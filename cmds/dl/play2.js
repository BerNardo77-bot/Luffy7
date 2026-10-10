import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js';
import { miniaturaYouTube } from '../../lib/ytMiniatura.js';
import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from '../../lib/limits.js';
import {
  ytdlpToFile, urlToFile, sendVideoFile, friendlyError, ytdlpSearch,
  isNoCredit, NO_CREDIT_MSG, mb, MAX_FILE_BYTES
} from '../../lib/mediadl.js';

// Tope de duración compartido (MAX_VIDEO_MIN, 60 min por defecto). Lo usan #ytvideo y #ytsearch.
export const MAX_DURATION_SEC = MAX_VIDEO_SEC
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOWNLOAD_BYTES = MAX_FILE_BYTES

export function parseDurationToSeconds(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  if (!ts || typeof ts !== 'string') return 0
  const parts = ts.split(':').map(n => Number(n))
  if (parts.some(n => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json'
    },
    timeout: 60000
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function searchYoutube(query) {
  const base = (typeof api !== 'undefined' && api?.url) ? String(api.url).replace(/\/$/, '') : 'https://api.alyacore.xyz'
  const keys = [getApiKey()]
  if (keys[0] !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  for (const key of keys) {
    try {
      const url = `${base}/search/yt?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
      const json = await fetchJson(url)
      const list = json?.result || json?.data || []
      if (json?.status && Array.isArray(list) && list.length) {
        return list.map((v) => {
          const u = v.url || ''
          const id = (u.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || u.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/) || [])[1]
          return {
            title: v.title || 'Sin título',
            author: { name: v.autor || v.author || 'Desconocido' },
            timestamp: v.duration || '',
            views: Number(String(v.views || '0').replace(/[^0-9]/g, '')) || 0,
            url: u,
            image: v.banner || v.thumbnail || '',
            videoId: id
          }
        })
      }
    } catch {}
  }
  return []
}


async function descargarMp4(videoUrl, titleQuery, key) {
  const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
  const queries = []
  const add = (q) => { if (q && !queries.includes(q)) queries.push(q) }
  add(videoUrl)
  const idMatch = String(videoUrl).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)
  if (idMatch) {
    add(`https://youtu.be/${idMatch[1]}`)
    add(`https://www.youtube.com/watch?v=${idMatch[1]}`)
  }
  if (titleQuery) add(titleQuery)

  const keys = [key]
  if (key !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  let lastMsg = 'No se encontraron resultados para la búsqueda.'
  // Preferir calidades con audio completo; 360 a veces viene mudo/corto
  const qualities = ['1080', '720', 'auto', '480', '360']

  for (const useKey of keys) {
    for (const q of queries) {
      for (const quality of qualities) {
        try {
          const apiUrl = `${base}/dl/youtubeplayv2?query=${encodeURIComponent(q)}&type=mp4&quality=${quality}&key=${useKey}`
          const res = await fetchJson(apiUrl)
          if (res?.status && res?.data?.dl) {
            const size = Number(res.data.size || 0)
            if (size && size > MAX_DOWNLOAD_BYTES) {
              lastMsg = `El video pesa ~${mb(size)} MB (limite 500 MB)`
              continue
            }
            return res
          }
          lastMsg = isNoCredit(res) ? NO_CREDIT_MSG : (res?.message || res?.error || lastMsg)
          if (lastMsg === NO_CREDIT_MSG) break
        } catch (e) {
          lastMsg = /HTTP 429/.test(e.message) ? NO_CREDIT_MSG : (e.message || lastMsg)
          if (lastMsg === NO_CREDIT_MSG) break
        }
      }
      if (lastMsg === NO_CREDIT_MSG) continue
      try {
        const altUrl = idMatch ? `https://youtu.be/${idMatch[1]}` : (q.startsWith('http') ? q : videoUrl)
        const alt = `${base}/dl/ytmp4?url=${encodeURIComponent(altUrl)}&key=${useKey}`
        const res2 = await fetchJson(alt)
        const dl = res2?.data?.dl || res2?.result?.dl || res2?.dl
        if (res2?.status && dl) {
          return { status: true, data: { ...(res2.data || {}), dl, title: res2.data?.title || titleQuery } }
        }
        lastMsg = isNoCredit(res2) ? NO_CREDIT_MSG : (res2?.message || res2?.error || lastMsg)
      } catch (e) {
        lastMsg = /HTTP 429/.test(e.message) ? NO_CREDIT_MSG : (e.message || lastMsg)
      }
    }
  }
  return { status: false, message: lastMsg }
}

export default {
  command: ['play2', 'mp4', 'ytmp4', 'ytvideo', 'playvideo'],
  category: 'downloader',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[ytvideo] build 1.1.46 HQ ≤1080p H.264, ≤500 MB, doc >64 MB')
    try {
      if (!args[0]) {
        return msg.reply('《✧》 Por favor, menciona el nombre o URL del video que deseas descargar.')
      }
      const text = args.join(' ')
      const videoMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)

      let videoInfo = null
      if (!videoMatch) {
        let list = await searchYoutube(text)
        if (!list.length) {
          try {
            list = (await ytdlpSearch(text, 1)).map((v) => ({ ...v, author: { name: v.autor }, timestamp: v.duration, views: 0 }))
          } catch (e) { console.error('[ytvideo] ytsearch', e?.message || e) }
        }
        videoInfo = list[0]
        if (!videoInfo) return msg.reply('《✧》 No se encontró información del video.')
      }
      const url = videoMatch ? `https://youtu.be/${videoMatch[1]}` : videoInfo.url
      const title = videoInfo?.title || ''

      if (videoInfo) {
        const caption = `【　✿　】 _\`୨୧  Download\` ───── *${title}*_

> _✐ \`Canal\` ── ${videoInfo.author?.name || 'Desconocido'}_
> _ⴵ \`Duración\` ── ${videoInfo.timestamp || ''}_
> _🜸 \`Enlace\` ── ${url}_

> _──  ִ    ۟  *Descargando video (hasta 1080p)…*_`
        try {
          const thumb = await miniaturaYouTube(videoInfo.videoId, url, videoInfo.image)
          if (thumb) await sock.sendMessage(msg.chat, { image: thumb.buffer, ...(thumb.mimetype ? { mimetype: thumb.mimetype } : {}), caption }, { quoted: msg })
          else await msg.reply(caption)
        } catch { await msg.reply(caption).catch(() => {}) }
        const sec = Number(videoInfo.seconds) || parseDurationToSeconds(videoInfo.timestamp)
        if (sec > MAX_DURATION_SEC) {
          return msg.reply(`《✧》 *${title}* dura ~${Math.round(sec / 60)} min. El límite es ${MAX_VIDEO_MIN} min.\n🔗 ${url}`)
        }
      } else {
        await msg.reply('《✧》 Bajando el video con yt-dlp (hasta 1080p)…')
      }

      // 1) yt-dlp: mejor H.264 ≤1080p, sin reencodear; baja a 720/480 solo si pasa de 500 MB
      let ytErr = null
      try {
        const got = await ytdlpToFile(url, {
          maxSec: MAX_DURATION_SEC,
          tag: 'yt',
          onStatus: (t) => msg.reply(`《✧》 ${t}`).catch(() => {})
        })
        const name = (got.title || title || 'video').replace(/[^\w\s.-]/g, '').trim().slice(0, 60) || 'video'
        const cap = `🎬 *${got.title || title || 'YouTube'}*\n${got.height ? got.height + 'p · ' : ''}${mb(got.size)} MB`
        if (got.size > 64 * 1024 * 1024) await msg.reply(`《✧》 Pesa ${mb(got.size)} MB; lo mando como *documento* para no perder calidad…`).catch(() => {})
        await sendVideoFile(sock, msg, got.file, { caption: cap, fileName: `${name}.mp4` })
        return
      } catch (e) {
        ytErr = e
        console.error('[ytvideo] yt-dlp', e?.message || e)
        if (/^(TOO_LONG|TOO_BIG|NO_SPACE):/.test(String(e?.message))) {
          return msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
        }
      }

      // 2) Respaldo: alyacore
      const res = await descargarMp4(url, title, getApiKey())
      if (!res?.status || !res.data?.dl) {
        const motivo = res?.message || 'sin respuesta'
        return msg.reply(
          `《✧》 Falló la descarga.\n• yt-dlp: ${String(ytErr?.message || ytErr).slice(0, 200)}\n• Respaldo: ${motivo}` +
          (/no está instalado/.test(String(ytErr?.message)) ? '' : `\nSi sigue fallando: pkg upgrade yt-dlp`) +
          `\n🔗 ${url}`
        )
      }
      try {
        const got = await urlToFile(res.data.dl, { tag: 'yt-api' })
        const name = (res.data?.title || title || 'video').replace(/[^\w\s.-]/g, '').slice(0, 60) || 'video'
        await sendVideoFile(sock, msg, got.file, { caption: `🎬 *${res.data?.title || title}*\n${mb(got.size)} MB`, fileName: `${name}.mp4` })
      } catch (e) {
        return msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
      }
    } catch (e) {
      console.error('[ytvideo]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
