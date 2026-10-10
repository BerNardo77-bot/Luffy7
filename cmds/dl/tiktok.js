import db from "#db"
import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prefijoActual } from '../../lib/prefijo.js';

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from '../../lib/limits.js'
import { ytdlpToFile, urlToFile, sendVideoFile, friendlyError, isNoCredit, NO_CREDIT_MSG } from '../../lib/mediadl.js'
const MAX_DURATION_SEC = MAX_VIDEO_SEC // MAX_VIDEO_MIN compartido (60 min por defecto)
const MAX_SEND = 64 * 1024 * 1024
const FFMPEG_TIMEOUT_MS = 240000
const TMP_DIR = path.join(process.cwd(), 'tmp-dl')

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}
function apiKeys() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  const keys = [key]
  if (key !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  return keys
}

function mb(n) {
  return (n / 1024 / 1024).toFixed(1)
}

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

async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nk=1:nw=1',
      filePath
    ], { timeout: 30000 })
    const n = Number(stdout)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

// Mejor calidad ≤1080p, a disco, tope 500 MB. Sin reencodear.
async function ytDlpTiktok(videoUrl) {
  return ytdlpToFile(videoUrl, { heights: [1080, 720, 480], maxSec: MAX_DURATION_SEC, tag: 'tt' })
}

function tooLongReply(sec, link, P = '#') {
  return (
    `《✧》 Ese TikTok dura ~${Math.round(sec / 60)} min.\n` +
    `El límite es ${MAX_VIDEO_MIN} min.\n` +
    (link ? `Abre el link:\n${link}` : '')
  )
}

export default {
  command: ['tiktok', 'tt', 'tk', 'tiktokdl'],
  category: 'downloader',
  run: async ({ msg, sock, args, command, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[tiktok] build 1.1.46 yt-dlp ≤1080p, doc >64 MB')

    if (!args.length) {
      return msg.reply(`✿ Ingresa un término o enlace de TikTok.`)
    }

    const isMp3 = args.includes('--mp3')
    const urls = args.filter(arg => arg.includes("tiktok.com"))

    if (urls.length) {
      const url = urls[0]
      if (!isMp3) {
        try {
          await msg.reply('《✧》 Bajando TikTok en la mejor calidad (yt-dlp)…')
          const got = await ytDlpTiktok(url)
          await sendVideoFile(sock, msg, got.file, { caption: `🎬 TikTok${got.height ? ' ' + got.height + 'p' : ''}${got.title ? '\n' + got.title.slice(0, 200) : ''}`, fileName: 'tiktok.mp4' })
          return
        } catch (e) {
          console.error('[tiktok] yt-dlp', e?.message || e)
          if (/^(TOO_LONG|TOO_BIG|NO_SPACE):/.test(String(e?.message))) {
            return msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
          }
        }
      }
      try {
        let data = null
        let last = 'sin data'
        for (const key of apiKeys()) {
          try {
            const apiUrl = isMp3
              ? `${apiBase()}/dl/tiktokmp3?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`
              : `${apiBase()}/dl/tiktok?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`
            const res = await fetch(apiUrl)
            const json = await res.json().catch(() => ({}))
            if (json?.data?.dl) { data = json.data; break }
            last = isNoCredit(json, res.status) ? NO_CREDIT_MSG : (json?.message || last)
          } catch (e) { last = e.message || last }
        }

        if (!data) return msg.reply(`✿ No pude bajar ese TikTok.\n• yt-dlp falló (prueba: pkg upgrade yt-dlp)\n• Respaldo: ${last}\n${url}`)

        const {
          id,
          title = 'Sin título',
          dl,
          duration,
          thumbnail,
          author = {},
          stats = {},
          music_info = {},
          music = {},
          type
        } = data

        const durationSec = parseDurationToSeconds(duration || music_info.duration || '')
        const tiktokLink = `https://www.tiktok.com/@${author.unique_id}/video/${id}`

        if (!isMp3 && durationSec > MAX_DURATION_SEC) {
          return msg.reply(tooLongReply(durationSec, tiktokLink || url, P))
        }

        const caption =
          `ㅤ۟∩　ׅ　★ ໌　ׅ　🅣𝗂𝗄𝖳𝗈𝗄 🅓ownload　ᰙ\n\n` +
          `𖣣ֶㅤ֯⌗ ✿ ⬭ Título: ${title}\n` +
          `𖣣ֶㅤ֯⌗ ★ ⬭ Autor: ${author.nickname || author.unique_id || 'Desconocido'}\n` +
          `𖣣ֶㅤ֯⌗ ❖ ⬭ Duración: ${duration || music_info.duration || 'N/A'}\n` +
          `𖣣ֶㅤ֯⌗ ♡ ⬭ Likes: ${(stats.likes || 0).toLocaleString()}\n` +
          `𖣣ֶㅤ֯⌗ ꕥ ⬭ Comentarios: ${(stats.comments || 0).toLocaleString()}\n` +
          `𖣣ֶㅤ֯⌗ ❒ ⬭ Vistas: ${(stats.views || stats.plays || 0).toLocaleString()}\n` +
          `𖣣ֶㅤ֯⌗ ☄︎ ⬭ Compartidos: ${(stats.shares || 0).toLocaleString()}\n` +
          `𖣣ֶㅤ֯⌗ ❍ ⬭ Enlace: ${tiktokLink}\n` +
          `𖣣ֶㅤ֯⌗ ❖ ⬭ Audio: ${(music.title || music_info.title) ? (music.title || music_info.title) + ' -' : 'Desconocido'} ${(music.author || music_info.author || '')}`

        if (isMp3) {
          await sock.sendMessage(msg.chat, { image: { url: thumbnail }, caption }, { quoted: msg })
          await sock.sendMessage(msg.chat, { audio: { url: dl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3` }, { quoted: msg })
        } else {
          try {
            if (type && type !== 'video') {
              await sock.sendMessage(msg.chat, { [type]: { url: dl }, caption }, { quoted: msg })
            } else {
              const got = await urlToFile(dl, { tag: 'tt-api' })
              await sendVideoFile(sock, msg, got.file, { caption, fileName: 'tiktok.mp4' })
            }
          } catch (e) {
            if (/^(TOO_BIG|NO_SPACE):/.test(String(e?.message))) return msg.reply(friendlyError(e, { link: tiktokLink || url }))
            console.error('[tiktok] send api', e)
            await msg.reply(`《✧》 No pude enviar el video por WhatsApp.\n${tiktokLink || url}`)
          }
        }
      } catch (e) {
        console.error('[tiktok]', e)
        try {
          await msg.reply(`《✧》 Error: ${e?.message || e}`)
        } catch (e2) {
          console.error('[tiktok] reply', e2)
        }
      }
    } else {
      const query = args.filter(a => a !== '--mp3').join(" ")
      try {
        const searchUrl = `${apiBase()}/search/tiktok?query=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKeys()[0])}`
        const res = await fetch(searchUrl)
        const json = await res.json()
        const results = json.data
        if (!results || results.length === 0) return msg.reply(`❖ No se encontraron resultados para: ${query}`)

        if (isMp3) {
          const chosen = results[0]
          const tiktokUrl = `https://www.tiktok.com/@${chosen.author.unique_id}/video/${chosen.id}`
          const dur0 = parseDurationToSeconds(chosen.duration || '')
          if (dur0 > MAX_DURATION_SEC) {
            return msg.reply(tooLongReply(dur0, tiktokUrl, P))
          }
          const apiUrl = `${apiBase()}/dl/tiktokmp3?url=${encodeURIComponent(tiktokUrl)}&key=${encodeURIComponent(apiKeys()[0])}`

          const res2 = await fetch(apiUrl)
          const json2 = await res2.json()
          const data = json2.data

          const {
            id,
            title = 'Sin título',
            dl,
            duration,
            thumbnail,
            author = {},
            stats = {},
            music_info = {},
            music = {}
          } = data

          const tiktokLink = `https://www.tiktok.com/@${author.unique_id}/video/${id}`

          const caption =
            `ㅤ۟∩　ׅ　★ ໌　ׅ　🅣𝗂𝗄𝖳𝗈𝗄 🅓ownload　ᰙ\n\n` +
            `𖣣ֶㅤ֯⌗ ✿ ⬭ Título: ${title}\n` +
            `𖣣ֶㅤ֯⌗ ★ ⬭ Autor: ${author.nickname || author.unique_id || 'Desconocido'}\n` +
            `𖣣ֶㅤ֯⌗ ❖ ⬭ Duración: ${duration || music_info.duration || 'N/A'}\n` +
            `𖣣ֶㅤ֯⌗ ♡ ⬭ Likes: ${(stats.likes || 0).toLocaleString()}\n` +
            `𖣣ֶㅤ֯⌗ ꕥ ⬭ Comentarios: ${(stats.comments || 0).toLocaleString()}\n` +
            `𖣣ֶㅤ֯⌗ ❒ ⬭ Vistas: ${(stats.views || stats.plays || 0).toLocaleString()}\n` +
            `𖣣ֶㅤ֯⌗ ☄︎ ⬭ Compartidos: ${(stats.shares || 0).toLocaleString()}\n` +
            `𖣣ֶㅤ֯⌗ ❍ ⬭ Enlace: ${tiktokLink}\n` +
            `𖣣ֶㅤ֯⌗ ❖ ⬭ Audio: ${(music.title || music_info.title) ? (music.title || music_info.title) + ' -' : 'Desconocido'} ${(music.author || music_info.author || '')}`

          await sock.sendMessage(msg.chat, { image: { url: thumbnail }, caption }, { quoted: msg })
          await sock.sendMessage(msg.chat, { audio: { url: dl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3` }, { quoted: msg })
        } else {
          const medias = []
          for (const data of results.slice(0, 5)) {
            const {
              id,
              title = 'Sin título',
              dl,
              duration,
              author = {},
              stats = {},
              music = {}
            } = data

            const durationSec = parseDurationToSeconds(duration || '')
            if (durationSec > MAX_DURATION_SEC) continue
            if (!dl) continue

            const tiktokLink = `https://www.tiktok.com/@${author.unique_id}/video/${id}`

            const caption =
              `ㅤ۟∩　ׅ　★ ໌　ׅ　🅣𝗂𝗄𝖳𝗈𝗄 🅓ownload　ᰙ\n\n` +
              `𖣣ֶㅤ֯⌗ ✿ ⬭ Título: ${title}\n` +
              `𖣣ֶㅤ֯⌗ ❑ ⬭ Autor: ${author.nickname || author.unique_id || 'Desconocido'}\n` +
              `𖣣ֶㅤ֯⌗ ❀ ⬭ Duración: ${duration || 'N/A'}\n` +
              `𖣣ֶㅤ֯⌗ ♡ ⬭ Likes: ${(stats.likes || 0).toLocaleString()}\n` +
              `𖣣ֶㅤ֯⌗ ★ ⬭ Comentarios: ${(stats.comments || 0).toLocaleString()}\n` +
              `𖣣ֶㅤ֯⌗ ❖ ⬭ Vistas: ${(stats.views || stats.plays || 0).toLocaleString()}\n` +
              `𖣣ֶㅤ֯⌗ ꕥ ⬭ Compartidos: ${(stats.shares || 0).toLocaleString()}\n` +
              `𖣣ֶㅤ֯⌗ ❍ ⬭ Enlace: ${tiktokLink}\n` +
              `𖣣ֶㅤ֯⌗ ☄︎ ⬭ Audio: ${music.title ? music.title + ' -' : 'Desconocido'} ${music.author || ''}`

            medias.push({
              type: 'video',
              data: { url: dl },
              caption
            })
          }

          if (medias.length) {
            await sock.sendAlbumMessage(msg.chat, medias, { quoted: msg })
          } else {
            await msg.reply(`✿ No se pudieron procesar los resultados (o todos pasaban de ${MAX_VIDEO_MIN} min).`)
          }
        }
      } catch (e) {
        console.error('[tiktok] search', e)
        msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
      }
    }
  },
};
