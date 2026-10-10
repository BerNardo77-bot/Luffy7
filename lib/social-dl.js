// Instagram / Facebook: alyacore primero; si falla (p. ej. sin saldo 429) usa yt-dlp en el teléfono.
import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from './limits.js'
import { ytdlpToFile, urlToFile, responseToFile, sendVideoFile, friendlyError, isNoCredit, NO_CREDIT_MSG } from './mediadl.js'

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}
function apiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = 'LUFFY-FIX67'
  return key
}

// Devuelve { medias: [{type, url}] } o { error }
export async function alyacoreMedia(endpoint, url) {
  try {
    const res = await fetch(`${apiBase()}/dl/${endpoint}?url=${encodeURIComponent(url)}&key=${encodeURIComponent(apiKey())}`, { signal: AbortSignal.timeout(60000) })
    const ct = String(res.headers.get('content-type') || '')
    if (res.ok && /video|octet-stream/.test(ct)) {
      return { response: res }
    }
    const json = await res.json().catch(() => ({}))
    if (isNoCredit(json, res.status)) return { error: NO_CREDIT_MSG }
    const d = json?.data || json?.result || {}
    const list = d.download || d.media || d.medias || (d.dl || d.url ? [{ type: 'video', url: d.dl || d.url }] : [])
    const medias = (Array.isArray(list) ? list : [list]).map((m) => ({ type: m?.type === 'image' ? 'image' : 'video', url: m?.url || m?.dl || m?.hd || m?.sd })).filter((m) => m.url)
    if (!json?.status || !medias.length) return { error: json?.message || `la API no devolvió contenido (HTTP ${res.status})` }
    return { medias }
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

export async function downloadSocial({ msg, sock, url, endpoint, label }) {
  const r = await alyacoreMedia(endpoint, url)
  if (r.response) {
    try {
      const got = await responseToFile(r.response, { tag: endpoint })
      await sendVideoFile(sock, msg, got.file, { caption: `🎬 ${label}`, fileName: `${endpoint}.mp4` })
    } catch (e) {
      await msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
    }
    return
  }
  if (r.medias) {
    const videos = r.medias.filter((m) => m.type === 'video')
    const images = r.medias.filter((m) => m.type === 'image')
    for (const img of images.slice(0, 10)) {
      await sock.sendMessage(msg.chat, { image: { url: img.url }, caption: `📸 ${label}` }, { quoted: msg }).catch((e) => console.error(`[${label}] img`, e?.message || e))
    }
    for (const v of videos.slice(0, 10)) {
      try {
        const got = await urlToFile(v.url, { tag: endpoint })
        await sendVideoFile(sock, msg, got.file, { caption: `🎬 ${label}`, fileName: `${endpoint}.mp4` })
      } catch (e) {
        await msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
      }
    }
    return
  }
  console.error(`[${label}] alyacore`, r.error)
  try {
    await msg.reply(`《✧》 ${r.error === NO_CREDIT_MSG ? 'alyacore se quedó sin saldo (429)' : 'La API falló'}; bajando con yt-dlp…`)
    const got = await ytdlpToFile(url, { maxSec: MAX_VIDEO_SEC, tag: endpoint })
    await sendVideoFile(sock, msg, got.file, { caption: `🎬 ${label}${got.height ? ' ' + got.height + 'p' : ''}`, fileName: `${endpoint}.mp4` })
  } catch (e) {
    console.error(`[${label}] yt-dlp`, e?.message || e)
    const m = String(e?.message || '')
    if (/^(TOO_LONG|TOO_BIG|NO_SPACE):/.test(m)) return msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
    await msg.reply(
      `《✧》 No pude bajar ese ${label}.\n• API: ${r.error}\n• yt-dlp: ${m.slice(0, 200)}` +
      (/login|cookies|private|privad/i.test(m) ? '\n(Puede ser privado o pedir iniciar sesión.)' : '\nSi sigue fallando: pkg upgrade yt-dlp') +
      `\n${url}`
    )
  }
}
