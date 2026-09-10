import fetch from 'node-fetch'

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
  run: async ({ msg, sock, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return msg.reply('✎ Uso: #ytsearch <texto>\nEjemplo: #ytsearch quien es Anubis')
    }

    const status = await msg.reply('✎ Buscando en YouTube...')
    const base = apiBase()
    let last = 'Sin resultados'

    try {
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/yt?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const json = await res.json().catch(() => ({}))
          const list = json?.result || json?.data || []
          if (!json?.status || !Array.isArray(list) || !list.length) {
            last = json?.message || last
            continue
          }

          const top = list.slice(0, 8)
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

          const thumb = top[0]?.banner || top[0]?.thumbnail || top[0]?.image
          if (thumb) {
            await sock.sendMessage(
              msg.chat,
              { image: { url: thumb }, caption: caption.slice(0, 3500) },
              { quoted: msg }
            )
          } else {
            await msg.reply(caption.slice(0, 3500))
          }
          try {
            await sock.sendMessage(msg.chat, { text: '✎ Listo.', edit: status.key })
          } catch {}
          return
        } catch (e) {
          last = e.message || last
        }
      }

      await msg.reply(`✎ No encontré videos para *${query}*.\n${last}`)
    } catch (e) {
      console.error('[ytsearch]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
