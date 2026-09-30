import db from "#db"
import fetch from "node-fetch"
import fs from "fs"
import os from "os"
import path from "path"
import { Transform } from "stream"
import { pipeline } from "stream/promises"
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

const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOC = (Number(process.env.XV_MAX_DOC_MB) || 500) * 1024 * 1024
const MAX_DOC_MB = Math.round(MAX_DOC / 1024 / 1024)
const MAX_SEND = 64 * 1024 * 1024
const DISK_MARGIN = 150 * 1024 * 1024
const MAX_HLS_HEIGHT = 720
const PREP_FAIL = 'La descarga falló al preparar el video.'
// Sin DATA_DIR (Termux) va a ./tmp-dl junto al bot, no a /data.
const TMP_DIR = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR.replace(/\/$/, ''), 'tmp', 'xv-dl')
  : path.join(process.cwd(), 'tmp-dl')

const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.xvideos.com/'
}

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function mb(n) {
  return (n / 1024 / 1024).toFixed(1)
}

function qualityRank(name) {
  const m = String(name || '').match(/(\d{3,4})/)
  if (m) return Number(m[1])
  if (/^high$/i.test(name)) return 360
  if (/^low$/i.test(name)) return 240
  return 100
}

export function displayQuality(name) {
  const s = String(name || '')
  // La clave "high" de la API es el mp4 progresivo. El estado dice "high", no 360p ni 720p.
  if (/^high$/i.test(s)) return 'high'
  if (/^low$/i.test(s)) return 'low'
  const m = s.match(/(\d{3,4})/)
  if (m) return `${m[1]}p`
  return s || 'mp4'
}

function videoMap(resultado) {
  const videos = resultado?.videos || resultado?.result?.videos || {}
  return videos && typeof videos === 'object' ? videos : {}
}

// Descarga: mp4 progresivo "high" y luego "low". Nunca un m3u8/HLS.
export function pickVideoCandidates(resultado) {
  const videos = videoMap(resultado)
  const list = []
  const seen = new Set()
  const push = (quality, url) => {
    if (!url || typeof url !== 'string' || seen.has(url)) return
    if (/\.m3u8(\?|$)/i.test(url) || /hls/i.test(quality)) return
    seen.add(url)
    list.push({ quality: String(quality), url })
  }
  push('high', videos.high)
  push('low', videos.low)
  const extras = Object.entries(videos)
    .filter(([k, v]) => typeof v === 'string' && !/^(high|low)$/i.test(k))
    .sort((a, b) => qualityRank(b[0]) - qualityRank(a[0]))
  for (const [k, v] of extras) {
    if (qualityRank(k) > MAX_HLS_HEIGHT) continue
    push(k, v)
  }
  push('legacy', resultado?.result?.url || resultado?.url || resultado?.dl)
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
      headers: UA_HEADERS,
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
    headers: UA_HEADERS,
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

export function looksLikeMpegTs(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const st = fs.fstatSync(fd)
    if (st.size < 188) return false
    const buf = Buffer.alloc(189)
    const n = fs.readSync(fd, buf, 0, Math.min(189, st.size), 0)
    if (n < 1 || buf[0] !== 0x47) return false
    if (st.size > 188 && (n <= 188 || buf[188] !== 0x47)) return false
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

async function sendReady(msg, sock, gotFile, usedQuality, link) {
  if (looksLikeMpegTs(gotFile.file)) {
    return msg.reply(`《✧》 ${PREP_FAIL}`)
  }
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
    return
  }
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

async function deliverXvideos({ msg, sock, videoUrl }) {
  let gotFile = null
  try {
    const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
    const key = getKey()
    let got = await fetchDl(base, videoUrl, key)
    if ((!got.json?.status) && key !== FALLBACK_KEY) {
      got = await fetchDl(base, videoUrl, FALLBACK_KEY)
    }
    const resultado = got.resultado || got.json?.resultado
    const candidates = pickVideoCandidates(resultado)
    if (!got.json?.status || !candidates.length) {
      return msg.reply(`No se pudo obtener el video para descargar.\n📌 ${got.json?.message || 'sin enlace en la API'}`)
    }

    let usedLink = null
    let usedQuality = ''
    let tooBig = ''
    let sawTs = false
    for (const c of candidates) {
      const label = displayQuality(c.quality)
      try {
        const len = await headSize(c.url)
        if (len > MAX_DOC) {
          tooBig = tooBig || `${label} ~${mb(len)} MB`
          console.error('[xvideos] skip', label, mb(len))
          continue
        }
        await msg.reply(`《✧》 Bajando calidad *${label}*${len ? ` (~${mb(len)} MB)` : ''}…`)
        gotFile = await downloadToFile(c.url)
        if (gotFile?.file && looksLikeMpegTs(gotFile.file)) {
          sawTs = true
          console.error('[xvideos] mpeg-ts descartado', label)
          await fs.promises.unlink(gotFile.file).catch(() => {})
          gotFile = null
          continue
        }
        usedLink = c.url
        usedQuality = label
        if (gotFile?.size) break
      } catch (e) {
        console.error('[xvideos] dl', label, e.message)
        if (/supera/.test(e.message || '')) tooBig = tooBig || label
        gotFile = null
      }
    }

    if (!gotFile?.size) {
      if (sawTs && !tooBig) return msg.reply(`《✧》 ${PREP_FAIL}`)
      if (tooBig) {
        return msg.reply(`《✧》 La mejor calidad pesa demasiado (${tooBig}) y supera *${MAX_DOC_MB} MB*.\n${videoUrl}`)
      }
      return msg.reply('El archivo vino vacío.')
    }
    await sendReady(msg, sock, gotFile, usedQuality, usedLink || videoUrl)
  } catch (err) {
    console.error('[xvideos]', err)
    return msg.reply(`《✧》 Error: ${err?.message || err}`)
  } finally {
    if (gotFile?.file) fs.promises.unlink(gotFile.file).catch(() => {})
  }
}

async function takeNumber({ msg, sock }, forced = 0) {
  const n = Number(forced) || choiceNumber(msg)
  if (!n || n < 1 || n > 5) return false
  // Termux: el mensaje del dueño llega con fromMe. No reenviar la miniatura.
  const hit = readPick(msg)
  if (!hit || hit.site !== 'xvideos') return false
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
  await deliverXvideos({ msg, sock, videoUrl: item.url })
  return true
}

export async function before(ctx) {
  try {
    return await takeNumber(ctx)
  } catch (e) {
    console.error('[xvideos] pick', e?.message || e)
    return false
  }
}

export default {
  command: ["xvideos"],
  category: "nsfw",
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[xvideos] build 1.1.32 numero descarga mp4 high', P)
    const chat = await db.getChat(msg.chat)
    if (!chat.nsfw) return msg.reply(mess.nsfw)

    try {
      const query = args.join(" ").trim()
      if (!query) return msg.reply("✿ Ingresa el nombre de un video o una URL de XVideos.")

      if (/^[1-5]$/.test(query)) {
        const handled = await takeNumber({ msg, sock }, Number(query))
        if (handled) return
        return msg.reply('No hay una lista pendiente de XVideos (caduca a los 5 min).')
      }

      const base = (typeof api !== 'undefined' && api?.url) ? api.url : 'https://api.alyacore.xyz'
      const key = getKey()
      let videoUrl = query

      if (!(query.startsWith("http") && query.includes("xvideos.com"))) {
        const apiUrl = `${base}/nsfw/search/xvideos?query=${encodeURIComponent(query)}&key=${key}`
        const res = await fetch(apiUrl)
        if (!res.ok) return msg.reply(`Error al conectar con XVideos API (${res.status})`)
        const json = await res.json()
        const results = normalizeResults(json.resultados)
        if (!json.status || !results.length) return msg.reply("No se encontró el video.")
        const hit = bestMatch(results, query)
        if (!isFullMatch(hit)) {
          const items = results.slice(0, 5)
          savePick(msg.chat, { sender: msg.sender, site: 'xvideos', items, msg, fromMe: msg.fromMe })
          await enviarOpciones({ msg, sock, items, cmd: 'xvideos', prefix: P })
          return
        }
        const videoInfo = results[hit.index]
        videoUrl = videoInfo.url
        await msg.reply(`*${videoInfo.title}*\n${videoInfo.duration || ''}\n${videoInfo.url}`)
      }

      await deliverXvideos({ msg, sock, videoUrl })
    } catch (err) {
      console.error('[xvideos]', err)
      return msg.reply(`《✧》 Error: ${err?.message || err}`)
    }
  },
}
