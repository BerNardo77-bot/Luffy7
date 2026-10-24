import fs from 'fs'
import path from 'path'

const DIR = path.resolve('assets/movimientos_cian')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ITEMS = [
  ['01_mirando', "Mirando..."],
  ['02_girando', "¿Quién?"],
  ['03_girando_diagonal', "Pensándolo bien"],
  ['04_clics', "Buscando..."],
  ['05_parpadeo', "¿Mande?"],
  ['06_avanzando', "Avanzando poco a poco"],
  ['07_pensando', "Pensando..."],
  ['08_dormido', "Tengo sueño"],
  ['09_sorprendido', "¡¿Qué?!"],
  ['10_nervioso', "Nervioso"],
  ['11_triste', "Triste"],
  ['12_guino', "¡Guiño!"],
  ['13_entrecerrar', "Entrecerrando los ojos"],
  ['14_lado_a_lado', "De lado a lado"],
  ['15_latido', "Latiendo"],
  ['16_brincando', "Brincando"],
  ['17_vueltas', "Dando vueltas"],
  ['18_sacandolo', "Sacándolo adelante"],
  ['19_vuelta', "Dando la vuelta"],
]

export default {
  command: ['movcian', 'movimientoscian'],
  category: 'stickers',
  run: async ({ msg, sock }) => {
    if (!fs.existsSync(DIR)) return sock.sendMessage(msg.chat, { text: '✿ No encontré los movimientos.' }, { quoted: msg })
    for (const [f, caption] of ITEMS) {
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f + '.webp')), isAnimated: true }) } catch (e) { console.error('[movcian]', f, e?.message) }
      await sleep(700)
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f + '.mp4')), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[movcian]', f, e?.message) }
      await sleep(1200)
    }
  },
}
