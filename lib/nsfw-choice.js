// Miniaturas de la lista de xvideos / xnxx. Solo la imagen que ya trae la API.
import fetch from 'node-fetch'
import { esImagen } from './gachaImagen.js'
import { itemCaption } from './nsfw-pick.js'

const MAX_THUMB = 2 * 1024 * 1024
const PAUSA_MS = 500

// Buffer solo si los magic bytes son JPEG o PNG. No baja el video.
export async function bajarMiniatura(url) {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  if (/\.(mp4|m3u8|webm|mkv|ts|m4v)(\?|$)/i.test(u)) return null
  try {
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5'
      },
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) return null
    const ctype = String(res.headers.get('content-type') || '')
    if (/^video\//i.test(ctype)) {
      res.body?.destroy?.()
      return null
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_THUMB) {
      res.body?.destroy?.()
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (!buffer.length || buffer.length > MAX_THUMB) return null
    const mimetype = esImagen(buffer)
    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') return null
    return { buffer, mimetype }
  } catch {
    return null
  }
}

// Un mensaje por resultado (imagen + pie, o texto si no hay miniatura usable).
// prefix es el símbolo en uso (lib/prefijo.js); no se asume "#".
export async function enviarOpciones({ msg, sock, items, cmd, prefix = '' }) {
  const shown = (items || []).slice(0, 5)
  const p = prefix == null ? '' : String(prefix)
  await msg.reply(
    `Ningún título trae todas las palabras de la búsqueda.\n` +
    `Elige un número o manda la url. No se descarga solo.\n\n` +
    `Responde con el número (ej. 2, vale 5 min) o envía ${p}${cmd} <url>`
  )
  for (let i = 0; i < shown.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, PAUSA_MS))
    const caption = itemCaption(shown[i], i)
    const img = await bajarMiniatura(shown[i]?.thumb)
    if (img) {
      try {
        await sock.sendMessage(msg.chat, {
          image: img.buffer,
          mimetype: img.mimetype,
          caption
        }, { quoted: msg })
        continue
      } catch (e) {
        console.error(`[${cmd}] miniatura`, e?.message || e)
      }
    }
    try {
      await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg })
    } catch (e) {
      console.error(`[${cmd}] texto`, e?.message || e)
      await msg.reply(caption).catch(() => {})
    }
  }
}
