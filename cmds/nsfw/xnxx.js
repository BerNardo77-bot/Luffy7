import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from '../../lib/limits.js'
import { ytdlpToFile, urlToFile, sendVideoFile, friendlyError, isNoCredit } from '../../lib/mediadl.js'
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
  bareNumber
} from "../../lib/nsfw-pick.js"
import { enviarOpciones } from "../../lib/nsfw-choice.js"

const MAX_DURATION_SEC = MAX_VIDEO_SEC // MAX_VIDEO_MIN compartido (60 min por defecto)

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

async function ytdlpXnxx({ msg, sock, videoUrl, motivo }) {
  try {
    await msg.reply(`《✧》 ${motivo ? motivo + '; ' : ''}bajando con yt-dlp…`)
    const got = await ytdlpToFile(videoUrl, { maxSec: MAX_DURATION_SEC, tag: 'xnxx' })
    await sendVideoFile(sock, msg, got.file, { caption: `XNXX ${got.height ? got.height + 'p' : ''}`.trim(), fileName: 'xnxx.mp4' })
  } catch (e) {
    console.error('[xnxx] yt-dlp', e?.message || e)
    await msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: videoUrl }))
  }
}

async function deliverXnxx({ msg, sock, videoUrl, durationSec = 0, prefix = '' }) {
  if (durationSec > MAX_DURATION_SEC) {
    return msg.reply(
      `《✧》 Ese video dura ~${Math.round(durationSec / 60)} min. El límite es ${MAX_VIDEO_MIN} min.\n` +
      `Abre el link:\n${videoUrl}`
    )
  }

  const downloadUrl = `${apiBase()}/nsfw/dl/xnxx?url=${encodeURIComponent(videoUrl)}&key=${encodeURIComponent(apiKey())}`
  let downloadJson = {}
  let status = 0
  try {
    const downloadRes = await fetch(downloadUrl)
    status = downloadRes.status
    downloadJson = await downloadRes.json().catch(() => ({}))
  } catch (e) { console.error('[xnxx] api', e?.message || e) }
  const result = downloadJson?.resultado?.result
  if (!downloadJson?.status || !result) {
    const motivo = isNoCredit(downloadJson, status) ? 'alyacore se quedó sin saldo (429)' : 'la API falló'
    return ytdlpXnxx({ msg, sock, videoUrl, motivo })
  }

  if (!durationSec) durationSec = parseDurationToSeconds(result.duration || result.length || '')
  if (durationSec > MAX_DURATION_SEC) {
    return msg.reply(`《✧》 Ese video dura ~${Math.round(durationSec / 60)} min. El límite es ${MAX_VIDEO_MIN} min.\n${videoUrl}`)
  }

  const dl = result.download || {}
  const links = []
  if (dl.high) links.push({ q: 'high', url: dl.high })
  if (dl.low) links.push({ q: 'low', url: dl.low })
  if (dl.url) links.push({ q: 'url', url: dl.url })
  if (!links.length) return ytdlpXnxx({ msg, sock, videoUrl, motivo: 'la API no dio enlace' })

  let lastErr = null
  for (const item of links) {
    try {
      await msg.reply(`《✧》 Bajando XNXX (*${item.q}*)…`)
      const got = await urlToFile(item.url, { tag: 'xnxx' })
      await sendVideoFile(sock, msg, got.file, { caption: item.q === 'high' ? 'XNXX (HD)' : 'XNXX', fileName: 'xnxx.mp4' })
      return
    } catch (e) {
      lastErr = e
      console.error('[xnxx] send', item.q, e?.message || e)
      if (/^NO_SPACE:/.test(String(e?.message))) break
    }
  }
  return msg.reply(friendlyError(lastErr, { maxMin: MAX_VIDEO_MIN, link: videoUrl }))
}

async function takeNumber({ msg, sock }, forced = 0) {
  const n = Number(forced) > 0 ? Number(forced) : bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== 'xnxx') return false
  if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
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
