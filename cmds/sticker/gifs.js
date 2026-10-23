import fs from 'fs'
import path from 'path'

const DIR = path.resolve('assets/gifs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default {
  command: ['gifs', 'grokgifs'],
  category: 'stickers',
  run: async ({ msg, sock }) => {
    let files = []
    try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mp4')).sort() } catch {}
    if (!files.length) return sock.sendMessage(msg.chat, { text: '✿ No encontré los gifs.' }, { quoted: msg })
    for (const f of files) {
      const caption = f.replace(/^\d+_/, '').replace(/\.mp4$/, '')
      try { await sock.sendMessage(msg.chat, { video: fs.readFileSync(path.join(DIR, f)), gifPlayback: true, mimetype: 'video/mp4', caption }) } catch (e) { console.error('[gifs]', f, e?.message) }
      await sleep(1200)
    }
  },
}
