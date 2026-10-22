import path from 'path'
import fs from 'fs'
import os from 'os'
import { savePick, readPick, bareNumber } from '../../lib/nsfw-pick.js'
import { searchLive, probeStream, recordStream, isStreamUrl, chanLine, logosFor, logoJpeg, TV_DURS, TV_MAX_MIN } from '../../lib/tv-core.js'
import { splitVideoEach, partsFor, freeDisk, MAX_TOTAL_BYTES, MAX_SPLIT_PARTS, bigWarning } from '../../lib/video-split.js'

// tv <canal | link .m3u8/rtmp> → elegir canal → elegir duración (5 min a 5 h) → video grabado con ffmpeg
// tvcancel (o "cancelar") detiene la grabación y vuelve a mostrar el menú de duración.
const SITE_CH = 'tv-canal'
const SITE_DUR = 'tv-dur'
const PICK_TTL = 15 * 60 * 1000
// Partes de la grabación: WhatsApp rechaza (error 500 "ack media") subidas cerca de 2 GB desde el teléfono.
// Por defecto 1000 MB por parte (TV_PART_MB lo cambia, máx. 1950).
const MAX_FILE = Math.min(Math.max(Number(process.env.TV_PART_MB) || 1000, 50), 1950) * 1024 * 1024
const MAX_VIDEO = 64 * 1024 * 1024 // más que esto va como documento
const jobs = new Map() // chat → { ac, sender, ch, prefix }
const mb = (b) => (b / 1048576).toFixed(1)
const label = (m) => m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`
const bare = (j = '') => String(j).split('@')[0].split(':')[0]

async function sendOnce(sock, msg, file, { caption, fileName, thumb }) {
  const th = thumb && thumb.length > 800 && thumb.length < 60000 ? { jpegThumbnail: thumb } : {}
  const size = fs.statSync(file).size
  if (size <= MAX_VIDEO) {
    try { await sock.sendMessage(msg.chat, { video: { url: file }, mimetype: 'video/mp4', fileName, caption, ...th }, { quoted: msg }); return } catch (e) { console.error('[tv] video→documento', e?.message || e) }
  }
  await sock.sendMessage(msg.chat, { document: { url: file }, mimetype: 'video/mp4', fileName, caption: `${caption}\n(${mb(size)} MB, documento)`, ...th }, { quoted: msg })
}

// Usa el socket actual (si WhatsApp reconectó, el viejo ya no sirve). Un fallo reintenta 1 vez tras 30 s
// y luego se rinde con un aviso: nunca deja escapar el error (no debe tumbar ni reiniciar la sesión).
async function sendVid(sock, msg, file, opts) {
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now(), size = fs.statSync(file).size
    // Tope de espera para que un envío colgado no deje el comando mudo para siempre
    const limit = 180000 + Math.ceil(size / 1048576) * 4000
    console.log(`[tv] enviando ${path.basename(file)} (${mb(size)} MB)…`)
    try {
      await Promise.race([sendOnce(global.sock || sock, msg, file, opts), new Promise((_, rej) => setTimeout(() => rej(new Error(`sin respuesta de WhatsApp en ${Math.round(limit / 1000)} s`)), limit).unref?.())])
      console.log(`[tv] enviado en ${Math.round((Date.now() - t0) / 1000)} s`); return true
    } catch (e) {
      console.error('[tv] envío falló', i + 1, e?.message || e)
      if (i === 0) await new Promise(r => setTimeout(r, 30000))
    }
  }
  return false
}
const say = (sock, msg, text) => (global.sock || sock).sendMessage(msg.chat, { text }, { quoted: msg }).catch(() => msg.reply(text).catch(() => {}))

function durMenu(sock, msg, ch, head = '', P = '$') {
  savePick(msg.chat, { msg, sender: msg.sender, site: SITE_DUR, items: TV_DURS.map(m => ({ ...ch, min: m, prefix: P })), maxItems: TV_DURS.length, ttlMs: PICK_TTL })
  return say(sock, msg, `${head}⏺ ¿Cuánto grabo de *${ch.title}*?\n${TV_DURS.map((m, i) => `*${i + 1}* → ${label(m)}`).join('\n')}\n\nResponde solo el *número de opción* (1-${TV_DURS.length}).\nOtra duración: escribe los minutos con *m*, ej. *45m* o *90 min* (máx. ${TV_MAX_MIN}).\n(El menú dura 15 min.)`)
}

async function offer(sock, msg, ch, P) {
  await say(sock, msg, `📺 Revisando la señal de *${ch.title}*…`)
  const p = await probeStream(ch.url, ch.headers)
  if (!p.ok) return say(sock, msg, `《✧》 ${ch.title}: ${p.reason}`)
  return durMenu(sock, msg, ch, `📺 *${ch.title}* está al aire${p.height ? ` (${p.height}p)` : ''}${p.video ? '' : ' (solo audio)'}.\n\n`, P)
}

async function grabar(msg, sock, ch, min, P = '$') {
  const key = String(msg.chat)
  if (jobs.has(key)) return say(sock, msg, `《✧》 Ya estoy grabando TV en este chat. Para cancelar: ${P}tvcancel`)
  const maxBytes = Math.min(MAX_TOTAL_BYTES, freeDisk(os.tmpdir()) - 300 * 1024 * 1024 - MAX_FILE)
  if (maxBytes < 20 * 1024 * 1024) return say(sock, msg, '《✧》 No hay espacio libre para grabar ahora. Libera espacio e intenta otra vez.')
  const ac = new AbortController()
  jobs.set(key, { ac, sender: msg.sender, ch, prefix: P })
  let rec = null
  const every = min > 60 ? 15 : 5
  try {
    await say(sock, msg, `⏺ Grabando ${label(min)} de *${ch.title}*… te aviso cada ${every} min y al terminar.\nPara cancelar: *${P}tvcancel* (o escribe *cancelar*)`)
    let lastMin = 0
    rec = await recordStream(ch.url, min * 60, {
      headers: ch.headers, alts: ch.alts || [], title: ch.title, maxBytes, signal: ac.signal,
      onProgress: (s, b) => {
        if (ac.signal.aborted) return
        const m = Math.floor(s / 60)
        if (m >= lastMin + every && m < min) { lastMin = m; say(sock, msg, `⏺ ${ch.title}: ${m}/${min} min · ${mb(b)} MB · cancelar: ${P}tvcancel`) }
      }
    })
    if (ac.signal.aborted) throw Object.assign(new Error('cancelado'), { cancelled: true })
    const got = `${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, '0')}`
    const cap = `📺 *${ch.title}* · ${got} · ${mb(rec.size)} MB`
    const thumb = await logoJpeg(ch.logo, 160).catch(() => null)
    const notes = [rec.seconds < min * 60 - 30 && !rec.slowPct ? `⚠️ La señal se cortó: solo se grabaron ${got}.` : '', rec.cut ? '⚠️ Se detuvo por falta de espacio.' : '', rec.reencoded ? 'ℹ️ Se recodificó (la señal no se podía copiar tal cual).' : '', rec.slowPct ? `⚠️ El servidor del canal manda el video más lento que el directo (~${rec.slowPct}% de la velocidad necesaria); por eso se grabó menos de lo pedido. Prueba otro link del canal o más tarde.` : '', rec.pieces > 1 ? `ℹ️ La señal se reconectó ${rec.pieces - 1} vez/veces; uní todo en un solo video.` : ''].filter(Boolean)
    if (rec.size > MAX_FILE) {
      const n = partsFor(rec.size, MAX_FILE)
      await say(sock, msg, `《✧》 Pesa ${mb(rec.size)} MB: te lo mando en ${n} partes, sin bajar la calidad…`)
      let total = 0
      await splitVideoEach(rec.file, MAX_FILE, { title: ch.title, maxParts: MAX_SPLIT_PARTS + 3, onPart: async (p) => {
        if (ac.signal.aborted) throw Object.assign(new Error('cancelado'), { cancelled: true })
        total = p.total
        if (!await sendVid(sock, msg, p.file, { caption: `${cap}\n📦 Parte ${p.index}/${p.total}`, fileName: p.name, thumb })) throw new Error(`WhatsApp no aceptó la parte ${p.index}/${p.total}`)
      } })
      const warn = bigWarning(rec.size, total)
      if (warn) notes.push(warn)
    } else {
      if (!await sendVid(sock, msg, rec.file, { caption: cap, fileName: rec.name, thumb })) throw new Error('WhatsApp no aceptó el video')
    }
    if (notes.length) await say(sock, msg, notes.join('\n'))
  } catch (e) {
    if (e?.cancelled || ac.signal.aborted) {
      // El menú se vuelve a mostrar desde cancelTv (para que salga después del aviso)
    } else await say(sock, msg, `《✧》 No pude terminar: ${String(e?.message || e).slice(0, 250)}`)
  } finally {
    if (rec?.dir) try { fs.rmSync(rec.dir, { recursive: true, force: true }) } catch {}
    if (jobs.get(key)?.ac === ac) jobs.delete(key)
  }
}

// Cancela la grabación del chat: solo quien la empezó o el owner.
async function cancelTv(msg, sock, isOwner) {
  const key = String(msg.chat)
  const job = jobs.get(key)
  if (!job) { await say(sock, msg, '《✧》 No hay ninguna grabación de TV en curso en este chat.'); return }
  if (!isOwner && bare(job.sender) !== bare(msg.sender)) { await say(sock, msg, '《✧》 Solo quien empezó la grabación (o el owner) puede cancelarla.'); return }
  job.ac.abort()
  jobs.delete(key)
  await durMenu(sock, msg, job.ch, `⏹ Grabación cancelada. No se mandó nada y se borraron los archivos.\n\n`, job.prefix)
}

export async function runTv({ msg, sock, args, text, usedPrefix, command, isOwner }) {
  const P = usedPrefix || '$'
  if (/^(tvcancel|tvcancelar|cancelartv)$/i.test(command || '')) return cancelTv(msg, sock, isOwner)
  const q = (text || (args || []).join(' ')).trim()
  if (!q) return msg.reply(`✎ Uso:\n${P}tv <nombre del canal> — busca en listas públicas (iptv-org). Ej: ${P}tv milenio · ${P}tv canal 22 · ${P}tv antena 3 es\n${P}tv <link> — link directo .m3u8, http o rtmp (como en VLC)\nLuego eliges canal y duración (5 min a 5 h) y te mando el video.\nCon link puedes poner los minutos: ${P}tv <link> 120\nCancelar una grabación: ${P}tvcancel`)
  const [first, ...rest] = q.split(/\s+/)
  if (isStreamUrl(first)) {
    const ch = { url: first, headers: {}, title: 'TV en vivo' }
    const min = Number((rest.join(' ').match(/^(\d{1,3})/) || [])[1]) || 0
    if (min) {
      const p = await probeStream(first)
      if (!p.ok) return msg.reply('《✧》 ' + p.reason)
      grabar(msg, sock, ch, Math.min(min, TV_MAX_MIN), P).catch(() => {}) // sin await: no bloquea al bot durante horas
      return
    }
    return offer(sock, msg, ch, P)
  }
  await msg.reply('🔎 Buscando canales al aire… (reviso cuáles funcionan, tarda unos segundos)')
  let items = []
  let total = 0
  try { const r = await searchLive(q, { limit: 10, pool: 30 }); items = r.items; total = r.total } catch (e) { console.error('[tv]', e?.message || e) }
  if (!items.length && total) return msg.reply(`《✧》 Encontré ${total} canal(es) con "${q.slice(0, 60)}", pero ninguno está al aire ahora (o no responde desde el servidor). Prueba más tarde, otro nombre o el link directo .m3u8.`)
  if (!items.length && total > 0) return msg.reply(`《✧》 Encontré ${total} canal(es) con "${q.slice(0, 60)}", pero ninguno está transmitiendo ahora (fuera del aire o bloqueado por país). Intenta más tarde, otro nombre, o pega el link directo .m3u8.`)
  if (!items.length) return msg.reply(`《✧》 No encontré canales con "${q.slice(0, 60)}". Prueba otro nombre, agrega el país (ej: ${P}tv antena 3 es) o pega el link directo .m3u8.`)
  savePick(msg.chat, { msg, sender: msg.sender, site: SITE_CH, items: items.map(it => ({ ...it, prefix: P })), maxItems: 10, ttlMs: PICK_TTL })
  // Logos como en ytsearch: cada canal en su mensaje con foto. Si un logo falla, ese canal va solo en la lista de texto.
  try {
    const logos = await logosFor(items, 320)
    for (let i = 0; i < items.length; i++) {
      if (!logos[i]) continue
      try { await (global.sock || sock).sendMessage(msg.chat, { image: logos[i], mimetype: 'image/jpeg', caption: chanLine(items[i], i) }, { quoted: msg }) } catch (e) { console.error('[tv] logo', e?.message || e) }
    }
  } catch {}
  return msg.reply(`📺 *Canales al aire:*\n${items.map(chanLine).join('\n')}\n\nResponde el *número del canal* (1-${items.length}). (La lista dura 15 min.)`)
}

export default {
  command: ['tv', 'canal', 'canaltv', 'television', 'tvcancel', 'tvcancelar', 'cancelartv'],
  category: 'downloader',
  run: runTv
}

const textOf = (msg) => String(msg?.body ?? msg?.text ?? msg?.message?.conversation ?? msg?.message?.extendedTextMessage?.text ?? '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim()

export async function before({ msg, sock, isOwner }) {
  const t = textOf(msg)
  // "cancelar" suelto: solo si hay una grabación de TV en este chat
  if (/^cancelar$/i.test(t) && jobs.has(String(msg.chat))) { await cancelTv(msg, sock, isOwner); return true }
  const custom = t.match(/^(\d{1,3})\s*(m|min|mins|minutos?)$/i)
  const n = custom ? null : bareNumber(msg)
  if (n == null && !custom) return false
  const hit = readPick(msg)
  if (!hit || (hit.site !== SITE_CH && hit.site !== SITE_DUR)) return false
  const P = hit.items[0]?.prefix || '$'
  if (custom) {
    if (hit.site !== SITE_DUR) return false
    const m = Number(custom[1])
    if (m < 1 || m > TV_MAX_MIN) { await say(sock, msg, `Los minutos van de 1 a ${TV_MAX_MIN} (5 horas). Ej: 45m`); return true }
    grabar(msg, sock, hit.items[0], m, P).catch(() => {})
    return true
  }
  if (n < 1 || n > hit.items.length) {
    await say(sock, msg, hit.site === SITE_DUR ? `Elige una opción del 1 al ${hit.items.length}. Para otros minutos escribe, por ejemplo, 45m.` : `Elige un canal del 1 al ${hit.items.length}.`)
    return true
  }
  const it = hit.items[n - 1]
  if (hit.site === SITE_CH) offer(sock, msg, it, P).catch(() => {})
  else grabar(msg, sock, it, Math.min(it.min, TV_MAX_MIN), P).catch(() => {})
  return true
}
