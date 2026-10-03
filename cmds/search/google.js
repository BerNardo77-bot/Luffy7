import fetch from 'node-fetch'
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js'
import play2 from '../dl/play2.js'
import tiktok from '../dl/tiktok.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)
const PAUSA_MS = 700
const MAX_THUMB = 2 * 1024 * 1024

// $google — búsqueda web.
// Orden de motores (el primero que da resultados reales gana; si da menos de 3 se completa con los siguientes):
//   1. APIs oficiales opcionales, solo si hay variables de entorno:
//        GOOGLE_CSE_KEY + GOOGLE_CSE_CX  → Google Programmable Search (JSON API)
//        BRAVE_API_KEY                   → Brave Search API
//   2. DuckDuckGo HTML → DuckDuckGo Lite (en IPs de servidor suelen pedir captcha: se detecta y se salta)
//   3. Seznam → Mwmbl → Marginalia (índices web propios que sí responden desde servidores / data centers)
//   4. Bing (con filtro de relevancia: a bots le responde basura)
//   5. Wikipedia (es) — último recurso
// Timeout corto por motor y presupuesto total ~19 s. Captcha / página vacía = falla → siguiente motor.
// SEARCH_DISABLE="duckduckgo,bing" (opcional) desactiva motores por nombre.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8'
}
const WIKI_UA = 'Luffy7-WhatsApp/1.1 (google)'
const ENGINE_TIMEOUT = 7000
const BUDGET = 19000 // presupuesto total de la búsqueda
const WIKI_RESERVE = 3500 // tiempo guardado para Wikipedia al final
const MAX = 10
const MIN_GOOD = 3 // con menos resultados se intenta completar con el siguiente motor

class BlockedError extends Error {}

async function get(url, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeout || ENGINE_TIMEOUT)
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { ...HEADERS, ...(opts.headers || {}) },
      signal: ctrl.signal,
      redirect: 'follow'
    })
    // DuckDuckGo responde 202 con su página "anomaly" (captcha) a IPs de servidor
    if (res.status === 202) throw new BlockedError('captcha (HTTP 202)')
    if (res.status === 403 || res.status === 429) throw new BlockedError(`bloqueado (HTTP ${res.status})`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (/captcha|sorry\/index|captcha-block|showcaptcha/i.test(res.url || '')) throw new BlockedError('captcha (redirección)')
    const body = opts.json ? await res.json() : await res.text()
    return body
  } finally {
    clearTimeout(t)
  }
}

// Páginas de captcha / anti-bots.
export function isBlockedPage(html = '') {
  const h = String(html).slice(0, 60000)
  return /anomaly-modal|anomaly\.js|g-recaptcha|h-captcha|cf-chl|challenge-platform|captcha-delivery|unusual traffic|are you a robot|not a robot|Making sure you&#39;re not a bot|automated queries/i.test(h)
}

function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde|cedil);/g, (_, l, k) =>
      (l + { acute: '\u0301', grave: '\u0300', uml: '\u0308', circ: '\u0302', tilde: '\u0303', cedil: '\u0327' }[k]).normalize('NFC')
    )
    .replace(/&iquest;/g, '¿')
    .replace(/&iexcl;/g, '¡')
    .replace(/&hellip;/g, '…')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function clean(html = '') {
  return decodeEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/[\u200b\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .replace(/([(\[¿¡])\s+/g, '$1')
    .trim()
}

function short(s = '', n = 200) {
  s = String(s).trim()
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s
}

function urlKey(u = '') {
  try {
    const x = new URL(u)
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ref_src)/i.test(k)) x.searchParams.delete(k)
    const qs = x.searchParams.toString()
    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (qs ? `?${qs}` : '')).toLowerCase()
  } catch {
    return String(u).toLowerCase()
  }
}

function uniq(list, seen = new Set()) {
  return list.filter((r) => {
    if (!r?.url || !r?.title || !/^https?:\/\//i.test(r.url)) return false
    const k = urlKey(r.url)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function norm(s = '') {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const STOP = new Set(
  ('que como para por con los las del una uno unos unas sus mas pero sin sobre entre cual quien ' +
    'donde cuando porque este esta esto ese esa the and for with what how who why').split(' ')
)

function keywords(q) {
  return [...new Set(norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))]
}

// Deja solo resultados que contienen las palabras importantes de la búsqueda y los ordena por coincidencias.
// need: 'any' (al menos 1), 'most' (todas si son ≤2, si no ~60 %).
function relevant(list, q, need = 'any') {
  const words = keywords(q)
  if (!words.length) return list
  const min = need === 'any' ? 1 : words.length <= 2 ? words.length : Math.ceil(words.length * 0.6)
  return list
    .map((r, i) => {
      const hay = norm(`${r.title} ${r.snippet} ${decodeURIComponentSafe(r.url)}`)
      return { r, i, score: words.filter((w) => hay.includes(w)).length }
    })
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.r)
}

function decodeURIComponentSafe(s = '') {
  try { return decodeURIComponent(s) } catch { return s }
}

function attr(tag = '', name) {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? m[1] ?? m[2] : ''
}

// ── APIs oficiales (opcionales) ────────────────────────────────────
async function googleCse(q, { timeout }) {
  const p = new URLSearchParams({ key: process.env.GOOGLE_CSE_KEY, cx: process.env.GOOGLE_CSE_CX, q, num: '10', hl: 'es', gl: 'mx' })
  const json = await get(`https://www.googleapis.com/customsearch/v1?${p}`, { timeout, json: true, headers: { Accept: 'application/json' } })
  return (json?.items || []).map((r) => ({ title: clean(r.title), url: r.link, snippet: clean(r.snippet || ''), image: r.pagemap?.cse_image?.[0]?.src || r.pagemap?.cse_thumbnail?.[0]?.src || '' }))
}

async function braveApi(q, { timeout }) {
  const p = new URLSearchParams({ q, count: '10', search_lang: 'es', country: 'MX', safesearch: 'moderate' })
  const json = await get(`https://api.search.brave.com/res/v1/web/search?${p}`, {
    timeout,
    json: true,
    headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY }
  })
  return (json?.web?.results || []).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.description || ''), image: r.thumbnail?.src || '' }))
}

// ── DuckDuckGo HTML ────────────────────────────────────────────────
function ddgUrl(href = '') {
  href = decodeEntities(href)
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  if (href.startsWith('//')) return 'https:' + href
  return href
}

export function parseDdgHtml(html = '') {
  const out = []
  const blocks = html.split(/(?=<div[^>]+class="[^"]*\bresult\b[^"]*")/i).slice(1)
  for (const b of blocks) {
    if (/result--ad/.test(b.slice(0, 300))) continue
    const a = b.match(/(<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>)([\s\S]*?)<\/a>/i)
    if (!a) continue
    const sn = b.match(/class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|td)>/i)
    const url = ddgUrl(attr(a[1], 'href'))
    if (/duckduckgo\.com\/y\.js/.test(url)) continue // anuncios
    out.push({ title: clean(a[2]), url, snippet: clean(sn?.[1] || '') })
  }
  return out
}

const ddgForm = (q) => new URLSearchParams({ q, kl: 'mx-es', b: '' }).toString()

async function ddgHtml(q, { timeout }) {
  const html = await get('https://html.duckduckgo.com/html/', {
    timeout,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://html.duckduckgo.com', Referer: 'https://html.duckduckgo.com/' },
    body: ddgForm(q)
  })
  const list = parseDdgHtml(html)
  if (!list.length && isBlockedPage(html)) throw new BlockedError('captcha')
  return list
}

// ── DuckDuckGo Lite ────────────────────────────────────────────────
export function parseDdgLite(html = '') {
  const links = [...html.matchAll(/(<a\b[^>]*class=["']result-link["'][^>]*>)([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/<td\b[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi)]
  return links
    .map((m, i) => ({ title: clean(m[2]), url: ddgUrl(attr(m[1], 'href')), snippet: clean(snippets[i]?.[1] || '') }))
    .filter((r) => !/duckduckgo\.com\/y\.js/.test(r.url))
}

async function ddgLite(q, { timeout }) {
  const html = await get('https://lite.duckduckgo.com/lite/', {
    timeout,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://lite.duckduckgo.com', Referer: 'https://lite.duckduckgo.com/' },
    body: ddgForm(q)
  })
  const list = parseDdgLite(html)
  if (!list.length && isBlockedPage(html)) throw new BlockedError('captcha')
  return list
}

// ── Seznam (buscador checo con índice propio de toda la web) ───────
export function parseSeznam(html = '') {
  const out = []
  const parts = html.split(/(?=<a\b[^>]*data-e-a="heading")/i).slice(1)
  for (const p of parts) {
    const a = p.match(/^(<a\b[^>]*>)([\s\S]*?)<\/a>/i)
    if (!a) continue
    const url = decodeEntities(attr(a[1], 'href'))
    if (!/^https?:\/\//i.test(url) || /(^|\.)(seznam|sklik|sdn)\.cz\//i.test(url.replace(/^https?:\/\//, '').split('/')[0] + '/')) continue
    const title = clean(a[2])
    // resumen: el <span> de texto más largo del bloque que no sea el título ni la URL visible
    let snippet = ''
    for (const m of p.slice(a[0].length, 6000).matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
      const t = clean(m[1])
      if (t.length > snippet.length && t !== title && !/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(t)) snippet = t
    }
    out.push({ title, url, snippet })
  }
  return out
}

async function seznam(q, { timeout }) {
  const html = await get(`https://search.seznam.cz/?q=${encodeURIComponent(q)}`, { timeout })
  const list = parseSeznam(html)
  if (!list.length && isBlockedPage(html)) throw new BlockedError('captcha')
  // Seznam es checo: los resultados .cz/.sk o traducidos al checo (cs.*) van al final
  const czech = (r) => /(^|\.)(cs|cz)\.|\.(cz|sk)$/i.test((() => { try { return new URL(r.url).hostname } catch { return '' } })())
  const ok = relevant(list, q, 'most')
  return ok.filter((r) => !czech(r)).concat(ok.filter(czech))
}

// ── Marginalia (índice independiente, API pública) ────────────────
async function marginalia(q, { timeout }) {
  const json = await get(`https://api.marginalia.nu/public/search/${encodeURIComponent(q)}?count=15`, {
    timeout,
    json: true,
    headers: { Accept: 'application/json' }
  })
  const list = (json?.results || []).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.description || '') }))
  return relevant(list, q, 'most')
}

// ── Mwmbl (índice independiente, API pública) ──────────────────────
const joinParts = (a) => (Array.isArray(a) ? a.map((x) => x?.value || '').join('') : String(a || ''))
async function mwmbl(q, { timeout }) {
  const json = await get(`https://api.mwmbl.org/api/v1/search/?s=${encodeURIComponent(q)}`, {
    timeout,
    json: true,
    headers: { Accept: 'application/json' }
  })
  const list = (Array.isArray(json) ? json : []).map((r) => ({ title: clean(joinParts(r.title)), url: r.url, snippet: clean(joinParts(r.extract)) }))
  return relevant(list, q, 'most')
}

// ── Bing ───────────────────────────────────────────────────────────
function bingUrl(href = '') {
  href = decodeEntities(href)
  const m = href.match(/[?&]u=a1([^&]+)/)
  if (m) {
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
      const url = Buffer.from(b64, 'base64').toString('utf8')
      if (/^https?:\/\//.test(url)) return url
    } catch {}
  }
  return href
}

async function bing(q, { timeout }) {
  const html = await get(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=MX`, { timeout })
  const out = []
  for (const b of html.split(/<li[^>]+class="b_algo"/i).slice(1)) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const sn = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({ title: clean(a[2]), url: bingUrl(a[1]), snippet: clean(sn?.[1] || '').replace(/^Web\s+/, '') })
  }
  if (!out.length && isBlockedPage(html)) throw new BlockedError('captcha')
  // Bing a veces responde basura a bots: exigir relevancia fuerte
  return relevant(out, q, 'most')
}

// ── Wikipedia (es) — último recurso ────────────────────────────────
async function wikipedia(q, { timeout }) {
  const url =
    `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=` +
    `${encodeURIComponent(q)}&format=json&utf8=1&srlimit=${MAX}`
  const json = await get(url, { timeout, json: true, headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } })
  return (json?.query?.search || []).map((r) => ({
    title: r.title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: clean(r.snippet)
  }))
}

export function engines() {
  const env = process.env
  const list = []
  if (env.GOOGLE_CSE_KEY && env.GOOGLE_CSE_CX) list.push({ id: 'google', name: 'Google', fn: googleCse })
  if (env.BRAVE_API_KEY) list.push({ id: 'brave', name: 'Brave Search', fn: braveApi })
  list.push(
    { id: 'duckduckgo', name: 'DuckDuckGo', fn: ddgHtml },
    { id: 'duckduckgo', name: 'DuckDuckGo Lite', fn: ddgLite },
    { id: 'seznam', name: 'Seznam', fn: seznam },
    { id: 'mwmbl', name: 'Mwmbl', fn: mwmbl },
    { id: 'marginalia', name: 'Marginalia', fn: marginalia, timeout: 5000 },
    { id: 'bing', name: 'Bing', fn: bing },
    { id: 'wikipedia', name: 'Wikipedia', fn: wikipedia, last: true }
  )
  const off = new Set(String(env.SEARCH_DISABLE || '').toLowerCase().split(/[\s,]+/).filter(Boolean))
  return list.filter((e) => !off.has(e.id) && !off.has(e.name.toLowerCase()))
}

export async function webSearch(q) {
  const errors = []
  const start = Date.now()
  const seen = new Set()
  let results = []
  const sources = []
  for (const eng of engines()) {
    if (results.length >= MAX) break
    const left = start + BUDGET - (eng.last ? 0 : WIKI_RESERVE) - Date.now()
    if (left < 1200) { errors.push(`${eng.name}: sin tiempo`); continue }
    const timeout = Math.min(eng.timeout || (eng.last ? 5000 : ENGINE_TIMEOUT), left)
    const t0 = Date.now()
    try {
      const list = uniq(await eng.fn(q, { timeout }), seen)
      if (list.length) {
        results = results.concat(list).slice(0, MAX)
        sources.push(eng.name)
      } else errors.push(`${eng.name}: sin resultados (${Date.now() - t0} ms)`)
    } catch (e) {
      errors.push(`${eng.name}: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e} (${Date.now() - t0} ms)`)
    }
  }
  const tiktoks = await buscarTiktok(q)
  if (tiktoks.length) {
    results = results.concat(uniq(tiktoks, seen)).slice(0, MAX)
    if (!sources.includes('TikTok')) sources.push('TikTok')
  }
  return { source: sources.join(' + ') || null, results, errors, ms: Date.now() - start }
}

async function buscarTiktok(q) {
  const base = (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = 'LUFFY-FIX67'
  try {
    const url = `${base}/search/tiktok?query=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    const json = await res.json().catch(() => ({}))
    const list = json?.data || json?.result || []
    if (!json?.status || !Array.isArray(list)) return []
    const out = []
    for (const v of list) {
      const page = String(v?.url || '').trim()
      const author = v?.author && typeof v.author === 'object' ? v.author : {}
      const uid = author.unique_id || author.uniqueId || ''
      const id = v?.id || ''
      const link = /tiktok\.com/i.test(page) ? page.split(/\s/)[0] : (uid && id ? `https://www.tiktok.com/@${uid}/video/${id}` : '')
      if (!link) continue
      const title = String(v.title || v.desc || 'TikTok').replace(/\s+/g, ' ').trim()
      out.push({
        title,
        url: link,
        snippet: uid ? `@${String(uid).replace(/^@/, '')}` : 'TikTok',
        image: typeof v.cover === 'string' ? v.cover : ''
      })
    }
    return out
  } catch (e) {
    console.error('[google] tiktok', e?.message || e)
    return []
  }
}

export function formatResults(q, source, results) {
  return (
    `❑ *Búsqueda Web*\n> ✿ ${q}\n\n` +
    results
      .map(
        (r, i) =>
          `➩ *${i + 1}. ${short(r.title, 120)}*\n` +
          (r.snippet ? `> ${short(r.snippet)}\n` : '') +
          `> ❑ ${r.url}`
      )
      .join('\n\n╾۪〬─ ┄─〬 ׅ┄─ׄ─۪〬 ┈┄─ׄ〬╼\n\n') +
    `\n\n✎ Fuente › ${source}`
  ).slice(0, 3800)
}



function youtubeVideoId(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').slice(0, 11)
      if (/^[\w-]{11}$/.test(id)) return id
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v') || ''
      if (/^[\w-]{11}$/.test(v)) return v
      const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)
      if (m) return m[1]
    }
  } catch {}
  return ''
}

// YouTube no pone og:image en el HTML que recibe el bot. La miniatura pública sí responde.
function miniaturaDirecta(url) {
  const id = youtubeVideoId(url)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
}

function miniaturaCanal(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return ''
    const ch = u.pathname.match(/\/channel\/(UC[\w-]{22})/)
    if (ch) return `https://unavatar.io/youtube/${ch[1]}`
    const at = u.pathname.match(/\/@([\w.-]+)/)
    if (at) return `https://unavatar.io/youtube/${at[1]}`
  } catch {}
  return ''
}

function esImagen(buf) {
  if (!buf || buf.length < 12) return false
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif'
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp'
  return false
}

function urlAbsoluta(base, href) {
  try { return new URL(href, base).href } catch { return '' }
}

// og:image o twitter:image del HTML de la página.
export function ogImage(html = '', pageUrl = '') {
  const metas = [...String(html).slice(0, 120000).matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])
  for (const tag of metas) {
    const prop = attr(tag, 'property') || attr(tag, 'name')
    if (!/^(og:image|og:image:url|twitter:image|twitter:image:src)$/i.test(prop)) continue
    const raw = decodeEntities(attr(tag, 'content'))
    const u = urlAbsoluta(pageUrl, raw)
    if (/^https?:\/\//i.test(u)) return u
  }
  return ''
}

let sharpMod
async function jpegConSharp(buffer) {
  try {
    if (sharpMod === undefined) {
      try { sharpMod = (await import('sharp')).default } catch { sharpMod = null }
    }
    if (!sharpMod) return { skip: true }
    const out = await sharpMod(buffer, { animated: false, failOn: 'none' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer()
    if (esImagen(out) === 'image/jpeg') return { buffer: out }
    return { error: 'sharp no produjo JPEG' }
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

async function jpegConFfmpeg(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggcover-'))
  const inp = path.join(dir, 'in.img')
  const out = path.join(dir, 'out.jpg')
  try {
    fs.writeFileSync(inp, buffer)
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', inp, '-frames:v', '1', '-q:v', '3', out], { timeout: 20000 })
    if (!fs.existsSync(out)) return { error: 'ffmpeg no escribió el JPEG' }
    const jpeg = fs.readFileSync(out)
    if (esImagen(jpeg) !== 'image/jpeg') return { error: 'ffmpeg no produjo JPEG' }
    return { buffer: jpeg }
  } catch (e) {
    return { error: e?.message || String(e) }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

async function aJpeg(buffer) {
  const sharpRes = await jpegConSharp(buffer)
  if (sharpRes.buffer) return sharpRes.buffer
  const ff = await jpegConFfmpeg(buffer)
  return ff.buffer || null
}

function origenDe(pageUrl) {
  try {
    const u = new URL(pageUrl)
    return `${u.protocol}//${u.host}/`
  } catch {
    return ''
  }
}

// Wikia niega la imagen (403) si no llega Referer, y sin format=original manda WEBP.
function urlImagenDescargable(url) {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return ''
  try {
    const x = new URL(u)
    if (/wikia\.nocookie\.net$/i.test(x.hostname) && !x.searchParams.has('format')) {
      x.searchParams.set('format', 'original')
    }
    return x.href
  } catch {
    return u
  }
}

async function bajarImagen(url, pageUrl = '') {
  const u = urlImagenDescargable(url)
  if (!u) return null
  const headers = { ...HEADERS, Accept: 'image/jpeg,image/png,image/webp,image/*,*/*;q=0.5' }
  const ref = origenDe(pageUrl)
  if (ref) headers.Referer = ref
  try {
    const res = await fetch(u, {
      headers,
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    })
    if (!res.ok) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_THUMB) return null
    const tipo = esImagen(buffer)
    if (tipo === 'image/jpeg' || tipo === 'image/png') return { buffer, mimetype: tipo }
    if (tipo === 'image/webp' || tipo === 'image/gif') {
      const jpeg = await aJpeg(buffer)
      if (jpeg) return { buffer: jpeg, mimetype: 'image/jpeg' }
    }
    return null
  } catch (e) {
    console.error('[google] miniatura', e?.message || e)
    return null
  }
}

async function htmlCorto(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return ''
    const chunks = []
    let n = 0
    for await (const c of res.body) {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c)
      chunks.push(b)
      n += b.length
      if (n >= 80000) break
    }
    res.body?.destroy?.()
    return Buffer.concat(chunks).slice(0, 80000).toString('utf8')
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

// Wikipedia usa /w/api.php. Fandom en español usa /es/api.php, no /w/.
function mediaWikiDe(url) {
  try {
    const u = new URL(url)
    const host = u.hostname
    const wiki = /(^|\.)wikipedia\.org$/i.test(host)
    const fandom = /(^|\.)fandom\.com$/i.test(host)
    if (!wiki && !fandom) return null
    const m = u.pathname.match(/^(?:\/([a-z]{2,12}))?\/wiki\/(.+)$/i)
    if (!m) return null
    const lang = m[1] && m[1].toLowerCase() !== 'wiki' ? m[1] : ''
    const title = decodeURIComponent(m[2])
    const api = lang
      ? `https://${host}/${lang}/api.php`
      : wiki
        ? `https://${host}/w/api.php`
        : `https://${host}/api.php`
    return { api, title }
  } catch {
    return null
  }
}

async function thumbsWiki(results) {
  const groups = new Map()
  for (const r of results) {
    if (r.image) continue
    const w = mediaWikiDe(r.url)
    if (!w) continue
    if (!groups.has(w.api)) groups.set(w.api, [])
    groups.get(w.api).push({ r, title: w.title })
  }
  await Promise.all([...groups.entries()].map(async ([api, items]) => {
    const titles = items.map((x) => x.title).slice(0, 8)
    const url = `${api}?action=query&prop=pageimages&format=json&pithumbsize=480&titles=${titles.map(encodeURIComponent).join('|')}`
    try {
      const json = await get(url, { timeout: 6000, json: true, headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } })
      for (const page of Object.values(json?.query?.pages || {})) {
        const src = page?.thumbnail?.source
        if (!src) continue
        const hit = items.find((x) => norm(x.title.replace(/_/g, ' ')) === norm(String(page.title || '').replace(/_/g, ' ')))
        if (hit) hit.r.image = src
      }
    } catch (e) {
      console.error('[google] wiki thumb', e?.message || e)
    }
  }))
}


function esYouTube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com'
  } catch { return false }
}

// Playlist y canal no tienen id de video. oEmbed devuelve la miniatura (la de la playlist sí).
async function oembedThumb(url) {
  if (!esYouTube(url)) return ''
  try {
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
    const json = await get(endpoint, { timeout: 6000, json: true, headers: { Accept: 'application/json' } })
    const thumb = String(json?.thumbnail_url || '')
    return /^https?:\/\//i.test(thumb) ? thumb : ''
  } catch (e) {
    console.error('[google] oembed', e?.message || e)
    return ''
  }
}

async function completarMiniaturas(results) {
  for (const r of results) {
    if (!r.image) r.image = miniaturaDirecta(r.url)
  }
  await Promise.all(results.map(async (r) => {
    if (r.image || !esYouTube(r.url)) return
    const thumb = await oembedThumb(r.url)
    if (thumb) r.image = thumb
    else r.image = miniaturaCanal(r.url)
  }))
  await thumbsWiki(results)
  await Promise.all(results.map(async (r) => {
    if (r.image) return
    const html = await htmlCorto(r.url)
    const img = ogImage(html, r.url)
    if (img) r.image = img
  }))
  await Promise.all(results.map(async (r) => {
    r._thumb = await bajarImagen(r.image, r.url)
  }))
}

function captionResultado(r, i) {
  return (
    `➩ *${i + 1}. ${short(r.title, 120)}*\n` +
    (r.snippet ? `> ${short(r.snippet)}\n` : '') +
    `> ❑ ${r.url}`
  ).slice(0, 1000)
}


const GOOGLE_SITE = 'google'

function recordar(msg, results) {
  const items = []
  for (const r of results) {
    const url = String(r?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    items.push({
      title: String(r.title || 'Sin título').replace(/\s+/g, ' ').trim().slice(0, 300),
      url
    })
  }
  if (!items.length) return 0
  savePick(msg.chat, { sender: msg.sender, site: GOOGLE_SITE, items, msg, fromMe: msg.fromMe })
  return items.length
}


function wikiDe(url) {
  try {
    const u = new URL(url)
    if (!/(^|\.)wikipedia\.org$/i.test(u.hostname)) return null
    const m = u.pathname.match(/\/wiki\/(.+)$/)
    if (!m) return null
    return { host: u.hostname, title: decodeURIComponent(m[1]) }
  } catch {
    return null
  }
}

async function resumenWiki(url) {
  const w = wikiDe(url)
  if (!w) return ''
  const api = `https://${w.host}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(w.title)}`
  const json = await get(api, { timeout: 8000, json: true, headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } })
  const page = Object.values(json?.query?.pages || {})[0] || {}
  const extract = String(page.extract || '').replace(/\s+/g, ' ').trim()
  if (!extract) return ''
  const title = String(page.title || w.title.replace(/_/g, ' ')).trim()
  const body = extract.length > 1400 ? extract.slice(0, 1400).replace(/\s+\S*$/, '') + '…' : extract
  return `❑ *${title}*\n\n${body}\n\n${url}`
}

function enlaceYouTube(url) {
  const id = youtubeVideoId(url)
  return id ? `https://youtu.be/${id}` : ''
}

async function takeNumber({ msg, sock, usedPrefix }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== GOOGLE_SITE) return false
  if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
    await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
    return true
  }
  const item = hit.items[n - 1]
  if (!item?.url) {
    await msg.reply('Ese resultado no tiene enlace.')
    return true
  }
  if (wikiDe(item.url)) {
    try {
      const text = await resumenWiki(item.url)
      if (!text) {
        await msg.reply(`No pude leer el resumen de Wikipedia.\n${item.url}`)
        return true
      }
      await msg.reply(text)
    } catch (e) {
      console.error('[google] wiki', e?.message || e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
    return true
  }
  if (/tiktok\.com/i.test(item.url)) {
    clearPick(msg)
    try {
      await tiktok.run({ msg, sock, args: [item.url], command: 'tiktok', usedPrefix })
    } catch (e) {
      console.error('[google] tiktok', e?.message || e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
    return true
  }
  const video = enlaceYouTube(item.url)
  if (!video) {
    const title = String(item.title || 'Ese resultado').replace(/\s+/g, ' ').trim().slice(0, 160)
    await msg.reply(`《✧》 *${title}* no es un video de YouTube. No lo bajo.\n${item.url}`)
    return true
  }
  clearPick(msg)
  try {
    await play2.run({ msg, sock, args: [video], usedPrefix })
  } catch (e) {
    console.error('[google] descarga', e?.message || e)
    await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
  }
  return true
}

export async function before(ctx) {
  try {
    return await takeNumber(ctx)
  } catch (e) {
    console.error('[google] pick', e?.message || e)
    let ours = false
    try {
      const hit = readPick(ctx?.msg)
      ours = !!(hit && hit.site === GOOGLE_SITE && bareNumber(ctx?.msg) != null)
    } catch {}
    if (!ours) return false
    try { await ctx.msg.reply(`《✧》 Error: ${e?.message || e}`) } catch {}
    return true
  }
}

async function enviarResultados({ msg, sock, q, source, results }) {
  await completarMiniaturas(results)
  const n = results.length
  const guardados = recordar(msg, results)
  const rango = guardados ? ` Responde con un número del 1 al ${guardados} (vale 5 min) para bajar un video de YouTube o TikTok, o leer el resumen de Wikipedia.` : ''
  await msg.reply(`❑ *Búsqueda Web*\n> ✿ ${q}\n\n✎ ${n} resultado${n === 1 ? '' : 's'}. Fuente › ${source}.${rango}`)
  for (let i = 0; i < results.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_MS))
    const caption = captionResultado(results[i], i)
    const thumb = results[i]._thumb
    try {
      if (thumb) {
        await sock.sendMessage(msg.chat, { image: thumb.buffer, mimetype: thumb.mimetype, caption }, { quoted: msg })
        continue
      }
    } catch (e) {
      console.error(`[google] miniatura ${i + 1} no enviada, mando texto:`, e?.message || e)
    }
    try {
      await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg })
    } catch (e) {
      console.error(`[google] resultado ${i + 1}`, e?.message || e)
    }
  }
}

export default {
  command: ['google', 'gg', 'buscar', 'googlesearch'],
  category: 'search',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    console.error('[google] build 1.1.41 diez tiktok miniatura')
    const p = usedPrefix || '#'
    const q = (text || args.join(' ')).trim()
    if (!q) {
      return msg.reply(`✎ Uso: ${p}google <texto>\nEjemplo: ${p}google algebra de baldor`)
    }

    try { await msg.react('🕒') } catch {}
    try {
      const { source, results, errors } = await webSearch(q)
      if (!results.length) {
        console.error('[google] sin resultados:', errors.join(' | '))
        try { await msg.react('✖️') } catch {}
        return msg.reply(
          `✤ No pude obtener resultados para *${q}*.\n` +
            `Los buscadores no respondieron o están bloqueando la consulta. Intenta de nuevo en unos minutos o con otras palabras.`
        )
      }
      await enviarResultados({ msg, sock, q, source, results })
      try { await msg.react('✔️') } catch {}
    } catch (e) {
      console.error('[google]', e)
      try { await msg.react('✖️') } catch {}
      await msg.reply(`✤ Error al buscar: ${e?.message || e}`)
    }
  }
}
