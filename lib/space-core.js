// X Spaces: info y descarga de la grabación con yt-dlp → MP3 128k con portada (avatar del anfitrión).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fetch from 'node-fetch'

const run = promisify(execFile)
export const SPACE_RE = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/i\/spaces\/([A-Za-z0-9]+)/i
export const spaceUrl = (t) => { const m = String(t || '').match(SPACE_RE); return m ? `https://x.com/i/spaces/${m[1]}` : null }
const BINS = [[process.env.YT_DLP_PATH, []], ['yt-dlp', []], [path.join(os.homedir(), '.local/bin/yt-dlp'), []], ['python3', ['-m', 'yt_dlp']], ['python', ['-m', 'yt_dlp']]].filter(b => b[0])

async function ytdlp(args, opts = {}) {
  let last
  for (const [bin, pre] of BINS) {
    try { return await run(bin, [...pre, ...args], { maxBuffer: 32 * 1024 * 1024, ...opts }) } catch (e) { if (e?.code === 'ENOENT') continue; last = e; break }
  }
  throw last || new Error('yt-dlp no está instalado')
}
const firstBin = async () => {
  for (const [bin, pre] of BINS) { try { await run(bin, [...pre, '--version'], { timeout: 20000 }); return [bin, pre] } catch {} }
  throw new Error('yt-dlp no está instalado')
}
const errLine = (e) => String(e?.stderr || e?.message || e).split('\n').filter(l => /ERROR/.test(l)).pop() || String(e?.message || e).slice(0, 200)

/** → { status: 'recorded'|'live'|'upcoming'|'unavailable', title, host, hostId, avatar, url, reason } */
export async function spaceInfo(url) {
  try {
    const { stdout } = await ytdlp(['-J', '--no-warnings', '--no-playlist', url], { timeout: 60000 })
    const d = JSON.parse(stdout)
    const st = d.live_status
    return {
      status: st === 'is_live' ? 'live' : st === 'is_upcoming' ? 'upcoming' : (d.formats || []).length ? 'recorded' : 'unavailable',
      title: d.title || 'Space', host: d.uploader || '', hostId: d.uploader_id || '', avatar: d.thumbnail || '', url, duration: d.duration || 0, timestamp: d.timestamp || 0
    }
  } catch (e) {
    const r = errLine(e)
    let reason = 'No se pudo abrir el Space.'
    if (/not available|no longer|does not exist|deleted|404|not found/i.test(r)) reason = 'Ese Space no existe o lo borraron.'
    else if (/not recorded|no recording|replay/i.test(r)) reason = 'Ese Space no se grabó (el anfitrión no activó la grabación).'
    else if (/login|cookies|authentication|private|protected/i.test(r)) reason = 'Ese Space es privado o pide iniciar sesión en X.'
    else if (/is live|live now/i.test(r)) return { status: 'live', title: 'Space', host: '', url }
    else if (/scheduled|upcoming|not started/i.test(r)) return { status: 'upcoming', title: 'Space', host: '', url }
    return { status: 'unavailable', reason, detail: r.slice(0, 200), url }
  }
}

async function probe(f) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeout: 60000 })
    return Number(String(stdout).trim()) || 0
  } catch { return 0 }
}
async function avatarJpeg(url, dir) {
  if (!url) return null
  try {
    const big = url.replace(/_(normal|bigger|200x200|400x400)\./, '_400x400.')
    const r = await fetch(big, { timeout: 8000 })
    if (!r.ok) return null
    const i = path.join(dir, 'av'), o = path.join(dir, 'cover.jpg')
    fs.writeFileSync(i, Buffer.from(await r.arrayBuffer()))
    await run('ffmpeg', ['-y', '-v', 'error', '-i', i, '-vf', 'scale=500:500:force_original_aspect_ratio=decrease:flags=lanczos,pad=500:500:(ow-iw)/2:(oh-ih)/2:black,format=yuvj420p', '-frames:v', '1', '-q:v', '2', o], { timeout: 20000 })
    return fs.existsSync(o) ? o : null
  } catch { return null }
}
export const cleanName = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min` }
export { hms }

/**
 * Baja la grabación y la convierte a MP3 128k con portada/etiquetas.
 * Si pasa de maxBytes, la parte en trozos por tiempo (Parte 1/N).
 * onProgress(texto) se llama con el avance (no más de una vez cada ~10 s).
 * → { dir, parts:[{file,name,seconds,size}], duration, cover } — borra `dir` al terminar.
 */
export async function downloadSpace(info, { maxBytes = 95 * 1024 * 1024, onProgress = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-'))
  try {
    const [bin, pre] = await firstBin()
    const src = path.join(dir, 'src.%(ext)s')
    let lastT = 0
    await new Promise((resolve, reject) => {
      const p = spawn(bin, [...pre, '-f', 'bestaudio/best', '--no-playlist', '--newline', '--no-warnings', '--concurrent-fragments', '8', '-o', src, info.url])
      let err = ''
      const onData = (b) => {
        const s = b.toString(); err = (err + s).slice(-3000)
        const m = s.match(/\[download\]\s+([\d.]+)%/g)
        if (m && Date.now() - lastT > 10000) { lastT = Date.now(); onProgress(`⬇️ Bajando: ${m[m.length - 1].match(/([\d.]+)%/)[1]}%`) }
      }
      p.stdout.on('data', onData); p.stderr.on('data', onData)
      const to = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Tardó demasiado (más de 2 h bajando).')) }, 2 * 3600 * 1000)
      p.on('error', reject)
      p.on('close', (c) => { clearTimeout(to); c === 0 ? resolve() : reject(new Error(errLine({ stderr: err }))) })
    })
    const sf = fs.readdirSync(dir).find(f => f.startsWith('src.'))
    if (!sf) throw new Error('yt-dlp no dejó ningún archivo.')
    const srcF = path.join(dir, sf)
    const duration = await probe(srcF)
    if (!(duration > 1)) throw new Error('La grabación está vacía.')
    const cover = await avatarJpeg(info.avatar, dir)
    const BITRATE = 128000
    const est = duration * BITRATE / 8 + 600 * 1024
    const n = est > maxBytes ? Math.ceil(est / (maxBytes * 0.92)) : 1
    const partSec = Math.ceil(duration / n)
    const base = cleanName(`${info.host ? info.host + ' - ' : ''}${info.title || 'Space'}`).slice(0, 90) || 'Space'
    const parts = []
    for (let i = 0; i < n; i++) {
      onProgress(n > 1 ? `🎛 Convirtiendo a MP3: parte ${i + 1}/${n}…` : '🎛 Convirtiendo a MP3…')
      const name = n > 1 ? `${base} (Parte ${i + 1} de ${n}).mp3` : `${base}.mp3`
      const out = path.join(dir, `p${i + 1}.mp3`)
      const title = n > 1 ? `${info.title} (Parte ${i + 1}/${n})` : info.title
      const args = ['-y', '-v', 'error', ...(n > 1 ? ['-ss', String(i * partSec), '-t', String(partSec)] : []), '-i', srcF]
      if (cover) args.push('-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
      else args.push('-map', '0:a:0', '-vn')
      args.push('-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-id3v2_version', '3', '-write_xing', '1',
        '-metadata', `title=${title}`, '-metadata', `artist=${info.host || info.hostId || 'X Space'}`, '-metadata', 'album=X Spaces',
        ...(n > 1 ? ['-metadata', `track=${i + 1}/${n}`] : []), '-f', 'mp3', out)
      await run('ffmpeg', args, { timeout: Math.max(600, partSec) * 1000 })
      parts.push({ file: out, name, seconds: Math.round(await probe(out)), size: fs.statSync(out).size })
    }
    fs.rmSync(srcF, { force: true })
    return { dir, parts, duration, cover: cover ? fs.readFileSync(cover) : null }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

export const SEARCH_MSG = (P) => `🔎 X no deja buscar Spaces por nombre sin cuenta de pago, así que necesito el *link* del Space.\nEn la app de X: abre el Space → Compartir → Copiar link, y mándamelo así:\n${P}space https://x.com/i/spaces/…`
