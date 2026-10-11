// #ttsearch, último respaldo: buscador web (Bing, Brave Search, DuckDuckGo) con
// "site:tiktok.com <q>", saca links tiktok.com/@user/video/ID y los completa con
// oEmbed (título, autor, miniatura) + yt-dlp -J (duración), directo → proxy.
import axios from 'axios'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { withProxyFallback, axiosOpts, ytDlpProxyArgs } from './dl-proxy.js'
import { ttCookieArgs } from './tt-cookies.js'

const execFileAsync = promisify(execFile)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const VIDEO_RE = /https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]+)\/video\/(\d{8,25})/g

const unescapeHtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/')

// Links de TikTok en una página de resultados (Bing los esconde en /ck/a?...&u=a1<base64>).
export function extractTiktokLinks(html) {
  const s = unescapeHtml(html)
  const found = []
  const add = (txt) => { for (const m of String(txt).matchAll(VIDEO_RE)) found.push({ user: m[1], id: m[2] }) }
  for (const m of s.matchAll(/[?&]u=a1([A-Za-z0-9_-]+)/g)) {
    try { add(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) } catch {}
  }
  for (const m of s.matchAll(/uddg=([^&"']+)/g)) { try { add(decodeURIComponent(m[1])) } catch {} }
  add(s)
  try { add(decodeURIComponent(s.replace(/%(?![0-9a-f]{2})/gi, '%25'))) } catch {}
  const seen = new Set()
  return found.filter(v => !seen.has(v.id) && seen.add(v.id))
    .map(v => ({ ...v, url: `https://www.tiktok.com/@${v.user}/video/${v.id}` }))
}

// Motores que sí devuelven links tiktok.com/@u/video/ID sin key (probado oct 2026):
// Yahoo Videos (el mejor, ~30-60 links), Bing Videos, DuckDuckGo Lite; Bing/Brave/DDG web como extra.
const ENGINES = [
  { id: 'yahoo-video', url: (q) => `https://video.search.yahoo.com/search/video?p=${encodeURIComponent(q)}` },
  { id: 'bing-video', url: (q) => `https://www.bing.com/videos/search?q=${encodeURIComponent(q)}&setlang=es&cc=MX` },
  { id: 'ddg-lite', url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=mx-es` },
  { id: 'bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=MX&count=30` },
  { id: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web` },
  { id: 'ddg', url: () => 'https://html.duckduckgo.com/html/', post: (q) => `q=${encodeURIComponent(q)}&kl=mx-es`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' } }
]
// Motor que falla (429/403/bloqueo) se salta unos minutos para no martillarlo.
const COOLDOWN_MS = 5 * 60 * 1000
const cooldown = new Map()
export function _resetEngineCooldown() { cooldown.clear() }

const stripTags = (t) => unescapeHtml(String(t || '').replace(/&lt;\/?b&gt;/g, '').replace(/<[^>]+>/g, '')).replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/\s+/g, ' ').trim()
const clockSec = (t) => String(t || '').split(':').map(Number).reduce((a, x) => a * 60 + x, 0) || 0

// Yahoo Videos trae por tile: link, miniatura, duración y descripción. Así no hace falta oEmbed.
export function parseYahooVideo(html) {
  const out = []
  for (const li of String(html || '').split('<li class="tile').slice(1)) {
    const ref = (li.match(/data-referenceurl="([^"]+)"/) || [])[1] || ''
    const m = ref.match(/tiktok\.com\/@([A-Za-z0-9_.]+)\/video\/(\d{8,25})/)
    if (!m) continue
    const img = unescapeHtml((li.match(/<img src="([^"]+)"/) || [])[1] || '')
    const alt = stripTags((li.match(/ alt="([^"]*)"/) || [])[1] || '')
    const desc = stripTags((li.match(/tile-description[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '')
    const dur = (li.match(/\btime\b[^>]*>(\d{1,2}:\d{2}(?::\d{2})?)</) || [])[1] || ''
    out.push({ user: m[1], id: m[2], url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, meta: { title: desc || alt, cover: img, duration: clockSec(dur) } })
  }
  return out
}

async function getPage(eng, q) {
  return withProxyFallback(async (useProxy) => {
    const r = await axios({ url: eng.url(q), method: eng.post ? 'POST' : 'GET', data: eng.post ? eng.post(q) : undefined, ...axiosOpts(useProxy), timeout: 15000, responseType: 'text',
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9', ...(eng.headers || {}) }, validateStatus: () => true })
    if (r.status >= 400 || r.status === 202) throw Object.assign(new Error(`HTTP ${r.status}`), { block: true })
    if (eng.id === 'yahoo-video') { const y = parseYahooVideo(r.data); if (y.length) return y }
    return extractTiktokLinks(r.data)
  }, `web ${eng.id}`)
}

export async function webTiktokLinks(query, max = 80, minEngines = 3) {
  const qs = [`site:tiktok.com ${query}`, `${query} tiktok`]
  const all = []
  const errors = []
  let tried = 0
  for (const eng of ENGINES) {
    if (all.length >= max || (tried >= minEngines && all.length >= 20)) break
    tried++
    const until = cooldown.get(eng.id) || 0
    if (Date.now() < until) { errors.push(`${eng.id}: en pausa`); continue }
    let got = 0
    for (const q of qs) {
      if (all.length >= max) break
      try {
        const l = await getPage(eng, q)
        all.push(...l)
        got += l.length
      } catch (e) {
        errors.push(`${eng.id}: ${String(e?.message || e).slice(0, 40)}`)
        if (e?.block || /HTTP (429|403|202)/.test(String(e?.message))) { cooldown.set(eng.id, Date.now() + COOLDOWN_MS); break }
      }
    }
    if (!got && !errors.some((x) => x.startsWith(eng.id))) errors.push(`${eng.id}: 0`)
  }
  const seen = new Set()
  const links = all.filter(v => !seen.has(v.id) && seen.add(v.id)).slice(0, max)
  // errores cortos: un motor una vez
  const short = [...new Map(errors.map((e) => [e.split(':')[0], e])).values()]
  return { links, errors: short }
}

async function oembed(url) {
  return withProxyFallback(async (useProxy) => {
    const r = await axios.get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { ...axiosOpts(useProxy), timeout: 10000, headers: { 'User-Agent': UA } })
    if (!r.data?.title && !r.data?.thumbnail_url) throw new Error('oembed vacío')
    return r.data
  }, 'oembed')
}

async function ytdlpMeta(url) {
  return withProxyFallback(async (useProxy) => {
    const { stdout } = await execFileAsync('yt-dlp', ['-J', '--skip-download', '--no-warnings', ...ttCookieArgs(), ...ytDlpProxyArgs(useProxy), url],
      { timeout: 30000, maxBuffer: 30 * 1024 * 1024 })
    return JSON.parse(stdout)
  }, 'yt-dlp meta')
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

const normTxt = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const STOP = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'vs', 'the', 'a', 'un', 'una', 'tiktok'])

// Mismo formato que tikwm (id, title, author, url, cover, duration en segundos).
// 1) oEmbed a todos (rápido) → 2) se ordenan por palabras del título → 3) yt-dlp solo a los mejores (duración).
export async function enrichTiktok(link, { meta = true } = {}) {
  const [o, j] = await Promise.all([oembed(link.url).catch(() => null), meta ? ytdlpMeta(link.url).catch(() => null) : null])
  return {
    id: link.id,
    title: String(j?.description || j?.title || o?.title || '').trim(),
    author: { unique_id: j?.uploader || link.user, nickname: j?.creator || o?.author_name || '' },
    url: link.url,
    cover: o?.thumbnail_url || j?.thumbnail || '',
    duration: Number(j?.duration) || 0,
    source: 'web'
  }
}

export async function searchTiktokWeb(query, { max = 15, concurrency = 4, needDuration = true } = {}) {
  const { links, errors } = await webTiktokLinks(query)
  if (!links.length) throw new Error(`sin links de TikTok (${errors.join(', ') || 'sin respuesta'})`)
  const words = normTxt(query).split(/[^a-z0-9ñ]+/).filter((w) => w && !STOP.has(w))
  const fromMeta = (l) => ({ id: l.id, title: l.meta.title, author: { unique_id: l.user, nickname: '' }, url: l.url, cover: l.meta.cover, duration: l.meta.duration, source: 'web' })
  const withMeta = links.filter((l) => l.meta?.title).map(fromMeta)
  const sinMeta = links.filter((l) => !l.meta?.title).slice(0, 16)
  const extra = (await pool(sinMeta, 6, (l) => enrichTiktok(l, { meta: false }))).filter((v) => v.title || v.cover)
  const firstPass = withMeta.concat(extra)
  const score = (v) => { const t = normTxt(`${v.title} ${v.author.unique_id}`); return words.reduce((n, w) => n + (new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(t) ? (/^\d+$/.test(w) ? 3 : 1) : 0), 0) }
  firstPass.sort((a, b) => score(b) - score(a))
  const top = firstPass.filter((v) => !words.length || score(v) > 0).slice(0, max)
  if (!needDuration) return top
  return pool(top, concurrency, async (v) => {
    if (v.duration && v.title) return v
    const j = await ytdlpMeta(v.url).catch(() => null)
    return j ? { ...v, title: String(j.description || j.title || v.title).trim(), duration: Number(j.duration) || 0, cover: v.cover || j.thumbnail || '' } : v
  })
}
