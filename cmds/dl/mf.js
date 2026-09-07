import db from "#db"
import fetch from 'node-fetch'

const FALLBACK_KEY = 'LUFFY-FIX67'
const MAX_SEND_BYTES = 64 * 1024 * 1024

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function getBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}

function parseSizeToBytes(filesize) {
  if (typeof filesize === 'number' && Number.isFinite(filesize)) return filesize
  const s = String(filesize || '').trim().toUpperCase().replace(',', '.')
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?/)
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  const unit = m[2] || 'B'
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
  return Math.round(n * (mult[unit] || 1))
}

export default {
  command: ['mf', 'mediafire'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    try {
      let text = args.join(' ').trim()
      if (!text) return msg.reply('Ingresa una URL de MediaFire.')
      if (!/^https?:\/\/(www\.)?mediafire\.com/i.test(text)) {
        return msg.reply('Solo se aceptan enlaces de MediaFire.')
      }

      const key = getKey()
      const apiUrl = `${getBase()}/dl/mediafire?url=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        timeout: 60000
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok || !json.status || !json.result) {
        return msg.reply(`No se pudo obtener el archivo.\n${json?.message || `HTTP ${res.status}`}`)
      }

      const { filename, filetype, filesize, uploaded, download } = json.result
      const bytes = parseSizeToBytes(filesize)

      let info = `*MEDIAFIRE*\n\n`
      info += `Archivo: *${filename || 'archivo'}*\n`
      info += `Tipo: *${filetype || '?'}*\n`
      info += `Tamano: *${filesize || '?'}*\n`
      info += `Subido: *${uploaded || '?'}*\n`

      if (!download) {
        return msg.reply(info + '\nNo vino enlace de descarga.')
      }

      // WhatsApp no puede enviar ~794MB ni nada cerca de eso
      if (bytes > MAX_SEND_BYTES) {
        info += `\nWhatsApp solo envia ~64 MB. Este archivo pesa *${filesize}* y no se puede mandar por el chat.\n\n`
        info += `Descargalo aqui:\n${download}`
        return msg.reply(info)
      }

      info += `\nDescargando y enviando (max ~64 MB)...`
      await msg.reply(info)

      try {
        await sock.sendMessage(
          msg.chat,
          {
            document: { url: download },
            mimetype: 'application/octet-stream',
            fileName: filename || 'archivo.bin'
          },
          { quoted: msg }
        )
      } catch (e) {
        console.error('[mf] send', e)
        await msg.reply(`No pude enviar el archivo por WhatsApp.\nAbrilo aqui:\n${download}`)
      }
    } catch (e) {
      console.error('[mf]', e)
      msg.reply(`Error: ${e?.message || e}`)
    }
  }
}
