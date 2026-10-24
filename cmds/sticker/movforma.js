// movnube / movcuadro — los 8 movimientos (sacados del video) de Grok Bot en forma de nube o cuadro (azul).
// "x" manda cada movimiento como GIF listo para X (documento).
import fs from 'fs'
import path from 'path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEMS = [
  ['01_avanzando', "Avanzando poco a poco"],
  ['02_encogiendo', "Haciéndose pequeño"],
  ['03_mirando_arriba', "Mirando arriba"],
  ['04_girando', "Girando"],
  ['05_mirando', "Mirando alrededor"],
  ['06_ladeando', "Ladeándose"],
  ['07_aplastando', "Aplastándose"],
  ['08_ojitos', "Achicando los ojos"],
]
const KIND = { movnube: 'nube', nube: 'nube', movimientosnube: 'nube', movcuadro: 'cuadro', cuadro: 'cuadro', movimientoscuadro: 'cuadro' }

export default {
  command: ['movnube', 'movimientosnube', 'movcuadro', 'movimientoscuadro'],
  category: 'stickers',
  run: async ({ msg, sock, args, command }) => {
    const kind = KIND[(command || '').toLowerCase()] || 'nube'
    const DIR = path.resolve('assets/formas_' + kind)
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    const a = (args || []).map((s) => s.toLowerCase())
    const x = a.includes('x')
    const n = parseInt(a.find((s) => /^\d+$/.test(s)), 10)
    const list = n >= 1 && n <= ITEMS.length ? [ITEMS[n - 1]] : ITEMS
    for (const [f, caption] of list) {
      if (x) {
        try { await sock.sendMessage(msg.chat, { document: fs.readFileSync(path.join(DIR, f + '_x.gif')), mimetype: 'image/gif', fileName: 'grokbot_' + kind + '_' + f + '.gif', caption }) } catch (e) { console.error('[movforma]', f, e?.message) }
        await sleep(900)
        continue
      }
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movforma]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movforma]', f, e?.message) }
      await sleep(1200)
    }
  },
}
