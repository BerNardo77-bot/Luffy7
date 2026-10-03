import db from '#db'
import { prefijoActual } from '../../lib/prefijo.js'
import { buscarImagen, descargarImagen } from '../../lib/imagenWeb.js'

// La búsqueda web de "ani" cae en el logo de ANI News. Esta es la captura oficial publicada por Elon.
const ANI_FOTO = 'https://pbs.twimg.com/media/Gvz_29KbsAABI9d.jpg?name=orig'
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
      const normalizedText = text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      const esAni = ['ani', 'ani grok', 'ani de grok'].includes(normalizedText)
      let img = esAni ? await descargarImagen(ANI_FOTO) : null
      if (!img) img = await buscarImagen(esAni ? 'Grok Ani companion' : text, { safe: !nsfwOn, omitir: esAni ? ['google', 'bing'] : [] })
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
