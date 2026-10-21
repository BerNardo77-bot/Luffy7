import fs from 'fs'
import os from 'os'
import { savePick, readPick, bareNumber } from '../../lib/nsfw-pick.js'
import { searchChannels, probeStream, recordStream, isStreamUrl, chanLine, TV_DURS, TV_MAX_MIN } from '../../lib/tv-core.js'
import { splitVideoEach, partsFor, freeDisk, MAX_TOTAL_BYTES, MAX_SPLIT_PARTS, bigWarning } from '../../lib/video-split.js'

// tv <canal | link .m3u8/rtmp> → elegir canal → elegir minutos (5-60) → video grabado con ffmpeg
const SITE_CH = 'tv-canal'
const SITE_DUR = 'tv-dur'
// Partes de la grabación: WhatsApp rechaza (error 500 "ack media") subidas cerca de 2 GB desde el teléfono.
// Por defecto 1000 MB por parte (TV_PART_MB lo cambia, máx. 1950).
const MAX_FILE = Math.min(Math.max(Number(process.env.TV_PART_MB) || 1000, 50), 1950) * 1024 * 1024
const MAX_VIDEO = 64 * 1024 * 1024 // más que esto va como documento
const jobs = new Set()
const mb = (b) => (b / 1048576).toFixed(1)

async function sendOnce(sock, msg, file, { caption, fileName }) {
  const size = fs.statSync(file).size
  if (size <= MAX_VIDEO) {
    try { await sock.sendMessage(msg.chat, { video: { url: file }, mimetype: 'video/mp4', fileName, caption }, { quoted: msg }); return } catch (e) { console.error('[tv] video→documento', e?.message || e) }
  }
  await sock.sendMessage(msg.chat, { document: { url: file }, mimetype: 'video/mp4', fileName, caption: `${caption}\n(${mb(size)} MB, documento)` }, { quoted: msg })
}

// Usa el socket actual (si WhatsApp reconectó, el viejo ya no sirve). Un fallo reintenta 1 vez tras 30 s
// y luego se rinde con un aviso: nunca deja escapar el error (no debe tumbar ni reiniciar la sesión).
async function sendVid(sock, msg, file, opts) {
  for (let i = 0; i < 2; i++) {
    try { await sendOnce(global.sock || sock, msg, file, opts); return true } catch (e) {
      console.error('[tv] envío falló', i + 1, e?.message || e)
      if (i === 0) await new Promise(r => setTimeout(r, 30000))
    }
  }
  return false
}

async function offer(msg, ch) {
  await msg.reply(`📺 Revisando la señal de *${ch.title}*…`)
  const p = await probeStream(ch.url, ch.headers)
  if (!p.ok) return msg.reply(`《✧》 ${ch.title}: ${p.reason}`)
  savePick(msg.chat, { msg, sender: msg.sender, site: SITE_DUR, items: TV_DURS.map(m => ({ ...ch, min: m })), maxItems: TV_DURS.length })
  return msg.reply(`📺 *${ch.title}* está al aire${p.height ? ` (${p.height}p)` : ''}${p.video ? '' : ' (solo audio)'}.\n¿Cuántos minutos grabo?\n${TV_DURS.map((m, i) => `${i + 1}) ${m} min`).join('\n')}\nResponde el número (vale 5 min).`)
}

async function grabar(msg, sock, ch, min) {
  const key = String(msg.chat)
  if (jobs.has(key)) return msg.reply('《✧》 Ya estoy grabando TV en este chat. Espera a que termine.')
  const maxBytes = Math.min(MAX_TOTAL_BYTES, freeDisk(os.tmpdir()) - 300 * 1024 * 1024 - MAX_FILE)
  if (maxBytes < 20 * 1024 * 1024) return msg.reply('《✧》 No hay espacio libre para grabar ahora. Libera espacio e intenta otra vez.')
  jobs.add(key)
  let rec = null
  try {
    await msg.reply(`⏺ Grabando ${min} min de *${ch.title}*… te aviso cada 5 min y al terminar.`)
    let lastMin = 0
    rec = await recordStream(ch.url, min * 60, {
      headers: ch.headers, title: ch.title, maxBytes,
      onProgress: (s, b) => {
        const m = Math.floor(s / 60)
        if (m >= lastMin + 5 && m < min) { lastMin = m; msg.reply(`⏺ ${ch.title}: ${m}/${min} min · ${mb(b)} MB`).catch(() => {}) }
      }
    })
    const got = `${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, '0')}`
    const cap = `📺 *${ch.title}* · ${got} · ${mb(rec.size)} MB`
    const notes = [rec.seconds < min * 60 - 30 ? `⚠️ La señal se cortó: solo se grabaron ${got}.` : '', rec.cut ? '⚠️ Se detuvo por falta de espacio.' : '', rec.reencoded ? 'ℹ️ Se recodificó (la señal no se podía copiar tal cual).' : ''].filter(Boolean)
    if (rec.size > MAX_FILE) {
      const n = partsFor(rec.size, MAX_FILE)
      await msg.reply(`《✧》 Pesa ${mb(rec.size)} MB: te lo mando en ${n} partes, sin bajar la calidad…`).catch(() => {})
      let total = 0
      await splitVideoEach(rec.file, MAX_FILE, { title: ch.title, maxParts: MAX_SPLIT_PARTS + 3, onPart: async (p) => {
        total = p.total
        if (!await sendVid(sock, msg, p.file, { caption: `${cap}\n📦 Parte ${p.index}/${p.total}`, fileName: p.name })) throw new Error(`WhatsApp no aceptó la parte ${p.index}/${p.total}`)
      } })
      const warn = bigWarning(rec.size, total)
      if (warn) notes.push(warn)
    } else {
      if (!await sendVid(sock, msg, rec.file, { caption: cap, fileName: rec.name })) throw new Error('WhatsApp no aceptó el video')
    }
    if (notes.length) await msg.reply(notes.join('\n')).catch(() => {})
  } catch (e) {
    await (global.sock || sock).sendMessage(msg.chat, { text: `《✧》 No pude terminar: ${String(e?.message || e).slice(0, 250)}` }).catch(() => {})
  } finally {
    if (rec?.dir) fs.rmSync(rec.dir, { recursive: true, force: true })
    jobs.delete(key)
  }
}

export async function runTv({ msg, sock, args, text, usedPrefix }) {
  const P = usedPrefix || '$'
  const q = (text || (args || []).join(' ')).trim()
  if (!q) return msg.reply(`✎ Uso:\n${P}tv <nombre del canal> — busca en listas públicas (iptv-org). Ej: ${P}tv milenio · ${P}tv canal 22 · ${P}tv antena 3 es\n${P}tv <link> — link directo .m3u8, http o rtmp (como en VLC)\nLuego eliges canal y minutos (5, 10, 15, 30 o 60) y te mando el video.`)
  const [first, ...rest] = q.split(/\s+/)
  if (isStreamUrl(first)) {
    const ch = { url: first, headers: {}, title: 'TV en vivo' }
    const min = Number((rest.join(' ').match(/^(\d{1,3})/) || [])[1]) || 0
    if (min) {
      const p = await probeStream(first)
      if (!p.ok) return msg.reply('《✧》 ' + p.reason)
      return grabar(msg, sock, ch, Math.min(min, TV_MAX_MIN))
    }
    return offer(msg, ch)
  }
  await msg.reply('🔎 Buscando canales…')
  let items = []
  try { items = await searchChannels(q, { limit: 10 }) } catch (e) { console.error('[tv]', e?.message || e) }
  if (!items.length) return msg.reply(`《✧》 No encontré canales con "${q.slice(0, 60)}". Prueba otro nombre, agrega el país (ej: ${P}tv antena 3 es) o pega el link directo .m3u8.`)
  savePick(msg.chat, { msg, sender: msg.sender, site: SITE_CH, items, maxItems: 10 })
  return msg.reply(`📺 *Canales encontrados:*\n${items.map(chanLine).join('\n')}\n\nResponde el número (vale 5 min).`)
}

export default {
  command: ['tv', 'canal', 'canaltv', 'television'],
  category: 'downloader',
  run: runTv
}

export async function before({ msg, sock }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || (hit.site !== SITE_CH && hit.site !== SITE_DUR)) return false
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige 1-${hit.items.length}.`); return true }
  const it = hit.items[n - 1]
  if (hit.site === SITE_CH) offer(msg, it).catch(() => {})
  else grabar(msg, sock, it, Math.min(it.min, TV_MAX_MIN)).catch(() => {})
  return true
}
