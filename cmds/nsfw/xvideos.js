import db from "#db"
import fetch from "node-fetch"
import fs from "fs"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOWNLOAD = 500 * 1024 * 1024 // bajar hasta 500MB (WhatsApp NO envia 2GB)
const MAX_SEND = 64 * 1024 * 1024
const TMP_DIR = path.join(process.cwd(), 'tmp-dl')

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function mb(n) {
  return (n / 1024 / 1024).toFixed(1)
}

function pickVideoCandidates(resultado) {
  const videos = resultado?.videos || resultado?.result?.videos || {}
  // Preferir low para WhatsApp; high despues
  const list = []
  if (videos.low) list.push({ quality: 'low', url: videos.low })
  if (videos.high) list.push({ quality: 'high', url: videos.high })
  const legacy = resultado?.result?.url || resultado?.url || resultado?.dl
  if (legacy) list.push({ quality: 'legacy', url: legacy })
  return list
}

async function fetchDl(base, videoUrl, key) {
  const downloadUrl = `${base}/nsfw/dl/xvideos?url=${encodeURIComponent(videoUrl)}&key=${key}`
  const downloadRes = await fetch(downloadUrl)
  const downloadJson = await downloadRes.json().catch(() => ({}))
  return {
    ok: downloadRes.ok,
    json: downloadJson,
    candidates: pickVideoCandidates(downloadJson?.resultado)
  }
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.xvideos.com/'
    },
    timeout: 600000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len && len > MAX_DOWNLOAD) {
    throw new Error(`El archivo pesa ~${mb(len)} MB (limite de descarga ${mb(MAX_DOWNLOAD)} MB). WhatsApp no soporta 2GB.`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_DOWNLOAD) {
    throw new Error(`El archivo pesa ${mb(buf.length)} MB (limite de descarga ${mb(MAX_DOWNLOAD)} MB).`)
  }
  return buf
}

async function compressForWhatsApp(inputBuf, baseName) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const inFile = path.join(TMP_DIR, `${baseName}-in.mp4`)
  const outFile = path.join(TMP_DIR, `${baseName}-out.mp4`)
  fs.writeFileSync(inFile, inputBuf)

  const attempts = [
    ['-y', '-i', inFile, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-vf', "scale='min(640,iw)':-2", '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', outFile],
    ['-y', '-i', inFile, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-vf', "scale='min(480,iw)':-2", '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outFile],
    ['-y', '-i', inFile, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '35', '-vf', "scale='min(360,iw)':-2", '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart', outFile]
  ]

  let best = null
  for (const args of attempts) {
    try {
      await execFileAsync('ffmpeg', args, { timeout: 600000 })
      if (!fs.existsSync(outFile)) continue
      const out = fs.readFileSync(outFile)
      if (!out.length) continue
      if (!best || out.length < best.length) best = out
      if (out.length <= MAX_SEND) {
        best = out
        break
      }
    } catch (e) {
      console.error('[xvideos] ffmpeg', e?.message || e)
    }
  }

  try { fs.unlinkSync(inFile) } catch {}
  try { fs.unlinkSync(outFile) } catch {}
  return best || inputBuf
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
      if ((!got.json?.status || !got.candidates.length) && key !== FALLBACK_KEY) {
        got = await fetchDl(base, videoUrl, FALLBACK_KEY)
      }
      if (!got.json?.status || !got.candidates.length) {
        return msg.reply(`No se pudo obtener el video para descargar.\n📌 ${got.json?.message || 'sin enlace en la API'}`)
      }

      let buf = null
      let usedLink = null
      for (const c of got.candidates) {
        try {
          await msg.reply(`《✧》 Bajando calidad *${c.quality}*…`)
          buf = await downloadBuffer(c.url)
          usedLink = c.url
          if (buf?.length) break
        } catch (e) {
          console.error('[xvideos] dl', c.quality, e.message)
        }
      }

      if (!buf?.length) return msg.reply("El archivo vino vacío.")

      if (buf.length > MAX_SEND) {
        await msg.reply(`《✧》 Pesa ${mb(buf.length)} MB. WhatsApp no manda eso; comprimiendo a <64 MB (no se pueden enviar 2GB por WhatsApp)…`)
        buf = await compressForWhatsApp(buf, `${Date.now()}`)
      }

      if (buf.length > MAX_SEND) {
        return msg.reply(
          `《✧》 Aun comprimido pesa ${mb(buf.length)} MB.\n` +
          `WhatsApp solo acepta ~64 MB por archivo; *no se pueden enviar 2GB* por el chat.\n` +
          `Abre el video aquí:\n${usedLink || got.candidates[0].url}`
        )
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
