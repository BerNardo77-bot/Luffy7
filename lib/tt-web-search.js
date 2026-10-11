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

async function getPage(url, opts = {}) {
  return withProxyFallback(async (useProxy) => {
    const r = await axios({ url, method: opts.method || 'GET', data: opts.data, ...axiosOpts(useProxy), timeout: 15000, responseType: 'text',
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9', ...(opts.headers || {}) }, validateStatus: () => true })
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    const links = extractTiktokLinks(r.data)
    if (!links.length) throw new Error('sin links de TikTok')
    return links
  }, 'web tiktok')
}

export async function webTiktokLinks(query, max = 20) {
  const qs = [`site:tiktok.com ${query}`, `tiktok ${query}`]
  const tries = []
  for (const q of qs) {
    tries.push(() => getPage(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=MX&count=30`))
    tries.push(() => getPage(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`))
    tries.push(() => getPage('https://html.duckduckgo.com/html/', { method: 'POST', data: `q=${encodeURIComponent(q)}&kl=mx-es`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' } }))
  }
  const all = []
  const errors = []
  for (const t of tries) {
    if (all.length >= max) break
    try { all.push(...await t()) } catch (e) { errors.push(String(e?.message || e).slice(0, 80)) }
  }
  const seen = new Set()
  const links = all.filter(v => !seen.has(v.id) && seen.add(v.id)).slice(0, max)
  return { links, errors }
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

// Mismo formato que tikwm (id, title, author, url, cover, duration en segundos).
export async function enrichTiktok(link) {
  const [o, j] = await Promise.all([oembed(link.url).catch(() => null), ytdlpMeta(link.url).catch(() => null)])
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

export async function searchTiktokWeb(query, { max = 15, concurrency = 4 } = {}) {
  const { links, errors } = await webTiktokLinks(query, max)
  if (!links.length) throw new Error(`buscador web sin links de TikTok (${errors.join('; ') || 'sin respuesta'})`)
  return pool(links, concurrency, enrichTiktok)
}
