// $podcast / $pod / $antennapod: búsqueda (iTunes MX), feed RSS, enlace de AntennaPod o enlace directo.
// Lista los 10 episodios más nuevos; el número 1-10 descarga el archivo original (sin recomprimir).
import fs from 'fs'
import { prefijoActual } from '../../lib/prefijo.js'
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js'
import { bajarImagen } from '../../lib/ytMiniatura.js'
import { urlToFile, rmQuiet, mb, MAX_FILE_BYTES, MAX_VIDEO_SEND } from '../../lib/mediadl.js'

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
      show
    })
  }
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
  return { show, art, items }
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`el servidor respondió ${res.status}`)
  return { text: await res.text(), type: String(res.headers.get('content-type') || '') }
}

async function itunesSearch(q) {
  const res = await fetch(`https://itunes.apple.com/search?media=podcast&country=MX&limit=5&term=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`iTunes respondió ${res.status}`)
  const j = await res.json()
  return (j.results || []).filter((r) => r.feedUrl)
}

const isMediaUrl = (u) => /\.(mp3|m4a|aac|ogg|opus|wav|mp4|m4v|mov|webm)(\?|$)/i.test(u)

async function listarEpisodios({ msg, sock, feedUrl, P }) {
  let feed
  try {
    const { text } = await getText(feedUrl)
    if (!/<rss|<feed|<channel/i.test(text)) throw new Error('el enlace no es un feed RSS de podcast')
    feed = parseFeed(text)
  } catch (e) {
    return msg.reply(`《✧》 No pude leer el feed del podcast: ${e?.message || e}.\n${feedUrl}`)
  }
  const items = feed.items.slice(0, MAX_EP)
  if (!items.length) return msg.reply(`《✧》 *${feed.show}* no tiene episodios para descargar en su feed.`)
  savePick(msg.chat, { sender: msg.sender, site: SITE, items, msg, fromMe: msg.fromMe })
  const art = feed.art ? await bajarImagen(feed.art).catch(() => null) : null
  const lista = items.map((it, i) => `*${i + 1}.* ${it.title.slice(0, 120)}\n> ${[fecha(it.date), it.duration, it.length ? mb(it.length) + ' MB' : ''].filter(Boolean).join(' · ')}`).join('\n\n')
  const texto = `🎙️ *${feed.show}* — ${items.length} episodios más nuevos\n\n${lista}\n\nResponde con el número (1-${items.length}) para descargar · vale 5 min`
  try {
    if (art) return await sock.sendMessage(msg.chat, { image: art.buffer, mimetype: art.mimetype, caption: texto.slice(0, 3800) }, { quoted: msg })
  } catch (e) { console.error('[podcast] portada', e?.message || e) }
  return msg.reply(texto)
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
          `• ${P}podcast <nombre> — busca el podcast y muestra sus 10 episodios más nuevos\n` +
          `• ${P}podcast <enlace RSS o de AntennaPod> — lista los episodios\n` +
          `• ${P}podcast <enlace .mp3/.mp4> — lo descarga directo\n` +
          `Luego responde con el número (1-10).`
        )
      }
      const link = (q.match(/https?:\/\/\S+/) || [])[0]
      if (link) {
        const ap = parseAntennaPod(link)
        if (ap) {
          if (ap.episode) return descargar({ msg, sock, item: { title: ap.title || 'Episodio', url: ap.episode, type: '', length: 0, show: '' } })
          if (ap.feed) return listarEpisodios({ msg, sock, feedUrl: ap.feed, P })
          return msg.reply('《✧》 Ese enlace de AntennaPod no trae la dirección del feed.')
        }
        if (isMediaUrl(link)) return descargar({ msg, sock, item: { title: decodeURIComponent(link.split('/').pop().split('?')[0]).replace(/\.\w+$/, '') || 'Episodio', url: link, type: '', length: 0, show: '' } })
        return listarEpisodios({ msg, sock, feedUrl: link, P })
      }
      let res
      try { res = await itunesSearch(q) } catch (e) { return msg.reply(`《✧》 No pude buscar el podcast: ${e?.message || e}`) }
      if (!res.length) return msg.reply(`《✧》 No encontré podcasts para *${q}*. Prueba con otro nombre o manda el enlace RSS.`)
      const top = res[0]
      if (res.length > 1) await msg.reply(`🔎 Encontré *${top.collectionName}* (${top.artistName}).${res.length > 1 ? `\nOtros: ${res.slice(1, 4).map((r) => r.collectionName).join(' · ')}` : ''}`).catch(() => {})
      return listarEpisodios({ msg, sock, feedUrl: top.feedUrl, P })
    } catch (e) {
      console.error('[podcast]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
