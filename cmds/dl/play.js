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

import fetch from 'node-fetch'
import { getBuffer } from '#serialize'
import { prefijoActual } from '../../lib/prefijo.js';
import { youtubeCover, prepareAudio, fetchCover, makeThumb, probeAudio, ytdlpAudio, haveFfmpeg } from '../../lib/audio-tags.js'
import { betterTitle } from '../../lib/music-page.js'
import { miniaturaYouTube } from '../../lib/ytMiniatura.js';

const FALLBACK_KEY = 'LUFFY-FIX67'


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
            author: { name: v.autor || v.author || v.channel || 'Desconocido' },
            timestamp: v.duration || '',
            views: Number(String(v.views || '0').replace(/[^0-9]/g, '')) || 0,
            url: u,
            image: v.banner || v.thumbnail || v.image || '',
            videoId: id
          }
        })
      }
    } catch {}
  }
  // Respaldo sin API: yt-search
  try {
    const { default: yts } = await import('yt-search')
    const id = (String(query).match(/youtu\.be\/([\w-]{11})|[?&]v=([\w-]{11})/) || []).slice(1).find(Boolean)
    const r = id ? await yts({ videoId: id }) : await yts(String(query))
    const vids = id ? (r ? [r] : []) : (r?.videos || [])
    return vids.slice(0, 10).map(v => ({ title: v.title, author: { name: v.author?.name || 'Desconocido' }, timestamp: v.timestamp || '', views: v.views || 0, url: v.url, image: v.thumbnail || v.image || '', videoId: v.videoId }))
  } catch {}
  return []
}

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
  run: async ({ msg, sock, args, meta = null, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    try {
      if (!args[0]) {
        return msg.reply('《✧》 Por favor, menciona el nombre o URL del video que deseas descargar')
      }

      const text = args.join(' ')
      const videoMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/)
      const query = videoMatch ? ('https://youtu.be/' + videoMatch[1]) : text

      const videos = await searchYoutube(query)
      if (!videos.length) {
        return msg.reply('《✧》 No se encontró información del video.')
      }

      const video = videoMatch
        ? (videos.find(v => v.videoId === videoMatch[1]) || videos[0])
        : videos[0]

      const { title, author, timestamp: duration, views, url, image, videoId } = video
      const vistas = (views || 0).toLocaleString()
      const canal = author?.name || author || 'Desconocido'

      const caption = `【　✿　】 _\`୨୧  Download\` ───── *${title}*_

> _✐ \`Canal\` ── ${canal}_
> _ⴵ \`Duración\` ── ${duration || ''}_
> _✰ \`Vistas\` ── ${vistas}_
> _🜸 \`Enlace\` ── ${url}_

> _──  ִ    ۟  *¡Enviando audio, por favor espera!*_
> 🎧 Audio calidad *320 kbps*`

      let ytThumb = null
      // Nunca tumbar #play por la miniatura
      try {
        // Miniatura descargada y validada (hq720 → … → default); si no hay, solo texto
        const thumb = await miniaturaYouTube(videoId, url, image)
        ytThumb = thumb
        if (meta?.quiet) {
          // álbum completo: sin tarjeta por canción
        } else if (thumb) {
          await sock.sendMessage(
            msg.chat,
            { image: thumb.buffer, mimetype: thumb.mimetype, caption },
            { quoted: msg }
          )
        } else {
          await msg.reply(caption)
        }
      } catch (thumbErr) {
        console.error('[play] thumb', thumbErr?.message || thumbErr)
        await msg.reply(caption).catch(() => {})
      }

      const key = getApiKey()
      const got = await obtenerAudio(url, title, key)
      await msg.reply('《✧》 Bajando el audio…')
      let audioBuffer = null
      let apiErr = String(got.error || (!got.dl ? 'Sin enlace' : '')).replace(/key=[^&\s]+/gi, 'key=***')
      if (got.dl) {
        try {
          audioBuffer = await downloadBuffer(got.dl)
        } catch (e) {
          try { audioBuffer = await getBuffer(got.dl) } catch { apiErr = `falló la descarga del archivo: ${String(e.message).replace(/key=[^&\s]+/gi, 'key=***')}` }
        }
      }
      // ¿Es audio de verdad? (la API a veces devuelve HTML, vacío o recortado)
      let src = audioBuffer?.length >= 50 * 1024 ? await probeAudio(audioBuffer) : null
      const ffprobeOk = await haveFfmpeg()
      if (!audioBuffer?.length || audioBuffer.length < 50 * 1024 || (src && !(src.duration > 5)) || (!src && ffprobeOk)) {
        console.error('[play] audio de la API inválido', apiErr || '', audioBuffer?.length || 0, JSON.stringify(src))
        const alt = await ytdlpAudio(url)
        const altProbe = alt ? await probeAudio(alt) : null
        if (alt && (altProbe ? altProbe.duration > 5 : !ffprobeOk)) { audioBuffer = alt; src = altProbe; console.log('[play] respaldo yt-dlp OK') }
        else {
          return msg.reply(`《✧》 No se pudo descargar el *audio*.\n📌 ${apiErr || 'el archivo vino vacío o incompleto'}\n\nPrueba: ${P}play https://youtu.be/ID`)
        }
      }
      if (src) console.log(`[play] fuente: ${src.codec} ${Math.round(src.duration)}s ${Math.round(src.bitrate / 1000)}kbps ${(audioBuffer.length / 1048576).toFixed(1)} MB`)

      if (meta?.title) { const nt = betterTitle(meta.title, title, meta.artist); if (nt !== meta.title) { console.log(`[titulo] "${meta.title}" → "${nt}"`); meta.title = nt } }
      // Portada + etiquetas (iTunes si viene de apple/google; si no, miniatura de YouTube)
      let cover = null
      let audioExt = 'mp3', audioMime = 'audio/mpeg'
      try {
        cover = (await youtubeCover(videoId)) || (meta?.cover && await fetchCover(meta.cover)) || ytThumb?.buffer || null
        const prep = await prepareAudio(audioBuffer, {
          title: meta?.title || title, artist: meta?.artist || canal, album: meta?.album || '', cover
        })
        audioBuffer = prep.buffer
        audioExt = prep.ext
        audioMime = prep.mime
        const fin = await probeAudio(audioBuffer)
        console.log(`[play] enviando: ${audioExt} codec=${fin?.codec || '?'} ${fin ? Math.round(fin.duration) + 's' : ''} ${fin ? Math.round(fin.bitrate / 1000) + 'kbps' : ''} ${(audioBuffer.length / 1048576).toFixed(1)} MB ${prep.tagged ? 'con portada' : 'sin portada'}`)
      } catch (e) { console.error('[play] tags', e?.message || e) }
      // Miniatura chica (WhatsApp ignora miniaturas grandes y usa la vista previa del link de YouTube)
      const thumbSmall = cover ? await makeThumb(cover).catch(() => null) : null
      const songTitle = String(meta?.title || title)
      const songArtist = String(meta?.artist || canal)
      const adReply = thumbSmall ? { contextInfo: { externalAdReply: { title: songTitle.slice(0, 80), body: songArtist.slice(0, 80), thumbnail: thumbSmall, mediaType: 1, renderLargerThumbnail: false } } } : {}
      const clean = (x) => String(x).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
      const docName = (clean(songArtist && songArtist !== 'Desconocido' ? `${songArtist} - ${songTitle}` : songTitle).slice(0, 100) || 'audio') + '.' + audioExt
      const fileName = docName

      const sendAudio = () => sock.sendMessage(msg.chat, {
        audio: audioBuffer,
        mimetype: audioMime,
        fileName,
        ptt: false,
        ...adReply
      }, { quoted: msg })
      const sendDoc = () => sock.sendMessage(msg.chat, {
        document: audioBuffer,
        mimetype: audioMime,
        fileName: docName,
        caption: `🎵 ${songTitle}${songArtist ? ` — ${songArtist}` : ''}${meta?.album ? `\n💿 ${meta.album}` : ''}`,
        ...(thumbSmall ? { jpegThumbnail: thumbSmall } : {})
      }, { quoted: msg })
      // Por defecto: solo el documento MP3 con nombre y portada. PLAY_SEND_AUDIO=1 manda también el audio en el chat.
      let sentDoc = false
      try {
        await sendDoc()
        sentDoc = true
        if (meta?.result) meta.result.ok = true
      } catch (e) {
        console.error('[play] doc send', e?.message || e)
      }
      if (!sentDoc || process.env.PLAY_SEND_AUDIO === '1') {
        await sendAudio()
        if (meta?.result) meta.result.ok = true
      }
    } catch (e) {
      console.error('[play]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
