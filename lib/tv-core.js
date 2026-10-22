// TV en vivo: búsqueda de canales en las listas públicas de iptv-org y grabación con ffmpeg.
// Sin dependencias npm: usa fetch de Node y ffmpeg/ffprobe del sistema.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

export const TV_DURS = [5, 10, 15, 30, 60, 120, 180, 240, 300]
export const TV_MAX_MIN = 300 // 5 horas
const IPTV = 'https://iptv-org.github.io/iptv'
const LISTS_TTL = 6 * 60 * 60 * 1000
const cache = new Map() // url → { at, items }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'

// Países: "tv milenio mx", "tv antena 3 es", etc. (código al final). Por defecto México primero.
const COUNTRY_WORDS = { mexico: 'mx', méxico: 'mx', espana: 'es', españa: 'es', colombia: 'co', argentina: 'ar', chile: 'cl', peru: 'pe', perú: 'pe', venezuela: 've', usa: 'us', eeuu: 'us', ecuador: 'ec', guatemala: 'gt', honduras: 'hn', salvador: 'sv', nicaragua: 'ni', panama: 'pa', panamá: 'pa', uruguay: 'uy', paraguay: 'py', bolivia: 'bo', dominicana: 'do', cuba: 'cu', brasil: 'br', 'costa rica': 'cr', 'puerto rico': 'pr' }
const ISO = new Set(['mx', 'es', 'co', 'ar', 'cl', 'pe', 've', 'us', 'ec', 'gt', 'hn', 'sv', 'ni', 'cr', 'pa', 'uy', 'py', 'bo', 'do', 'cu', 'pr', 'br', 'uk', 'fr', 'it', 'de', 'pt', 'ca', 'jp', 'kr', 'in'])

export function isStreamUrl(s = '') {
  return /^(https?|rtmps?|rtsp|mms|udp):\/\/\S+$/i.test(String(s).trim())
}
// Para "envivo": solo links directos de stream (no YouTube/TikTok, que maneja envivo).
export function isDirectStream(s = '') {
  const u = String(s).trim()
  if (!isStreamUrl(u)) return false
  if (/youtu\.?be|tiktok\.com/i.test(u)) return false
  return /^(rtmps?|rtsp|mms|udp):/i.test(u) || /\.(m3u8?|mpd|ts|flv)(\?|$)/i.test(u)
}

const norm = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

export function parseM3u(text, country = '') {
  const out = []
  let cur = null
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim()
    if (!l) continue
    if (l.startsWith('#EXTINF')) {
      const attr = (k) => (l.match(new RegExp(k + '="([^"]*)"')) || [])[1] || ''
      const name = l.slice(l.lastIndexOf(',') + 1).trim()
      cur = { name, logo: attr('tvg-logo'), group: attr('group-title'), id: attr('tvg-id'), country, headers: {} }
    } else if (l.startsWith('#EXTVLCOPT')) {
      const m = l.match(/http-(user-agent|referrer)=(.+)$/i)
      if (cur && m) cur.headers[m[1].toLowerCase() === 'referrer' ? 'referer' : 'user-agent'] = m[2].trim()
    } else if (!l.startsWith('#') && cur) {
      cur.url = l
      cur.geo = /geo-?blocked/i.test(cur.name)
      cur.not247 = /not 24\/7/i.test(cur.name)
      cur.title = cur.name.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
      out.push(cur)
      cur = null
    }
  }
  return out
}

async function getList(url, country) {
  const c = cache.get(url)
  if (c && Date.now() - c.at < LISTS_TTL) return c.items
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`lista HTTP ${r.status}`)
  const items = parseM3u(await r.text(), country)
  cache.set(url, { at: Date.now(), items })
  return items
}

// Separa "milenio mx" → { query: 'milenio', country: 'mx' }
export function splitCountry(q = '') {
  let s = ' ' + norm(q) + ' '
  let country = ''
  for (const [w, cc] of Object.entries(COUNTRY_WORDS)) {
    const k = ' ' + norm(w) + ' '
    if (s.includes(k)) { country = cc; s = s.replace(k, ' ') }
  }
  const last = s.trim().split(' ').pop()
  if (!country && ISO.has(last) && s.trim().split(' ').length > 1) { country = last; s = s.replace(new RegExp(' ' + last + ' $'), ' ') }
  return { query: s.trim(), country }
}

// Busca canales; devuelve hasta `limit` (México y el país pedido primero, luego el índice mundial).
export async function searchChannels(q, { limit = 10 } = {}) {
  const { query, country } = splitCountry(q)
  const words = query.split(' ').filter(Boolean)
  if (!words.length) return []
  const lists = []
  const cc = country || 'mx'
  lists.push(getList(`${IPTV}/countries/${cc}.m3u`, cc).catch(() => []))
  if (!country) lists.push(getList(`${IPTV}/languages/spa.m3u`, '').catch(() => []))
  let pool = (await Promise.all(lists)).flat()
  const score = (it) => {
    const t = norm(it.title.replace(/\(\d{3,4}[pi]\)/gi, ' '))
    if (!words.every(w => t.includes(w))) return 0
    let s = 10
    if (t === query) s += 50
    else if (t.startsWith(query)) s += 20
    if (it.country === cc) s += 15
    if (it.geo) s -= 3
    if (it.not247) s -= 2
    if (/^https:/i.test(it.url)) s += 1
    return s
  }
  let hits = pool.map(it => ({ it, s: score(it) })).filter(x => x.s > 0)
  if (hits.length < 3) {
    const world = await getList(`${IPTV}/index.m3u`, '').catch(() => [])
    hits = hits.concat(world.map(it => ({ it, s: score(it) })).filter(x => x.s > 0))
  }
  const seen = new Set()
  return hits.sort((a, b) => b.s - a.s).map(x => x.it).filter(it => {
    if (seen.has(it.url)) return false
    seen.add(it.url)
    return true
  }).slice(0, limit)
}

function headerArgs(url, headers = {}) {
  const a = []
  if (/^https?:/i.test(url)) {
    a.push('-user_agent', headers['user-agent'] || UA)
    if (headers.referer) a.push('-headers', `Referer: ${headers.referer}\r\n`)
    a.push('-rw_timeout', '20000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5')
  } else if (/^rtmp/i.test(url)) {
    a.push('-rw_timeout', '20000000')
  }
  return a
}

// Error claro en español según la salida de ffmpeg/ffprobe.
export function tvError(stderr = '', fallback = '') {
  const s = String(stderr)
  if (/403|forbidden|geo|not available in your (country|region)|451/i.test(s)) return 'El canal está bloqueado por región (geobloqueo) o pide permiso: desde este servidor no se puede ver. Prueba otro canal o el link desde tu propia red en VLC.'
  if (/404|410|not found|no such file/i.test(s)) return 'El canal está fuera del aire (el link ya no existe). Prueba otro de la lista.'
  if (/timed out|timeout|connection refused|unreachable|could not resolve|name or service|i\/o error|end of file|invalid data found/i.test(s)) return 'El canal no responde ahora (fuera del aire o link caído). Intenta más tarde u otro canal.'
  if (/5\d\d|server error/i.test(s)) return 'El servidor del canal está fallando ahora. Intenta en unos minutos.'
  return fallback || 'No pude abrir la transmisión. Puede estar fuera del aire o bloqueada por región.'
}

function run(bin, args, { timeoutMs = 30000, onStdout } = {}) {
  return new Promise((resolve) => {
    let out = '', err = ''
    let p
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return resolve({ code: -1, out, err: String(e?.message || e) }) }
    const t = setTimeout(() => { err += '\ntimed out'; try { p.kill('SIGKILL') } catch {} }, timeoutMs)
    p.stdout.on('data', d => { const s = d.toString(); if (out.length < 200000) out += s; if (onStdout) onStdout(s) })
    p.stderr.on('data', d => { if (err.length < 20000) err += d.toString() })
    p.on('error', e => { err += '\n' + (e?.message || e) })
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }) })
  })
}

// Revisa que el stream responda y tenga video/audio.
export async function probeStream(url, headers = {}) {
  const r = await run('ffprobe', ['-v', 'error', ...headerArgs(url, headers), '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', url], { timeoutMs: 35000 })
  if (r.code === -1 || /ENOENT/.test(r.err)) return { ok: false, reason: 'Falta ffmpeg en el servidor (en Termux: pkg install ffmpeg).' }
  let streams = []
  try { streams = JSON.parse(r.out || '{}').streams || [] } catch {}
  const v = streams.find(s => s.codec_type === 'video')
  const a = streams.find(s => s.codec_type === 'audio')
  if (r.code !== 0 || (!v && !a)) return { ok: false, reason: tvError(r.err) }
  return { ok: true, video: !!v, audio: !!a, vcodec: v?.codec_name, acodec: a?.codec_name, height: v?.height || 0 }
}

const cleanName = (x) => String(x || 'tv').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'tv'
const pad2 = (n) => String(n).padStart(2, '0')
function stamp(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}` }

// Graba `seconds` del stream a MP4. Primero -c copy; si falla, recodifica (H.264 ≤720p + AAC).
// onProgress(segundosGrabados, bytes). maxBytes corta el archivo (espacio libre / tope total).
export async function recordStream(url, seconds, { headers = {}, title = 'TV', maxBytes = 0, onProgress, dir } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${cleanName(title)} ${stamp()}.mp4`)
  const base = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', ...headerArgs(url, headers), '-i', url, '-t', String(seconds), '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn']
  const tail = ['-movflags', '+faststart', ...(maxBytes > 0 ? ['-fs', String(Math.floor(maxBytes))] : []), file]
  const progress = (s) => {
    const m = s.match(/out_time_(?:us|ms)=(\d+)/g)
    if (!m || !onProgress) return
    const us = Number(m[m.length - 1].split('=')[1])
    try { onProgress(Math.floor(us / 1e6), fs.existsSync(file) ? fs.statSync(file).size : 0) } catch {}
  }
  const limit = (seconds + 180) * 1000
  let r = await run('ffmpeg', [...base, '-c', 'copy', ...tail], { timeoutMs: limit, onStdout: progress })
  const size = () => { try { return fs.statSync(file).size } catch { return 0 } }
  let reencoded = false
  if ((r.code !== 0 && size() < 200 * 1024) || size() < 50 * 1024) {
    if (/ENOENT/.test(r.err)) throw new Error('Falta ffmpeg en el servidor (en Termux: pkg install ffmpeg).')
    const fatal = /403|404|410|forbidden|not found|could not resolve|connection refused/i.test(r.err)
    if (fatal) throw new Error(tvError(r.err))
    try { fs.rmSync(file, { force: true }) } catch {}
    reencoded = true
    r = await run('ffmpeg', [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '128k', ...tail], { timeoutMs: limit * 2, onStdout: progress })
    if (size() < 50 * 1024) throw new Error(tvError(r.err))
  }
  const dur = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeoutMs: 20000 })
  return { file, dir, name: path.basename(file), size: size(), seconds: Math.round(Number(dur.out) || 0), reencoded, cut: maxBytes > 0 && size() >= maxBytes * 0.98 }
}

export function chanLine(it, i) {
  const tags = [it.country ? it.country.toUpperCase() : '', it.geo ? '🔒 geobloqueado' : '', it.not247 ? 'no 24/7' : ''].filter(Boolean).join(' · ')
  return `${i + 1}) ${it.title}${tags ? ` (${tags})` : ''}`
}

// Logo del canal → JPEG real (fondo blanco, cuadrado `size`px). null si falta o falla (entonces va solo texto).
// Con tiempo límite y validación: nunca manda a WhatsApp/Telegram un buffer vacío, SVG o WebP crudo.
const logoCache = new Map()
export async function logoJpeg(url, size = 320) {
  if (!/^https?:\/\//i.test(String(url || ''))) return null
  const key = url + '|' + size
  if (logoCache.has(key)) return logoCache.get(key)
  let dir = null
  let out = null
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 100 || buf.length > 3 * 1024 * 1024) throw new Error('tamaño raro')
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tvlogo-'))
    const src = path.join(dir, 'in'), dst = path.join(dir, 'out.jpg')
    fs.writeFileSync(src, buf)
    const inner = Math.round(size * 0.9)
    const res = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=white:s=${size}x${size}`, '-i', src,
      '-filter_complex', `[1:v]scale=${inner}:${inner}:force_original_aspect_ratio=decrease[l];[0:v][l]overlay=(W-w)/2:(H-h)/2:format=auto`,
      '-frames:v', '1', '-q:v', '4', dst], { timeoutMs: 15000 })
    const j = fs.existsSync(dst) ? fs.readFileSync(dst) : null
    if (res.code !== 0 || !j || j.length < 800 || j[0] !== 0xff || j[1] !== 0xd8) throw new Error('no es JPEG')
    out = j
  } catch { out = null } finally { if (dir) try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  if (logoCache.size > 300) logoCache.delete(logoCache.keys().next().value)
  logoCache.set(key, out)
  return out
}

// Logos de varios canales a la vez (máx. 4 en paralelo para teléfonos con poca RAM).
export async function logosFor(items, size = 320) {
  const res = new Array(items.length).fill(null)
  let i = 0
  const worker = async () => { while (i < items.length) { const k = i++; res[k] = await logoJpeg(items[k].logo, size).catch(() => null) } }
  await Promise.all([worker(), worker(), worker(), worker()])
  return res
}
