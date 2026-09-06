import yts from 'yt-search'
import fetch from 'node-fetch'
import { getBuffer } from '#serialize'

const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_BYTES = 50 * 1024 * 1024 // ~50MB seguro para WhatsApp/Termux

function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json'
    }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
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

  for (const useKey of keys) {
    for (const q of queries) {
      for (const quality of ['360', '480', 'auto', '720']) {
        try {
          const apiUrl = `${base}/dl/youtubeplayv2?query=${encodeURIComponent(q)}&type=mp4&quality=${quality}&key=${useKey}`
          const res = await fetchJson(apiUrl)
          if (res?.status && res?.data?.dl) return res
          lastMsg = res?.message || res?.error || lastMsg
        } catch (e) {
          lastMsg = e.message || lastMsg
        }
      }
      try {
        const altUrl = idMatch ? `https://youtu.be/${idMatch[1]}` : (q.startsWith('http') ? q : videoUrl)
        const alt = `${base}/dl/ytmp4?url=${encodeURIComponent(altUrl)}&key=${useKey}`
        const res2 = await fetchJson(alt)
        const dl = res2?.data?.dl || res2?.result?.dl || res2?.dl
        if (res2?.status && dl) {
          return { status: true, data: { ...(res2.data || {}), dl, title: res2.data?.title || titleQuery } }
        }
        lastMsg = res2?.message || res2?.error || lastMsg
      } catch (e) {
        lastMsg = e.message || lastMsg
      }
    }
  }

  return { status: false, message: lastMsg }
}

export default {
  command: ['play2', 'mp4', 'ytmp4', 'ytvideo', 'playvideo'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    try {
      if (!args[0]) {
        return msg.reply('《✧》 Por favor, menciona el nombre o URL del video que deseas descargar.')
      }

      const text = args.join(' ')
      const videoMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)
      const query = videoMatch ? 'https://youtu.be/' + videoMatch[1] : text

      const search = await yts(query)
      const videoInfo = videoMatch
        ? search.videos.find(v => v.videoId === videoMatch[1]) || search.all[0]
        : search.all[0]

      if (!videoInfo) {
        return msg.reply('《✧》 No se encontró información del video.')
      }

      const { timestamp: duration } = videoInfo
      const url = videoInfo.url
      const title = videoInfo.title
      const vistas = (videoInfo.views || 0).toLocaleString()
      const canal = videoInfo.author?.name || 'Desconocido'
      const thumbBuffer = await getBuffer(videoInfo.image)

      const caption = `【　✿　】 _\`୨୧  Download\` ───── *${title}*_

> _✐ \`Canal\` ── ${canal}_
> _ⴵ \`Duración\` ── ${duration || ''}_
> _✰ \`Vistas\` ── ${vistas}_
> _🜸 \`Enlace\` ── ${url}_

> _──  ִ    ۟  *¡Enviando video, por favor espera!*_`

      await sock.sendMessage(msg.chat, { image: thumbBuffer, caption }, { quoted: msg })

      const key = getApiKey()
      const res = await descargarMp4(url, title, key)

      if (!res?.status || !res.data?.dl) {
        const motivo = res?.message || res?.error || 'Motivo no especificado'
        return msg.reply(`《✧》 Falló la descarga.\n📌 Razón de la API: ${motivo}\n\nPrueba con un enlace directo:\n/ytvideo https://youtu.be/ID`)
      }

      const dlUrl = res.data.dl
      const fileName = `${(res.data?.title || title || 'video').replace(/[^\w\s.-]/g, '').slice(0, 60) || 'video'}.mp4`

      // Bajar el archivo y mandarlo como buffer (WhatsApp a menudo no abre las URLs de la API)
      let videoBuffer
      try {
        videoBuffer = await getBuffer(dlUrl)
      } catch (e) {
        console.error('[ytvideo] getBuffer', e)
        return msg.reply('《✧》 Se obtuvo el enlace, pero no se pudo descargar el archivo de video. Intenta otro video más corto.')
      }

      if (!videoBuffer || !videoBuffer.length) {
        return msg.reply('《✧》 El archivo de video vino vacío. Prueba otro enlace.')
      }

      if (videoBuffer.length > MAX_BYTES) {
        return msg.reply(`《✧》 El video pesa ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB y es demasiado grande para enviarlo por WhatsApp. Prueba uno más corto o usa /play (audio).`)
      }

      try {
        await sock.sendMessage(msg.chat, {
          video: videoBuffer,
          fileName,
          mimetype: 'video/mp4',
          caption: title
        }, { quoted: msg })
      } catch (e) {
        console.error('[ytvideo] send video', e)
        // Fallback: documento
        await sock.sendMessage(msg.chat, {
          document: videoBuffer,
          fileName,
          mimetype: 'video/mp4',
          caption: title
        }, { quoted: msg })
      }

    } catch (e) {
      console.error('[ytvideo]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
