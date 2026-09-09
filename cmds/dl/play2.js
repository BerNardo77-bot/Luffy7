import yts from 'yt-search'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getBuffer } from '#serialize'

const execFileAsync = promisify(execFile)
const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024
const MAX_SEND_BYTES = 64 * 1024 * 1024
const TMP_DIR = path.join(process.cwd(), 'tmp-dl')

function parseDurationToSeconds(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  if (!ts || typeof ts !== 'string') return 0
  const parts = ts.split(':').map(n => Number(n))
  if (parts.some(n => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return 0
}

function isBadMedia({ hasAudio, durationSec, expectedSec }) {
  if (!hasAudio) return 'sin audio'
  if (expectedSec >= 120 && durationSec > 0 && durationSec < expectedSec * 0.5) {
    return `incompleto (${Math.round(durationSec)}s de ~${Math.round(expectedSec)}s)`
  }
  if (expectedSec >= 600 && durationSec > 0 && durationSec < 180) {
    return `parece un clip corto (${Math.round(durationSec)}s), no el video completo`
  }
  return null
}


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

async function fetchFollow(url, opts = {}, maxRedirects = 8) {
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, { ...opts, redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`HTTP ${res.status} sin Location`)
      try { if (res.body?.cancel) res.body.cancel() } catch {}
      current = new URL(loc, current).href
      continue
    }
    return res
  }
  throw new Error('Demasiados redirects (302)')
}

async function downloadVideoBuffer(url) {
  const res = await fetchFollow(url, {
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

async function downloadYoutubeWithYtDlp(videoUrl) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const base = path.join(TMP_DIR, "yt-" + Date.now())
  const outTpl = base + ".%(ext)s"
  const attempts = [
    ["yt-dlp", ["-f", "b[height<=480]/b", "--merge-output-format", "mp4", "--no-playlist", "-o", outTpl, videoUrl]]
  ]
  let last = "yt-dlp no disponible"
  for (const pair of attempts) {
    const bin = pair[0]
    const args = pair[1]
    try {
      await execFileAsync(bin, args, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 })
      const hit = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(path.basename(base)))
      if (!hit) throw new Error("yt-dlp no genero archivo")
      const file = path.join(TMP_DIR, hit)
      const buf = fs.readFileSync(file)
      try { fs.unlinkSync(file) } catch {}
      return buf
    } catch (e) {
      last = (e && e.message) || String(e)
      console.error("[ytvideo] yt-dlp", last.slice(0, 180))
    }
  }
  throw new Error(last.slice(0, 180))
}


function isMp4(buf) {
  if (!buf || buf.length < 12) return false
  return buf.slice(4, 8).toString() === 'ftyp'
}

async function probeHasAudio(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      filePath
    ], { timeout: 30000 })
    return String(stdout || '').toLowerCase().includes('audio')
  } catch {
    return false
  }
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

async function prepareForWhatsApp(inputBuf, baseName, { forceCompress = false } = {}) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const inFile = path.join(TMP_DIR, `${baseName}-in.mp4`)
  const outFile = path.join(TMP_DIR, `${baseName}-out.mp4`)
  fs.writeFileSync(inFile, inputBuf)

  const hasAudio = await probeHasAudio(inFile)
  const duration = await probeDuration(inFile)

  // Siempre reencode con video+audio para WhatsApp (el copy a menudo deja videos mudos o truncados)
  const encodes = []
  if (!forceCompress && inputBuf.length <= MAX_SEND_BYTES) {
    // calidad decente, audio AAC obligatorio
    encodes.push([
      '-y', '-i', inFile,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
      '-movflags', '+faststart',
      outFile
    ])
  }
  encodes.push([
    '-y', '-i', inFile,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-vf', "scale='min(854,iw)':-2",
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart',
    outFile
  ])
  encodes.push([
    '-y', '-i', inFile,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32',
    '-vf', "scale='min(640,iw)':-2",
    '-c:a', 'aac', '-b:a', '64k', '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart',
    outFile
  ])

  let best = null
  let bestMeta = { hasAudio: false, duration: 0 }
  for (const args of encodes) {
    try {
      await execFileAsync('ffmpeg', args, { timeout: 600000 })
      if (!fs.existsSync(outFile)) continue
      const out = fs.readFileSync(outFile)
      if (!out.length || !isMp4(out)) continue
      const a = await probeHasAudio(outFile)
      const d = await probeDuration(outFile)
      // Preferir con audio y duracion razonable
      const score = (a ? 100000000 : 0) + Math.min(d, 36000) * 1000 - out.length / 1000
      const bestScore = best
        ? ((bestMeta.hasAudio ? 100000000 : 0) + Math.min(bestMeta.duration, 36000) * 1000 - best.length / 1000)
        : -Infinity
      if (!best || score > bestScore) {
        best = out
        bestMeta = { hasAudio: a, duration: d }
      }
      if (out.length <= MAX_SEND_BYTES && a && d >= Math.max(1, duration * 0.85)) {
        best = out
        bestMeta = { hasAudio: a, duration: d }
        break
      }
    } catch (e) {
      console.error('[ytvideo] ffmpeg', e?.message || e)
    }
  }

  try { fs.unlinkSync(inFile) } catch {}
  try { fs.unlinkSync(outFile) } catch {}

  return {
    buffer: best || inputBuf,
    hasAudio: bestMeta.hasAudio || hasAudio,
    duration: bestMeta.duration || duration,
    sourceHasAudio: hasAudio,
    sourceDuration: duration
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
  // Preferir calidades con audio completo; 360 a veces viene mudo/corto
  const qualities = ['720', '480', 'auto', '1080', '360']

  for (const useKey of keys) {
    for (const q of queries) {
      for (const quality of qualities) {
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

> _──  ִ    ۟  *Descargando video completo con audio…*_`

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

      await msg.reply("《✧》 Bajando el video completo…")
      let videoBuffer = null
      try {
        videoBuffer = await downloadVideoBuffer(dlUrl)
      } catch (e) {
        console.error("[ytvideo] http", e?.message || e)
      }
      if (!videoBuffer?.length || !isMp4(videoBuffer)) {
        await msg.reply("《✧》 La API mando un redirect. Probando yt-dlp…")
        videoBuffer = await downloadYoutubeWithYtDlp(url)
      }
      if (!videoBuffer?.length) return msg.reply("《✧》 El archivo de video vino vacio.")
      if (!isMp4(videoBuffer)) {
        return msg.reply("《✧》 No salio un MP4. Instala yt-dlp: pkg install yt-dlp -y")
      }

      const needCompress = videoBuffer.length > MAX_SEND_BYTES
      if (needCompress) {
        await msg.reply(`《✧》 Pesa ${mb(videoBuffer.length)} MB. Comprimiendo sin quitar el audio…`)
      }

      const expectedSec = Number(videoInfo.seconds) || parseDurationToSeconds(duration)
      const prepared = await prepareForWhatsApp(videoBuffer, `${Date.now()}`, { forceCompress: needCompress })
      videoBuffer = prepared.buffer

      const dur = prepared.duration || prepared.sourceDuration || 0
      const bad = isBadMedia({
        hasAudio: prepared.hasAudio,
        durationSec: dur,
        expectedSec
      })
      if (bad) {
        return msg.reply(
          `《✧》 No envié el archivo: la fuente salió *${bad}*.\n` +
          `YouTube indica ~${expectedSec ? Math.round(expectedSec) + 's' : 'desconocido'}; el archivo trae ~${Math.round(dur)}s.\n` +
          `Prueba otro enlace (oficial/trailer) o /play para audio.\n🔗 ${url}`
        )
      }

      if (videoBuffer.length > MAX_SEND_BYTES) {
        return msg.reply(`《✧》 Aun comprimido pesa ${mb(videoBuffer.length)} MB y WhatsApp no lo acepta (~64 MB).\n🔗 ${dlUrl}`)
      }

      const meta = `${title}\n(${mb(videoBuffer.length)} MB · ${Math.round(dur)}s · con audio)`

      try {
        await sock.sendMessage(msg.chat, {
          video: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: meta
        }, { quoted: msg })
      } catch (e1) {
        console.error('[ytvideo] video fail', e1)
        await sock.sendMessage(msg.chat, {
          document: videoBuffer,
          mimetype: 'video/mp4',
          fileName,
          caption: meta
        }, { quoted: msg })
      }

    } catch (e) {
      console.error('[ytvideo]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
