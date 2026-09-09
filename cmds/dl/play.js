async function fetchFollow(url, opts = {}, maxRedirects = 8) {
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, { ...opts, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`HTTP ${res.status} sin Location`)
      try { if (res.body?.cancel) res.body.cancel() } catch {}
      current = new URL(loc, current).href
      continue
    }
    return res
  }
  throw new Error('Demasiados redirects (302)')
}

import ytsearch from 'yt-search'
import fetch from 'node-fetch'
import { getBuffer } from '#serialize'

const FALLBACK_KEY = 'LUFFY-FIX67'

function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json'
    },
    timeout: 60000
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function downloadBuffer(url) {
  const res = await fetchFollow(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: '*/*'
    },
    timeout: 180000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function obtenerAudio(videoUrl, title, key) {
  const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
  const urls = []
  const add = (u) => { if (u && !urls.includes(u)) urls.push(u) }
  add(videoUrl)
  const idMatch = String(videoUrl).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)
  if (idMatch) {
    add(`https://youtu.be/${idMatch[1]}`)
    add(`https://www.youtube.com/watch?v=${idMatch[1]}`)
  }

  const keys = [key]
  if (key !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  let lastMsg = 'No se pudo descargar el audio'

  for (const useKey of keys) {
    for (const u of urls) {
      for (const ep of ['ytmp3v2', 'ytmp3']) {
        try {
          const apiUrl = `${base}/dl/${ep}?url=${encodeURIComponent(u)}&key=${useKey}`
          const res = await fetchJson(apiUrl)
          const dl = res?.data?.dl || res?.result?.dl || res?.dl
          if (res?.status && dl) {
            return {
              dl,
              title: res.data?.title || res.result?.title || title,
              fileName: res.data?.fileName || `${title}.mp3`
            }
          }
          lastMsg = res?.message || res?.error || lastMsg
        } catch (e) {
          lastMsg = e.message || lastMsg
        }
      }
      // tambien por query/title en youtubeplay si aplica audio
      try {
        const apiUrl = `${base}/dl/youtubeplayv2?query=${encodeURIComponent(u)}&type=mp3&quality=320&key=${useKey}`
        const res = await fetchJson(apiUrl)
        const dl = res?.data?.dl
        if (res?.status && dl) {
          return { dl, title: res.data?.title || title, fileName: `${title}.mp3` }
        }
        lastMsg = res?.message || res?.error || lastMsg
      } catch (e) {
        lastMsg = e.message || lastMsg
      }
    }
  }
  return { error: lastMsg }
}

export default {
  command: ['play', 'mp3', 'ytmp3', 'ytaudio', 'playaudio'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    try {
      if (!args[0]) {
        return msg.reply('《✧》 Por favor, menciona el nombre o URL del video que deseas descargar')
      }

      const text = args.join(' ')
      const videoMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)
      const query = videoMatch ? ('https://youtu.be/' + videoMatch[1]) : text

      const searchResult = await ytsearch(query)
      if (!searchResult.videos || !searchResult.videos.length) {
        return msg.reply('《✧》 No se encontró información del video.')
      }

      const video = videoMatch
        ? (searchResult.videos.find(v => v.videoId === videoMatch[1]) || searchResult.videos[0])
        : searchResult.videos[0]

      const { title, author, timestamp: duration, views, url, image } = video
      const vistas = (views || 0).toLocaleString()
      const canal = author?.name || author || 'Desconocido'
      let thumbBuffer
      try { thumbBuffer = await getBuffer(image) } catch { thumbBuffer = null }

      const caption = `【　✿　】 _\`୨୧  Download\` ───── *${title}*_

> _✐ \`Canal\` ── ${canal}_
> _ⴵ \`Duración\` ── ${duration || ''}_
> _✰ \`Vistas\` ── ${vistas}_
> _🜸 \`Enlace\` ── ${url}_

> _──  ִ    ۟  *¡Enviando audio, por favor espera!*_`

      if (thumbBuffer) {
        await sock.sendMessage(msg.chat, { image: thumbBuffer, caption }, { quoted: msg })
      } else {
        await msg.reply(caption)
      }

      const key = getApiKey()
      const got = await obtenerAudio(url, title, key)
      if (got.error || !got.dl) {
        return msg.reply(`《✧》 No se pudo descargar el *audio*.\n📌 ${got.error || 'Sin enlace'}\n\nPrueba: /play https://youtu.be/ID`)
      }

      await msg.reply('《✧》 Bajando el audio…')
      let audioBuffer
      try {
        audioBuffer = await downloadBuffer(got.dl)
      } catch (e) {
        // fallback corto
        try { audioBuffer = await getBuffer(got.dl) } catch {
          return msg.reply(`《✧》 Había enlace, pero falló la descarga del archivo: ${e.message}`)
        }
      }

      if (!audioBuffer?.length) {
        return msg.reply('《✧》 El audio vino vacío.')
      }
      // MP3 muy pequenos suelen ser basura/error de la API
      if (audioBuffer.length < 50 * 1024) {
        return msg.reply(`《✧》 No envié el audio: el archivo es demasiado pequeno (${(audioBuffer.length/1024).toFixed(1)} KB), parece incompleto. Prueba otro enlace.`)
      }

      const fileName = (got.fileName || `${title}.mp3`).replace(/[^\w\s.-]/g, '').slice(0, 80) || 'audio.mp3'

      try {
        await sock.sendMessage(msg.chat, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName,
          ptt: false
        }, { quoted: msg })
      } catch (e) {
        console.error('[play] audio send', e)
        await sock.sendMessage(msg.chat, {
          document: audioBuffer,
          mimetype: 'audio/mpeg',
          fileName,
          caption: title
        }, { quoted: msg })
      }
    } catch (e) {
      console.error('[play]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
