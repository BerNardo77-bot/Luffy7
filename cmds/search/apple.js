import { musicKind, searchItunes } from '../../lib/music-page.js'
import { musicaDesdePagina, ALBUM_SITE } from './google.js'
import { savePick } from '../../lib/nsfw-pick.js'

// $ apple <link de Apple Music> → canción: audio; álbum: lista numerada (5 min)
// $ apple <texto> → busca en Apple Music (iTunes) y muestra canciones y álbumes
export default {
  command: ['apple', 'applemusic', 'am'],
  category: 'downloader',
  run: async ({ msg, sock, args, text, usedPrefix }) => {
    const P = usedPrefix || '$'
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply(`✎ Uso: ${P}apple <link de Apple Music o nombre>\nEjemplo: ${P}apple https://music.apple.com/…/album/…\nEjemplo: ${P}apple Dei V Candy Man`)
    try {
      const url = (q.match(/https?:\/\/\S+/) || [])[0]
      if (url) {
        const mk = musicKind(url)
        if (!mk || (mk.kind !== 'track' && mk.kind !== 'album')) {
          return msg.reply(`《✧》 Ese link no es una canción ni un álbum de Apple Music (también sirven Spotify, Genius y Deezer).\n${url}`)
        }
        return await musicaDesdePagina({ msg, sock, usedPrefix: P, item: { url, title: '' }, mk })
      }
      const items = (await searchItunes(q)).slice(0, 12)
      if (!items.length) return msg.reply(`《✧》 No encontré nada en Apple Music para: ${q}`)
      savePick(msg.chat, { sender: msg.sender, site: ALBUM_SITE, items, msg, fromMe: msg.fromMe })
      const lista = items.map((t, i) => `${i + 1}. ${t.type === 'album' ? '💿' : '🎵'} ${t.title} — ${t.artist}`).join('\n')
      const caption = `🍎 *Apple Music:* ${q}\n\n${lista}\n\n✎ Responde con un número (vale 5 min): 🎵 te mando el audio, 💿 te muestro las canciones del álbum.`
      const img = items[0]?.image
      if (img) {
        try { return await sock.sendMessage(msg.chat, { image: { url: img }, caption: caption.slice(0, 1000) }, { quoted: msg }) } catch {}
      }
      return msg.reply(caption)
    } catch (e) {
      console.error('[apple]', e?.message || e)
      return msg.reply(`《✧》 Error: ${String(e?.message || e).slice(0, 150)}`)
    }
  }
}
