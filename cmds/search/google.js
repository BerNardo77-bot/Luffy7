import fetch from 'node-fetch'

// #google — búsqueda web.
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
const MAX = 5
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
  return (json?.items || []).map((r) => ({ title: clean(r.title), url: r.link, snippet: clean(r.snippet || '') }))
}

async function braveApi(q, { timeout }) {
  const p = new URLSearchParams({ q, count: '10', search_lang: 'es', country: 'MX', safesearch: 'moderate' })
  const json = await get(`https://api.search.brave.com/res/v1/web/search?${p}`, {
    timeout,
    json: true,
    headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY }
  })
  return (json?.web?.results || []).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.description || '') }))
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
    if (results.length >= MIN_GOOD) break
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
  return { source: sources.join(' + ') || null, results, errors, ms: Date.now() - start }
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

export default {
  command: ['google', 'gg', 'buscar', 'googlesearch'],
  category: 'search',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
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
      await msg.reply(formatResults(q, source, results))
      try { await msg.react('✔️') } catch {}
    } catch (e) {
      console.error('[google]', e)
      try { await msg.react('✖️') } catch {}
      await msg.reply(`✤ Error al buscar: ${e?.message || e}`)
    }
  }
}
