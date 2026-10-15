import { savePick, readPick, bareNumber } from '../../lib/nsfw-pick.js'
import { geocode, parseInput, mapsLink, placeLine } from '../../lib/maps-core.js'

// mapa <lugar | lat,lon | link de Google Maps> → ubicación de WhatsApp + link de Google Maps
const SITE = 'mapa'

async function enviar(msg, sock, p) {
  await sock.sendMessage(msg.chat, { location: { degreesLatitude: p.lat, degreesLongitude: p.lon, name: p.name, address: p.address } }, { quoted: msg })
  await msg.reply(`📍 *${p.name}*${p.address ? `\n${p.address}` : ''}\n🗺 ${mapsLink(p.lat, p.lon)}`)
}

export default {
  command: ['mapa', 'maps', 'ubicacion', 'map'],
  category: 'search',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply(`✎ Uso: ${P}mapa <lugar>\nEjemplos: ${P}mapa Zócalo CDMX · ${P}mapa 19.4326,-99.1332 · ${P}mapa <link de Google Maps>`)
    try {
      const inp = await parseInput(q)
      if (inp.kind === 'point') return await enviar(msg, sock, inp.place)
      if (inp.kind === 'bad') return msg.reply('《✧》 No entendí ese link de Google Maps. Mándame el nombre del lugar o las coordenadas (ej. 19.43,-99.13).')
      const list = await geocode(inp.q, 10)
      if (!list.length) return msg.reply(`《✧》 No encontré "${inp.q}" en el mapa. Prueba agregando la ciudad o el país.`)
      if (list.length === 1) return await enviar(msg, sock, list[0])
      savePick(msg.chat, { msg, sender: msg.sender, site: SITE, items: list, maxItems: 10 })
      await msg.reply(`🗺 *Mapa* › ${inp.q}\n\n${list.map(placeLine).join('\n')}\n\n✎ Responde con el número (1-${list.length}) y te mando la ubicación · vale 5 min.`)
    } catch (e) {
      console.error('[mapa]', e?.message || e)
      await msg.reply('《✧》 El mapa no responde ahora. Intenta en un momento.')
    }
  }
}

export async function before({ msg, sock }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== SITE) return false
  if (n < 1 || n > hit.items.length) { await msg.reply(`Elige un número del 1 al ${hit.items.length}.`); return true }
  await enviar(msg, sock, hit.items[n - 1])
  return true
}
