import db from "#db"
import fetch from "node-fetch"

const FALLBACK_KEY = 'LUFFY-FIX67'

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function pickVideoUrl(resultado) {
  const videos = resultado?.videos || resultado?.result?.videos || {}
  return (
    videos.high ||
    videos.low ||
    resultado?.result?.url ||
    resultado?.url ||
    resultado?.dl ||
    null
  )
}

async function fetchDl(base, videoUrl, key) {
  const downloadUrl = `${base}/nsfw/dl/xvideos?url=${encodeURIComponent(videoUrl)}&key=${key}`
  const downloadRes = await fetch(downloadUrl)
  const downloadJson = await downloadRes.json().catch(() => ({}))
  return { ok: downloadRes.ok, json: downloadJson, link: pickVideoUrl(downloadJson?.resultado) }
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.xvideos.com/'
    },
    timeout: 300000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export default {
  command: ["xvideos"],
  category: "nsfw",
  run: async ({ msg, sock, args }) => {
    const chat = await db.getChat(msg.chat)
    if (!chat.nsfw) return msg.reply(mess.nsfw)

    try {
      const query = args.join(" ").trim()
      if (!query) return msg.reply("✿ Ingresa el nombre de un video o una URL de XVideos.")

      const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
      const key = getKey()
      let videoUrl = query

      if (!(query.startsWith("http") && query.includes("xvideos.com"))) {
        const apiUrl = `${base}/nsfw/search/xvideos?query=${encodeURIComponent(query)}&key=${key}`
        const res = await fetch(apiUrl)
        if (!res.ok) return msg.reply(`Error al conectar con XVideos API (${res.status})`)
        const json = await res.json()
        if (!json.status || !json.resultados?.length) return msg.reply("No se encontró el video.")
        const videoInfo = json.resultados[Math.floor(Math.random() * json.resultados.length)]
        videoUrl = videoInfo.url
        await msg.reply(`*${videoInfo.title}*\n${videoInfo.duration || ''}\n${videoInfo.url}`)
      }

      let got = await fetchDl(base, videoUrl, key)
      if ((!got.json?.status || !got.link) && key !== FALLBACK_KEY) {
        got = await fetchDl(base, videoUrl, FALLBACK_KEY)
      }
      if (!got.json?.status || !got.link) {
        return msg.reply(`No se pudo obtener el video para descargar.\n📌 ${got.json?.message || 'sin enlace en la API'}`)
      }

      await msg.reply("《✧》 Bajando el video…")
      const buf = await downloadBuffer(got.link)
      if (!buf?.length) return msg.reply("El archivo vino vacío.")
      if (buf.length > 64 * 1024 * 1024) {
        return msg.reply(`Pesa ${(buf.length / 1024 / 1024).toFixed(1)} MB; demasiado para WhatsApp.\n${got.link}`)
      }

      try {
        await sock.sendMessage(msg.chat, { video: buf, mimetype: "video/mp4" }, { quoted: msg })
      } catch (e) {
        console.error('[xvideos] send', e)
        await sock.sendMessage(msg.chat, { document: buf, mimetype: "video/mp4", fileName: "xvideos.mp4" }, { quoted: msg })
      }
    } catch (err) {
      console.error('[xvideos]', err)
      return msg.reply(`《✧》 Error: ${err?.message || err}`)
    }
  },
}
