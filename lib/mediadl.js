// Descargas de video seguras para Termux: yt-dlp a disco (sin cargar todo en RAM),
// revisión de espacio libre, tope 500 MB, video ≤64 MB y documento arriba, limpieza de temporales.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Transform, Readable } from 'stream'
import { pipeline } from 'stream/promises'

const execFileAsync = promisify(execFile)
export const TMP_DIR = path.join(process.cwd(), 'tmp')
export const MAX_FILE_BYTES = (Number(process.env.MAX_FILE_MB) || 500) * 1024 * 1024
export const MAX_VIDEO_SEND = 64 * 1024 * 1024
export const YTDLP_TIMEOUT_MS = 20 * 60 * 1000
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

export const mb = (n) => (Number(n || 0) / 1024 / 1024).toFixed(1)

export function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  return TMP_DIR
}

export function freeBytes(dir = ensureTmp()) {
  try {
    const st = fs.statfsSync(dir)
    return Number(st.bavail) * Number(st.bsize)
  } catch { return Infinity }
}

// Pide ~2x el tamaño esperado (descarga + piezas que yt-dlp une). Lanza error legible si no hay.
export function checkSpace(expectedBytes) {
  const need = Math.max(Number(expectedBytes) || 0, 20 * 1024 * 1024) * 2
  const free = freeBytes()
  if (free < need) {
    throw new Error(`NO_SPACE: hay ${mb(free)} MB libres en el teléfono y hacen falta ~${mb(need)} MB. Libera espacio.`)
  }
}

export function rmQuiet(...files) {
  for (const f of files) { try { if (f) fs.rmSync(f, { force: true }) } catch {} }
}

function cleanPrefix(prefix) {
  try {
    for (const f of fs.readdirSync(TMP_DIR)) if (f.startsWith(prefix)) rmQuiet(path.join(TMP_DIR, f))
  } catch {}
}

// ¿Respuesta de alyacore sin saldo?
export function isNoCredit(json, status) {
  return Number(status) === 429 || Number(json?.code) === 429 || /saldo|rate_limit_balance/i.test(String(json?.type || json?.message || ''))
}
export const NO_CREDIT_MSG = 'la API de alyacore se quedó sin saldo (429)'

let ytdlpBin = null
async function ytdlp(args, opts = {}) {
  const tries = ytdlpBin ? [ytdlpBin] : [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']], ['python', ['-m', 'yt_dlp']]]
  let last
  for (const [bin, pre] of tries) {
    try {
      const r = await execFileAsync(bin, [...pre, ...args], { maxBuffer: 64 * 1024 * 1024, ...opts })
      ytdlpBin = [bin, pre]
      return r
    } catch (e) {
      last = e
      if (e?.code !== 'ENOENT') { ytdlpBin = [bin, pre]; throw e }
    }
  }
  const err = new Error('yt-dlp no está instalado. En Termux: pkg install yt-dlp')
  err.cause = last
  throw err
}

function ytErr(e) {
  const t = String(e?.stderr || e?.message || e || '')
  const line = t.split('\n').reverse().find((l) => /ERROR/.test(l)) || t.split('\n').find(Boolean) || t
  return line.replace(/\s+/g, ' ').trim().slice(0, 220)
}

const isYouTube = (u) => /youtu(\.be|be\.com)/i.test(String(u))

// Formatos por altura: H.264 + m4a (se une sin reencodear), luego cualquier mp4.
function formatFor(h, youtube) {
  if (!youtube) return `b[ext=mp4][height<=${h}]/b[height<=${h}]/bv*[height<=${h}]+ba/b`
  return [
    `bv*[vcodec^=avc1][height<=${h}]+ba[ext=m4a]`,
    `bv*[vcodec^=avc1][height<=${h}]+ba`,
    `b[vcodec^=avc1][height<=${h}]`,
    `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]`,
    `b[height<=${h}]`
  ].join('/')
}

function commonArgs(url) {
  const a = ['--no-playlist', '--no-warnings', '--no-part', '--retries', '3', '--socket-timeout', '30']
  if (isYouTube(url)) a.push('--js-runtimes', 'node', '--remote-components', 'ejs:github')
  return a
}

function estimateSize(info) {
  const parts = Array.isArray(info?.requested_formats) && info.requested_formats.length ? info.requested_formats : [info]
  let total = 0
  for (const f of parts) total += Number(f?.filesize || f?.filesize_approx || 0)
  if (!total && info?.filesize_approx) total = Number(info.filesize_approx)
  return total
}

/**
 * Baja con yt-dlp a un archivo en tmp/. Prueba 1080 → 720 → 480 hasta que quepa en 500 MB.
 * maxSec: tope de duración (0 = sin tope). onStatus(text): avisos opcionales.
 * Devuelve { file, size, duration, height, title }. Lanza TOO_LONG:<sec>, TOO_BIG:<mb>, NO_SPACE:...
 */
export async function ytdlpToFile(url, { heights = [1080, 720, 480], maxSec = 0, maxBytes = MAX_FILE_BYTES, onStatus, tag = 'vid' } = {}) {
  ensureTmp()
  const youtube = isYouTube(url)
  let lastErr = ''
  let tooBig = 0
  for (const h of heights) {
    const fmt = formatFor(h, youtube)
    let info = null
    try {
      const { stdout } = await ytdlp(['-J', '-f', fmt, ...commonArgs(url), url], { timeout: 120000 })
      info = JSON.parse(stdout)
    } catch (e) {
      if (/no está instalado/.test(e?.message)) throw e
      lastErr = ytErr(e)
      continue
    }
    const duration = Number(info?.duration || 0)
    if (maxSec && duration > maxSec) throw new Error(`TOO_LONG:${Math.round(duration)}`)
    const est = estimateSize(info)
    if (est && est > maxBytes) { tooBig = est; continue }
    checkSpace(est || (duration ? duration * 400 * 1024 : 100 * 1024 * 1024))
    const prefix = `${tag}-${Date.now()}-${h}`
    const outTpl = path.join(TMP_DIR, `${prefix}.%(ext)s`)
    if (onStatus && h !== heights[0]) await onStatus(`Bajando en ${h}p para que no pase de ${mb(maxBytes)} MB…`)
    try {
      await ytdlp(['-f', fmt, '--merge-output-format', 'mp4', '--max-filesize', String(maxBytes), ...commonArgs(url), '-o', outTpl, url], { timeout: YTDLP_TIMEOUT_MS })
    } catch (e) {
      cleanPrefix(prefix)
      lastErr = e?.killed ? 'yt-dlp tardó más de 20 min y se canceló' : ytErr(e)
      continue
    }
    const hit = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(prefix) && !/\.(part|ytdl|temp)/.test(f)).sort((a, b) => (b.endsWith('.mp4') ? 1 : 0) - (a.endsWith('.mp4') ? 1 : 0))[0]
    if (!hit) { cleanPrefix(prefix); lastErr = 'yt-dlp no generó archivo (¿pasó de 500 MB?)'; tooBig = tooBig || est; continue }
    const file = path.join(TMP_DIR, hit)
    const size = fs.statSync(file).size
    if (size > maxBytes) { cleanPrefix(prefix); tooBig = size; continue }
    return { file, size, duration, height: Number(info?.height || 0) || h, title: info?.title || '' }
  }
  if (tooBig) throw new Error(`TOO_BIG:${mb(tooBig)}`)
  throw new Error(lastErr || 'yt-dlp no pudo bajar el video')
}

// Descarga HTTP en streaming a disco con tope de bytes y timeout por inactividad.
export async function urlToFile(url, { maxBytes = MAX_FILE_BYTES, ext = 'mp4', tag = 'dl', headers = {}, idleMs = 60000 } = {}) {
  ensureTmp()
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, redirect: 'follow' })
  return responseToFile(res, { maxBytes, ext, tag, idleMs })
}

// Igual que urlToFile pero con una respuesta fetch ya abierta.
export async function responseToFile(res, { maxBytes = MAX_FILE_BYTES, ext = 'mp4', tag = 'dl', idleMs = 60000 } = {}) {
  ensureTmp()
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > maxBytes) { try { await res.body?.cancel?.() } catch {} throw new Error(`TOO_BIG:${mb(len)}`) }
  checkSpace(len || 100 * 1024 * 1024)
  const file = path.join(TMP_DIR, `${tag}-${Date.now()}.${ext}`)
  let size = 0
  let idle
  const limiter = new Transform({
    transform(chunk, _e, cb) {
      size += chunk.length
      clearTimeout(idle)
      idle = setTimeout(() => limiter.destroy(new Error('Descarga detenida (sin datos 60 s)')), idleMs)
      if (size > maxBytes) return cb(new Error(`TOO_BIG:${mb(size)}`))
      cb(null, chunk)
    }
  })
  idle = setTimeout(() => limiter.destroy(new Error('Descarga detenida (sin datos 60 s)')), idleMs)
  try {
    await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(file))
  } catch (e) {
    rmQuiet(file)
    throw e
  } finally { clearTimeout(idle) }
  return { file, size }
}

// Video normal hasta 64 MB; documento arriba. Siempre borra el archivo al terminar.
export async function sendVideoFile(sock, msg, file, { caption = '', fileName = 'video.mp4', keep = false } = {}) {
  try {
    const size = fs.statSync(file).size
    const safeName = String(fileName || 'video.mp4').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'video.mp4'
    if (size <= MAX_VIDEO_SEND) {
      try {
        await sock.sendMessage(msg.chat, { video: { url: file }, mimetype: 'video/mp4', fileName: safeName, caption }, { quoted: msg })
        return 'video'
      } catch (e) {
        console.error('[mediadl] video fail, documento', e?.message || e)
      }
    }
    await sock.sendMessage(msg.chat, {
      document: { url: file }, mimetype: 'video/mp4', fileName: safeName,
      caption: (caption ? caption + '\n' : '') + `(${mb(size)} MB, documento)`
    }, { quoted: msg })
    return 'document'
  } finally {
    if (!keep) rmQuiet(file)
  }
}

// Mensaje legible para errores de ytdlpToFile / urlToFile
export function friendlyError(e, { maxMin = 60, link = '' } = {}) {
  const m = String(e?.message || e || '')
  const tail = link ? `\n🔗 ${link}` : ''
  if (m.startsWith('TOO_LONG:')) return `《✧》 Ese video dura ~${Math.round(Number(m.split(':')[1]) / 60)} min. El límite es ${maxMin} min.${tail}`
  if (m.startsWith('TOO_BIG:')) return `《✧》 Ni en calidad baja cabe: pesa ~${m.split(':')[1]} MB y el límite es ${mb(MAX_FILE_BYTES)} MB.${tail}`
  if (m.startsWith('NO_SPACE:')) return `《✧》 ${m.slice(9).trim()}${tail}`
  return `《✧》 No se pudo bajar: ${m.slice(0, 220)}${tail}`
}

export async function ytdlpSearch(query, n = 20) {
  const { stdout } = await ytdlp(['-J', '--flat-playlist', '--no-warnings', `ytsearch${n}:${query}`], { timeout: 90000 })
  const j = JSON.parse(stdout)
  return (j?.entries || []).filter((v) => v?.id).map((v) => ({
    title: v.title || 'Sin título',
    autor: v.channel || v.uploader || '',
    seconds: Number(v.duration || 0),
    duration: fmtClock(Number(v.duration || 0)),
    views: v.view_count != null ? Number(v.view_count).toLocaleString('es-MX') : '',
    url: `https://youtu.be/${v.id}`,
    videoId: v.id
  }))
}

export function fmtClock(sec) {
  sec = Math.round(Number(sec) || 0)
  if (!sec) return ''
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`
}

export { os }
