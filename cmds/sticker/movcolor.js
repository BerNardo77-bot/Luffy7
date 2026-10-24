// movcolor <color> [x] [número] — los 10 movimientos de Grok Bot en el color elegido. "x" = GIFs listos para X (documento).
import fs from 'fs'
import path from 'path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const COLORS = { cafe: 'café', rojo: 'rojo', naranja: 'naranja', amarillo: 'amarillo', verde: 'verde', gris: 'gris', rosa: 'rosa', morado: 'morado', azul: 'azul' }
const norm = (s) => (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0]
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
  command: ['movcolor', 'movimientoscolor', 'colorbot'],
  category: 'stickers',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const c = norm((args || []).join(' '))
    const p = usedPrefix || ''
    if (!COLORS[c]) return sock.sendMessage(msg.chat, { text: `✿ Elige un color:\n${Object.values(COLORS).map((n) => `• ${n}`).join('\n')}\n\nEjemplo: ${p}movcolor rojo  ·  ${p}movcolor rojo x  ·  ${p}movcolor rojo x 3` }, { quoted: msg })
    const DIR = path.resolve('assets/movimientos_' + c)
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    const a = (args || []).slice(1).map((s) => s.toLowerCase())
    const x = a.includes('x')
    const n = parseInt(a.find((s) => /^\d+$/.test(s)), 10)
    const list = n >= 1 && n <= ITEMS.length ? [ITEMS[n - 1]] : ITEMS
    for (const [f, caption] of list) {
      if (x) {
        try { await sock.sendMessage(msg.chat, { document: fs.readFileSync(path.join(DIR, f + '_x.gif')), mimetype: 'image/gif', fileName: 'grokbot_' + c + '_' + f + '.gif', caption }) } catch (e) { console.error('[movcolor]', f, e?.message) }
        await sleep(900)
        continue
      }
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movcolor]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movcolor]', f, e?.message) }
      await sleep(1200)
    }
  },
}
