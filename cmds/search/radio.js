import fs from 'fs'
import { savePick, readPick } from '../../lib/nsfw-pick.js'
import { searchStations, recordStation, stationLine, stationInfo, faviconCover, parseMinutes, isStreamUrl, stationFromUrl, countClick, DEFAULT_REC_SEC, MAX_REC_MIN } from '../../lib/radio-core.js'
import { makeThumb } from '../../lib/audio-tags.js'

// radio <nombre, país o ciudad> → lista numerada (vale 10 min); responde N (graba 60 s) o "N 5" (5 min)
// radio <link del stream> [min] → graba directo. "rec 10" vuelve a grabar la última estación.
const SITE = 'radio'
const TTL = 10 * 60 * 1000
const LIST_MAX = 50
const CARDS = 10
const jobs = new Set()
const lastStation = new Map() // chat → { st, until }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const bodyOf = (msg) => String(msg?.body || msg?.text || msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim()

async function grabar({ msg, sock, st, seconds }) {
  const key = String(msg.chat)
  if (jobs.has(key)) { await msg.reply('《✧》 Ya estoy grabando una radio en este chat. Espera a que termine.'); return }
  jobs.add(key)
  lastStation.set(key, { st, until: Date.now() + 30 * 60 * 1000 })
  let rec = null
  try {
    countClick(st.uuid)
    const fav = await faviconCover(st.favicon)
    const info = `${stationInfo(st)}\n\n⏺ Grabando ${seconds >= 60 ? Math.round(seconds / 60) + ' min' : seconds + ' s'}…`
    if (fav) await sock.sendMessage(msg.chat, { image: fav, caption: info }, { quoted: msg })
    else await msg.reply(info)
    rec = await recordStation(st, seconds)
    console.log(`[radio] ${st.name} ${rec.seconds}s ${(rec.size / 1048576).toFixed(1)} MB ${rec.url}`)
    const thumb = rec.cover ? await makeThumb(rec.cover, 300).catch(() => null) : null
    await sock.sendMessage(msg.chat, {
      document: { url: rec.file }, mimetype: 'audio/mpeg', fileName: rec.name,
      caption: `📻 ${st.name} · ${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, '0')}`,
      ...(thumb ? { jpegThumbnail: thumb } : {})
    }, { quoted: msg })
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
  await msg.reply(`📻 *Radios* › ${q}\n${list.length} ${list.length === 1 ? 'estación' : 'estaciones'}. Responde con el número (1-${list.length}) y grabo ${DEFAULT_REC_SEC} s, o *número minutos* (ej. *1 5*) hasta ${MAX_REC_MIN} min · vale 10 min.`)
  const favs = await Promise.all(list.slice(0, CARDS).map(s => faviconCover(s.favicon).catch(() => null)))
  const sinImg = []
  for (let i = 0; i < Math.min(CARDS, list.length); i++) {
    if (!favs[i]) { sinImg.push(stationLine(list[i], i)); continue }
    await sock.sendMessage(msg.chat, { image: await makeThumb(favs[i], 300).catch(() => favs[i]), caption: stationLine(list[i], i) }, { quoted: msg }).catch(() => sinImg.push(stationLine(list[i], i)))
    await sleep(500)
  }
  const rest = [...sinImg, ...list.slice(CARDS).map((s, j) => stationLine(s, CARDS + j))]
  for (let i = 0; i < rest.length; i += 40) await msg.reply(rest.slice(i, i + 40).join('\n'))
}

export default {
  command: ['radio', 'radios', 'fm'],
  category: 'downloader',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply(`✎ Uso:\n${P}radio <nombre, país o ciudad> → lista de estaciones\n${P}radio <link del stream> [minutos] → graba directo\nLuego responde el número (graba ${DEFAULT_REC_SEC} s) o *número minutos* (ej. *2 10*), máx. ${MAX_REC_MIN} min.\n*rec 5* vuelve a grabar la última estación 5 min.\nEjemplo: ${P}radio Exa · ${P}radio Mexico`)
    const url = (q.match(/https?:\/\/\S+/) || [])[0]
    if (url && isStreamUrl(url)) {
      const min = parseMinutes(q.replace(url, ''))
      return grabar({ msg, sock, st: stationFromUrl(url), seconds: min ? min * 60 : DEFAULT_REC_SEC })
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
  if (!hit || hit.site !== SITE) return false
  const n = Number(m[1])
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige un número del 1 al ${hit.items.length}.`); return true }
  const min = m[2] ? Math.max(1, Math.min(Number(m[2]), MAX_REC_MIN)) : 0
  grabar({ msg, sock, st: hit.items[n - 1], seconds: min ? min * 60 : DEFAULT_REC_SEC }).catch(() => {})
  return true
}
