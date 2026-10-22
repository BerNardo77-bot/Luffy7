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
    const toks = t.split(' ')
    // números como palabra completa ("canal 5" no debe traer "canal 50"); texto puede ser parcial
    if (!words.every(w => /^\d+$/.test(w) ? toks.includes(w) : t.includes(w))) return 0
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
    a.push('-rw_timeout', '15000000', '-timeout', '15000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5')
    if (!/\.m3u8?(\?|$)/i.test(url)) a.push('-reconnect_at_eof', '1')
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

function run(bin, args, { timeoutMs = 30000, onStdout, signal } = {}) {
  return new Promise((resolve) => {
    let out = '', err = ''
    let p
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return resolve({ code: -1, out, err: String(e?.message || e) }) }
    const t = setTimeout(() => { err += '\ntimed out'; try { p.kill('SIGKILL') } catch {} }, timeoutMs)
    const onAbort = () => { err += '\ncancelado'; try { p.kill('SIGKILL') } catch {} }
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }) }
    p.stdout.on('data', d => { const s = d.toString(); if (out.length < 200000) out += s; if (onStdout) onStdout(s) })
    p.stderr.on('data', d => { if (err.length < 20000) err += d.toString() })
    p.on('error', e => { err += '\n' + (e?.message || e) })
    p.on('close', code => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve({ code, out, err }) })
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

// Graba `seconds` del stream a MP4, resistente a cortes.
// - Graba en tramos MPEG-TS (-c copy, descarta paquetes corruptos: un paquete AAC dañado ya no tumba la grabación).
// - Si ffmpeg termina antes de tiempo (sesión del servidor vencida, reset, playlist que se corta), vuelve a pedir la
//   playlist (nuevo token/sesión) y sigue en un tramo nuevo; prueba links alternos si el principal no responde.
// - Solo se rinde si la señal está muerta ~75 s seguidos; entonces entrega lo grabado.
// - Al final une los tramos (concat) y pasa a MP4: video copiado; si el audio da error, se recodifica solo el audio.
// onProgress(segundosTotales, bytesTotales). maxBytes: tope de espacio. signal: AbortSignal para cancelar.
const DEAD_LIMIT_MS = 75000
export class TvCancelled extends Error { constructor() { super('Grabación cancelada'); this.cancelled = true } }
export async function recordStream(url, seconds, { headers = {}, title = 'TV', maxBytes = 0, onProgress, dir, signal, alts = [] } = {}) {
  if (signal?.aborted) throw new TvCancelled()
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${cleanName(title)} ${stamp()}.mp4`)
  const sizeOf = (f) => { try { return fs.statSync(f).size } catch { return 0 } }
  const wipe = () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
  const cancelled = () => { if (signal?.aborted) { wipe(); throw new TvCancelled() } }
  const sources = [{ url, headers }, ...alts.filter(a => a?.url && a.url !== url)]
  // Se graba en TS y luego se pasa a MP4: hace falta espacio para ambos → los tramos usan como máximo la mitad
  const tsBudget = maxBytes > 0 ? Math.floor(maxBytes / 2) : 0
  const segs = []
  let done = 0, bytes = 0, src = 0, reencode = false, deadSince = 0, lastErr = '', segN = 0
  const hardStop = Date.now() + (seconds * 2 + 600) * 1000
  while (done < seconds - 2 && Date.now() < hardStop) {
    cancelled()
    if (tsBudget && bytes >= tsBudget * 0.98) break
    const s0 = sources[src % sources.length]
    const seg = path.join(dir, `seg${String(++segN).padStart(3, '0')}.ts`)
    const left = Math.ceil(seconds - done)
    let segSec = 0
    const progress = (txt) => {
      const m = txt.match(/out_time_(?:us|ms)=(\d+)/g)
      if (!m) return
      segSec = Number(m[m.length - 1].split('=')[1]) / 1e6
      if (onProgress) try { onProgress(Math.floor(done + segSec), bytes + sizeOf(seg)) } catch {}
    }
    const codec = reencode
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '128k']
      : ['-c', 'copy']
    const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y',
      '-fflags', '+discardcorrupt+genpts', '-err_detect', 'ignore_err', ...headerArgs(s0.url, s0.headers || {}),
      '-i', s0.url, '-t', String(left), '-map', '0:v:0?', '-map', '0:a:0?', '-sn', '-dn', ...codec,
      ...(tsBudget ? ['-fs', String(Math.max(1024 * 1024, tsBudget - bytes))] : []), '-f', 'mpegts', seg]
    const r = await run('ffmpeg', args, { timeoutMs: (left + 120) * 1000 * (reencode ? 2 : 1), onStdout: progress, signal })
    cancelled()
    if (/ENOENT/.test(r.err) && !sizeOf(seg)) { wipe(); throw new Error('Falta ffmpeg en el servidor (en Termux: pkg install ffmpeg).') }
    const got = sizeOf(seg) > 32 * 1024 ? segSec : 0
    if (got >= 1) {
      segs.push(seg); done += got; bytes += sizeOf(seg); deadSince = 0
      if (done < seconds - 2) console.log(`[tv] tramo ${segN} terminó a los ${Math.round(got)} s (${String(r.err).split('\n').filter(Boolean).pop() || 'fin'}); sigo grabando…`)
    } else {
      try { fs.rmSync(seg, { force: true }) } catch {}
      lastErr = r.err || lastErr
      // Sin nada grabado aún: errores definitivos (403/404) → avisar ya; códec raro → recodificar
      if (!segs.length && segN === 1 && /403|404|410|forbidden|not found|could not resolve|connection refused/i.test(r.err) && sources.length === 1) { wipe(); throw new Error(tvError(r.err)) }
      if (!segs.length && !reencode && r.code !== 0 && /codec|muxer|not supported|Invalid data/i.test(r.err) && !/HTTP|Connection|timed out/i.test(r.err)) { reencode = true; continue }
      if (!deadSince) deadSince = Date.now()
      if (Date.now() - deadSince > DEAD_LIMIT_MS) break
      src++ // probar el siguiente link (o el mismo con playlist nueva)
      await new Promise(res => setTimeout(res, 3000))
    }
  }
  cancelled()
  if (!segs.length) { wipe(); throw new Error(tvError(lastErr)) }
  // Unir tramos → MP4
  let input = segs[0]
  let inArgs = ['-i', segs[0]]
  if (segs.length > 1) {
    const list = path.join(dir, 'lista.txt')
    fs.writeFileSync(list, segs.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
    inArgs = ['-f', 'concat', '-safe', '0', '-i', list]
    input = list
  }
  const mux = async (audio) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+discardcorrupt+genpts', '-err_detect', 'ignore_err', ...inArgs,
    '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', ...audio, '-movflags', '+faststart', file], { timeoutMs: Math.max(600000, seconds * 1000), signal })
  const durOf = async (f) => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { timeoutMs: 30000 })).out) || 0
  await mux(['-c:a', 'copy'])
  cancelled()
  let secs = await durOf(file)
  if (secs < done * 0.9) {
    // AAC dañado (ADTS) en el copy: recodificar solo el audio (rápido, sirve en el teléfono)
    await mux(['-c:a', 'aac', '-b:a', '128k'])
    cancelled()
    secs = await durOf(file)
  }
  for (const f of segs) try { fs.rmSync(f, { force: true }) } catch {}
  if (sizeOf(file) < 50 * 1024) { wipe(); throw new Error('No pude armar el video final (la señal llegó dañada).') }
  return { file, dir, name: path.basename(file), size: sizeOf(file), seconds: Math.round(secs || done), reencoded: reencode, cut: !!tsBudget && bytes >= tsBudget * 0.98, pieces: segs.length }
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

// ---- Canales al aire: revisión rápida en paralelo antes de mostrar la lista ----
const liveCache = new Map() // url → { ok, at }
const LIVE_TTL = 7 * 60 * 1000
function reqHeaders(headers = {}) {
  const h = { 'user-agent': headers['user-agent'] || UA }
  if (headers.referer) { h.referer = headers.referer; try { h.origin = new URL(headers.referer).origin } catch {} }
  return h
}
async function getText(url, headers, ms) {
  const r = await fetch(url, { headers: reqHeaders(headers), redirect: 'follow', signal: AbortSignal.timeout(ms) })
  if (!r.ok) { try { await r.body?.cancel() } catch {} ; throw new Error('HTTP ' + r.status) }
  const ct = String(r.headers.get('content-type') || '')
  // Solo leemos texto si parece playlist; si es video directo, basta con que responda
  if (/mpegurl|text|octet-stream/i.test(ct) || /\.m3u8?(\?|$)/i.test(url)) {
    const reader = r.body.getReader(); let out = '', n = 0
    while (n < 256 * 1024) { const { done, value } = await reader.read(); if (done) break; n += value.length; out += Buffer.from(value).toString('utf8') }
    try { reader.cancel() } catch {}
    return { text: out, url: r.url || url, ct }
  }
  try { await r.body?.cancel() } catch {}
  return { text: '', url: r.url || url, ct }
}
async function pingBytes(url, headers, ms) {
  const h = { ...reqHeaders(headers), range: 'bytes=0-2047' }
  const r = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(ms) })
  try { await r.body?.cancel() } catch {}
  return r.ok || r.status === 206
}
const firstUri = (text, base) => {
  for (const l of String(text).split(/\r?\n/)) { const s = l.trim(); if (s && !s.startsWith('#')) { try { return new URL(s, base).href } catch { return null } } }
  return null
}

// true si el stream responde: playlist válida → variante → un segmento responde.
export async function isLive(url, headers = {}, ms = 4500) {
  const c = liveCache.get(url)
  if (c && Date.now() - c.at < LIVE_TTL) return c.ok
  let ok = false
  try {
    if (!/^https?:/i.test(url)) {
      const r = await run('ffprobe', ['-v', 'error', ...headerArgs(url, headers), '-show_entries', 'format=format_name', '-of', 'json', url], { timeoutMs: 8000 })
      ok = r.code === 0
    } else {
      const a = await getText(url, headers, ms)
      if (!a.text) ok = true // video directo que responde
      else if (/#EXTM3U/.test(a.text)) {
        let media = a
        if (/#EXT-X-STREAM-INF/i.test(a.text)) {
          const v = firstUri(a.text.split(/#EXT-X-STREAM-INF[^\n]*\n/i).slice(1).join('\n'), a.url)
          if (!v) throw new Error('sin variantes')
          media = await getText(v, headers, ms)
          if (!/#EXTM3U/.test(media.text)) throw new Error('variante inválida')
        }
        const seg = firstUri(media.text, media.url)
        ok = seg ? await pingBytes(seg, headers, ms) : false
      }
    }
  } catch { ok = false }
  liveCache.set(url, { ok, at: Date.now() })
  if (liveCache.size > 2000) liveCache.delete(liveCache.keys().next().value)
  return ok
}

// Busca y devuelve solo canales al aire (hasta `limit`), revisando hasta `pool` candidatos (8 a la vez).
// Si un canal tiene varios links (mismo nombre), prueba los alternos.
export async function searchLive(q, { limit = 10, pool = 30, concurrency = 8 } = {}) {
  const cands = await searchChannels(q, { limit: pool * 2 })
  const groups = []
  const byKey = new Map()
  for (const it of cands) {
    const k = norm(it.title) + '|' + (it.country || '')
    if (byKey.has(k)) { byKey.get(k).alts.push(it); continue }
    const g = { ...it, alts: [it] }
    byKey.set(k, g); groups.push(g)
  }
  const list = groups.slice(0, pool)
  const res = new Array(list.length).fill(null)
  let i = 0, found = 0
  const worker = async () => {
    while (i < list.length && found < limit) {
      const k = i++
      const g = list[k]
      for (const alt of g.alts.slice(0, 3)) {
        if (await isLive(alt.url, alt.headers)) { res[k] = { ...g, url: alt.url, headers: alt.headers, alts: g.alts.filter(a => a.url !== alt.url).slice(0, 3).map(a => ({ url: a.url, headers: a.headers })) }; found++; break }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { items: res.filter(Boolean).slice(0, limit), checked: Math.min(i, list.length), total: cands.length }
}
