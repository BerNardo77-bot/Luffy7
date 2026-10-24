import fs from 'fs'
import path from 'path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const COLORS = { cafe: 'café', rojo: 'rojo', naranja: 'naranja', amarillo: 'amarillo', verde: 'verde', gris: 'gris', rosa: 'rosa', morado: 'morado', azul: 'azul' }
const norm = (s) => (s || '').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/)[0]
const ITEMS = [
  ['01_mirando', "Mirando..."],
  ['02_girando', "¿Quién?"],
  ['03_girando_diagonal', "Pensándolo bien"],
  ['04_clics', "Buscando..."],
  ['05_parpadeo', "¿Mande?"],
  ['06_avanzando', "Trabajando en eso"],
  ['07_pensando', "Pensando..."],
  ['08_dormido', "Tengo sueño"],
  ['09_sorprendido', "¡¿Qué?!"],
  ['10_nervioso', "Nervioso"],
  ['11_triste', "Triste"],
  ['12_guino', "¡Guiño!"],
  ['13_entrecerrar', "Entrecerrando los ojos"],
  ['14_lado_a_lado', "Haciéndolo"],
  ['15_latido', "Encargándose"],
  ['16_brincando', "Brincando"],
  ['17_vueltas', "Dándole vueltas al asunto"],
  ['18_sacandolo', "Sacándolo adelante"],
  ['19_vuelta', "Dando la vuelta"],
  ['20_estrella', "Grok Bot ⭐"],
  ['21_encargandose', "Encargándose"],
  ['22_puntos', "Reflexionando al respecto"],
]

export default {
  command: ['movcolor', 'movimientoscolor', 'colorbot'],
  category: 'stickers',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const c = norm((args || []).join(' '))
    const p = usedPrefix || ''
    if (!COLORS[c]) return sock.sendMessage(msg.chat, { text: `✿ Elige un color:\n${Object.values(COLORS).map((n) => `• ${n}`).join('\n')}\n\nEjemplo: ${p}movcolor rojo` }, { quoted: msg })
    const DIR = path.resolve('assets/movimientos_' + c)
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    for (const [f, caption] of ITEMS) {
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movcolor]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movcolor]', f, e?.message) }
      await sleep(1200)
    }
  },
}
