import fs from 'fs'
import { savePick, readPick, bareNumber } from '../../lib/nsfw-pick.js'
import { liveTarget, tiktokTarget, liveInfo, recordLive, vlcSteps, ipNote, MAX_LIVE_MIN } from '../../lib/live-core.js'
import { makeThumb } from '../../lib/audio-tags.js'

// envivo <link o @canal> → link directo (VLC) + opción de grabar 5/10/15/30 min en MP3
const SITE = 'envivo-dur'
const DURS = [5, 10, 15, 30]
const jobs = new Set()

async function grabar(msg, sock, url, min) {
  const key = String(msg.chat)
  if (jobs.has(key)) return msg.reply('《✧》 Ya estoy grabando un en vivo en este chat. Espera a que termine.')
  jobs.add(key)
  let rec = null
  try {
    await msg.reply(`⏺ Grabando ${min} min del en vivo…${min >= 5 ? ' te aviso al terminar.' : ''}`)
    rec = await recordLive(url, min * 60)
    const thumb = rec.cover ? await makeThumb(rec.cover, 300).catch(() => null) : null
    await sock.sendMessage(msg.chat, { document: { url: rec.file }, mimetype: 'audio/mpeg', fileName: rec.name, caption: `🔴 ${rec.info.title} · ${Math.floor(rec.seconds / 60)}:${String(rec.seconds % 60).padStart(2, '0')}`, ...(thumb ? { jpegThumbnail: thumb } : {}) }, { quoted: msg })
  } catch (e) {
    await msg.reply(`《✧》 No pude grabar: ${String(e?.message || e).slice(0, 150)}`).catch(() => {})
  } finally {
    if (rec?.dir) fs.rmSync(rec.dir, { recursive: true, force: true })
    jobs.delete(key)
  }
}

export default {
  command: ['envivo', 'envivos', 'live', 'ytlive'],
  category: 'downloader',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    const url = (await tiktokTarget(q)) || liveTarget(q)
    if (!url) return msg.reply(`✎ Uso: ${P}envivo <link de YouTube o @canal>\nEjemplos: ${P}envivo @MILENIO · ${P}envivo @LofiGirl (YouTube)\nTikTok: ${P}envivo tiktok @usuario o el link de TikTok\nTe doy el link para verlo en VLC. Agrega minutos para grabar el audio: ${P}envivo @MILENIO 10 (máx. ${MAX_LIVE_MIN}).`)
    const min = Number((q.match(/\s(\d{1,3})\s*(m|min|minutos?)?\s*$/i) || [])[1]) || 0
    await msg.reply('📡 Buscando el en vivo…')
    const info = await liveInfo(url)
    if (info.status === 'nouser') return msg.reply(info.suggest ? `No encontré a @${info.user}. ¿Quisiste decir *@${info.suggest.user}*?${info.suggest.live ? ' (está en vivo ahora 🔴)' : ''}\nPrueba: envivo tt @${info.suggest.user}` : 'No encontré ese usuario de TikTok. Revisa el usuario (el que va después de @ en el perfil, puede llevar punto o guion bajo).')
    if (info.status === 'blocked') return msg.reply(info.reason)
    if (info.tiktok && info.status === 'notlive') return msg.reply('Ese usuario de TikTok no está en vivo ahora (o el usuario no existe). Cuando empiece su live, vuelve a intentarlo.')
    if (info.status === 'upcoming') return msg.reply(`🗓 Ese en vivo todavía no empieza${info.title ? `: *${info.title}*` : ''}. Vuelve a intentarlo cuando comience.`)
    if (info.status === 'ended') return msg.reply(`⏹ Ese en vivo ya terminó${info.title ? `: *${info.title}*` : ''}. Si quieres el video, usa ${P}play o ${P}ytmp4 con el link.`)
    if (info.status === 'notlive') return msg.reply(`《✧》 Ese canal no está transmitiendo en vivo ahora (o el canal no existe).${info.title ? `\n${info.title}` : ''}`)
    if (info.status !== 'live') return msg.reply(`《✧》 No pude revisar el en vivo. ${info.reason || ''}`)
    if (min) return grabar(msg, sock, url, Math.min(min, MAX_LIVE_MIN))
    const cap = `🔴 *EN VIVO*${info.tiktok ? ' · TikTok' : ''}\n📺 ${info.title}${info.channel ? `\n👤 ${info.channel}` : ''}\n\n${vlcSteps()}\n${ipNote(info)}\n\nAbajo te mando los links (cópialos completos).`
    if (info.thumb) await sock.sendMessage(msg.chat, { image: { url: info.thumb }, caption: cap }, { quoted: msg }).catch(() => msg.reply(cap))
    else await msg.reply(cap)
    if (info.master) await msg.reply(`🎬 Video + audio (VLC):\n${info.master}`)
    if (info.alt) await msg.reply(`🎬 Otra versión (HLS, puede fallar):\n${info.alt}`)
    if (info.audio) await msg.reply(`🎧 Solo audio:\n${info.audio}`)
    savePick(msg.chat, { msg, sender: msg.sender, site: SITE, items: DURS.map(m => ({ url, min: m })), maxItems: 4 })
    await msg.reply(`⏺ ¿Grabar el audio en MP3?\n${DURS.map((m, i) => `${i + 1}) ${m} min`).join('\n')}\nResponde el número (vale 5 min).`)
  }
}

export async function before({ msg, sock }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== SITE) return false
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige 1-${hit.items.length}.`); return true }
  const it = hit.items[n - 1]
  grabar(msg, sock, it.url, it.min).catch(() => {})
  return true
}
