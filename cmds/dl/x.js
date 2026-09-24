import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)
const MAX_SEND = 64 * 1024 * 1024 // tope seguro video/imagen en WhatsApp
const MAX_DOC = 100 * 1024 * 1024 // si pesa más que MAX_SEND pero menos que esto → documento
const MAX_MEDIA = 10
const TMP_DIR = path.join(process.cwd(), 'lib', 'system', 'tmp', 'x-dl') // gitignored
// UA sin 'Mozilla': api.vxtwitter.com (Cloudflare) da 403 a UAs tipo navegador.
// video.twimg.com / pbs.twimg.com aceptan cualquier UA, así que se usa el mismo para todo.
const UA = { 'User-Agent': 'Luffy7-Bot/1.1 (x-downloader)' }

const HOSTS = '(?:www\\.|mobile\\.|m\\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx|twittpr|girlcockx|stupidpenisx)\\.com'
const STATUS_RE = new RegExp(`https?:\\/\\/${HOSTS}\\/(?:i\\/web\\/|i\\/|[A-Za-z0-9_]{1,20}\\/)?status(?:es)?\\/(\\d{1,25})`, 'i')
const TCO_RE = /https?:\/\/t\.co\/[A-Za-z0-9]+/i

function mb(n) {
  return (n / 1024 / 1024).toFixed(1)
}

export function parseTweet(url) {
  const m = String(url || '').match(STATUS_RE)
  if (!m) return null
  const um = String(url).match(/\.com\/([A-Za-z0-9_]{1,20})\/status/i)
  const user = um && !['i', 'web'].includes(um[1].toLowerCase()) ? um[1] : 'i'
  return { id: m[1], user }
}

async function resolveTco(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: UA, timeout: 15000 })
    return res.url || url
  } catch {
    return url
  }
}

function pickBestMp4(formats = [], fallbackUrl) {
  const mp4 = formats
    .filter(f => f?.url && (f.container === 'mp4' || /\.mp4(\?|$)/.test(f.url)))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
    .map(f => f.url)
  if (fallbackUrl && !mp4.includes(fallbackUrl)) mp4.unshift(fallbackUrl)
  return mp4
}

// FxTwitter: https://api.fxtwitter.com/status/<id>
async function fromFx(id, user) {
  const res = await fetch(`https://api.fxtwitter.com/${user || 'i'}/status/${id}`, { headers: UA, timeout: 20000 })
  const json = await res.json().catch(() => ({}))
  if (json?.code !== 200 || !json.tweet) {
    const err = new Error(json?.message || `FxTwitter HTTP ${res.status}`)
    err.code = json?.code || res.status
    throw err
  }
  const t = json.tweet
  const media = (t.media?.all || []).map(m => {
    if (m.type === 'photo') {
      const u = m.url?.includes('pbs.twimg.com') && !/[?&]name=/.test(m.url) ? `${m.url}?name=orig` : m.url
      return { type: 'image', urls: [u] }
    }
    return { type: m.type === 'gif' ? 'gif' : 'video', urls: pickBestMp4(m.formats, m.url), duration: m.duration }
  }).filter(m => m.urls?.[0])
  return {
    source: 'FxTwitter',
    author: t.author?.name || '',
    handle: t.author?.screen_name || '',
    text: t.text || '',
    link: t.url || `https://x.com/i/status/${id}`,
    likes: t.likes, retweets: t.retweets,
    media
  }
}

// VxTwitter: https://api.vxtwitter.com/Twitter/status/<id>
async function fromVx(id, user) {
  const res = await fetch(`https://api.vxtwitter.com/${user || 'Twitter'}/status/${id}`, { headers: UA, timeout: 20000 })
  const json = await res.json().catch(() => null)
  if (!json || !json.tweetID) throw new Error(`VxTwitter HTTP ${res.status}`)
  const media = (json.media_extended || []).map(m => {
    if (m.type === 'image') return { type: 'image', urls: [m.url] }
    return { type: m.type === 'gif' ? 'gif' : 'video', urls: [m.url], duration: (m.duration_millis || 0) / 1000 }
  }).filter(m => m.urls?.[0])
  return {
    source: 'VxTwitter',
    author: json.user_name || '',
    handle: json.user_screen_name || '',
    text: json.text || '',
    link: json.tweetURL || `https://x.com/i/status/${id}`,
    likes: json.likes, retweets: json.retweets,
    media
  }
}

// yt-dlp es opcional: viene en el Dockerfile, pero en Termux puede no estar instalado.
let ytDlpAvailable = null
async function hasYtDlp() {
  if (ytDlpAvailable !== null) return ytDlpAvailable
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 15000 })
    ytDlpAvailable = true
  } catch {
    ytDlpAvailable = false
  }
  return ytDlpAvailable
}

// Respaldo: yt-dlp (solo si está disponible)
async function fromYtDlp(link) {
  if (!(await hasYtDlp())) throw new Error('yt-dlp no está instalado')
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  const base = `x-${Date.now()}`
  await execFileAsync('yt-dlp', [
    '-f', 'best[ext=mp4][filesize<64M]/best[ext=mp4]/best',
    '--no-playlist', '--max-filesize', '100M',
    '-o', path.join(TMP_DIR, base + '.%(ext)s'),
    link
  ], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 })
  const hit = fs.readdirSync(TMP_DIR).find(f => f.startsWith(base))
  if (!hit) throw new Error('yt-dlp no generó archivo')
  const full = path.join(TMP_DIR, hit)
  const buf = fs.readFileSync(full)
  try { fs.unlinkSync(full) } catch {}
  return buf
}

async function headSize(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: UA, timeout: 15000 })
    const n = Number(res.headers.get('content-length'))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

async function download(url) {
  const res = await fetch(url, { headers: UA, timeout: 120000 })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.buffer()
}

// Elige la mejor calidad que quepa en WhatsApp; si ninguna cabe, devuelve la más chica como documento
async function fetchMedia(item) {
  let smallest = null
  for (const url of item.urls) {
    const size = await headSize(url)
    if (size && size > MAX_SEND) {
      if (!smallest || size < smallest.size) smallest = { url, size }
      continue
    }
    const buf = await download(url)
    if (buf.length <= MAX_SEND) return { buf, asDoc: false }
    if (!smallest || buf.length < smallest.size) smallest = { url, size: buf.length }
  }
  if (smallest && smallest.size <= MAX_DOC) {
    return { buf: await download(smallest.url), asDoc: true }
  }
  const err = new Error(`TOO_HEAVY:${smallest ? mb(smallest.size) : '?'}`)
  err.url = smallest?.url || item.urls[0]
  throw err
}

function buildCaption(info) {
  let text = (info.text || '').replace(/https?:\/\/t\.co\/\S+/g, '').trim()
  if (text.length > 400) text = text.slice(0, 400).trim() + '…'
  return (
    `ㅤ۟∩　ׅ　★ ໌　ׅ　🅧 🅓ownload　ᰙ\n\n` +
    `𖣣ֶㅤ֯⌗ ★ ⬭ Autor: ${info.author || 'Desconocido'}${info.handle ? ` (@${info.handle})` : ''}\n` +
    (text ? `𖣣ֶㅤ֯⌗ ✿ ⬭ Texto: ${text}\n` : '') +
    (info.likes != null ? `𖣣ֶㅤ֯⌗ ♡ ⬭ Likes: ${Number(info.likes || 0).toLocaleString()}\n` : '') +
    (info.retweets != null ? `𖣣ֶㅤ֯⌗ ☄︎ ⬭ Reposts: ${Number(info.retweets || 0).toLocaleString()}\n` : '') +
    `𖣣ֶㅤ֯⌗ ❍ ⬭ Enlace: ${info.link}`
  )
}

async function sendOne(sock, msg, item, got, caption, i) {
  if (got.asDoc) {
    const isVid = item.type !== 'image'
    return sock.sendMessage(msg.chat, {
      document: got.buf,
      mimetype: isVid ? 'video/mp4' : 'image/jpeg',
      fileName: `x-${Date.now()}-${i + 1}.${isVid ? 'mp4' : 'jpg'}`,
      caption: (caption ? caption + '\n\n' : '') + `《✧》 Pesa ${mb(got.buf.length)} MB, se envía como documento.`
    }, { quoted: msg })
  }
  if (item.type === 'image') {
    return sock.sendMessage(msg.chat, { image: got.buf, ...(caption ? { caption } : {}) }, { quoted: msg })
  }
  return sock.sendMessage(msg.chat, {
    video: got.buf,
    mimetype: 'video/mp4',
    ...(item.type === 'gif' ? { gifPlayback: true } : {}),
    ...(caption ? { caption } : {})
  }, { quoted: msg })
}

export default {
  command: ['x', 'twitter', 'xdownloader', 'xdl', 'tw'],
  category: 'downloader',
  description: 'Descarga videos e imágenes de X/Twitter.',
  run: async ({ msg, sock, args, usedPrefix, command }) => {
    console.error('[x] Luffy7 v1.1.17 fx/vx + yt-dlp opcional')
    const p = usedPrefix || '#'
    if (!args.length) {
      return msg.reply(`✎ Ingresa un enlace de *X/Twitter*.\n> Ejemplo: *${p}${command || 'x'} https://x.com/usuario/status/123*`)
    }

    let raw = args.find(a => STATUS_RE.test(a)) || args.find(a => TCO_RE.test(a))
    if (raw && !STATUS_RE.test(raw)) raw = await resolveTco(raw.match(TCO_RE)[0])
    const parsed = parseTweet(raw)
    if (!parsed) {
      return msg.reply('✿ El enlace no parece *válido*. Usa un link de *x.com* o *twitter.com* con /status/…')
    }
    const { id, user } = parsed
    const link = `https://x.com/${user}/status/${id}`

    let info = null
    let lastErr = ''
    for (const fn of [fromFx, fromVx]) {
      try {
        info = await fn(id, user)
        if (info.media.length) break
      } catch (e) {
        lastErr = e?.message || String(e)
        console.error(`[x] ${fn.name}`, lastErr)
      }
    }

    try {
      if (!info || !info.media.length) {
        // Último recurso: yt-dlp (solo video)
        try {
          const buf = await fromYtDlp(link)
          const cap = info ? buildCaption(info) : `🎬 X/Twitter (yt-dlp)\n${link}`
          const got = { buf, asDoc: buf.length > MAX_SEND }
          await sendOne(sock, msg, { type: 'video' }, got, cap, 0)
          return
        } catch (e) {
          console.error('[x] yt-dlp', e?.message || e)
        }
        if (info) return msg.reply(`《✧》 Ese post no tiene *videos ni imágenes* para descargar.\n${info.link}`)
        return msg.reply(`《✧》 No pude obtener el post. Puede ser *privado*, estar *eliminado* o tener restricción de edad.\n${link}${lastErr ? `\n> ${lastErr}` : ''}`)
      }

      const caption = buildCaption(info)
      const items = info.media.slice(0, MAX_MEDIA)
      let sent = 0
      const failed = []
      for (let i = 0; i < items.length; i++) {
        try {
          const got = await fetchMedia(items[i])
          await sendOne(sock, msg, items[i], got, i === 0 ? caption : '', i)
          sent++
        } catch (e) {
          console.error('[x] media', i, e?.message || e)
          const m = String(e?.message || e)
          if (m.startsWith('TOO_HEAVY:')) {
            failed.push(`《✧》 El archivo ${i + 1} pesa ~${m.split(':')[1]} MB y no cabe en WhatsApp.\n${e.url || info.link}`)
          } else {
            failed.push(`《✧》 No pude enviar el archivo ${i + 1}.`)
          }
        }
      }
      if (failed.length) await msg.reply(failed.join('\n\n') + (sent ? '' : `\n${info.link}`))
    } catch (e) {
      console.error('[x]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
