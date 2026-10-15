// Radio en vivo: Radio Browser (buscar estaciones) + grabación de un fragmento con ffmpeg → MP3 con portada.
import fs from 'fs'
import os from 'os'
import path from 'path'
import dns from 'dns'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fetch from 'node-fetch'

const run = promisify(execFile)
const UA = 'BotRadio/1.0 (+https://www.radio-browser.info)'
const MIRRORS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info', 'at1.api.radio-browser.info', 'nl1.api.radio-browser.info']
export const MAX_REC_MIN = 30
export const DEFAULT_REC_SEC = 60

let mirrorCache = null
async function mirrors() {
  if (mirrorCache) return mirrorCache
  let list = []
  try {
    const r = await fetch('https://all.api.radio-browser.info/json/servers', { headers: { 'User-Agent': UA }, timeout: 6000 })
    if (r.ok) list = (await r.json()).map(s => s.name).filter(Boolean)
  } catch {}
  if (!list.length) {
    try { list = (await dns.promises.reverse((await dns.promises.resolve4('all.api.radio-browser.info'))[0])).filter(Boolean) } catch {}
  }
  list = [...new Set([...list, ...MIRRORS])].sort(() => Math.random() - 0.5)
  mirrorCache = list
  setTimeout(() => { mirrorCache = null }, 3600000).unref?.()
  return list
}

async function api(pathQs) {
  let last
  for (const host of (await mirrors()).slice(0, 4)) {
    try {
      const r = await fetch(`https://${host}/json/${pathQs}`, { headers: { 'User-Agent': UA }, timeout: 10000 })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.json()
    } catch (e) { last = e }
  }
  throw last || new Error('Radio Browser no responde')
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
const COUNTRY = { mexico: 'MX', 'méxico': 'MX', espana: 'ES', españa: 'ES', colombia: 'CO', argentina: 'AR', chile: 'CL', peru: 'PE', 'perú': 'PE', venezuela: 'VE', 'estados unidos': 'US', usa: 'US', eeuu: 'US', 'republica dominicana': 'DO', dominicana: 'DO', 'puerto rico': 'PR', cuba: 'CU', ecuador: 'EC', guatemala: 'GT', honduras: 'HN', 'el salvador': 'SV', nicaragua: 'NI', 'costa rica': 'CR', panama: 'PA', 'panamá': 'PA', uruguay: 'UY', paraguay: 'PY', bolivia: 'BO', brasil: 'BR', francia: 'FR', italia: 'IT', alemania: 'DE', japon: 'JP', 'japón': 'JP', canada: 'CA', 'canadá': 'CA', 'reino unido': 'GB', inglaterra: 'GB' }

function shape(s) {
  return {
    uuid: s.stationuuid, name: String(s.name || '').trim() || 'Radio', url: s.url, url_resolved: s.url_resolved,
    favicon: s.favicon || '', country: s.country || '', cc: s.countrycode || '', state: s.state || '',
    codec: s.codec || '', bitrate: Number(s.bitrate) || 0, homepage: s.homepage || '', votes: Number(s.votes) || 0, clicks: Number(s.clickcount) || 0
  }
}

/** Busca por nombre, país (nombre o código), estado/ciudad y etiqueta. Más escuchadas primero. */
export async function searchStations(q, limit = 50) {
  const t = String(q || '').trim()
  if (!t) return []
  const base = `hidebroken=true&order=clickcount&reverse=true&limit=${limit}`
  const e = encodeURIComponent
  const cc = COUNTRY[norm(t)] || (/^[a-z]{2}$/i.test(t) ? t.toUpperCase() : '')
  const tries = cc ? [`stations/search?countrycode=${cc}&${base}`] : []
  tries.push(`stations/search?name=${e(t)}&${base}`)
  tries.push(`stations/search?country=${e(t)}&${base}`, `stations/search?state=${e(t)}&${base}`, `stations/search?tag=${e(t.toLowerCase())}&${base}`)
  const out = [], seen = new Set()
  for (const p of tries) {
    if (out.length >= limit) break
    let rows = []
    try { rows = await api(p) } catch (e) { if (!out.length && p === tries[tries.length - 1]) throw e }
    for (const s of rows || []) {
      if (!s?.url || seen.has(s.stationuuid)) continue
      const key = String(s.url_resolved || s.url).replace(/[?#].*/, '').replace(/\/+$/, '')
      if (seen.has(key)) continue
      seen.add(s.stationuuid); seen.add(key); out.push(shape(s))
    }
  }
  // Primero las que tienen la búsqueda como palabra en el nombre ("Exa" ≠ "Texas")
  const nq = norm(t), re = new RegExp(`(^|[^a-z0-9])${nq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`)
  const rank = (s) => norm(s.name) === nq ? 0 : re.test(norm(s.name)) ? 1 : (cc && s.cc === cc) || re.test(norm(`${s.country} ${s.state}`)) ? 2 : 3
  let ranked = out.map((s, i) => [rank(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (ranked.filter(x => x[0] < 3).length >= 5) ranked = ranked.filter(x => x[0] < 3) // sin coincidencias sueltas
  return ranked.map(x => x[2]).slice(0, limit)
}

/** Avisa a Radio Browser del clic (cuenta de popularidad); no bloquea. */
export function countClick(uuid) { if (uuid) api(`url/${uuid}`).catch(() => {}) }

export function isStreamUrl(s) { return /^https?:\/\/\S+$/i.test(String(s || '').trim()) }

/** .m3u/.pls → primer URL del stream. m3u8 (HLS) y streams directos se devuelven igual. */
async function expandPlaylist(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return [url]
  const looks = /\.(m3u|pls|asx|xspf)(\?|$)/i.test(url)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Icy-MetaData': '0' }, timeout: 8000, size: looks ? 512 * 1024 : 0 })
    const ct = String(r.headers.get('content-type') || '')
    if (looks || /mpegurl|scpls|x-scpls|playlist|text\/plain|text\/html/i.test(ct)) {
      if (/application\/vnd\.apple\.mpegurl/i.test(ct) && !looks) { r.body?.destroy?.(); return [url] }
      const txt = (await r.text()).slice(0, 200000)
      if (/#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(txt)) return [url]
      const urls = [...txt.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(m => m[0].replace(/[),;]+$/, ''))
      if (urls.length) return [...new Set(urls)].slice(0, 3)
    } else r.body?.destroy?.()
  } catch {}
  return [url]
}

async function probeDur(f) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { timeout: 30000 })
    return Number(String(stdout).trim()) || 0
  } catch { return 0 }
}

/** Favicon → JPEG cuadrado 500px (fondo blanco). null si no se puede. */
export async function faviconCover(url) {
  if (!url || !/^https?:/i.test(url) || /\.svg(\?|$)/i.test(url)) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fav-'))
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 5000, size: 3 * 1024 * 1024 })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 200 || /^\s*</.test(buf.slice(0, 64).toString())) return null
    const i = path.join(dir, 'in'), o = path.join(dir, 'out.jpg')
    fs.writeFileSync(i, buf)
    await run('ffmpeg', ['-y', '-v', 'error', '-i', i, '-vf', 'scale=500:500:force_original_aspect_ratio=decrease:flags=lanczos,pad=500:500:(ow-iw)/2:(oh-ih)/2:white,format=yuvj420p', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2', o], { timeout: 15000 })
    const out = fs.readFileSync(o)
    return out.length > 500 ? out : null
  } catch { return null } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

const pad2 = (n) => String(n).padStart(2, '0')
const TZ = process.env.RADIO_TZ || 'America/Mexico_City'
export function stamp(d = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day} ${p.hour}.${p.minute}`
  } catch { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}` }
}
export const cleanName = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Graba `seconds` de la estación a MP3 128k con portada (favicon) y etiquetas.
 * Prueba url_resolved, url y lo que tenga la lista .m3u/.pls; corta si no llega audio (timeout).
 * → { file, name, seconds, size, cover, tried } — borra tú `file` cuando lo mandes.
 */
export async function recordStation(st, seconds = DEFAULT_REC_SEC, { maxBytes = 0 } = {}) {
  seconds = Math.max(5, Math.min(Math.round(seconds), MAX_REC_MIN * 60))
  const cands = []
  for (const u of [st.url_resolved, st.url].filter(Boolean)) for (const x of await expandPlaylist(u)) if (!cands.includes(x)) cands.push(x)
  if (!cands.length) throw new Error('La estación no tiene URL de stream.')
  const cover = await faviconCover(st.favicon)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-'))
  const coverF = path.join(dir, 'cover.jpg')
  if (cover) fs.writeFileSync(coverF, cover)
  const when = new Date()
  const name = `${cleanName(st.name).slice(0, 80) || 'Radio'} - ${stamp(when)}.mp3`
  const out = path.join(dir, 'rec.mp3')
  const meta = ['-metadata', `title=${st.name} (${stamp(when)})`, '-metadata', `artist=${st.name}`, '-metadata', `album=Radio en vivo${st.country ? ' · ' + st.country : ''}`, '-metadata', `date=${when.getFullYear()}`]
  const errs = []
  for (const u of cands) {
    const inp = ['-y', '-v', 'error', '-user_agent', UA, '-rw_timeout', '15000000', ...(/^https?:/i.test(u) && !/\.m3u8/i.test(u) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : []), '-t', String(seconds), '-i', u]
    const maps = cover ? ['-i', coverF, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)'] : ['-map', '0:a:0', '-vn']
    const enc = ['-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-id3v2_version', '3', '-write_xing', '1', ...meta, ...(maxBytes > 0 ? ['-fs', String(maxBytes)] : []), '-f', 'mp3', out]
    try {
      fs.rmSync(out, { force: true })
      await run('ffmpeg', [...inp, ...maps, ...enc], { timeout: (seconds + 60) * 1000, maxBuffer: 4 * 1024 * 1024 })
    } catch (e) {
      errs.push(String(e?.stderr || e?.message || e).split('\n').filter(Boolean).pop()?.slice(0, 160) || 'error')
    }
    // ffmpeg puede salir con error al cortar el stream y aun así dejar audio útil
    const dur = fs.existsSync(out) ? await probeDur(out) : 0
    if (dur >= Math.min(5, seconds * 0.5)) {
      return { file: out, dir, name, seconds: Math.round(dur), size: fs.statSync(out).size, cover, url: u, tried: cands.length }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  throw new Error(`La estación no transmite ahora (sin audio). ${errs[errs.length - 1] || ''}`.trim())
}

export function stationLine(s, i) {
  const where = [s.state, s.country].filter(Boolean).join(', ')
  const q = [s.codec, s.bitrate ? s.bitrate + ' kbps' : ''].filter(Boolean).join(' ')
  return `${i + 1}. ${s.name}${where ? ` — ${where}` : ''}${q ? ` · ${q}` : ''}`
}
export function stationInfo(s) {
  const where = [s.state, s.country].filter(Boolean).join(', ')
  const q = [s.codec, s.bitrate ? s.bitrate + ' kbps' : ''].filter(Boolean).join(' ')
  return `📻 ${s.name}${where ? `\n📍 ${where}` : ''}${q ? `\n🎚 ${q}` : ''}${s.homepage ? `\n🌐 ${s.homepage}` : ''}\n🔴 En vivo: ${s.url_resolved || s.url}`
}
/** "rec 5", "5 min", "3 10" → minutos (1..30) o null */
export function parseMinutes(s) {
  const m = String(s || '').match(/(\d{1,3})\s*(m|min|mins|minutos?)?\s*$/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? Math.min(n, MAX_REC_MIN) : null
}
/** Estación desde un link directo */
export function stationFromUrl(u) {
  let host = 'Radio'
  try { host = new URL(u).hostname.replace(/^www\./, '') } catch {}
  return { uuid: '', name: host, url: u, url_resolved: u, favicon: '', country: '', state: '', codec: '', bitrate: 0, homepage: '' }
}
