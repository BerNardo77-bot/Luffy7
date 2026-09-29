import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js';
import { miniaturaYouTube } from '../../lib/ytMiniatura.js';

const FALLBACK_KEY = 'LUFFY-FIX67'
// Cuántos resultados se mandan (cada uno es un mensaje con su miniatura)
const MAX_RESULTADOS = 5
// Pausa entre mensajes para no hacer spam ni chocar con el límite de WhatsApp
const PAUSA_MS = 700

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

// Pie de foto de un resultado
function textoResultado(v, i, total) {
  const title = v.title || '?'
  const author = v.autor || v.author?.name || v.author || v.channel || ''
  const dur = v.duration || v.timestamp || ''
  // Los directos llegan con 0 vistas y sin duración: no se muestran esos campos
  const views = v.views && String(v.views) !== '0' ? v.views : ''
  const up = v.uploaded || v.ago || ''
  const link = v.url || ''
  return (
    `➩ *${i + 1}/${total}. ${title}*\n` +
    (dur ? `> ✤ Duración › ${dur}\n` : '') +
    (author ? `> ❀ Canal › ${author}\n` : '') +
    (views ? `> ꕥ Vistas › ${views}\n` : '') +
    (up ? `> ✰ Subido › ${up}\n` : '') +
    `> ❑ Enlace › ${link}`
  ).slice(0, 1000)
}

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

export default {
  command: ['ytsearch', 'search', 'yts'],
  category: 'search',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    const query = args.join(' ').trim()
    if (!query) {
      return msg.reply(`✎ Uso: ${P}ytsearch <texto>\nEjemplo: ${P}ytsearch quien es Anubis`)
    }

    const status = await msg.reply('✎ Buscando en YouTube...')
    const base = apiBase()
    let last = 'Sin resultados'

    // 1) Búsqueda: si falla aquí es que de verdad no hubo resultados
    let top = null
    for (const key of apiKeys()) {
      try {
        const url = `${base}/search/yt?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        const json = await res.json().catch(() => ({}))
        const list = json?.result || json?.data || []
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
    if (!top) return msg.reply(`✎ No encontré videos para *${query}*.\n${last}`)

    // 2) Envío: un mensaje por resultado. Miniaturas en paralelo; si una falla, ese resultado va en texto
    try {
      const miniaturas = await Promise.all(
        top.map((v) => miniaturaYouTube(v.videoId, v.url, v.banner || v.thumbnail || v.image).catch(() => null))
      )
      try {
        await sock.sendMessage(msg.chat, { text: `✎ ${top.length} resultado${top.length === 1 ? '' : 's'} para *${query}*:`, edit: status.key })
      } catch {}

      for (let i = 0; i < top.length; i++) {
        if (i > 0) await esperar(PAUSA_MS)
        const caption = textoResultado(top[i], i, top.length)
        const thumb = miniaturas[i]
        try {
          if (thumb) {
            await sock.sendMessage(msg.chat, { image: thumb.buffer, mimetype: thumb.mimetype, caption }, { quoted: msg })
            continue
          }
        } catch (e) {
          console.error(`[ytsearch] miniatura ${i + 1} no enviada, mando texto:`, e?.message || e)
        }
        try {
          await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg })
        } catch (e) {
          console.error(`[ytsearch] resultado ${i + 1} no enviado:`, e?.message || e)
        }
      }
    } catch (e) {
      console.error('[ytsearch] envío', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
