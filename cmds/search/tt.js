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
  command: ['tiktoksearch', 'ttsearch', 'tts'],
  category: 'search',
  run: async ({ msg, sock, args }) => {
    const query = args.join(' ').trim()
    if (!query) return msg.reply('✎ Uso: #ttsearch <texto>')

    await msg.reply('✎ Buscando en TikTok...')
    const base = apiBase()
    let last = 'Sin resultados'

    try {
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/tiktok?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const json = await res.json().catch(() => ({}))
          const list = json?.data || json?.result || []
          if (!json?.status || !Array.isArray(list) || !list.length) {
            last = json?.message || last
            continue
          }

          const top = list.slice(0, 5)
          let message = `❑ *TikTok Search*\n> ✿ ${query}\n\n`
          top.forEach((result, index) => {
            const author = result.author || {}
            const stats = result.stats || {}
            const nick = author.nickname || author.name || '?'
            const uid = author.unique_id || author.uniqueId || author.id || ''
            const id = result.id || ''
            message += `➩ *Título ›* ${result.title || '?'}\n\n`
            message += `𖹭 ✿ Autor › ${nick}${uid ? ` (@${uid})` : ''}\n`
            message += `𖹭 ✤ Views › ${stats.views ?? '?'}\n`
            message += `𖹭 ✰ Likes › ${stats.likes ?? '?'}\n`
            message += `𖹭 ⚡︎ Duración › ${result.duration ?? '?'}\n`
            if (uid && id) {
              message += `𖹭 ❑ URL › https://www.tiktok.com/@${uid}/video/${id}\n`
            } else if (result.url) {
              message += `𖹭 ❑ URL › ${result.url}\n`
            }
            if (index < top.length - 1) message += `\n╾۪〬─ ┄─〬 ׅ┄─ׄ─۪〬 ┈┄─ׄ〬╼\n\n`
          })
          await msg.reply(message.slice(0, 3500))
          return
        } catch (e) {
          last = e.message || last
        }
      }
      await msg.reply(`✎ No encontré resultados para *${query}*.\n${last}`)
    } catch (e) {
      console.error('[ttsearch]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
