// $podcast / $pod / $antennapod: búsqueda (iTunes MX), feed RSS, enlace de AntennaPod o enlace directo.
// Portado de AndrewWife v1.1.64: axios para feeds (evita "Premature close"), búsqueda de episodios, 10 tarjetas con portada. Sin proxy (teléfono en MX).
import fs from 'fs'
import axios from 'axios'
import { prefijoActual } from '../../lib/prefijo.js'
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js'
import { bajarImagen } from '../../lib/ytMiniatura.js'
import { urlToFile, rmQuiet, mb, MAX_FILE_BYTES, MAX_VIDEO_SEND } from '../../lib/mediadl.js'
const withProxyFallback = (fn) => fn(false)
const axiosOpts = () => ({})


const SITE = 'podcast'
const MAX_EP = 10
const UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 AntennaPod-compatible'
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim()
const tag = (xml, name) => decode((String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')) || [])[1] || '')
const attr = (xml, name, a) => ((String(xml).match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]+)"`, 'i')) || [])[1] || '').replace(/&amp;/g, '&')

function durText(d) {
  const s = String(d || '').trim()
  if (!s) return ''
  if (/^\d+$/.test(s)) { const n = Number(s); const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), x = n % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}` }
  return s
}
function fecha(d) {
  const t = Date.parse(d)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

// Enlaces de AntennaPod: antennapod.org/deeplink/subscribe?url=<feed>[&eUrl=<episodio>] (también eurl/episode)
export function parseAntennaPod(link) {
  try {
    const u = new URL(link)
    if (!/antennapod\.org$/i.test(u.hostname)) return null
    const g = (k) => { for (const [kk, v] of u.searchParams) if (kk.toLowerCase() === k) return v; return '' }
    return { feed: g('url') || g('feed'), episode: g('eurl') || g('episode') || g('eurlx'), title: g('title') }
  } catch { return null }
}

export function parseFeed(xml) {
  const show = tag(String(xml).split(/<item[\s>]/i)[0], 'title') || 'Podcast'
  const art = attr(xml, 'itunes:image', 'href') || tag((String(xml).match(/<image>[\s\S]*?<\/image>/i) || [''])[0], 'url')
  const items = []
  for (const it of String(xml).split(/<item[\s>]/i).slice(1)) {
    const url = attr(it, 'enclosure', 'url')
    if (!url) continue
    items.push({
      title: tag(it, 'title') || 'Episodio',
      url,
      type: attr(it, 'enclosure', 'type') || '',
      length: Number(attr(it, 'enclosure', 'length')) || 0,
      date: tag(it, 'pubDate'),
      duration: durText(tag(it, 'itunes:duration')),
      thumb: attr(it, 'itunes:image', 'href') || art,
      desc: (tag(it, 'itunes:summary') || tag(it, 'description')).replace(/<[^>]+>/g, ' ').slice(0, 1500),
      show
    })
  }
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
  return { show, art, items }
}

// axios (node-fetch a veces corta feeds gzip con "Premature close"); directo → proxy
async function getText(url) {
  return withProxyFallback(async (useProxy) => {
    const res = await axios.get(url, { ...axiosOpts(useProxy), responseType: 'text', timeout: 25000, maxRedirects: 10, validateStatus: () => true,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' } })
    if (res.status >= 400) throw Object.assign(new Error(`el servidor respondió ${res.status}`), { final: res.status === 404 || res.status === 410 })
    return { text: String(res.data || ''), type: String(res.headers['content-type'] || '') }
  }, 'feed')
}

async function itunesJson(params) {
  const r = await axios.get(`https://itunes.apple.com/search?country=MX&${params}`, { timeout: 20000, validateStatus: () => true })
  if (r.status >= 400) throw new Error(`iTunes respondió ${r.status}`)
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data
}
async function itunesSearch(q) {
  const j = await itunesJson(`media=podcast&limit=5&term=${encodeURIComponent(q)}`)
  return (j.results || []).filter((r) => r.feedUrl)
}
// Episodios por nombre en todo iTunes (entity=podcastEpisode)
export async function itunesEpisodes(q, limit = 25) {
  const j = await itunesJson(`media=podcast&entity=podcastEpisode&limit=${limit}&term=${encodeURIComponent(q)}`)
  return (j.results || []).filter((r) => r.episodeUrl).map((r) => ({
    title: String(r.trackName || 'Episodio'),
    url: r.episodeUrl,
    type: r.episodeContentType && r.episodeFileExtension ? `${r.episodeContentType}/${r.episodeFileExtension === 'mp3' ? 'mpeg' : r.episodeFileExtension}` : '',
    length: 0,
    date: r.releaseDate || '',
    duration: r.trackTimeMillis ? durText(String(Math.round(r.trackTimeMillis / 1000))) : '',
    thumb: r.artworkUrl600 || r.artworkUrl160 || '',
    show: String(r.collectionName || '')
  }))
}

// Sin acentos ni mayúsculas; palabras de 2+ letras (o números)
export const normTxt = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()
const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'y', 'en', 'con', 'del', 'a', 'un', 'una', 'the', 'podcast'])
export const qWords = (q) => normTxt(q).replace(/#/g, '').split(' ').filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w))
const fracIn = (text, words) => { const t = ' ' + normTxt(text).replace(/#/g, ' ') + ' '; return words.length ? words.filter((w) => t.includes(' ' + w + ' ') || t.includes(w)).length / words.length : 0 }

// Episodios cuyo título (o título + programa) trae las palabras; todos los del feed, mejores primero
// Orden por niveles (todos los episodios del feed): 1) frase exacta en el título,
// 2) todas las palabras en título(+programa), 3) parte de las palabras en el título,
// 4) palabras en la descripción. Mejores primero; los más nuevos desempatan.
export function rankEpisodes(items, q, max = MAX_EP, minTier = 1) {
  const words = qWords(q)
  if (!words.length) return []
  const phrase = normTxt(q).replace(/#/g, ' ').replace(/\s+/g, ' ').trim()
  const scored = []
  items.forEach((it, i) => {
    const t = normTxt(it.title).replace(/#/g, ' ').replace(/\s+/g, ' ')
    const sT = fracIn(it.title, words)
    const sTS = fracIn(`${it.title} ${it.show}`, words)
    const sD = fracIn(`${it.title} ${it.show} ${it.desc || ''}`, words)
    let tier = 0
    if (phrase && t.includes(phrase)) tier = 5
    else if (sTS >= 1) tier = 4
    else if (sT >= 0.5) tier = 3
    else if (sD >= 1) tier = 2
    else if (sD >= 0.6 && sT > 0) tier = 1
    if (tier && tier >= minTier) scored.push({ it, i, tier, s: sT + sD })
  })
  scored.sort((a, b) => b.tier - a.tier || b.s - a.s || a.i - b.i)
  return scored.slice(0, max).map((x) => x.it)
}
export const matchEpisodes = rankEpisodes

const epKey = (it) => String(it.url || '').split('?')[0] || normTxt(it.title)
export function dedupeEps(list) {
  const seen = new Set()
  return list.filter((it) => { const k = epKey(it); const k2 = normTxt(`${it.show} ${it.title}`); if (seen.has(k) || seen.has(k2)) return false; seen.add(k); seen.add(k2); return true })
}

// Hasta 10, en este orden: 1) coincidencias en títulos del programa, 2) sus episodios más
// nuevos, 3) otras coincidencias (descripción, y episodios de iTunes de otros programas). Sin duplicados.
export function fillEpisodes({ feed, q, itunesEps = [] }) {
  const items = feed?.items || []
  const titulo = rankEpisodes(items, q, MAX_EP, 3)
  const otros = rankEpisodes(items, q, MAX_EP, 1)
  return dedupeEps([...titulo, ...items.slice(0, MAX_EP), ...otros, ...itunesEps]).slice(0, MAX_EP)
}
async function buscarEpisodios({ feed, q, itunesQs }) {
  const items = feed?.items || []
  // iTunes solo si el feed no llena los 10
  const itunesEps = []
  if (dedupeEps([...rankEpisodes(items, q), ...items.slice(0, MAX_EP)]).length < MAX_EP || !rankEpisodes(items, q).length) {
    for (const iq of itunesQs) {
      try {
        const eps = await itunesEpisodes(iq, 50)
        itunesEps.push(...rankEpisodes(eps, iq, 50), ...eps.slice(0, MAX_EP))
      } catch (e) { console.error('[podcast] episodios', e?.message || e) }
      if (itunesEps.length >= MAX_EP) break
    }
  }
  // Sin ninguna coincidencia en el feed, no rellenar con sus nuevos (la búsqueda no era de este programa)
  if (feed && !rankEpisodes(items, q).length) return dedupeEps([...rankEpisodes(itunesEps, q, 50), ...itunesEps]).slice(0, MAX_EP)
  return fillEpisodes({ feed, q, itunesEps })
}

export const showScore = (name, q) => fracIn(name, qWords(q))

async function leerFeed(feedUrl) {
  const { text } = await getText(feedUrl)
  if (!/<rss|<feed|<channel/i.test(text)) throw new Error('el enlace no es un feed RSS de podcast')
  return parseFeed(text)
}

const PAUSA_MS = 1200
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

// Un mensaje por resultado: miniatura (itunes:image del episodio o portada del programa) + número,
// título, programa, fecha, duración, tamaño. Pausa entre envíos. Al final, el pie.
async function enviarLista({ msg, sock, titulo, items, art }) {
  items = items.slice(0, MAX_EP)
  if (!items.length) return
  savePick(msg.chat, { sender: msg.sender, site: SITE, items, msg, fromMe: msg.fromMe })
  await msg.reply(`🎙️ ${titulo}`).catch(() => {})
  const cache = new Map()
  for (let i = 0; i < items.length; i++) {
    await esperarMs(PAUSA_MS)
    const it = items[i]
    const meta = [fecha(it.date), it.duration, it.length ? mb(it.length) + ' MB' : ''].filter(Boolean).join(' · ')
    const caption = `*${i + 1}.* ${it.title.slice(0, 160)}${it.show ? `\n🎙️ ${it.show.slice(0, 60)}` : ''}${meta ? `\n${meta}` : ''}`
    const src = it.thumb || art
    if (src && !cache.has(src)) cache.set(src, await bajarImagen(src).catch(() => null))
    const pic = src ? cache.get(src) : null
    try {
      if (pic) { await sock.sendMessage(msg.chat, { image: pic.buffer, mimetype: pic.mimetype, caption }, { quoted: msg }); continue }
    } catch (e) { console.error('[podcast] miniatura', e?.message || e) }
    await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg }).catch(() => msg.reply(caption).catch(() => {}))
  }
  await esperarMs(PAUSA_MS)
  const pie = `✎ Responde con el número (1-${items.length}) para descargar · vale 5 min`
  await sock.sendMessage(msg.chat, { text: pie }, { quoted: msg }).catch(() => msg.reply(pie).catch(() => {}))
}

const isMediaUrl = (u) => /\.(mp3|m4a|aac|ogg|opus|wav|mp4|m4v|mov|webm)(\?|$)/i.test(u)

// filtro: palabras del episodio (opcional). Sin filtro: los 10 más nuevos.
async function listarEpisodios({ msg, sock, feedUrl, filtro = '' }) {
  let feed
  try {
    feed = await leerFeed(feedUrl)
  } catch (e) {
    return msg.reply(`《✧》 No pude leer el feed del podcast: ${e?.message || e}.\n${feedUrl}`)
  }
  if (!feed.items.length) return msg.reply(`《✧》 *${feed.show}* no tiene episodios para descargar en su feed.`)
  if (filtro) {
    const hits = await buscarEpisodios({ feed, q: filtro, itunesQs: [`${filtro} ${feed.show}`, filtro] })
    if (!hits.length) return false
    return enviarLista({ msg, sock, titulo: `*${feed.show}* — ${hits.length} episodio${hits.length === 1 ? '' : 's'} para “${filtro}” (busqué en sus ${feed.items.length} episodios${hits.some((h) => h.show !== feed.show) ? ' y en otros podcasts' : ''})`, items: hits, art: feed.art })
  }
  return enviarLista({ msg, sock, titulo: `*${feed.show}* — ${Math.min(MAX_EP, feed.items.length)} episodios más nuevos`, items: feed.items, art: feed.art })
}

// Búsqueda de episodios en iTunes; true si mandó lista
async function porEpisodio({ msg, sock, q }) {
  let eps = []
  try { eps = await itunesEpisodes(q) } catch (e) { console.error('[podcast] episodios', e?.message || e) }
  const hits = await buscarEpisodios({ feed: null, q, itunesQs: [q] })
  if (!hits.length) return false
  await enviarLista({ msg, sock, titulo: `${hits.length} episodios para “${q}”`, items: hits })
  return true
}

async function descargar({ msg, sock, item }) {
  await msg.reply(`《✧》 Bajando: *${item.title.slice(0, 120)}*${item.length ? ` (~${mb(item.length)} MB)` : ''}…`)
  if (item.length > MAX_FILE_BYTES) return msg.reply(`《✧》 Ese episodio pesa ~${mb(item.length)} MB y el límite es ${mb(MAX_FILE_BYTES)} MB.\n${item.url}`)
  const ext = (item.url.match(/\.(mp3|m4a|aac|ogg|opus|wav|mp4|m4v|mov|webm)(\?|$)/i) || [])[1]?.toLowerCase() || (/video/.test(item.type) ? 'mp4' : 'mp3')
  let got
  try {
    got = await urlToFile(item.url, { tag: 'pod', ext, idleMs: 90000 })
  } catch (e) {
    const m = String(e?.message || e)
    if (m.startsWith('TOO_BIG:')) return msg.reply(`《✧》 Ese episodio pesa más de ${mb(MAX_FILE_BYTES)} MB; no cabe.\n${item.url}`)
    if (m.startsWith('NO_SPACE:')) return msg.reply(`《✧》 ${m.slice(9).trim()}`)
    return msg.reply(`《✧》 No pude bajar el episodio: ${m.slice(0, 150)}.\n${item.url}`)
  }
  const isVideo = /video/.test(item.type) || /^(mp4|m4v|mov|webm)$/.test(ext)
  const mime = item.type && /audio|video/.test(item.type) ? item.type : (isVideo ? 'video/mp4' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg')
  const name = `${item.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 90) || 'episodio'}.${ext}`
  const cap = `🎙️ ${item.show ? item.show + ' — ' : ''}${item.title.slice(0, 150)}\n${mb(got.size)} MB`
  try {
    if (isVideo && got.size <= MAX_VIDEO_SEND) {
      await sock.sendMessage(msg.chat, { video: { url: got.file }, mimetype: 'video/mp4', fileName: name, caption: cap }, { quoted: msg })
    } else {
      // audio y videos pesados: documento con el archivo original (sin recomprimir)
      await sock.sendMessage(msg.chat, { document: { url: got.file }, mimetype: mime, fileName: name, caption: cap }, { quoted: msg })
    }
  } catch (e) {
    console.error('[podcast] envío', e?.message || e)
    await msg.reply(`《✧》 Lo bajé (${mb(got.size)} MB) pero WhatsApp no lo aceptó. Ábrelo aquí:\n${item.url}`).catch(() => {})
  } finally {
    rmQuiet(got.file)
  }
}

export async function before({ msg, sock }) {
  try {
    // fromMe permitido (el usuario prueba desde la cuenta del bot). Sin msg.isBot.
    const n = bareNumber(msg)
    if (n == null) return false
    const hit = readPick(msg)
    if (!hit || hit.site !== SITE) return false
    if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
      await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
      return true
    }
    const item = hit.items[n - 1]
    clearPick(msg)
    await descargar({ msg, sock, item })
    return true
  } catch (e) {
    console.error('[podcast] número', e?.message || e)
    await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    return true
  }
}

export default {
  command: ['podcast', 'pod', 'antennapod'],
  category: 'downloader',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    try {
      const q = args.join(' ').trim()
      if (!q) {
        return msg.reply(
          `🎙️ *Podcasts*\n` +
          `• ${P}pod <programa> — sus 10 episodios más nuevos\n   Ej: ${P}pod Cracks Oso Trava\n` +
          `• ${P}pod <programa> | <episodio> — busca en TODOS sus episodios\n   Ej: ${P}pod Cracks Oso Trava | Carlos Slim\n` +
          `• ${P}pod <palabras del episodio> — lo busca por nombre en todos los podcasts\n   Ej: ${P}pod Carlos Slim Oso Trava\n` +
          `• ${P}pod <enlace RSS o de AntennaPod> — lista los episodios\n` +
          `• ${P}pod <enlace .mp3/.mp4> — lo descarga directo\n` +
          `Luego responde con el número (1-10). Hasta 500 MB, calidad original.`
        )
      }
      const link = (q.match(/https?:\/\/\S+/) || [])[0]
      if (link) {
        const ap = parseAntennaPod(link)
        if (ap) {
          if (ap.episode) return descargar({ msg, sock, item: { title: ap.title || 'Episodio', url: ap.episode, type: '', length: 0, show: '' } })
          if (ap.feed) return listarEpisodios({ msg, sock, feedUrl: ap.feed })
          return msg.reply('《✧》 Ese enlace de AntennaPod no trae la dirección del feed.')
        }
        if (isMediaUrl(link)) return descargar({ msg, sock, item: { title: decodeURIComponent(link.split('/').pop().split('?')[0]).replace(/\.\w+$/, '') || 'Episodio', url: link, type: '', length: 0, show: '' } })
        return listarEpisodios({ msg, sock, feedUrl: link })
      }
      // "<podcast> | <episodio>": busca el programa y dentro de TODO su feed
      const [showQ, epQ] = q.includes('|') ? q.split('|').map((x) => x.trim()) : [q, '']
      let res = []
      try { res = await itunesSearch(showQ) } catch (e) { if (!epQ) console.error('[podcast] itunes', e?.message || e) }
      if (epQ) {
        if (res[0]) {
          const r = await listarEpisodios({ msg, sock, feedUrl: res[0].feedUrl, filtro: epQ })
          if (r !== false) return
        }
        if (await porEpisodio({ msg, sock, q: `${epQ} ${showQ}` })) return
        if (await porEpisodio({ msg, sock, q: epQ })) return
        return msg.reply(`《✧》 No encontré el episodio *${epQ}*${res[0] ? ` en *${res[0].collectionName}*` : ''}. Prueba con otras palabras del título.`)
      }
      const top = res[0]
      // Coincide fuerte con el nombre del programa → sus 10 más nuevos (como antes)
      if (top && showScore(`${top.collectionName} ${top.artistName}`, q) >= 0.75) {
        if (res.length > 1) await msg.reply(`🔎 Encontré *${top.collectionName}* (${top.artistName}).\nOtros: ${res.slice(1, 4).map((r) => r.collectionName).join(' · ')}\n✎ ¿Buscas un episodio? ${P}pod ${top.collectionName.slice(0, 30)} | <palabras del episodio>`).catch(() => {})
        return listarEpisodios({ msg, sock, feedUrl: top.feedUrl })
      }
      // Si no: episodios por nombre (feed del mejor programa + iTunes episodios)
      if (top) {
        try {
          const feed = await leerFeed(top.feedUrl)
          const hits = await buscarEpisodios({ feed, q, itunesQs: [q] })
          if (hits.length) return enviarLista({ msg, sock, titulo: `${hits.length} episodios para “${q}” (primero de *${feed.show}*)`, items: hits, art: feed.art })
        } catch (e) { console.error('[podcast] feed', e?.message || e) }
      }
      if (await porEpisodio({ msg, sock, q })) return
      if (top) return listarEpisodios({ msg, sock, feedUrl: top.feedUrl })
      return msg.reply(`《✧》 No encontré podcasts ni episodios para *${q}*. Prueba con otro nombre o manda el enlace RSS.`)
    } catch (e) {
      console.error('[podcast]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
