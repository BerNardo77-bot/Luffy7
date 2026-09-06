import yts from 'yt-search'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getBuffer } from '#serialize'

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024 // pedir/bajar hasta 500MB
const MAX_SEND_BYTES = 64 * 1024 * 1024 // limite practico WhatsApp
const TMP_DIR = path.join(process.cwd(), 'tmp-dl')

function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function mb(n) {
  return (n / 1024 / 1024).toFixed(1)
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
    timeout: 600000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len && len > MAX_DOWNLOAD_BYTES) {
    throw new Error(`El video pesa ~${mb(len)} MB (limite de descarga 500 MB)`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`El video pesa ${mb(buf.length)} MB (limite de descarga 500 MB)`)
  }
  return buf
}

function isMp4(buf) {
  if (!buf || buf.length < 12) return false
  return buf.slice(4, 8).toString() === 'ftyp'
}

async function compressForWhatsApp(inputBuf, baseName) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const inFile = path.join(TMP_DIR, `${baseName}-in.mp4`)
  const outFile = path.join(TMP_DIR, `${baseName}-out.mp4`)
  fs.writeFileSync(inFile, inputBuf)

  const attempts = [
    // remux
    ['-y', '-i', inFile, '-c', 'copy', '-movflags', '+faststart', outFile],
    // compresion media
    ['-y', '-i', inFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-vf', 'scale=\'min(854,iw)\':-2', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile],
    // mas agresiva
    ['-y', '-i', inFile, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-vf', 'scale=\'min(640,iw)\':-2', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outFile]
  ]

  let best = null
  for (const args of attempts) {
    try {
      await execFileAsync('ffmpeg', args, { timeout: 600000 })
      if (!fs.existsSync(outFile)) continue
      const out = fs.readFileSync(outFile)
      if (!out.length) continue
      if (!best || out.length < best.length) best = out
      if (out.length <= MAX_SEND_BYTES) {
        best = out
        break
      }
    } catch (e) {
      console.error('[ytvideo] ffmpeg attempt', e?.message || e)
    }
  }

  try { fs.unlinkSync(inFile) } catch {}
  try { fs.unlinkSync(outFile) } catch {}
  return best || inputBuf
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
      for (const quality of ['360', '480', 'auto', '720']) {
        try {
          const apiUrl = `${base}/dl/youtubeplayv2?query=${encodeURIComponent(q)}&type=mp4&quality=${quality}&key=${useKey}`
          const res = await fetchJson(apiUrl)
          if (res?.status && res?.data?.dl) {
            const size = Number(res.data.size || 0)
            if (size && size > MAX_DOWNLOAD_BYTES) {
              lastMsg = `El video pesa ~${mb(size)} MB (limite 500 MB)`
              continue
            }
            return res
          }
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

> _──  ִ    ۟  *Descargando (hasta 500MB; si pesa mucho se comprime…)*_`

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

      await msg.reply('《✧》 Bajando el video…')
      let videoBuffer = await downloadVideoBuffer(dlUrl)

      if (!videoBuffer?.length) return msg.reply('《✧》 El archivo de video vino vacío.')
      if (!isMp4(videoBuffer)) {
        return msg.reply('《✧》 La API no devolvió un MP4 válido. Prueba otro video.')
      }

      if (videoBuffer.length > MAX_SEND_BYTES) {
        await msg.reply(`《✧》 Pesa ${mb(videoBuffer.length)} MB. WhatsApp no manda tanto; comprimiendo para que quepa (<64 MB)…`)
        videoBuffer = await compressForWhatsApp(videoBuffer, `${Date.now()}`)
      } else {
        // remux ligero para compatibilidad
        videoBuffer = await compressForWhatsApp(videoBuffer, `${Date.now()}`)
      }

      if (!videoBuffer?.length) {
        return msg.reply('《✧》 No se pudo preparar el video.')
      }

      if (videoBuffer.length > MAX_SEND_BYTES) {
        return msg.reply(`《✧》 Aun comprimido pesa ${mb(videoBuffer.length)} MB y WhatsApp no lo acepta (limite ~64 MB). Usa /play (audio) o un video mas corto.\n🔗 ${dlUrl}`)
      }

      try {
        await sock.sendMessage(msg.chat, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: `${title}\n(${mb(videoBuffer.length)} MB)`
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
