import fetch from 'node-fetch'

// #google — búsqueda web sin API key.
// Orden: DuckDuckGo HTML → DuckDuckGo Lite → Bing (con filtro de relevancia)
//        → Wikipedia (es) → Marginalia. Cada fuente con timeout propio.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-419,es;q=0.9,en;q=0.6'
}
const TIMEOUT = 12000
const MAX = 5

async function get(url, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT)
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { ...HEADERS, ...(opts.headers || {}) },
      signal: ctrl.signal,
      redirect: 'follow'
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } finally {
    clearTimeout(t)
  }
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

function uniq(list) {
  const seen = new Set()
  return list.filter((r) => {
    if (!r?.url || !r?.title || !/^https?:\/\//i.test(r.url)) return false
    const k = r.url.replace(/[#?].*$/, '').replace(/\/$/, '')
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

// Algunas fuentes (Bing) devuelven resultados aleatorios a bots: se descartan
// los que no contienen ninguna palabra importante de la búsqueda.
function relevant(list, q) {
  const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
  if (!words.length) return list
  return list.filter((r) => {
    const hay = norm(`${r.title} ${r.snippet} ${r.url}`)
    return words.some((w) => hay.includes(w))
  })
}

// ── DuckDuckGo HTML ────────────────────────────────────────────────
function ddgUrl(href = '') {
  href = decodeEntities(href)
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  if (href.startsWith('//')) return 'https:' + href
  return href
}

function attr(tag = '', name) {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? m[1] ?? m[2] : ''
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

async function ddgHtml(q) {
  const res = await get('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' },
    body: new URLSearchParams({ q, kl: 'mx-es' }).toString()
  })
  return parseDdgHtml(await res.text())
}

// ── DuckDuckGo Lite ────────────────────────────────────────────────
export function parseDdgLite(html = '') {
  const links = [...html.matchAll(/(<a\b[^>]*class=["']result-link["'][^>]*>)([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/<td\b[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi)]
  return links
    .map((m, i) => ({ title: clean(m[2]), url: ddgUrl(attr(m[1], 'href')), snippet: clean(snippets[i]?.[1] || '') }))
    .filter((r) => !/duckduckgo\.com\/y\.js/.test(r.url))
}

async function ddgLite(q) {
  const res = await get('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://lite.duckduckgo.com/' },
    body: new URLSearchParams({ q, kl: 'mx-es' }).toString()
  })
  return parseDdgLite(await res.text())
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

async function bing(q) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=MX`
  const html = await (await get(url)).text()
  const out = []
  for (const b of html.split(/<li[^>]+class="b_algo"/i).slice(1)) {
    const a = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!a) continue
    const sn = b.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    out.push({ title: clean(a[2]), url: bingUrl(a[1]), snippet: clean(sn?.[1] || '').replace(/^Web\s+/, '') })
  }
  // Bing a veces responde basura a bots: exigir relevancia
  const ok = relevant(out, q)
  return ok.length >= Math.min(3, out.length) ? ok : []
}

// ── Marginalia (índice independiente, API pública) — último recurso ─────────────────
async function marginalia(q) {
  const url = `https://api.marginalia.nu/public/search/${encodeURIComponent(q)}?count=10`
  const json = await (await get(url, { timeout: 8000, headers: { Accept: 'application/json' } })).json()
  const list = (json?.results || []).map((r) => ({
    title: clean(r.title),
    url: r.url,
    snippet: clean(r.description || '')
  }))
  return relevant(list, q)
}

// ── Wikipedia (es) — respaldo ────────────────────────────────
async function wikipedia(q) {
  const url =
    `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=` +
    `${encodeURIComponent(q)}&format=json&utf8=1&srlimit=${MAX}`
  const json = await (await get(url, { headers: { 'User-Agent': 'Luffy7-WhatsApp/1.1.18 (google)' } })).json()
  return (json?.query?.search || []).map((r) => ({
    title: r.title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: clean(r.snippet)
  }))
}

const SOURCES = [
  ['DuckDuckGo', ddgHtml],
  ['DuckDuckGo Lite', ddgLite],
  ['Bing', bing],
  ['Wikipedia', wikipedia],
  ['Marginalia', marginalia]
]

export async function webSearch(q) {
  const errors = []
  for (const [name, fn] of SOURCES) {
    try {
      const list = uniq(await fn(q)).slice(0, MAX)
      if (list.length) return { source: name, results: list, errors }
      errors.push(`${name}: sin resultados`)
    } catch (e) {
      errors.push(`${name}: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`)
    }
  }
  return { source: null, results: [], errors }
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
