import db from '#db'
import { buscarImagen } from '../../lib/imagenWeb.js'
import { prefijoActual } from '../../lib/prefijo.js';

export default {
  command: ['imagen', 'img', 'image'],
  category: 'search',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    const text = args.join(' ').trim()
    if (!text) return msg.reply(`✎ Uso: ${P}imagen <texto>`)

    const banned = ['xxx', 'porn', 'porno', 'xnxx', 'xvideos', 'onlyfans', 'hentai']
    const chatData = await db.getChat(msg.chat)
    const nsfwOn = chatData?.nsfw === 1
    if (!nsfwOn && banned.some((w) => text.toLowerCase().includes(w))) {
      return msg.reply(`✤ Este comando no permite búsquedas NSFW (activa ${P}nsfw enable en el grupo).`)
    }

    await msg.reply('✎ Buscando imagen...')

    try {
      // Descarga la imagen como buffer y valida que sea JPEG/PNG real antes de enviarla
      const img = await buscarImagen(text, { safe: !nsfwOn })
      if (!img) {
        return msg.reply(`✎ No pude conseguir una imagen para *${text}*. Prueba con otras palabras o intenta de nuevo en un momento.`)
      }
      await sock.sendMessage(msg.chat, { image: img.buffer, mimetype: img.mimetype, caption: `✿ ${text}` }, { quoted: msg })
    } catch (e) {
      console.error('[imagen]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
