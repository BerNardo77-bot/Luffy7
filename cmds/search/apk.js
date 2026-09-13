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

function sizeMb(size) {
  const n = parseFloat(String(size || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}

export default {
  command: ['aptoide', 'apk', 'apkdl'],
  category: 'search',
  run: async ({ msg, sock, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return msg.reply('✎ Uso: #apk <nombre de la app>\nEjemplo: #apk WhatsApp')
    }

    if (/^https?:\/\//i.test(query)) {
      return msg.reply(
        `✎ Link APK detectado\n\n${query}\n\n` +
          `Abre el link para descargar. WhatsApp a veces no puede subir APKs muy grandes.`
      )
    }

    await msg.reply('✎ Buscando APK...')
    const base = apiBase()
    let last = 'Sin resultados'

    try {
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/apk?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url)
          const json = await res.json().catch(() => ({}))
          const data = json?.data
          if (!json?.status || !data?.name || !data?.dl) {
            last = json?.message || last
            continue
          }

          const mb = sizeMb(data.size)
          const info =
            `✿ *APK*\n\n` +
            `❖ Nombre › ${data.name}\n` +
            `❖ Paquete › ${data.package || '?'}\n` +
            `❖ Actualización › ${data.lastUpdated || '?'}\n` +
            `❖ Tamaño › ${data.size || '?'}\n` +
            `❖ Link › ${data.dl}`

          await msg.reply(info)

          // WhatsApp aguanta más que Telegram, pero 200+ MB suele fallar/timeout
          if (mb != null && mb > 90) {
            await msg.reply(
              `✎ Pesa *${data.size}*: no lo subo por WhatsApp (se cuelga).\n` +
                `Abre el *link* de arriba en el navegador para descargarlo.`
            )
            return
          }

          try {
            await sock.sendMessage(
              msg.chat,
              {
                document: { url: data.dl },
                fileName: `${String(data.name).replace(/[^\w.\- ]+/g, '')}.apk`,
                mimetype: 'application/vnd.android.package-archive',
                caption: typeof global !== 'undefined' && global.dev ? global.dev : 'Luffy7'
              },
              { quoted: msg }
            )
          } catch (e) {
            console.error('[apk] document', e?.message || e)
            await msg.reply('✎ No pude subir el archivo. Usa el link de arriba.')
          }
          return
        } catch (e) {
          last = e.message || last
        }
      }
      await msg.reply(`✎ No encontré la app *${query}*.\n${last}`)
    } catch (e) {
      console.error('[apk]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
