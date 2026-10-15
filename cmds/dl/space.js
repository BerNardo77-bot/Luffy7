import fs from 'fs'
import { spaceUrl, spaceInfo, downloadSpace, hms, SEARCH_MSG } from '../../lib/space-core.js'
import { makeThumb } from '../../lib/audio-tags.js'

// space <link de x.com/i/spaces/…> → MP3 de la grabación (partes de ~95 MB si es muy largo)
const jobs = new Set()
const MAX_PART = 95 * 1024 * 1024

export default {
  command: ['space', 'spaces', 'xspace'],
  category: 'downloader',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply(`✎ Uso: ${P}space <link del Space de X>\nEjemplo: ${P}space https://x.com/i/spaces/1nxeLMRVZVLJX\nTe mando la grabación en MP3.`)
    const url = spaceUrl(q)
    if (!url) return msg.reply(SEARCH_MSG(P))
    const key = String(msg.chat)
    if (jobs.has(key)) return msg.reply('《✧》 Ya estoy bajando un Space en este chat. Espera a que termine.')
    jobs.add(key)
    let res = null
    try {
      await msg.reply('🎙 Revisando el Space…')
      const info = await spaceInfo(url)
      if (info.status === 'live') return msg.reply(`🔴 Ese Space está *en vivo* ahora. Solo se puede escuchar en la app de X:\n${url}\nCuando termine, si el anfitrión lo grabó, mándamelo otra vez.`)
      if (info.status === 'upcoming') return msg.reply(`🗓 Ese Space todavía no empieza. Cuando termine (si lo graban) mándamelo otra vez:\n${url}`)
      if (info.status !== 'recorded') return msg.reply(`《✧》 ${info.reason || 'Ese Space no tiene grabación disponible.'}\n${url}`)
      await msg.reply(`🎙 *${info.title}*${info.host ? `\n👤 ${info.host}${info.hostId ? ` (@${info.hostId})` : ''}` : ''}\n⬇️ Bajando la grabación… si dura horas puede tardar varios minutos, te aviso.`)
      let lastT = Date.now()
      res = await downloadSpace(info, {
        maxBytes: MAX_PART,
        onProgress: (t) => { if (Date.now() - lastT > 120000 || /Parte 1\/|MP3…$/.test(t)) { lastT = Date.now(); msg.reply(t).catch(() => {}) } }
      })
      console.log(`[space] ${info.title} ${Math.round(res.duration)}s ${res.parts.length} parte(s)`)
      const thumb = res.cover ? await makeThumb(res.cover, 300).catch(() => null) : null
      if (res.parts.length > 1) await msg.reply(`📦 Dura ${hms(res.duration)}; te lo mando en ${res.parts.length} partes.`)
      for (const p of res.parts) {
        await sock.sendMessage(msg.chat, {
          document: { url: p.file }, mimetype: 'audio/mpeg', fileName: p.name,
          caption: `🎙 ${info.title}${info.host ? ` · ${info.host}` : ''} · ${hms(p.seconds)}`,
          ...(thumb ? { jpegThumbnail: thumb } : {})
        }, { quoted: msg })
        await new Promise(r => setTimeout(r, 1500))
      }
    } catch (e) {
      console.error('[space]', e?.message || e)
      await msg.reply(`《✧》 No pude bajar el Space: ${String(e?.message || e).slice(0, 200)}`).catch(() => {})
    } finally {
      if (res?.dir) fs.rmSync(res.dir, { recursive: true, force: true })
      jobs.delete(key)
    }
  }
}
