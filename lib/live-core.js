// En vivo de YouTube: link directo HLS (para VLC) con yt-dlp + grabación de N min a MP3.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fetch from 'node-fetch'

const run = promisify(execFile)
export const MAX_LIVE_MIN = 30
export const IS_PHONE = fs.existsSync('/data/data/com.termux') || /com\.termux/.test(process.env.PREFIX || '')
const BINS = [[process.env.YT_DLP_PATH, []], ['yt-dlp', []], [path.join(os.homedir(), '.local/bin/yt-dlp'), []], ['python3', ['-m', 'yt_dlp']], ['python', ['-m', 'yt_dlp']]].filter(b => b[0])

async function ytdlp(args, opts = {}) {
  let last
  for (const [bin, pre] of BINS) {
    try { return await run(bin, [...pre, ...args], { maxBuffer: 64 * 1024 * 1024, ...opts }) } catch (e) { if (e?.code === 'ENOENT') continue; last = e; break }
  }
  throw last || new Error('yt-dlp no está instalado')
}
const errLine = (e) => String(e?.stderr || e?.message || e).split('\n').filter(l => /ERROR/.test(l)).pop() || String(e?.message || e).slice(0, 200)

/** "@MilenioTV", link de canal o de video → URL para yt-dlp. null si no parece YouTube. */
export function liveTarget(arg) {
  const t = String(arg || '').trim().split(/\s+/)[0]
  if (/^@[\w.\-]+$/.test(t)) return `https://www.youtube.com/${t}/live`
  if (!/^https?:\/\//i.test(t) || !/(youtube\.com|youtu\.be)/i.test(t)) return null
  const u = t.replace(/[?&]si=[^&]+/, '')
  if (/youtube\.com\/(@[\w.\-]+|channel\/[\w-]+|c\/[\w.\-]+|user\/[\w.\-]+)\/?(\?.*)?$/i.test(u)) return u.replace(/\/?(\?.*)?$/, '') + '/live'
  return u
}

/** → { status:'live'|'upcoming'|'ended'|'notlive'|'error', title, channel, thumb, master, audio, videoId, reason } */
export async function liveInfo(url) {
  try {
    const { stdout } = await ytdlp(['-J', '--no-warnings', '--no-playlist', url], { timeout: 90000 })
    const d = JSON.parse(stdout)
    const base = { title: d.title || 'En vivo', channel: d.channel || d.uploader || '', thumb: d.thumbnail || '', videoId: d.id, url: d.webpage_url || url }
    if (d.live_status === 'is_upcoming') return { status: 'upcoming', ...base }
    if (d.live_status !== 'is_live') return { status: d.live_status === 'was_live' || d.live_status === 'post_live' ? 'ended' : 'notlive', ...base }
    const f = d.formats || []
    const master = (f.find(x => /hls_variant/.test(x.manifest_url || '')) || {}).manifest_url || ''
    const muxed = f.filter(x => x.acodec && x.acodec !== 'none' && x.vcodec && x.vcodec !== 'none' && /m3u8/.test(x.protocol || '')).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    const aud = f.filter(x => x.acodec !== 'none' && x.vcodec === 'none' && /m3u8/.test(x.protocol || '')).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]
    const exp = Number(((master || muxed?.url || aud?.url || '').match(/\/expire\/(\d+)/) || [])[1]) || 0
    return { status: 'live', ...base, master: master || muxed?.url || '', audio: (f.find(x => x.format_id === '234') || aud)?.url || '', expires: exp, ipBound: /\/ip\/[^/]+/.test(master || aud?.url || '') }
  } catch (e) {
    const r = errLine(e)
    if (/not currently live|is not live|no.*live stream|does not have a .*live|\/live.*404|HTTP Error 404/i.test(r)) return { status: 'notlive', reason: r }
    if (/will begin|premieres|scheduled/i.test(r)) return { status: 'upcoming', reason: r }
    if (/sign in|confirm you.re not a bot|cookies/i.test(r)) return { status: 'error', reason: 'YouTube pidió verificación (bot) al servidor. Intenta más tarde.' }
    return { status: 'error', reason: r.slice(0, 200) }
  }
}

async function probeDur(f) {
  try { const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeout: 30000 }); return Number(String(stdout).trim()) || 0 } catch { return 0 }
}
const pad2 = (n) => String(n).padStart(2, '0')
export function stamp(d = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RADIO_TZ || 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day} ${p.hour}.${p.minute}`
  } catch { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}` }
}
const cleanName = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Graba N s del en vivo (pide links nuevos) → { file, dir, name, seconds, size, cover } */
export async function recordLive(url, seconds, { maxBytes = 0 } = {}) {
  seconds = Math.max(10, Math.min(Math.round(seconds), MAX_LIVE_MIN * 60))
  const info = await liveInfo(url)
  if (info.status !== 'live') throw new Error('Ya no está en vivo.')
  const src = info.audio || info.master
  if (!src) throw new Error('No encontré el audio del en vivo.')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'))
  try {
    let cover = null
    if (info.thumb) {
      try {
        const r = await fetch(info.thumb, { timeout: 8000 })
        if (r.ok) { const i = path.join(dir, 't'), o = path.join(dir, 'cover.jpg'); fs.writeFileSync(i, Buffer.from(await r.arrayBuffer())); await run('ffmpeg', ['-y', '-v', 'error', '-i', i, '-vf', 'scale=1000:-2:flags=lanczos,format=yuvj420p', '-frames:v', '1', '-q:v', '2', o], { timeout: 20000 }); cover = o }
      } catch {}
    }
    const when = stamp()
    const name = `${cleanName(info.channel || info.title).slice(0, 60) || 'En vivo'} - ${when}.mp3`
    const out = path.join(dir, 'rec.mp3')
    const args = ['-y', '-v', 'error', '-rw_timeout', '20000000', '-t', String(seconds), '-i', src]
    if (cover) args.push('-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v', 'comment=Cover (front)')
    else args.push('-map', '0:a:0', '-vn')
    args.push('-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-id3v2_version', '3', '-write_xing', '1',
      '-metadata', `title=${info.title} (${when})`, '-metadata', `artist=${info.channel || 'YouTube'}`, '-metadata', 'album=En vivo',
      ...(maxBytes > 0 ? ['-fs', String(maxBytes)] : []), '-f', 'mp3', out)
    try { await run('ffmpeg', args, { timeout: (seconds + 90) * 1000 }) } catch (e) { console.error('[envivo] ffmpeg', errLine(e)) }
    const dur = fs.existsSync(out) ? await probeDur(out) : 0
    if (dur < Math.min(5, seconds / 2)) throw new Error('No llegó audio del en vivo.')
    return { file: out, dir, name, seconds: Math.round(dur), size: fs.statSync(out).size, cover: cover ? fs.readFileSync(cover) : null, info }
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e }
}

export function vlcSteps() {
  return 'Cómo verlo en VLC (Android): abre VLC → pestaña "Más" (⋯) → "Nueva transmisión" → pega el link → toca la flecha ▶.'
}
export function ipNote(info) {
  const h = info.expires ? Math.max(1, Math.round((info.expires * 1000 - Date.now()) / 3600000)) : 6
  if (IS_PHONE) return `⚠️ El link caduca en unas ${h} h. Lo pidió este mismo teléfono, así que debe abrir aquí (si cambias de red y falla, pídelo otra vez).`
  return `⚠️ El link caduca en unas ${h} h y YouTube lo liga a la IP del servidor del bot. En mi prueba sí abrió desde otra IP, pero si en tu teléfono no abre, pídelo otra vez o usa la app de YouTube.`
}
