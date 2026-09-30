import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js'
import { esImagen } from '../../lib/gachaImagen.js'
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js'
import tiktok from '../dl/tiktok.js'

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

// Portada del video (cover / thumbnail / image). No usa el avatar del autor ni el mp4.
function coverUrl(result) {
  if (!result || typeof result !== 'object') return ''
  const keys = ['cover', 'origin_cover', 'originCover', 'thumbnail', 'thumb', 'thumbnailUrl', 'image', 'img', 'poster']
  const roots = [result, result.video, result.videoMeta, result.aweme]
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    for (const k of keys) {
      const u = httpUrl(root[k])
      if (u && !/\.(mp4|m3u8|webm|mkv|ts|m4v)(\?|$)/i.test(u)) return u
    }
  }
  return ''
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
async function aJpeg(buffer) {
  try {
    if (sharpMod === undefined) {
      try { sharpMod = (await import('sharp')).default } catch { sharpMod = null }
    }
    if (!sharpMod) return null
    const out = await sharpMod(buffer, { animated: false }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
    return esImagen(out) === 'image/jpeg' ? { buffer: out, mimetype: 'image/jpeg' } : null
  } catch {
    return null
  }
}

// Solo se manda imagen si el buffer final es JPEG o PNG.
// La portada de la API suele ser WEBP: se convierte a JPEG. Si no se puede, texto.
async function bajarPortada(url) {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  if (/\.(mp4|m3u8|webm|mkv|ts|m4v)(\?|$)/i.test(u)) return null
  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5'
      },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null
    const ctype = String(res.headers.get('content-type') || '')
    if (/^video\//i.test(ctype)) {
      res.body?.destroy?.()
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_THUMB) return null
    const mimetype = esImagen(buffer)
    if (mimetype === 'image/jpeg' || mimetype === 'image/png') return { buffer, mimetype }
    if (mimetype === 'image/webp' || mimetype === 'image/gif') return await aJpeg(buffer)
    return null
  } catch {
    return null
  }
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
    console.error('[ttsearch] build 1.1.34 numero descarga miniatura', P)
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
      const portadas = await Promise.all(top.map((v) => bajarPortada(coverUrl(v)).catch(() => null)))

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
