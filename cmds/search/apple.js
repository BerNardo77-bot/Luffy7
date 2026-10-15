import { musicKind, searchItunes, pageMusicQuery, strongAlbum } from '../../lib/music-page.js'
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
        if (!mk) {
          // Otra página (blog de música, etc.): saca artista/título y busca en Apple Music
          const pq = await pageMusicQuery(url)
          if (!pq) return msg.reply(`《✧》 No pude saber qué música es esa página.\n${url}`)
          return await buscar(pq)
        }
        if (mk.kind !== 'track' && mk.kind !== 'album') {
          return msg.reply(`《✧》 Ese link no es una canción ni un álbum de Apple Music (también sirven Spotify, Genius y Deezer).\n${url}`)
        }
        return await musicaDesdePagina({ msg, sock, usedPrefix: P, item: { url, title: '' }, mk })
      }
      return await buscar(q)
      async function buscar(q) {
      let items = (await searchItunes(q)).slice(0, 12)
      if (!items.length && q.split(' ').length > 3) items = (await searchItunes(q.split(' ').slice(0, 4).join(' '))).slice(0, 12)
      const strong = strongAlbum(items, q)
      if (strong) return musicaDesdePagina({ msg, sock, usedPrefix: P, item: { url: strong.albumUrl, title: strong.title, image: strong.image }, mk: musicKind(strong.albumUrl) })
      if (!items.length) return msg.reply(`《✧》 No encontré nada en Apple Music para: ${q}`)
      savePick(msg.chat, { sender: msg.sender, site: ALBUM_SITE, items, msg, fromMe: msg.fromMe })
      const lista = items.map((t, i) => `${i + 1}. ${t.type === 'album' ? '💿' : '🎵'} ${t.title} — ${t.artist}`).join('\n')
      const caption = `🍎 *Apple Music:* ${q}\n\n${lista}\n\n✎ Responde con un número (vale 5 min): 🎵 te mando el audio, 💿 te muestro las canciones del álbum.`
      const img = items[0]?.image
      if (img) {
        try { return await sock.sendMessage(msg.chat, { image: { url: img }, caption: caption.slice(0, 1000) }, { quoted: msg }) } catch {}
      }
      return msg.reply(caption)
      }
    } catch (e) {
      console.error('[apple]', e?.message || e)
      return msg.reply(`《✧》 Error: ${String(e?.message || e).slice(0, 150)}`)
    }
  }
}
