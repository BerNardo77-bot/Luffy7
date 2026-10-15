import { musicKind, pageMusicQuery } from '../../lib/music-page.js'
import { musicaDesdePagina, buscarMusica } from './google.js'

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
          return await buscarMusica({ msg, sock, usedPrefix: P, q: pq })
        }
        if (mk.kind !== 'track' && mk.kind !== 'album') {
          return msg.reply(`《✧》 Ese link no es una canción ni un álbum de Apple Music (también sirven Spotify, Genius y Deezer).\n${url}`)
        }
        return await musicaDesdePagina({ msg, sock, usedPrefix: P, item: { url, title: '' }, mk })
      }
      return await buscarMusica({ msg, sock, usedPrefix: P, q })
    } catch (e) {
      console.error('[apple]', e?.message || e)
      return msg.reply(`《✧》 Error: ${String(e?.message || e).slice(0, 150)}`)
    }
  }
}
