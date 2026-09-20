import db from "#db"
import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DURATION_SEC = 20 * 60 // mismo tope seguro que #ytvideo
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

async function compressForWhatsApp(inputBuf, baseName) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const inFile = path.join(TMP_DIR, `${baseName}-in.mp4`)
  const outFile = path.join(TMP_DIR, `${baseName}-out.mp4`)
  fs.writeFileSync(inFile, inputBuf)
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', inFile,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-vf', "scale='min(720,iw)':-2,fps=30",
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      outFile
    ], { timeout: FFMPEG_TIMEOUT_MS })
    if (!fs.existsSync(outFile)) return null
    const out = fs.readFileSync(outFile)
    return out.length ? out : null
  } catch (e) {
    console.error('[tiktok] ffmpeg', e?.message || e)
    return null
  } finally {
    try { fs.unlinkSync(inFile) } catch {}
    try { fs.unlinkSync(outFile) } catch {}
  }
}

async function ytDlpTiktok(videoUrl) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const base = path.join(TMP_DIR, `tt-${Date.now()}`)
  const outTpl = base + '.%(ext)s'
  // best HD but cap height 1080 to limit RAM on Northflank
  const args = [
    '-f', 'best[ext=mp4][height<=1080]/best[height<=1080]/best',
    '--no-playlist',
    '-o', outTpl,
    videoUrl
  ]
  await execFileAsync('yt-dlp', args, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 })
  const hit = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(path.basename(base)) && f.endsWith('.mp4'))
  if (!hit) throw new Error('yt-dlp no genero mp4')
  const full = path.join(TMP_DIR, hit)
  const dur = await probeDuration(full)
  if (dur > MAX_DURATION_SEC) {
    try { fs.unlinkSync(full) } catch {}
    const err = new Error(`TOO_LONG:${Math.round(dur)}`)
    throw err
  }
  let buf = fs.readFileSync(full)
  try { fs.unlinkSync(full) } catch {}
  if (buf.length > MAX_SEND) {
    const compressed = await compressForWhatsApp(buf, `${Date.now()}-tt`)
    if (!compressed || compressed.length > MAX_SEND) {
      throw new Error(`TOO_HEAVY:${mb(buf.length)}`)
    }
    buf = compressed
  }
  return buf
}

function tooLongReply(sec, link) {
  return (
    `《✧》 Ese TikTok dura ~${Math.round(sec / 60)} min.\n` +
    `Límite seguro: ~${Math.round(MAX_DURATION_SEC / 60)} min (como #ytvideo).\n` +
    (link ? `Abre el link:\n${link}` : '')
  )
}

export default {
  command: ['tiktok', 'tt', 'tk', 'tiktokdl'],
  category: 'downloader',
  run: async ({ msg, sock, args, command }) => {
    console.error('[tiktok] build 120-safe 20min')

    if (!args.length) {
      return msg.reply(`✿ Ingresa un término o enlace de TikTok.`)
    }

    const isMp3 = args.includes('--mp3')
    const urls = args.filter(arg => arg.includes("tiktok.com"))

    if (urls.length) {
      const url = urls[0]
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
            last = json?.message || last
          } catch (e) { last = e.message || last }
        }

        if (!data && !isMp3) {
          try {
            await msg.reply('《✧》 API falló; bajando TikTok HD con yt-dlp…')
            const buf = await ytDlpTiktok(url)
            await sock.sendMessage(msg.chat, {
              video: buf,
              mimetype: 'video/mp4',
              caption: '🎬 TikTok (HD yt-dlp)'
            }, { quoted: msg })
            return
          } catch (e) {
            console.error('[tiktok] yt-dlp', e)
            const m = String(e?.message || e)
            if (m.startsWith('TOO_LONG:')) {
              return msg.reply(tooLongReply(Number(m.split(':')[1]) || 0, url))
            }
            if (m.startsWith('TOO_HEAVY:')) {
              return msg.reply(`《✧》 El archivo pesa ~${m.split(':')[1]} MB y no cabe en WhatsApp (~64 MB).\n${url}`)
            }
          }
        }

        if (!data) return msg.reply(`✿ No se encontraron resultados para: ${url}\n${last}`)

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
          return msg.reply(tooLongReply(durationSec, tiktokLink || url))
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
            await sock.sendMessage(msg.chat, { [type || 'video']: { url: dl }, caption }, { quoted: msg })
          } catch (e) {
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
            return msg.reply(tooLongReply(dur0, tiktokUrl))
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
            await msg.reply('✿ No se pudieron procesar los resultados (o todos pasaban de 20 min).')
          }
        }
      } catch (e) {
        console.error('[tiktok] search', e)
        msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
      }
    }
  },
};
