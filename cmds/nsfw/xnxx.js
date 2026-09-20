import db from "#db"
import fetch from "node-fetch"

const MAX_DURATION_SEC = 20 * 60 // mismo tope seguro que #ytvideo / #xvideos

function parseDurationToSeconds(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  if (!ts || typeof ts !== 'string') return 0
  const s = ts.trim().toLowerCase()
  const mMin = s.match(/(\d+)\s*min/)
  const mSec = s.match(/(\d+)\s*sec/)
  if (mMin || mSec) return (Number(mMin?.[1] || 0) * 60) + Number(mSec?.[1] || 0)
  const parts = s.split(':').map(n => Number(n))
  if (parts.some(n => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}

function apiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = 'LUFFY-FIX67'
  return key
}

export default {
  command: ["xnxx"],
  category: "nsfw",
  run: async ({ msg, sock, args }) => {
    console.error('[xnxx] build 120-safe 20min')
    const chat = await db.getChat(msg.chat)

    if (!chat.nsfw)
      return msg.reply(mess.nsfw)

    try {
      const query = args.join(" ").trim()
      if (!query) return msg.reply("✿ Ingresa el nombre de un video o una URL de XNXX.")

      const base = apiBase()
      const key = apiKey()
      let videoUrl
      let videoInfo
      let durationSec = 0

      if (query.startsWith("http") && query.includes("xnxx.com")) {
        videoUrl = query
      } else {
        const apiUrl = `${base}/nsfw/search/xnxx?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
        const res = await fetch(apiUrl)
        if (!res.ok) return msg.reply("Error al conectar con XNXX API")

        const json = await res.json()
        if (!json.status || !json.resultados || json.resultados.length === 0) {
          return msg.reply("No se encontró el video.")
        }

        const randomIndex = Math.floor(Math.random() * json.resultados.length)
        videoInfo = json.resultados[randomIndex]
        videoUrl = videoInfo.url
        durationSec = parseDurationToSeconds(videoInfo.duration || videoInfo.resolution || '')

        const caption = `- ׄ　ꕤ　ׅ　✤ ໌　۟　🅧nxx　ׅ　팅화　ׄ

𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Titulo :: ${videoInfo.title}*
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Vistas ::* ${videoInfo.views}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Resolución ::* ${videoInfo.resolution}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Duración ::* ${videoInfo.duration}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Ver en ::* ${videoInfo.url}`

        await msg.reply(caption)
      }

      if (durationSec > MAX_DURATION_SEC) {
        return msg.reply(
          `《✧》 Ese video dura ~${Math.round(durationSec / 60)} min.\n` +
          `Límite seguro: ~${Math.round(MAX_DURATION_SEC / 60)} min (como #ytvideo).\n` +
          `Abre el link:\n${videoUrl}`
        )
      }

      const downloadUrl = `${base}/nsfw/dl/xnxx?url=${encodeURIComponent(videoUrl)}&key=${encodeURIComponent(key)}`
      const downloadRes = await fetch(downloadUrl)
      if (!downloadRes.ok) return msg.reply("Error al descargar el video")

      const downloadJson = await downloadRes.json()
      if (!downloadJson.status || !downloadJson.resultado || !downloadJson.resultado.result) {
        return msg.reply("No se pudo obtener el video para descargar.")
      }

      const result = downloadJson.resultado.result
      if (!durationSec) {
        durationSec = parseDurationToSeconds(result.duration || result.length || '')
      }
      if (durationSec > MAX_DURATION_SEC) {
        return msg.reply(
          `《✧》 Ese video dura ~${Math.round(durationSec / 60)} min.\n` +
          `Límite seguro: ~${Math.round(MAX_DURATION_SEC / 60)} min.\n${videoUrl}`
        )
      }

      const dl = result.download || {}
      // Videos largos: preferir high pero con fallback low si high falla al enviar
      const links = []
      if (dl.high) links.push({ q: 'high', url: dl.high })
      if (dl.low) links.push({ q: 'low', url: dl.low })
      if (dl.url) links.push({ q: 'url', url: dl.url })
      if (!links.length) return msg.reply("No se pudo obtener el video para descargar.")

      let lastErr = null
      for (const item of links) {
        try {
          await msg.reply(`《✧》 Enviando XNXX (*${item.q}*)…`)
          await sock.sendMessage(msg.chat, {
            video: { url: item.url },
            mimetype: "video/mp4",
            caption: item.q === 'high' ? 'XNXX (HD)' : 'XNXX'
          }, { quoted: msg })
          return
        } catch (e) {
          lastErr = e
          console.error('[xnxx] send', item.q, e?.message || e)
        }
      }

      return msg.reply(
        `《✧》 No pude enviar el archivo por WhatsApp.\nAbre el link:\n${links[0].url}\n` +
        (lastErr?.message ? `(${lastErr.message})` : '')
      )
    } catch (err) {
      console.error('[xnxx]', err)
      return msg.reply(`《✧》 Error: ${err?.message || err}`)
    }
  },
}
