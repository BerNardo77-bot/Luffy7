import db from '#db'
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
  command: ['imagen', 'img', 'image'],
  category: 'search',
  run: async ({ msg, sock, args }) => {
    const text = args.join(' ').trim()
    if (!text) return msg.reply('✎ Uso: #imagen <texto>')

    const banned = ['xxx', 'porn', 'porno', 'xnxx', 'xvideos', 'onlyfans', 'hentai']
    const chatData = await db.getChat(msg.chat)
    const nsfwOn = chatData?.nsfw === 1
    if (!nsfwOn && banned.some((w) => text.toLowerCase().includes(w))) {
      return msg.reply('✤ Este comando no permite búsquedas NSFW (activa #nsfw enable en el grupo).')
    }

    await msg.reply('✎ Buscando imagen...')
    const base = apiBase()

    try {
      // 1) Google imagen Alyacore
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/googleimagen?query=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const ctype = (res.headers.get('content-type') || '').toLowerCase()
          if (res.ok && ctype.includes('image')) {
            const buffer = Buffer.from(await res.arrayBuffer())
            if (buffer.length > 256) {
              await sock.sendMessage(msg.chat, { image: buffer, caption: text }, { quoted: msg })
              return
            }
          }
        } catch {}
      }

      // 2) Fallback Pinterest
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/pinterest?query=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const json = await res.json().catch(() => ({}))
          const item = (json?.data || [])[0]
          const img = item?.hd || item?.url || item?.mini
          if (json?.status && img) {
            await sock.sendMessage(
              msg.chat,
              { image: { url: img }, caption: `✿ ${text}` },
              { quoted: msg }
            )
            return
          }
        } catch {}
      }

      await msg.reply(`✎ No encontré imagen para *${text}*`)
    } catch (e) {
      console.error('[imagen]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
