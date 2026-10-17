import fs from 'fs'
import os from 'os'
import path from 'path'
import { voiceTranslate, vtFormat, vtCleanup, vtErrorText, vtUsage, parseVoiceArgs, vtTranslate, vtLangName, vtLangList, VT_MAX_SEC } from '../../lib/voice-translate-core.js'

// traducir / traduce / tr / translate
// • Respondiendo a una nota de voz, audio o video: lo pasa a texto, lo traduce y regresa texto + nota de voz.
// • Respondiendo a un texto (o con texto después del idioma): traduce el texto.
const jobs = new Map()

function mediaOf(m) {
  if (!m) return null
  const mime = m.mime || m.mimetype || m.msg?.mimetype || ''
  if (/^(audio|video)\//.test(mime)) return { m, mime, seconds: Number(m.msg?.seconds || 0) }
  return null
}

export default {
  command: ['traducir', 'traduce', 'tr', 'translate', 'traductor'],
  category: 'utils',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = usedPrefix || '$'
    const media = mediaOf(msg.quoted) || mediaOf(msg)
    const words = (args || []).filter(Boolean)

    if (!media) {
      // Traducción de texto (como antes)
      const first = parseVoiceArgs(words[0] || '')
      let target = first.target
      let text = target ? words.slice(1).join(' ') : words.join(' ')
      if (!text && msg.quoted?.text) text = msg.quoted.text
      if (!text) return msg.reply(vtUsage(P))
      try {
        let r
        if (target) r = await vtTranslate(text, target)
        else {
          // Sin idioma: español → inglés, cualquier otro → español
          r = await vtTranslate(text, 'es')
          target = 'es'
          if (String(r.src || '').startsWith('es')) { r = await vtTranslate(text, 'en', 'es'); target = 'en' }
        }
        return sock.sendMessage(msg.chat, { text: `🌐 *${vtLangName(target)}:*\n${r.text}` }, { quoted: msg })
      } catch (e) {
        return msg.reply(vtErrorText(e))
      }
    }

    const opt = parseVoiceArgs(words.join(' '))
    if (opt.unknown) return msg.reply(`《✧》 No conozco el idioma *${opt.unknown}*.\nUsa uno de estos: ${vtLangList()}\nEjemplo: ${P}traducir en`)
    if (media.seconds > VT_MAX_SEC + 60) await msg.reply(`⚠️ Ese audio dura ${Math.round(media.seconds / 60)} min; solo voy a traducir los primeros ${Math.round(VT_MAX_SEC / 60)} minutos.`)

    const key = String(msg.chat)
    if (jobs.get(key) >= 2) return msg.reply('《✧》 Ya estoy traduciendo audios en este chat. Espera a que termine.')
    jobs.set(key, (jobs.get(key) || 0) + 1)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtin-'))
    let res = null
    try {
      await msg.reply('🎙️ Escuchando el audio…')
      const buf = await media.m.download()
      if (!buf?.length) throw new Error('No pude descargar el audio. Mándalo otra vez.')
      const ext = /ogg|opus/.test(media.mime) ? 'ogg' : /mp4|m4a|aac/.test(media.mime) ? 'm4a' : /mpeg|mp3/.test(media.mime) ? 'mp3' : /video/.test(media.mime) ? 'mp4' : 'bin'
      const input = path.join(dir, 'audio.' + ext)
      fs.writeFileSync(input, buf)
      res = await voiceTranslate(input, { target: opt.target, source: opt.source })
      await sock.sendMessage(msg.chat, { text: vtFormat(res) }, { quoted: msg })
      if (res.ogg) {
        await sock.sendMessage(msg.chat, { audio: fs.readFileSync(res.ogg), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg })
      }
      console.log(`[traducir] ${res.source}→${res.target} ${Math.round(res.seconds)}s`)
    } catch (e) {
      console.error('[traducir]', e?.message || e)
      const et = vtErrorText(e)
      await msg.reply(et.startsWith('🎙️') ? et : et + `\n\n✎ Tip: si el idioma salió mal, dile cuál es, por ejemplo: ${P}traducir es>en o ${P}traducir pt>es`).catch(() => {})
    } finally {
      vtCleanup(res?.dir)
      vtCleanup(dir)
      const n = (jobs.get(key) || 1) - 1
      if (n <= 0) jobs.delete(key); else jobs.set(key, n)
    }
  }
}
