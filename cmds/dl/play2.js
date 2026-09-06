import yts from 'yt-search'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getBuffer } from '#serialize'

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_BYTES = 45 * 1024 * 1024
const TMP_DIR = path.join(process.cwd(), 'tmp-dl')

function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: 'application/json'
    },
    timeout: 60000
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function downloadVideoBuffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: '*/*'
    },
    timeout: 180000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf
}

function isMp4(buf) {
  if (!buf || buf.length < 12) return false
  return buf.slice(4, 8).toString() === 'ftyp'
}

async function remuxForWhatsApp(inputBuf, baseName) {
  try {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
    const inFile = path.join(TMP_DIR, `${baseName}-in.mp4`)
    const outFile = path.join(TMP_DIR, `${baseName}-out.mp4`)
    fs.writeFileSync(inFile, inputBuf)
    // Remux rápido; si falla, reencode ligero
    try {
      await execFileAsync('ffmpeg', ['-y', '-i', inFile, '-c', 'copy', '-movflags', '+faststart', outFile], { timeout: 120000 })
    } catch {
      await execFileAsync('ffmpeg', ['-y', '-i', inFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile], { timeout: 300000 })
    }
    const out = fs.readFileSync(outFile)
    try { fs.unlinkSync(inFile) } catch {}
    try { fs.unlinkSync(outFile) } catch {}
    return out
  } catch (e) {
    console.error('[ytvideo] ffmpeg', e?.message || e)
    return inputBuf
  }
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
      for (const quality of ['360', '480', 'auto']) {
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
      let thumbBuffer
      try { thumbBuffer = await getBuffer(videoInfo.image) } catch { thumbBuffer = null }

      const caption = `【　✿　】 _\`୨୧  Download\` ───── *${title}*_

> _✐ \`Canal\` ── ${canal}_
> _ⴵ \`Duración\` ── ${duration || ''}_
> _✰ \`Vistas\` ── ${vistas}_
> _🜸 \`Enlace\` ── ${url}_

> _──  ִ    ۟  *Descargando archivo…*_`

      if (thumbBuffer) {
        await sock.sendMessage(msg.chat, { image: thumbBuffer, caption }, { quoted: msg })
      } else {
        await msg.reply(caption)
      }

      const key = getApiKey()
      const res = await descargarMp4(url, title, key)
      if (!res?.status || !res.data?.dl) {
        const motivo = res?.message || res?.error || 'Motivo no especificado'
        return msg.reply(`《✧》 Falló la descarga.\n📌 Razón de la API: ${motivo}`)
      }

      const dlUrl = res.data.dl
      const safeName = `${(res.data?.title || title || 'video').replace(/[^\w\s.-]/g, '').slice(0, 40) || 'video'}`
      const fileName = `${safeName}.mp4`

      await msg.reply('《✧》 Bajando el video al celular del bot…')
      let videoBuffer = await downloadVideoBuffer(dlUrl)

      if (!videoBuffer?.length) {
        return msg.reply('《✧》 El archivo de video vino vacío.')
      }
      if (videoBuffer.length > MAX_BYTES) {
        return msg.reply(`《✧》 Pesa ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB; demasiado para WhatsApp/Termux. Usa /play (audio) o un video más corto.`)
      }
      if (!isMp4(videoBuffer)) {
        return msg.reply('《✧》 La API no devolvió un MP4 válido (archivo corrupto o HTML). Prueba otro video.')
      }

      videoBuffer = await remuxForWhatsApp(videoBuffer, `${Date.now()}`)

      // Documento primero: WhatsApp suele fallar menos que "video" con archivos de APIs
      try {
        await sock.sendMessage(msg.chat, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: title
        }, { quoted: msg })
      } catch (e1) {
        console.error('[ytvideo] document fail', e1)
        await sock.sendMessage(msg.chat, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: title
        }, { quoted: msg })
      }

    } catch (e) {
      console.error('[ytvideo]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
