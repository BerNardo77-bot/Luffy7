// Archivos que pasan el tope (1950 MB) o el espacio libre: opciones por número (vale 20 min).
// 1 Enlace directo · 2 En partes (video: ffmpeg por tiempo, cada parte se reproduce; otros: .001/.002) · 3 Comprimir (video)
// Usa el mismo almacén de listas que yt/tt/xnxx (gana la lista más nueva del chat).
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { savePick, readPick, clearPick, bareNumber } from './nsfw-pick.js'
import { TMP_DIR, ensureTmp, freeBytes, mb, rmQuiet, MAX_FILE_BYTES, ytdlpToFile, urlToFile, friendlyError } from './mediadl.js'

const run = promisify(execFile)
export const SITE = 'oversize'
const TTL = 20 * 60 * 1000
const MARGIN = 300 * 1024 * 1024

// Tope de descarga: espacio libre menos margen, máximo 10 GB (MAX_DOWNLOAD_MB lo fija)
export function downloadCap() {
  const env = Number(process.env.MAX_DOWNLOAD_MB) * 1024 * 1024
  const hard = env > 0 ? env : 10 * 1024 ** 3
  return Math.max(0, Math.min(hard, freeBytes() - MARGIN))
}

const isVideoFile = (f) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(f || '')

async function duration(file) {
  try { const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 60000 }); return Number(stdout.trim()) || 0 } catch { return 0 }
}

export async function splitVideo(file, limit) {
  const size = fs.statSync(file).size
  const dur = await duration(file)
  if (!dur) throw new Error('no pude leer la duración')
  const dir = path.dirname(file)
  const stem = path.basename(file).replace(/\.[^.]+$/, '') + '-part'
  const ext = path.extname(file) || '.mp4'
  const list = () => fs.readdirSync(dir).filter((f) => f.startsWith(stem)).sort().map((f) => path.join(dir, f))
  let factor = 0.85
  for (let i = 0; i < 4; i++) {
    for (const p of list()) rmQuiet(p)
    const seg = Math.max(5, Math.floor(dur * (limit * factor) / size))
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-f', 'segment', '-segment_time', String(seg), '-reset_timestamps', '1', path.join(dir, `${stem}%03d${ext}`)], { timeout: 2 * 60 * 60 * 1000 })
    const parts = list()
    if (parts.length && parts.every((p) => fs.statSync(p).size <= limit)) return parts
    factor *= 0.7
  }
  for (const p of list()) rmQuiet(p)
  throw new Error('no pude cortar el video en partes que quepan')
}

export async function splitBinary(file, limit, name) {
  const chunk = Math.floor(limit * 0.98)
  const size = fs.statSync(file).size
  const parts = []
  const fd = fs.openSync(file, 'r')
  try {
    for (let i = 0; i * chunk < size; i++) {
      const out = path.join(ensureTmp(), `${Date.now()}-${name}.${String(i + 1).padStart(3, '0')}`)
      await new Promise((res, rej) => fs.createReadStream(null, { fd, start: i * chunk, end: Math.min(size, (i + 1) * chunk) - 1, autoClose: false }).pipe(fs.createWriteStream(out)).on('finish', res).on('error', rej))
      parts.push(out)
    }
  } finally { fs.closeSync(fd) }
  return parts
}

async function compressVideo(file, limit) {
  const dur = await duration(file)
  if (!dur) throw new Error('no pude leer la duración')
  const kbps = Math.floor((limit * 0.9 * 8) / dur / 1000) - 128
  if (kbps < 150) throw new Error('es demasiado largo para comprimirlo a ese tamaño; usa "En partes"')
  const out = file.replace(/\.[^.]+$/, '') + '-comp.mp4'
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { timeout: 4 * 60 * 60 * 1000 })
  return out
}

/**
 * Ofrece opciones. Al menos uno de: file (ya bajado), fetchFile(maxBytes) → {file}, link.
 */
export async function offerOversize({ msg, sock, file = null, fetchFile = null, size = 0, video = true, link = '', fileName = 'archivo', reason = '' }) {
  const opts = []
  if (link) opts.push({ act: 'link' })
  if (file || fetchFile) opts.push({ act: 'parts' })
  if ((file || fetchFile) && video) opts.push({ act: 'comp' })
  const labels = { link: 'Enlace directo', parts: 'En partes (cada una cabe en WhatsApp)', comp: 'Comprimir (tarda; baja la calidad)' }
  const offer = { file, fetchFile, size, video, link, fileName }
  if (!opts.length) return msg.reply(`《✧》 ${reason || 'El archivo es demasiado grande.'}`)
  savePick(msg.chat, { sender: msg.sender, msg, fromMe: msg.fromMe, site: SITE, ttlMs: TTL, items: opts.map((o) => ({ ...o, offer })) })
  const head = reason || `Pesa ${size ? '~' + mb(size) + ' MB' : 'demasiado'} y el tope es ${mb(MAX_FILE_BYTES)} MB.`
  return msg.reply(`《✧》 ${head}\n\n${opts.map((o, i) => `*${i + 1}.* ${labels[o.act]}`).join('\n')}\n\nResponde con el número · vale 20 min`)
}

// Para errores TOO_BIG / NO_SPACE de ytdlpToFile/urlToFile: ofrece opciones; si no, el mensaje de siempre.
export async function replyDlError({ msg, sock, e, url = '', direct = false, maxSec = 0, maxMin = 120, link = '', fileName = 'video.mp4', video = true }) {
  const m = String(e?.message || e || '')
  if (!/^(TOO_BIG|NO_SPACE):/.test(m) || !url) return msg.reply(friendlyError(e, { maxMin, link: link || url }))
  const size = /^TOO_BIG:/.test(m) ? Number(m.split(':')[1]) * 1024 * 1024 : 0
  const fetchFile = direct
    ? (max) => urlToFile(url, { maxBytes: max, ext: (fileName.split('.').pop() || 'bin') })
    : (max) => ytdlpToFile(url, { maxBytes: max, maxSec })
  const reason = /^NO_SPACE:/.test(m) ? m.slice(9).trim() + ' Puedo intentarlo en partes si liberas espacio, o mandarte el enlace.' : ''
  return offerOversize({ msg, sock, fetchFile, size, video, link: link || url, fileName, reason })
}

async function sendPart(sock, msg, file, name, caption, video) {
  await sock.sendMessage(msg.chat, { document: { url: file }, mimetype: video ? 'video/mp4' : 'application/octet-stream', fileName: name, caption }, { quoted: msg })
}

async function doParts(msg, sock, o) {
  let parts = []
  try {
    if (!o.file) {
      const cap = downloadCap()
      if (o.size && o.size * 2.1 > cap + MARGIN) return msg.reply(`《✧》 No hay espacio: hacen falta ~${mb(o.size * 2.1)} MB libres y hay ${mb(cap)} MB. Libera espacio o usa el enlace.`)
      await msg.reply('《✧》 Descargando completo para cortarlo en partes…')
      const got = await o.fetchFile(cap)
      o.file = got.file
    }
    const size = fs.statSync(o.file).size
    if (size * 1.05 > freeBytes()) return msg.reply(`《✧》 No hay espacio para cortar (${mb(size)} MB). Libera espacio o usa el enlace.`)
    if (size <= MAX_FILE_BYTES) {
      await sendPart(sock, msg, o.file, o.fileName, `(${mb(size)} MB)`, o.video)
      return
    }
    await msg.reply(`《✧》 Cortando ${mb(size)} MB en partes…`)
    let binary = !(o.video || isVideoFile(o.file))
    if (!binary) { try { parts = await splitVideo(o.file, MAX_FILE_BYTES) } catch (e) { console.error('[oversize] video', e?.message); binary = true } }
    if (binary) parts = await splitBinary(o.file, MAX_FILE_BYTES, o.fileName.replace(/[^\w.\- ]+/g, '_'))
    for (let i = 0; i < parts.length; i++) {
      const name = binary ? path.basename(parts[i]).replace(/^\d+-/, '') : o.fileName.replace(/(\.[^.]+)?$/, `_parte${i + 1}$1`)
      await sendPart(sock, msg, parts[i], name, `Parte ${i + 1}/${parts.length} · ${mb(fs.statSync(parts[i]).size)} MB`, !binary)
      rmQuiet(parts[i])
    }
    if (binary) await msg.reply('Para unir: en Android abre la .001 con ZArchiver (todas en la misma carpeta). En PC (cmd): copy /b archivo.001+archivo.002+… archivo_final')
  } finally {
    for (const p of parts) rmQuiet(p)
    rmQuiet(o.file)
  }
}

async function doCompress(msg, sock, o) {
  let out = null
  try {
    if (!o.file) {
      await msg.reply('《✧》 Descargando para comprimir…')
      o.file = (await o.fetchFile(downloadCap())).file
    }
    await msg.reply('《✧》 Comprimiendo (puede tardar bastante en el teléfono)…')
    out = await compressVideo(o.file, MAX_FILE_BYTES * 0.95)
    await sendPart(sock, msg, out, o.fileName.replace(/(\.[^.]+)?$/, '_comprimido.mp4'), `Comprimido · ${mb(fs.statSync(out).size)} MB`, true)
  } finally { rmQuiet(out, o.file) }
}

export async function before({ msg, sock }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== SITE) return false
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige un número del 1 al ${hit.items.length}.`); return true }
  const it = hit.items[n - 1]
  clearPick(msg)
  try {
    if (it.act === 'link') await msg.reply(`🔗 ${it.offer.link}`)
    else if (it.act === 'parts') await doParts(msg, sock, it.offer)
    else await doCompress(msg, sock, it.offer)
  } catch (e) {
    console.error('[oversize]', e?.message || e)
    await msg.reply(`《✧》 No se pudo: ${String(e?.message || e).replace(/^(TOO_BIG|NO_SPACE):/, '').slice(0, 200)}`).catch(() => {})
  }
  return true
}
