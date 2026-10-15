import fs from 'fs'
import { savePick, readPick } from '../../lib/nsfw-pick.js'
import { searchStations, recordStation, stationLine, stationInfo, faviconCover, parseMinutes, isStreamUrl, stationFromUrl, countClick, DEFAULT_REC_SEC, MAX_REC_MIN } from '../../lib/radio-core.js'
import { makeThumb } from '../../lib/audio-tags.js'

// radio <nombre, país o ciudad> → lista numerada (vale 10 min); responde N (info + menú) o "N 5" (5 min)
// radio <link del stream> [min] → graba directo. "rec 10" vuelve a grabar la última estación.
const SITE = 'radio'
const DUR_SITE = 'radio-dur'
const DURS = [5, 10, 15, 30]
const HINT = `Responde *2 10* para grabar 10 min (máx. ${MAX_REC_MIN})`
const TTL = 10 * 60 * 1000
const LIST_MAX = 50
const CARDS = 10
const jobs = new Set()
const lastStation = new Map() // chat → { st, until }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const bodyOf = (msg) => String(msg?.body || msg?.text || msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim()

/** Elegir estación: info + link En vivo y menú 1-4 de duración (ya no graba solo). */
async function ofrecer({ msg, sock, st }) {
  lastStation.set(String(msg.chat), { st, until: Date.now() + 30 * 60 * 1000 })
  countClick(st.uuid)
  savePick(msg.chat, { msg, sender: msg.sender, site: DUR_SITE, items: DURS.map(m => ({ st, min: m })), maxItems: 4, ttlMs: TTL })
  const fav = await faviconCover(st.favicon).catch(() => null)
  const info = stationInfo(st)
  if (fav) await sock.sendMessage(msg.chat, { image: fav, caption: info }, { quoted: msg })
  else await msg.reply(info)
  await msg.reply(`⏺ ¿Grabar *${st.name.slice(0, 60)}* en MP3?\n${DURS.map((m, i) => `${i + 1}) ${m} min`).join('\n')}\nResponde el número (vale 10 min) o *rec N* (1-${MAX_REC_MIN}).`)
}

async function grabar({ msg, sock, st, seconds }) {
  const key = String(msg.chat)
  if (jobs.has(key)) { await msg.reply('《✧》 Ya estoy grabando una radio en este chat. Espera a que termine.'); return }
  jobs.add(key)
  lastStation.set(key, { st, until: Date.now() + 30 * 60 * 1000 })
  let rec = null
  try {
        const fav = await faviconCover(st.favicon)
    const min = Math.round(seconds / 60)
    void fav
    await msg.reply(`⏺ Grabando *${st.name.slice(0, 60)}* · ${seconds >= 60 ? min + ' min' : seconds + ' s'}…${seconds >= 300 ? ' te aviso al terminar.' : ''}`)
    const t0 = Date.now()
    const tick = seconds >= 600 ? setInterval(() => { msg.reply(`⏺ ${st.name.slice(0, 60)}: ${Math.round((Date.now() - t0) / 60000)}/${min} min grabados…`).catch(() => {}) }, 10 * 60 * 1000) : null
    try { rec = await recordStation(st, seconds) } finally { if (tick) clearInterval(tick) }
    console.log(`[radio] ${st.name} ${rec.seconds}s ${(rec.size / 1048576).toFixed(1)} MB ${rec.url}`)
    const thumb = rec.cover ? await makeThumb(rec.cover, 300).catch(() => null) : null
    await sock.sendMessage(msg.chat, {
      document: { url: rec.file }, mimetype: 'audio/mpeg', fileName: rec.name,
      caption: `📻 ${st.name} · ${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, '0')}`,
      ...(thumb ? { jpegThumbnail: thumb } : {})
    }, { quoted: msg })
    // Menú de duraciones: lista más reciente → responder 1-4 graba esa duración de la misma estación
    savePick(msg.chat, { msg, sender: msg.sender, site: DUR_SITE, items: DURS.map(m => ({ st, min: m })), maxItems: 4, ttlMs: TTL })
    await msg.reply(`⏺ ¿Grabar más de *${st.name.slice(0, 60)}*?\n${DURS.map((m, i) => `${i + 1}) ${m} min`).join('\n')}\nResponde el número (vale 10 min) o *rec N* (1-${MAX_REC_MIN}).`)
  } catch (e) {
    console.error('[radio]', e?.message || e)
    await msg.reply(`《✧》 ${String(e?.message || e).slice(0, 200)}\nPrueba otra estación.`).catch(() => {})
  } finally {
    if (rec?.dir) fs.rmSync(rec.dir, { recursive: true, force: true })
    jobs.delete(key)
  }
}

async function mostrarLista({ msg, sock, q, P, list }) {
  savePick(msg.chat, { msg, sender: msg.sender, site: SITE, items: list, maxItems: LIST_MAX, ttlMs: TTL })
  await msg.reply(`📻 *Radios* › ${q}\n${list.length} ${list.length === 1 ? 'estación' : 'estaciones'}. Responde con el número (1-${list.length}) y te doy el link y opciones para grabar.\n${HINT} · vale 10 min.`)
  const favs = await Promise.all(list.slice(0, CARDS).map(s => faviconCover(s.favicon).catch(() => null)))
  const sinImg = []
  for (let i = 0; i < Math.min(CARDS, list.length); i++) {
    if (!favs[i]) { sinImg.push(stationLine(list[i], i)); continue }
    await sock.sendMessage(msg.chat, { image: await makeThumb(favs[i], 300).catch(() => favs[i]), caption: stationLine(list[i], i) }, { quoted: msg }).catch(() => sinImg.push(stationLine(list[i], i)))
    await sleep(500)
  }
  const rest = [...sinImg, ...list.slice(CARDS).map((s, j) => stationLine(s, CARDS + j))]
  for (let i = 0; i < rest.length; i += 40) await msg.reply(rest.slice(i, i + 40).join('\n'))
  await msg.reply(`✎ Responde el número (1-${list.length}) → link + menú de grabación. ${HINT}.`)
}

export default {
  command: ['radio', 'radios', 'fm'],
  category: 'downloader',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply(`✎ Uso:\n${P}radio <nombre, país o ciudad> → lista de estaciones\n${P}radio <link del stream> [minutos] → link y menú (con minutos graba directo)\nLuego responde el número (link + menú 5/10/15/30 min) o *número minutos* (ej. *2 10*), máx. ${MAX_REC_MIN} min.\n*rec 5* vuelve a grabar la última estación 5 min.\nEjemplo: ${P}radio Exa · ${P}radio Mexico`)
    const url = (q.match(/https?:\/\/\S+/) || [])[0]
    if (url && isStreamUrl(url)) {
      const min = parseMinutes(q.replace(url, ''))
      return min ? grabar({ msg, sock, st: stationFromUrl(url), seconds: min * 60 }) : ofrecer({ msg, sock, st: stationFromUrl(url) })
    }
    try {
      const list = await searchStations(q, LIST_MAX)
      if (!list.length) return msg.reply(`《✧》 No encontré radios para "${q}". Prueba con otro nombre, país o ciudad.`)
      await mostrarLista({ msg, sock, q, P, list })
    } catch (e) {
      console.error('[radio] buscar', e?.message || e)
      await msg.reply(`《✧》 Radio Browser no responde ahora. ${String(e?.message || e).slice(0, 120)}`)
    }
  }
}

export async function before({ msg, sock }) {
  const t = bodyOf(msg)
  if (!t || t.length > 20) return false
  let m = t.match(/^rec\s+(\d{1,3})\s*(m|min|minutos?)?$/i)
  if (m) {
    const ls = lastStation.get(String(msg.chat))
    if (!ls || Date.now() > ls.until) return false
    await grabar({ msg, sock, st: ls.st, seconds: Math.min(Number(m[1]) || 1, MAX_REC_MIN) * 60 })
    return true
  }
  m = t.match(/^(\d{1,4})(?:\s+(\d{1,3})\s*(?:m|min|minutos?)?)?$/i)
  if (!m) return false
  const hit = readPick(msg)
  if (hit && hit.site === DUR_SITE && !m[2]) {
    const n = Number(m[1])
    if (n < 1 || n > hit.items.length) { await msg.reply(`Elige 1-${hit.items.length}.`); return true }
    const it = hit.items[n - 1]
    grabar({ msg, sock, st: it.st, seconds: it.min * 60 }).catch(() => {})
    return true
  }
  if (!hit || hit.site !== SITE) return false
  const n = Number(m[1])
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige un número del 1 al ${hit.items.length}.`); return true }
  const min = m[2] ? Math.max(1, Math.min(Number(m[2]), MAX_REC_MIN)) : 0
  ;(min ? grabar({ msg, sock, st: hit.items[n - 1], seconds: min * 60 }) : ofrecer({ msg, sock, st: hit.items[n - 1] })).catch(() => {})
  return true
}
