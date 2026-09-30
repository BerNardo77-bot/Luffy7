import db from "#db"
import fetch from "node-fetch"
import { prefijoActual } from '../../lib/prefijo.js'
import {
  bestMatch,
  isFullMatch,
  normalizeResults,
  savePick,
  readPick,
  clearPick,
  choiceNumber
} from "../../lib/nsfw-pick.js"
import { enviarOpciones } from "../../lib/nsfw-choice.js"

const MAX_DURATION_SEC = 20 * 60 // mismo tope seguro que #ytvideo; no se sube

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

async function deliverXnxx({ msg, sock, videoUrl, durationSec = 0, prefix = '' }) {
  const P = prefix
  if (durationSec > MAX_DURATION_SEC) {
    return msg.reply(
      `《✧》 Ese video dura ~${Math.round(durationSec / 60)} min.\n` +
      `Límite seguro: ~${Math.round(MAX_DURATION_SEC / 60)} min (como ${P}ytvideo).\n` +
      `Abre el link:\n${videoUrl}`
    )
  }

  const base = apiBase()
  const key = apiKey()
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
  // Misma calidad de siempre: high y luego low. XNXX no comparte el descargador de xvideos.
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
}

async function takeNumber({ msg, sock }, forced = 0) {
  const n = Number(forced) || choiceNumber(msg)
  if (!n || n < 1 || n > 5) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== 'xnxx') return false
  if (n > hit.items.length) {
    await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
    return true
  }
  const item = hit.items[n - 1]
  clearPick(msg)
  const jid = msg.chat || msg.key?.remoteJid
  const chat = await db.getChat(jid)
  if (!chat.nsfw) {
    await msg.reply(mess.nsfw)
    return true
  }
  const P = await prefijoActual({ sock })
  await deliverXnxx({
    msg,
    sock,
    videoUrl: item.url,
    durationSec: parseDurationToSeconds(item.duration || ''),
    prefix: P
  })
  return true
}

export async function before(ctx) {
  try {
    return await takeNumber(ctx)
  } catch (e) {
    console.error('[xnxx] pick', e?.message || e)
    return false
  }
}

export default {
  command: ["xnxx"],
  category: "nsfw",
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[xnxx] build 1.1.32 numero descarga', P)
    const chat = await db.getChat(msg.chat)

    if (!chat.nsfw)
      return msg.reply(mess.nsfw)

    try {
      const query = args.join(" ").trim()
      if (!query) return msg.reply("✿ Ingresa el nombre de un video o una URL de XNXX.")

      if (/^[1-5]$/.test(query)) {
        const handled = await takeNumber({ msg, sock }, Number(query))
        if (handled) return
        return msg.reply('No hay una lista pendiente de XNXX (caduca a los 5 min).')
      }

      const base = apiBase()
      const key = apiKey()
      let videoUrl
      let durationSec = 0

      if (query.startsWith("http") && query.includes("xnxx.com")) {
        videoUrl = query
      } else {
        const apiUrl = `${base}/nsfw/search/xnxx?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
        const res = await fetch(apiUrl)
        if (!res.ok) return msg.reply("Error al conectar con XNXX API")

        const json = await res.json()
        const results = normalizeResults(json.resultados)
        if (!json.status || !results.length) {
          return msg.reply("No se encontró el video.")
        }

        const hit = bestMatch(results, query)
        if (!isFullMatch(hit)) {
          const items = results.slice(0, 5)
          savePick(msg.chat, { sender: msg.sender, site: 'xnxx', items, msg, fromMe: msg.fromMe })
          await enviarOpciones({ msg, sock, items, cmd: 'xnxx', prefix: P })
          return
        }

        const videoInfo = results[hit.index]
        videoUrl = videoInfo.url
        durationSec = parseDurationToSeconds(videoInfo.duration || '')

        const raw = (json.resultados || []).find(r => (r.url || r.link) === videoInfo.url) || {}
        const caption = `- ׄ　ꕤ　ׅ　✤ ໌　۟　🅧nxx　ׅ　팅화　ׄ

𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Titulo :: ${videoInfo.title}*
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Vistas ::* ${raw.views || ''}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Resolución ::* ${raw.resolution || ''}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Duración ::* ${videoInfo.duration}
𖣣ֶㅤ֯⌗ ✿  ׄ ⬭ *Ver en ::* ${videoInfo.url}`

        await msg.reply(caption)
      }

      await deliverXnxx({ msg, sock, videoUrl, durationSec, prefix: P })
    } catch (err) {
      console.error('[xnxx]', err)
      return msg.reply(`《✧》 Error: ${err?.message || err}`)
    }
  },
}
