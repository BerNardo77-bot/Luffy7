import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { prefijoActual } from '../../lib/prefijo.js'
import { esImagen } from '../../lib/gachaImagen.js'
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js'
import tiktok from '../dl/tiktok.js'

const execFileAsync = promisify(execFile)

const FALLBACK_KEY = 'LUFFY-FIX67'
// Igual que ytsearch: hasta 10. La API a veces devuelve menos.
const MAX_RESULTADOS = 10
const PAUSA_MS = 700
const TT_SITE = 'tiktok'
const MAX_THUMB = 2 * 1024 * 1024

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

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

function httpUrl(v, depth = 0) {
  if (depth > 3 || v == null) return ''
  if (typeof v === 'string') {
    const s = v.trim()
    return /^https?:\/\//i.test(s) ? s : ''
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const u = httpUrl(item, depth + 1)
      if (u) return u
    }
    return ''
  }
  if (typeof v === 'object') {
    for (const k of ['url', 'src', 'cover', 'originCover', 'origin_cover', 'thumbnail', 'image']) {
      const u = httpUrl(v[k], depth + 1)
      if (u) return u
    }
  }
  return ''
}

const COVER_KEYS = ['cover', 'origin_cover', 'originCover', 'dynamic_cover', 'dynamicCover', 'thumbnail', 'thumb', 'thumbnailUrl', 'image', 'img', 'poster']
const VIDEO_URL = /\.(mp4|m3u8|webm|mkv|ts|m4v)(\?|$)/i

function esUrlDeVideo(u) {
  return VIDEO_URL.test(String(u || ''))
}

// Todas las portadas http, en orden. cover primero, luego origin_cover / thumbnail y video.cover.
// No usa el avatar del autor ni el mp4. Si una falla, se prueba la siguiente.
function coverCandidates(result) {
  const out = []
  const seen = new Set()
  const add = (v) => {
    const u = httpUrl(v)
    if (!u || seen.has(u) || esUrlDeVideo(u)) return
    seen.add(u)
    out.push(u)
  }
  if (!result || typeof result !== 'object') return out
  const roots = [result, result.video, result.videoMeta, result.aweme]
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    for (const k of COVER_KEYS) add(root[k])
  }
  return out
}

function resultUrl(result) {
  const direct = String(result?.url || result?.link || result?.webVideoUrl || '').trim()
  if (/^https?:\/\//i.test(direct) && /tiktok\.com/i.test(direct)) return direct.split(/\s/)[0]
  const author = result?.author && typeof result.author === 'object' ? result.author : {}
  const uid = author.unique_id || author.uniqueId || author.id || ''
  const id = result?.id || result?.video_id || result?.aweme_id || ''
  if (uid && id) return `https://www.tiktok.com/@${uid}/video/${id}`
  return /^https?:\/\//i.test(direct) ? direct.split(/\s/)[0] : ''
}

function autorDe(result) {
  const author = result?.author
  if (typeof author === 'string') return author.trim()
  const nick = String(author?.nickname || author?.name || author?.nickName || '').trim()
  const uid = String(author?.unique_id || author?.uniqueId || '').replace(/^@/, '').trim()
  if (nick && uid) return `${nick} (@${uid})`
  return nick || (uid ? `@${uid}` : '')
}

function duracionDe(result) {
  const d = result?.duration ?? result?.video?.duration ?? ''
  if (d == null || d === '') return ''
  if (typeof d === 'number' && Number.isFinite(d)) {
    const sec = d > 1000 ? Math.round(d / 1000) : Math.round(d)
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return String(d).trim()
}

function rememberResults(msg, list) {
  const items = []
  for (const v of (list || []).slice(0, MAX_RESULTADOS)) {
    const url = resultUrl(v)
    if (!url) continue
    items.push({
      title: String(v.title || v.desc || 'Sin título').replace(/\s+/g, ' ').trim().slice(0, 300),
      url
    })
  }
  if (!items.length) return 0
  // La lista nueva pisa la anterior (mismo mapa que ytsearch / xvideos).
  savePick(msg.chat, { sender: msg.sender, site: TT_SITE, items, msg, fromMe: msg.fromMe })
  return items.length
}

function textoResultado(v, i, total) {
  const title = String(v.title || v.desc || '?').replace(/\s+/g, ' ').trim()
  const author = autorDe(v)
  const dur = duracionDe(v)
  const link = resultUrl(v)
  return (
    `➩ *${i + 1}/${total}. ${title}*\n` +
    (author ? `> ❀ Autor › ${author}\n` : '') +
    (dur ? `> ✤ Duración › ${dur}\n` : '') +
    `> ❑ Enlace › ${link}`
  ).slice(0, 1000)
}

let sharpMod

// HEIC/AVIF no entran en esImagen (solo JPEG/PNG/GIF/WEBP).
function tipoBinario(buf) {
  const m = esImagen(buf)
  if (m) return m
  if (!buf || buf.length < 12) return ''
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 16).toString('ascii')
    if (/heic|heix|heif|mif1|msf1/i.test(brand)) return 'image/heic'
    if (/avif|avis/i.test(brand)) return 'image/avif'
  }
  return ''
}

async function jpegConSharp(buffer) {
  try {
    if (sharpMod === undefined) {
      try { sharpMod = (await import('sharp')).default } catch { sharpMod = null }
    }
    if (!sharpMod) return { skip: true }
    const out = await sharpMod(buffer, { animated: false, failOn: 'none' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82 })
      .toBuffer()
    if (esImagen(out) === 'image/jpeg') return { buffer: out, mimetype: 'image/jpeg' }
    return { error: 'sharp no produjo JPEG' }
  } catch (e) {
    return { error: e?.message || String(e) }
  }
}

async function jpegConFfmpeg(buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttcover-'))
  const inp = path.join(dir, 'in.img')
  const out = path.join(dir, 'out.jpg')
  try {
    fs.writeFileSync(inp, buffer)
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inp,
      '-frames:v', '1',
      '-q:v', '3',
      out
    ], { timeout: 20000 })
    if (!fs.existsSync(out)) return { error: 'ffmpeg no escribió el JPEG' }
    const jpeg = fs.readFileSync(out)
    if (esImagen(jpeg) !== 'image/jpeg') return { error: 'ffmpeg no produjo JPEG' }
    return { buffer: jpeg, mimetype: 'image/jpeg' }
  } catch (e) {
    return { error: e?.message || String(e) }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

// WEBP/GIF/HEIC/AVIF → JPEG. sharp si carga; si no (o si falla), ffmpeg.
// Si ninguno puede, un log y null para probar el siguiente campo.
async function aJpeg(buffer, url) {
  const sharpRes = await jpegConSharp(buffer)
  if (sharpRes.buffer) return { buffer: sharpRes.buffer, mimetype: 'image/jpeg' }
  const ff = await jpegConFfmpeg(buffer)
  if (ff.buffer) return { buffer: ff.buffer, mimetype: 'image/jpeg' }
  const why = [
    sharpRes.skip ? 'sharp no está' : `sharp: ${sharpRes.error}`,
    `ffmpeg: ${ff.error}`
  ].join('; ')
  console.error(`[ttsearch] no pude convertir la portada a JPEG (${why}) url=${String(url || '').slice(0, 140)}`)
  return null
}

// JPEG/PNG se mandan tal cual. WEBP (lo que devuelve TikTok en cover) y HEIC se convierten.
async function bajarPortada(url) {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  if (esUrlDeVideo(u)) return null
  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'image/jpeg,image/png,image/webp,image/heic,image/*;q=0.8,*/*;q=0.5'
      },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) {
      console.error(`[ttsearch] portada HTTP ${res.status}, pruebo otro campo`)
      return null
    }
    const ctype = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (/^video\//i.test(ctype)) {
      res.body?.destroy?.()
      console.error('[ttsearch] portada es video, pruebo otro campo')
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_THUMB) {
      console.error(`[ttsearch] portada vacía o grande (${buffer.length}), pruebo otro campo`)
      return null
    }
    const tipo = tipoBinario(buffer)
    if (tipo === 'image/jpeg' || tipo === 'image/png') return { buffer, mimetype: tipo }
    if (tipo === 'image/webp' || tipo === 'image/gif' || tipo === 'image/heic' || tipo === 'image/avif') {
      return await aJpeg(buffer, u)
    }
    console.error(`[ttsearch] portada no usable (${tipo || ctype || 'desconocido'}), pruebo otro campo`)
    return null
  } catch (e) {
    console.error('[ttsearch] portada', e?.message || e)
    return null
  }
}

async function primeraPortada(result) {
  const urls = coverCandidates(result)
  for (const u of urls) {
    const got = await bajarPortada(u)
    if (got) return got
  }
  return null
}

async function takeNumber({ msg, sock, usedPrefix }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== TT_SITE) return false
  if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
    await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
    return true
  }
  const item = hit.items[n - 1]
  if (!item?.url) {
    await msg.reply('Ese resultado no tiene enlace.')
    return true
  }
  clearPick(msg)
  try {
    await tiktok.run({ msg, sock, args: [item.url], command: 'tiktok', usedPrefix })
  } catch (e) {
    console.error('[ttsearch] descarga', e?.message || e)
    await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
  }
  return true
}

export async function before(ctx) {
  try {
    return await takeNumber(ctx)
  } catch (e) {
    console.error('[ttsearch] pick', e?.message || e)
    let ours = false
    try {
      const hit = readPick(ctx?.msg)
      ours = !!(hit && hit.site === TT_SITE && bareNumber(ctx?.msg) != null)
    } catch {}
    if (!ours) return false
    try { await ctx.msg.reply(`《✧》 Error: ${e?.message || e}`) } catch {}
    return true
  }
}

export default {
  command: ['tiktoksearch', 'ttsearch', 'tts'],
  category: 'search',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[ttsearch] build 1.1.35 portada webp a jpeg', P)
    const query = args.join(' ').trim()
    if (!query) return msg.reply(`✎ Uso: ${P}ttsearch <texto>`)

    const status = await msg.reply('✎ Buscando en TikTok...')
    const base = apiBase()
    let last = 'Sin resultados'

    try {
      let top = null
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/tiktok?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
          const json = await res.json().catch(() => ({}))
          const list = json?.data || json?.result || []
          if (!json?.status || !Array.isArray(list) || !list.length) {
            last = json?.message || last
            continue
          }
          top = list.slice(0, MAX_RESULTADOS)
          break
        } catch (e) {
          last = e.message || last
        }
      }
      if (!top) return msg.reply(`✎ No encontré resultados para *${query}*.\n${last}`)

      const guardados = rememberResults(msg, top)
      const portadas = await Promise.all(top.map((v) => primeraPortada(v).catch((e) => {
        console.error('[ttsearch] portada', e?.message || e)
        return null
      })))

      try {
        const rango = guardados ? ` Responde con un número del 1 al ${guardados} (vale 5 min) para descargarlo.` : ''
        await sock.sendMessage(msg.chat, {
          text: `✎ ${top.length} resultado${top.length === 1 ? '' : 's'} para *${query}*.${rango}`,
          edit: status.key
        })
      } catch {}

      for (let i = 0; i < top.length; i++) {
        if (i > 0) await esperar(PAUSA_MS)
        const caption = textoResultado(top[i], i, top.length)
        const thumb = portadas[i]
        try {
          if (thumb) {
            await sock.sendMessage(msg.chat, { image: thumb.buffer, mimetype: thumb.mimetype, caption }, { quoted: msg })
            continue
          }
        } catch (e) {
          console.error(`[ttsearch] miniatura ${i + 1} no enviada, mando texto:`, e?.message || e)
        }
        try {
          await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg })
        } catch (e) {
          console.error(`[ttsearch] resultado ${i + 1} no enviado:`, e?.message || e)
        }
      }
    } catch (e) {
      console.error('[ttsearch]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
