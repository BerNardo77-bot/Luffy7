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
  command: ['pinterest', 'pin'],
  category: 'search',
  run: async ({ msg, sock, args }) => {
    const text = args.join(' ').trim()
    if (!text) {
      return msg.reply('✎ Uso: #pin <texto> o #pin <link de Pinterest>')
    }

    const base = apiBase()
    const isUrl = /^https?:\/\//i.test(text)
    await msg.reply(isUrl ? '✎ Descargando Pinterest...' : '✎ Buscando en Pinterest...')

    try {
      for (const key of apiKeys()) {
        try {
          if (isUrl) {
            const url = `${base}/dl/pinterest?url=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
            const res = await fetch(url)
            const json = await res.json().catch(() => ({}))
            const result = json?.data || json?.result
            const dl = result?.dl || result?.url
            if (!dl) continue
            const mediaType = ['image', 'video'].includes(result?.type) ? result.type : 'image'
            await sock.sendMessage(
              msg.chat,
              { [mediaType]: { url: dl }, caption: null },
              { quoted: msg }
            )
            return
          }

          const url = `${base}/search/pinterest?query=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const json = await res.json().catch(() => ({}))
          const results = json?.data || []
          if (!json?.status || !results.length) continue

          const medias = []
          for (const result of results.slice(0, 8)) {
            const img = result.hd || result.url || result.mini
            if (!img) continue
            const caption =
              `✿ Pinterest\n` +
              (result.title ? `Título › ${result.title}\n` : '') +
              (result.full_name ? `Autor › ${result.full_name}\n` : '') +
              (result.likes != null ? `Likes › ${result.likes}` : '')
            medias.push({ type: 'image', data: { url: img }, caption })
          }

          if (medias.length && typeof sock.sendAlbumMessage === 'function') {
            await sock.sendAlbumMessage(msg.chat, medias, { quoted: msg })
          } else if (medias[0]) {
            await sock.sendMessage(
              msg.chat,
              { image: medias[0].data, caption: medias[0].caption },
              { quoted: msg }
            )
          } else {
            continue
          }
          return
        } catch (e) {
          console.error('[pin]', e?.message || e)
        }
      }
      await msg.reply(`✎ No encontré resultados para *${text}*`)
    } catch (e) {
      console.error('[pinterest]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
