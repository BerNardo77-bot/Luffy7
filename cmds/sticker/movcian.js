// movcian — los 10 movimientos de Grok Bot en cian. "x" manda cada uno como GIF listo para X (documento); un número manda solo ese.
import fs from 'fs'
import path from 'path'

const DIR = path.resolve('assets/movimientos_cian')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEMS = [
  ['01_mirando', "Mirando alrededor"],
  ['02_encogiendo', "Haciéndose pequeño"],
  ['03_girando', "Girando"],
  ['04_vuelta', "Dando la vuelta"],
  ['05_parpadeo', "Parpadeando"],
  ['06_mirando_arriba', "Mirando arriba"],
  ['07_ladeando', "Ladeándose"],
  ['08_volteando', "Volteando"],
  ['09_puntos', "Reflexionando al respecto"],
  ['20_estrella', "Grok Bot ⭐"],
]

export default {
  command: ['movcian', 'movimientoscian'],
  category: 'stickers',
  run: async ({ msg, sock, args }) => {
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    const a = (args || []).map((s) => s.toLowerCase())
    const x = a.includes('x')
    const n = parseInt(a.find((s) => /^\d+$/.test(s)), 10)
    const list = n >= 1 && n <= ITEMS.length ? [ITEMS[n - 1]] : ITEMS
    for (const [f, caption] of list) {
      if (x) {
        try { await sock.sendMessage(msg.chat, { document: fs.readFileSync(path.join(DIR, f + '_x.gif')), mimetype: 'image/gif', fileName: 'grokbot_cian_' + f + '.gif', caption }) } catch (e) { console.error('[movcian]', f, e?.message) }
        await sleep(900)
        continue
      }
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movcian]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movcian]', f, e?.message) }
      await sleep(1200)
    }
  },
}
