import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js';
import { miniaturaYouTube } from '../../lib/ytMiniatura.js';

const FALLBACK_KEY = 'LUFFY-FIX67'

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
        top = list.slice(0, 8)
        break
      } catch (e) {
        last = e.message || last
      }
    }
    if (!top) return msg.reply(`✎ No encontré videos para *${query}*.\n${last}`)

    const caption =
      `❑ *YouTube Search*\n> ✿ ${query}\n\n` +
      top
        .map((v, i) => {
          const title = v.title || '?'
          const author = v.autor || v.author || v.channel || ''
          const dur = v.duration || v.timestamp || '?'
          const views = v.views || '?'
          const up = v.uploaded || v.ago || ''
          const link = v.url || ''
          return (
            `➩ *${i + 1}. ${title}*\n` +
            `> ✤ Duración › ${dur}\n` +
            (up ? `> ✰ Subido › ${up}\n` : '') +
            `> ꕥ Vistas › ${views}\n` +
            (author ? `> ❀ Autor › ${author}\n` : '') +
            `> ❑ Url › ${link}`
          )
        })
        .join('\n\n╾۪〬─ ┄─〬 ׅ┄─ׄ─۪〬 ┈┄─ׄ〬╼\n\n')
        .slice(0, 3500)

    // 2) Envío: la miniatura se descarga y valida; si falla, los resultados van solo en texto
    try {
      const first = top[0] || {}
      const thumb = await miniaturaYouTube(first.videoId, first.url, first.banner || first.thumbnail || first.image)
      let enviado = false
      if (thumb) {
        try {
          await sock.sendMessage(msg.chat, { image: thumb.buffer, mimetype: thumb.mimetype, caption }, { quoted: msg })
          enviado = true
        } catch (e) {
          console.error('[ytsearch] miniatura no enviada, mando texto:', e?.message || e)
        }
      }
      if (!enviado) await msg.reply(caption)
      try {
        await sock.sendMessage(msg.chat, { text: '✎ Listo.', edit: status.key })
      } catch {}
    } catch (e) {
      console.error('[ytsearch] envío', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
