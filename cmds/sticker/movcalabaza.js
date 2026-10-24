// movcalabaza — los 9 movimientos de la calabaza naranja de Grok Bot (sacados del video).
// "x" manda cada movimiento como GIF listo para X (documento).
import fs from 'fs'
import path from 'path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEMS = [
  ['01_sacandolo', "Sacándolo adelante"],
  ['02_mirando', "Mirando alrededor"],
  ['03_ladeando', "Ladeándose"],
  ['04_meciendo', "Meciéndose"],
  ['05_achicando', "Haciéndose pequeño"],
  ['06_girando', "Girando"],
  ['07_parpadeo', "Parpadeando"],
  ['08_aplastando', "Aplastándose"],
  ['09_aplastado', "Aplanándose"],
]

export default {
  command: ['movcalabaza', 'movimientoscalabaza'],
  category: 'stickers',
  run: async ({ msg, sock, args, command }) => {
    const kind = 'calabaza'
    const DIR = path.resolve('assets/formas_' + kind)
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    const a = (args || []).map((s) => s.toLowerCase())
    const x = a.includes('x')
    const n = parseInt(a.find((s) => /^\d+$/.test(s)), 10)
    const list = n >= 1 && n <= ITEMS.length ? [ITEMS[n - 1]] : ITEMS
    for (const [f, caption] of list) {
      if (x) {
        try { await sock.sendMessage(msg.chat, { document: fs.readFileSync(path.join(DIR, f + '_x.gif')), mimetype: 'image/gif', fileName: 'grokbot_' + kind + '_' + f + '.gif', caption }) } catch (e) { console.error('[movcalabaza]', f, e?.message) }
        await sleep(900)
        continue
      }
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movcalabaza]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movcalabaza]', f, e?.message) }
      await sleep(1200)
    }
  },
}
