import { replyDlError } from '../../lib/oversize.js'
import { urlToFile, rmQuiet, mb as mbTxt, MAX_FILE_BYTES } from '../../lib/mediadl.js'
import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js';

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
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    const query = args.join(' ').trim()
    if (!query) {
      return msg.reply(`✎ Uso: ${P}apk <nombre de la app>\nEjemplo: ${P}apk WhatsApp`)
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

          // Se baja a disco y se sube como documento (hasta 1950 MB); más grande → opciones
          const fileName = `${String(data.name).replace(/[^\w.\- ]+/g, '').trim() || 'app'}.apk`
          if (mb != null && mb * 1024 * 1024 > MAX_FILE_BYTES) {
            return replyDlError({ msg, sock, e: new Error(`TOO_BIG:${mb}`), url: String(data.dl), direct: true, fileName, video: false })
          }
          let got = null
          try {
            if (mb > 64) await msg.reply(`✎ Descargando ${data.size}…`).catch(() => {})
            got = await urlToFile(String(data.dl), { ext: 'apk', tag: 'apk' })
            await sock.sendMessage(msg.chat, { document: { url: got.file }, fileName, mimetype: 'application/vnd.android.package-archive', caption: `${data.name} · ${mbTxt(got.size)} MB` }, { quoted: msg })
          } catch (e) {
            console.error('[apk] document', e?.message || e)
            if (/^(TOO_BIG|NO_SPACE):/.test(String(e?.message))) return replyDlError({ msg, sock, e, url: String(data.dl), direct: true, fileName, video: false })
            await msg.reply('✎ No pude subir el archivo. Usa el link de arriba.')
          } finally { if (got) rmQuiet(got.file) }
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
