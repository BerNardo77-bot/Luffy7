import db from "#db"
import fetch from "node-fetch"
import fs from "fs"
import os from "os"
import path from "path"
import { Transform } from "stream"
import { pipeline } from "stream/promises"

const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOC = (Number(process.env.XV_MAX_DOC_MB) || 500) * 1024 * 1024
const MAX_DOC_MB = Math.round(MAX_DOC / 1024 / 1024)
const MAX_SEND = 64 * 1024 * 1024
const DISK_MARGIN = 150 * 1024 * 1024
// Sin DATA_DIR (Termux) va a ./tmp-dl junto al bot, no a /data.
const TMP_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR.replace(/\/$/, ''), 'tmp', 'xv-dl')
  : path.join(process.cwd(), 'tmp-dl')

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
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

// En XVideos "high" suele ser ~360/480p, no la mejor. Se ordena por resolución real (1080, 720, …).
function qualityRank(name) {
  const m = String(name || '').match(/(\d{3,4})/)
  if (m) return Number(m[1])
  if (/^high$/i.test(name)) return 480
  if (/^low$/i.test(name)) return 240
  return 100
}

export function pickVideoCandidates(resultado) {
  const videos = resultado?.videos || resultado?.result?.videos || {}
  const list = []
  const seen = new Set()
  const push = (quality, url) => {
    if (!url || typeof url !== 'string' || seen.has(url)) return
    if (/\.m3u8(\?|$)/i.test(url)) return
    seen.add(url)
    list.push({ quality: String(quality), url })
  }
  if (videos && typeof videos === 'object') {
    for (const [k, v] of Object.entries(videos)) push(k, v)
  }
  push('legacy', resultado?.result?.url || resultado?.url || resultado?.dl)
  list.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
  return list
}

async function fetchDl(base, videoUrl, key) {
  const downloadUrl = `${base}/nsfw/dl/xvideos?url=${encodeURIComponent(videoUrl)}&key=${key}`
  const downloadRes = await fetch(downloadUrl)
  const downloadJson = await downloadRes.json().catch(() => ({}))
  return {
    ok: downloadRes.ok,
    json: downloadJson,
    resultado: downloadJson?.resultado,
    candidates: null
  }
}

function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir)
    return Number(st.bavail) * Number(st.bsize)
  } catch {
    return Infinity
  }
}

// Archivo en TMP_DIR + copia cifrada de Baileys en os.tmpdir()
function hasDiskFor(size) {
  ensureTmp()
  let same = false
  try { same = fs.statSync(TMP_DIR).dev === fs.statSync(os.tmpdir()).dev } catch {}
  if (same) return freeBytes(TMP_DIR) > size * 2 + DISK_MARGIN
  return freeBytes(TMP_DIR) > size + DISK_MARGIN && freeBytes(os.tmpdir()) > size + DISK_MARGIN
}

async function headSize(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Referer: 'https://www.xvideos.com/'
      },
      timeout: 15000
    })
    const n = Number(res.headers.get('content-length'))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

async function downloadToFile(url) {
  ensureTmp()
  const file = path.join(TMP_DIR, `xv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      Accept: '*/*',
      Referer: 'https://www.xvideos.com/'
    },
    timeout: 60000
  })
  if (!res.ok) throw new Error(`Descarga HTTP ${res.status}`)
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_DOC) {
    res.body.destroy()
    throw new Error(`El archivo pesa ~${mb(len)} MB y supera el límite de *${MAX_DOC_MB} MB*.`)
  }
  let size = 0
  let idle = null
  const counter = new Transform({
    transform(chunk, _e, cb) {
      size += chunk.length
      idle.refresh()
      if (size > MAX_DOC) return cb(new Error(`El archivo pesa más de *${MAX_DOC_MB} MB*.`))
      cb(null, chunk)
    }
  })
  idle = setTimeout(() => counter.destroy(new Error('Descarga detenida (timeout)')), 60000)
  try {
    await pipeline(res.body, counter, fs.createWriteStream(file))
  } catch (e) {
    fs.promises.unlink(file).catch(() => {})
    throw e
  } finally {
    clearTimeout(idle)
  }
  return { file, size }
}

export default {
  command: ["xvideos"],
  category: "nsfw",
  run: async ({ msg, sock, args, usedPrefix }) => {
    console.error('[xvideos] build 127 mejor calidad ≤' + MAX_DOC_MB + 'MB', usedPrefix || '')
    let gotFile = null
    const chat = await db.getChat(msg.chat)
    if (!chat.nsfw) return msg.reply(mess.nsfw)

    try {
      const query = args.join(" ").trim()
      if (!query) return msg.reply("✿ Ingresa el nombre de un video o una URL de XVideos.")

      const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
      const key = getKey()
      let videoUrl = query
      let durationSec = 0

      if (!(query.startsWith("http") && query.includes("xvideos.com"))) {
        const apiUrl = `${base}/nsfw/search/xvideos?query=${encodeURIComponent(query)}&key=${key}`
        const res = await fetch(apiUrl)
        if (!res.ok) return msg.reply(`Error al conectar con XVideos API (${res.status})`)
        const json = await res.json()
        if (!json.status || !json.resultados?.length) return msg.reply("No se encontró el video.")
        const videoInfo = json.resultados[Math.floor(Math.random() * json.resultados.length)]
        videoUrl = videoInfo.url
        durationSec = parseDurationToSeconds(videoInfo.duration || videoInfo.duration_string || videoInfo.length)
        await msg.reply(`*${videoInfo.title}*\n${videoInfo.duration || ''}\n${videoInfo.url}`)
      }


      let got = await fetchDl(base, videoUrl, key)
      if ((!got.json?.status) && key !== FALLBACK_KEY) {
        got = await fetchDl(base, videoUrl, FALLBACK_KEY)
      }
      const resultado = got.resultado || got.json?.resultado
      if (!durationSec) {
        durationSec = parseDurationToSeconds(
          resultado?.duration || resultado?.result?.duration || resultado?.length || ''
        )
      }

      const candidates = pickVideoCandidates(resultado)
      if (!got.json?.status || !candidates.length) {
        return msg.reply(`No se pudo obtener el video para descargar.\n📌 ${got.json?.message || 'sin enlace en la API'}`)
      }

      let usedLink = null
      let usedQuality = ''
      let tooBig = ''
      for (const c of candidates) {
        try {
          const len = await headSize(c.url)
          if (len > MAX_DOC) {
            tooBig = tooBig || `${c.quality} ~${mb(len)} MB`
            console.error('[xvideos] skip', c.quality, mb(len))
            continue
          }
          await msg.reply(`《✧》 Bajando calidad *${c.quality}*${len ? ` (~${mb(len)} MB)` : ''}…`)
          gotFile = await downloadToFile(c.url)
          usedLink = c.url
          usedQuality = c.quality
          if (gotFile?.size) break
        } catch (e) {
          console.error('[xvideos] dl', c.quality, e.message)
          if (/500 MB|supera/.test(e.message || '')) tooBig = tooBig || c.quality
          gotFile = null
        }
      }

      if (!gotFile?.size) {
        return msg.reply(tooBig
          ? `《✧》 La mejor calidad pesa demasiado (${tooBig}) y supera *${MAX_DOC_MB} MB*.\n${videoUrl}`
          : 'El archivo vino vacío.')
      }

      const link = usedLink || candidates[0].url
      if (gotFile.size > MAX_SEND && !hasDiskFor(gotFile.size)) {
        return msg.reply(
          `《✧》 Pesa ${mb(gotFile.size)} MB y no hay espacio temporal para enviarlo.\nAbre el video aquí:\n${link}`
        )
      }
      if (gotFile.size > MAX_SEND) {
        await msg.reply(`《✧》 Pesa ${mb(gotFile.size)} MB; se envía como *documento* (límite ${MAX_DOC_MB} MB, puede tardar unos minutos)…`).catch(() => {})
        await sock.sendMessage(msg.chat, {
          document: { url: gotFile.file },
          mimetype: 'video/mp4',
          fileName: 'xvideos.mp4',
          caption: `XVideos ${usedQuality} (${mb(gotFile.size)} MB, documento)`
        }, { quoted: msg })
      } else {
        try {
          await sock.sendMessage(msg.chat, {
            video: { url: gotFile.file },
            mimetype: 'video/mp4',
            caption: `XVideos ${usedQuality} (${mb(gotFile.size)} MB)`
          }, { quoted: msg })
        } catch (e) {
          console.error('[xvideos] send', e)
          await sock.sendMessage(msg.chat, {
            document: { url: gotFile.file },
            mimetype: 'video/mp4',
            fileName: 'xvideos.mp4'
          }, { quoted: msg })
        }
      }
    } catch (err) {
      console.error('[xvideos]', err)
      return msg.reply(`《✧》 Error: ${err?.message || err}`)
    } finally {
      if (gotFile?.file) fs.promises.unlink(gotFile.file).catch(() => {})
    }
  },
}
