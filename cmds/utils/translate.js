import fs from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { downloadContentFromMessage } from 'baileys'
import { imageTranslate } from '../../lib/ocr-core.js'
import { vtPronounce, voiceTranslate, vtMessages, vtCleanup, vtHms, vtEstimate, vtErrorText, vtUsage, parseVoiceArgs, vtTranslate, vtLangName, vtLangList, VT_MAX_SEC } from '../../lib/voice-translate-core.js'

// traducir / traduce / tr / translate
// • Respondiendo a una nota de voz, audio o video: lo pasa a texto, lo traduce y regresa texto + nota de voz.
// • Respondiendo a una imagen/captura/sticker (o mandándola con el comando): lee el texto (OCR) y lo traduce.
// • Respondiendo a un texto (o con texto después del idioma): traduce el texto.
const jobs = new Map()

function mediaOf(m) {
  if (!m) return null
  const mime = m.mime || m.mimetype || m.msg?.mimetype || ''
  if (/^(audio|video)\//.test(mime)) return { m, mime, seconds: Number(m.msg?.seconds || 0) }
  if (/^image\//.test(mime)) return { m, mime, image: true }
  return null
}

// Descarga directo a un archivo (sin juntar todo en la memoria del teléfono)
async function downloadTo(media, file) {
  const m = media.m
  const content = m.msg || m
  const type = String(m.type || media.mime.split('/')[0]).replace(/Message$/i, '')
  try {
    const stream = await downloadContentFromMessage(content, type)
    await pipeline(stream, fs.createWriteStream(file))
  } catch (e) {
    // Plan B: la descarga normal del bot
    console.error('[traducir] descarga por partes falló:', e?.message || e)
    const buf = await m.download()
    if (!buf?.length) throw e
    fs.writeFileSync(file, buf)
  }
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0
  if (!size) throw new Error(media.image ? 'No pude descargar la imagen. Mándala otra vez.' : 'No pude descargar el audio. Mándalo otra vez.')
  return size
}

// Mensaje de avance: se edita (máx. cada 20 s); si WhatsApp no deja editar, manda uno nuevo cada ~25 %.
function progress(sock, msg, first) {
  let key = null, last = 0, lastPct = -100, canEdit = true, pending = null, busy = false
  const send = async (text) => {
    if (busy) { pending = text; return }
    busy = true
    try {
      if (key && canEdit) {
        try { await sock.sendMessage(msg.chat, { text, edit: key }) } catch { canEdit = false }
      }
      if (!key || !canEdit) {
        const pct = Number((text.match(/(\d+)%/) || [])[1] ?? -1)
        if (!key || pct < 0 || pct - lastPct >= 25 || Date.now() - last > 5 * 60000) {
          const sent = await sock.sendMessage(msg.chat, { text }, { quoted: msg })
          if (!key) key = sent?.key
          if (pct >= 0) lastPct = pct
        }
      }
      last = Date.now()
    } catch {} finally {
      busy = false
      if (pending) { const t = pending; pending = null; if (Date.now() - last > 20000) send(t) }
    }
  }
  const p = { ready: send(first) }
  p.update = (text) => {
    const isPct = /\d+%/.test(text)
    if (isPct && Date.now() - last < 20000) return
    send(text)
  }
  return p
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
        const pron = await vtPronounce(r.text, target).catch(() => null)
        return sock.sendMessage(msg.chat, { text: `🌐 *${vtLangName(target)}:*\n${r.text}` + (pron ? `\n\n🗣️ *Cómo se pronuncia:*\n${pron}` : '') }, { quoted: msg })
      } catch (e) {
        return msg.reply(vtErrorText(e))
      }
    }

    const opt = parseVoiceArgs(words.join(' '))
    if (opt.unknown) return msg.reply(`《✧》 No conozco el idioma *${opt.unknown}*.\nUsa uno de estos: ${vtLangList()}\nEjemplo: ${P}traducir en`)
    if (!media.image && media.seconds > VT_MAX_SEC + 60) await msg.reply(`⚠️ Ese audio dura ${vtHms(media.seconds)}; solo voy a traducir las primeras ${Math.round(VT_MAX_SEC / 3600)} horas.`)

    const key = String(msg.chat)
    if (jobs.get(key) >= 2) return msg.reply('《✧》 Ya estoy traduciendo en este chat. Espera a que termine.')
    jobs.set(key, (jobs.get(key) || 0) + 1)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtin-'))
    let res = null
    try {
      const long = !media.image && media.seconds > 120
      const prog = progress(sock, msg, media.image ? '🖼️ Leyendo el texto de la imagen…'
        : long ? `🎙️ Escuchando el audio (${vtHms(media.seconds)})… Tardo más o menos ${vtEstimate(media.seconds)} min; te voy avisando el avance.`
          : '🎙️ Escuchando el audio…')
      await prog.ready
      const ext = media.image ? (/png/.test(media.mime) ? 'png' : /webp/.test(media.mime) ? 'webp' : 'jpg') : /ogg|opus/.test(media.mime) ? 'ogg' : /mp4|m4a|aac/.test(media.mime) ? 'm4a' : /mpeg|mp3/.test(media.mime) ? 'mp3' : /video/.test(media.mime) ? 'mp4' : 'bin'
      const input = path.join(dir, (media.image ? 'imagen.' : 'audio.') + ext)
      await downloadTo(media, input)
      res = media.image
        ? await imageTranslate(input, { target: opt.target, source: opt.source })
        : await voiceTranslate(input, { target: opt.target, source: opt.source, onStatus: long ? prog.update : null })
      fs.rmSync(input, { force: true })
      const out = vtMessages(res, { maxLen: 6000 })
      for (const text of out.messages) await sock.sendMessage(msg.chat, { text }, { quoted: msg })
      if (out.file) {
        await sock.sendMessage(msg.chat, { document: Buffer.from(out.file.content, 'utf8'), mimetype: 'text/plain', fileName: out.file.name }, { quoted: msg })
      }
      if (res.ogg) {
        await sock.sendMessage(msg.chat, { audio: fs.readFileSync(res.ogg), mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg })
      }
      console.log(`[traducir] ${media.image ? 'imagen' : 'voz'} ${res.source}→${res.target}`)
    } catch (e) {
      console.error('[traducir]', e?.message || e)
      const et = vtErrorText(e)
      await msg.reply(/^(🎙️|🖼️)/.test(et) ? et : et + `\n\n✎ Tip: si el idioma salió mal, dile cuál es, por ejemplo: ${P}traducir es>en o ${P}traducir pt>es`).catch(() => {})
    } finally {
      vtCleanup(res?.dir)
      vtCleanup(dir)
      const n = (jobs.get(key) || 1) - 1
      if (n <= 0) jobs.delete(key); else jobs.set(key, n)
    }
  }
}
