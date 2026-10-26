// Búsqueda de YouTube como la ve alguien en México: InnerTube (youtubei/v1/search) con gl=MX, hl=es-419.
// Así salen los títulos originales en español (no traducidos al inglés) y el orden de LatAm.
// Proxy primero si el bot ya tiene uno configurado (YT_DLP_PROXY / YT_PROXY / DL_PROXY); si falla, directo.
const ENDPOINT = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false'
const ONLY_VIDEOS = 'EgIQAQ=='
const CLIENT_VERSION = '2.20250101.00.00'

export function ytRegion(env = process.env) {
  return { gl: String(env.YT_SEARCH_GL || 'MX').toUpperCase(), hl: String(env.YT_SEARCH_HL || 'es-419') }
}
export function ytSearchProxy(env = process.env) {
  return String(env.YT_DLP_PROXY || env.YT_PROXY || env.DL_PROXY || '').trim()
}
// Argumentos de yt-dlp para que los títulos salgan en español
export const YTDLP_LANG_ARGS = ['--extractor-args', 'youtube:lang=es']

export function buildSearchBody(query, { gl, hl } = ytRegion(), params = '') {
  return {
    context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl, gl, timeZone: 'America/Mexico_City', utcOffsetMinutes: -360 } },
    query,
    params: params || ONLY_VIDEOS
  }
}

const txt = (t) => t?.simpleText || (t?.runs || []).map((r) => r.text).join('') || ''
function walk(node, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return }
  if (node.videoRenderer) { out.push(node.videoRenderer); return }
  for (const k in node) walk(node[k], out)
}
function toSeconds(s) {
  const p = String(s || '').split(':').map(Number)
  if (!p.length || p.some((x) => !Number.isFinite(x))) return 0
  return p.reduce((a, b) => a * 60 + b, 0)
}

export function parseSearch(json) {
  const vr = []
  walk(json?.contents, vr)
  return vr.filter((v) => v.videoId).map((v) => {
    const thumbs = v.thumbnail?.thumbnails || []
    const duration = txt(v.lengthText)
    return {
      title: txt(v.title) || 'Sin título',
      videoId: v.videoId,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      duration,
      seconds: toSeconds(duration),
      autor: txt(v.ownerText || v.longBylineText),
      views: txt(v.viewCountText).replace(/\s*(vistas|views|visualizaciones)\s*$/i, ''),
      uploaded: txt(v.publishedTimeText),
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url.split('?')[0] : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      live: !duration
    }
  })
}

async function once(query, proxy, params) {
  const { gl, hl } = ytRegion()
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': `${hl},es;q=0.9`,
      Origin: 'https://www.youtube.com',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': CLIENT_VERSION
    },
    body: JSON.stringify(buildSearchBody(query, { gl, hl }, params)),
    signal: AbortSignal.timeout(15000)
  }
  let res
  if (proxy) {
    const [{ default: nodeFetch }, { HttpsProxyAgent }] = await Promise.all([import('node-fetch'), import('https-proxy-agent')])
    res = await nodeFetch(ENDPOINT, { ...init, agent: new HttpsProxyAgent(proxy) })
  } else {
    res = await fetch(ENDPOINT, init)
  }
  if (res.status >= 400) throw new Error(`YouTube HTTP ${res.status}`)
  const list = parseSearch(await res.json())
  if (!list.length) throw new Error('YouTube sin resultados')
  return list
}

// Proxy primero (ve lo que ve LatAm); si falla, directo con gl=MX. Nunca se imprime la URL del proxy.
export async function searchYoutubeMx(query, n = 10, params = '') {
  const proxy = ytSearchProxy()
  const errs = []
  for (const p of proxy ? [proxy, ''] : ['']) {
    try {
      return (await once(query, p, params)).slice(0, n)
    } catch (e) {
      errs.push(`${p ? 'proxy' : 'directo'}: ${String(e?.message || e).replace(/\/\/[^@\s]+@/g, '//***@').slice(0, 120)}`)
    }
  }
  throw new Error('innertube ' + errs.join(' · '))
}
