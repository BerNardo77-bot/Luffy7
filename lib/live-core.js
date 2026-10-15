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

/** TikTok: "tiktok @user", "tt user", links tiktok.com/@user(/live) o vm.tiktok.com → URL /live. null si no es TikTok. */
export async function tiktokTarget(arg) {
  const t = String(arg || '').trim()
  let m = t.match(/^(?:tiktok|tt)\s+@?([\w.\-]+)/i)
  if (m) return `https://www.tiktok.com/@${m[1]}/live`
  let u = (t.match(/https?:\/\/\S*tiktok\.com\S*/i) || [])[0]
  if (!u) return null
  if (/\/\/(vm|vt)\.tiktok\.com|tiktok\.com\/t\//i.test(u)) {
    try { const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }); const loc = r.headers.get('location'); if (loc) u = loc } catch {}
  }
  m = u.match(/tiktok\.com\/@([\w.\-]+)/i)
  return m ? `https://www.tiktok.com/@${m[1]}/live` : u
}
export const isTiktok = (u) => /tiktok\.com/i.test(String(u || ''))

/** TikTok por su API web pública (yt-dlp a veces dice "no está en vivo" aunque sí lo esté). null si falla. */
async function tiktokRoom(url) {
  const user = (String(url).match(/tiktok\.com\/@([\w.\-]+)/i) || [])[1]
  if (!user) return null
  try {
    const r = await fetch(`https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${encodeURIComponent(user)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Encoding': 'identity' }, timeout: 12000 })
    if (r.status === 403 || r.status === 429) return { status: 'blocked', tiktok: true, reason: 'TikTok bloqueó al servidor del bot (pasa con IPs de servidores). Intenta más tarde o ábrelo en la app de TikTok.' }
    const j = await r.json().catch(() => null)
    if (!j) return null
    const d = j.data || {}
    if (!d.user) return /not exist|not found/i.test(j.message || j.status_msg || '') || j.statusCode === 10221 ? { status: 'nouser', tiktok: true } : null
    const room = d.liveRoom || {}
    const base = { tiktok: true, title: room.title || `${d.user.nickname || user} en vivo`, channel: `${d.user.nickname || user} (@${d.user.uniqueId || user})`, thumb: room.coverUrl || d.user.avatarLarger || '', url }
    if (Number(room.status ?? d.user.status) !== 2) return { status: 'notlive', ...base }
    let sd = {}
    try { sd = JSON.parse(room.streamData?.pull_data?.stream_data || '{}').data || {} } catch {}
    const order = ['origin', 'uhd', 'hd', 'sd', 'ld']
    const q = order.find(k => sd[k]?.main?.flv || sd[k]?.main?.hls) || Object.keys(sd).find(k => k !== 'ao')
    const main = sd[q]?.main || {}
    const master = main.flv || main.hls || ''
    if (!master) return null
    const alt = main.hls && main.flv ? main.hls : ''
    const audio = sd.ao?.main?.flv || sd.ao?.main?.hls || ''
    const exp = Number((master.match(/[?&]expire=(\d{10})/) || [])[1]) || 0
    return { status: 'live', ...base, master, alt, audio, expires: exp, ipBound: false }
  } catch { return null }
}

/** → { status:'live'|'upcoming'|'ended'|'notlive'|'error', title, channel, thumb, master, audio, videoId, reason } */
export async function liveInfo(url) {
  if (isTiktok(url)) { const t = await tiktokRoom(url); if (t && t.status !== 'notlive') return t; if (t?.status === 'notlive') return t }
  try {
    const { stdout } = await ytdlp(['-J', '--no-warnings', '--no-playlist', url], { timeout: 90000 })
    const d = JSON.parse(stdout)
    const base = { title: d.title || 'En vivo', channel: d.channel || d.uploader || '', thumb: d.thumbnail || '', videoId: d.id, url: d.webpage_url || url }
    if (d.live_status === 'is_upcoming') return { status: 'upcoming', ...base }
    if (d.live_status !== 'is_live') return { status: d.live_status === 'was_live' || d.live_status === 'post_live' ? 'ended' : 'notlive', ...base }
    const f = d.formats || []
    if (isTiktok(url)) {
      // TikTok: FLV/HLS directos; el mejor por calidad (sin audio separado)
      const ok = f.filter(x => x.url)
      const best = ok.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0) || (b.quality || 0) - (a.quality || 0))[0]
      const hls = ok.filter(x => /m3u8/.test(x.protocol || '') || /\.m3u8/.test(x.url)).sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))[0]
      const ao = f.find(x => x.vcodec === 'none' && x.url)
      const main = best?.url || ''
      const exp = Number((main.match(/[?&]expire=(\d{10})/) || [])[1]) || 0
      return { status: 'live', ...base, title: d.title || `${d.uploader || 'TikTok'} en vivo`, channel: d.uploader || d.channel || d.uploader_id || '', thumb: d.thumbnail || (d.thumbnails || []).slice(-1)[0]?.url || '', master: main, alt: hls && hls.url !== main ? hls.url : '', audio: ao?.url || '', expires: exp, ipBound: false, tiktok: true }
    }
    const master = (f.find(x => /hls_variant/.test(x.manifest_url || '')) || {}).manifest_url || ''
    const muxed = f.filter(x => x.acodec && x.acodec !== 'none' && x.vcodec && x.vcodec !== 'none' && /m3u8/.test(x.protocol || '')).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    const aud = f.filter(x => x.acodec !== 'none' && x.vcodec === 'none' && /m3u8/.test(x.protocol || '')).sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]
    const exp = Number(((master || muxed?.url || aud?.url || '').match(/\/expire\/(\d+)/) || [])[1]) || 0
    return { status: 'live', ...base, master: master || muxed?.url || '', audio: (f.find(x => x.format_id === '234') || aud)?.url || '', expires: exp, ipBound: /\/ip\/[^/]+/.test(master || aud?.url || '') }
  } catch (e) {
    const r = errLine(e)
    if (isTiktok(url)) {
      if (/not currently live|not live/i.test(r)) return { status: 'notlive', tiktok: true }
      if (/does not exist|couldn.t find|unable to find|user.*not found|404/i.test(r)) return { status: 'nouser', tiktok: true }
      if (/403|blocked|captcha|verify|region|not available in your/i.test(r)) return { status: 'blocked', tiktok: true, reason: 'TikTok bloqueó al servidor del bot (pasa con IPs de servidores). Intenta más tarde o ábrelo en la app de TikTok.' }
      return { status: 'error', tiktok: true, reason: r.slice(0, 200) }
    }
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
  const src = info.audio || info.master || info.alt
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
  const cuando = h > 48 ? `unos ${Math.round(h / 24)} días` : `unas ${h} h`
  if (info.tiktok) return info.expires ? `⚠️ El link caduca en ${cuando}, o antes si termina el en vivo. Si deja de abrir, pídelo otra vez.` : '⚠️ Este link de TikTok puede caducar pronto (y se corta cuando termina el en vivo). Si deja de abrir, pídelo otra vez.'
  if (IS_PHONE) return `⚠️ El link caduca en unas ${h} h. Lo pidió este mismo teléfono, así que debe abrir aquí (si cambias de red y falla, pídelo otra vez).`
  return `⚠️ El link caduca en unas ${h} h y YouTube lo liga a la IP del servidor del bot. En mi prueba sí abrió desde otra IP, pero si en tu teléfono no abre, pídelo otra vez o usa la app de YouTube.`
}
