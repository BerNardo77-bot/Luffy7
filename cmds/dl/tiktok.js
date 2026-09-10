import db from "#db"
import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'

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

async function ytDlpTiktok(videoUrl) {
  const outTpl = path.join(os.tmpdir(), `tt-${Date.now()}.%(ext)s`)
  const args = ['-f', 'best[ext=mp4]/best', '--no-playlist', '-o', outTpl, videoUrl]
  await execFileAsync('yt-dlp', args, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 })
  const dir = path.dirname(outTpl)
  const prefix = path.basename(outTpl).split('.%(ext)s')[0]
  const hit = fs.readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith('.mp4'))
  if (!hit) throw new Error('yt-dlp no genero mp4')
  const full = path.join(dir, hit)
  const buf = fs.readFileSync(full)
  try { fs.unlinkSync(full) } catch {}
  return buf
}

export default {
  command: ['tiktok', 'tt', 'tk', 'tiktokdl'],
  category: 'downloader',
  run: async ({ msg, sock, args, command }) => {

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

        if (isMp3) {
          await sock.sendMessage(msg.chat, { image: { url: thumbnail }, caption }, { quoted: msg })
          await sock.sendMessage(msg.chat, { audio: { url: dl }, mimetype: 'audio/mpeg', fileName: `${title}.mp3` }, { quoted: msg })
        } else {
          await sock.sendMessage(msg.chat, { [type || 'video']: { url: dl }, caption }, { quoted: msg })
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
            await msg.reply('✿ No se pudieron procesar los resultados.')
          }
        }
      } catch (e) {
        msg.reply(msgglobal)
      }
    }
  },
};