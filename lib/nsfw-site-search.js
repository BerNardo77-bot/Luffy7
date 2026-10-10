// Búsqueda directa en la web de xnxx / xvideos (respaldo y relleno de la API).
// Devuelve [{ title, duration, url, thumb }]. Directo (el teléfono está en México, sin proxy).

export const NSFW_LIST_MAX = 10
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ')
  .replace(/&([aeiou])acute;/gi, (_, v) => ({ a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' }[v]))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()

// Quita marcadores de plantilla del sitio (THUMBNUM y similares en mayúsculas) del enlace.
// /video.hkepti355b/THUMBNUM/slug → /video.hkepti355b/slug
export function cleanVideoUrl(u) {
  return String(u || '').replace(/\/(?:THUMBNUM|[A-Z][A-Z_]{5,}[A-Z])(?=\/|$)/g, '')
}
// Miniatura con marcador (…/xv_THUMBNUM_t.jpg) → la 1
export function cleanThumbUrl(u) {
  return String(u || '').replace(/THUMBNUM/g, '1')
}

export function parseSiteResults(html, site) {
  const host = site === 'xnxx' ? 'https://www.xnxx.com' : 'https://www.xvideos.com'
  const out = []
  for (const block of String(html || '').split('<div id="video_').slice(1)) {
    const a = block.match(/<a href="(\/video[.-][^"]+)" title="([^"]*)"/)
    if (!a) continue
    const thumb = cleanThumbUrl((block.match(/data-src="(https:[^"]+)"/) || [])[1] || '')
    let duration = ''
    if (site === 'xvideos') duration = ((block.match(/<span class="duration">([^<]+)<\/span>/) || [])[1] || '').trim()
    else duration = ((block.match(/<\/span><\/span>\s*([0-9][^<\n]*?(?:min|sec|h))\s*\n/) || [])[1] || '').trim()
    out.push({ title: decode(a[2]) || 'Sin título', duration, url: cleanVideoUrl(host + a[1]), thumb })
  }
  return out
}

export function siteSearchUrl(site, query, page = 0) {
  const q = encodeURIComponent(String(query).trim())
  if (site === 'xnxx') return `https://www.xnxx.com/search/${q.replace(/%20/g, '+')}${page ? '/' + page : ''}`
  return `https://www.xvideos.com/?k=${q}${page ? '&p=' + page : ''}`
}

export async function siteSearch(site, query, page = 0) {
  const res = await fetch(siteSearchUrl(site, query, page), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9' },
    signal: AbortSignal.timeout(25000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const items = parseSiteResults(await res.text(), site)
  if (!items.length) throw new Error('página sin resultados')
  return items
}

export function dedupeByUrl(list) {
  const seen = new Set()
  const out = []
  for (const it of list || []) {
    const k = String(it?.url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
    const id = (k.match(/video[.-]([a-z0-9]+)/) || [])[1] || k
    if (!k || seen.has(id)) continue
    seen.add(id)
    out.push(it)
  }
  return out
}

// API primero; si da < max, se completa con la web (páginas 0 y 1).
export async function fillResults(site, query, apiResults, max = NSFW_LIST_MAX) {
  let all = dedupeByUrl(apiResults)
  for (let page = 0; all.length < max && page < 2; page++) {
    try {
      all = dedupeByUrl(all.concat(await siteSearch(site, query, page)))
    } catch (e) {
      console.error(`[${site}] web p${page}`, String(e?.message || e).slice(0, 160))
      break
    }
  }
  return all
}
