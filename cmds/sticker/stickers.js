import fs from 'fs'
import path from 'path'

const DIR = path.resolve('assets/stickers')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default {
  command: ['stickers', 'grokstickers'],
  category: 'stickers',
  run: async ({ msg, sock }) => {
    let files = []
    try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort() } catch {}
    if (!files.length) return sock.sendMessage(msg.chat, { text: '✿ No encontré los stickers.' }, { quoted: msg })
    for (const f of files) {
      try { await sock.sendMessage(msg.chat, { sticker: fs.readFileSync(path.join(DIR, f)) }) } catch (e) { console.error('[stickers]', f, e?.message) }
      await sleep(1200)
    }
  },
}
