import fetch from 'node-fetch'

export default {
  command: ['ams', 'applemusicsearch'],
  category: 'search',
  run: async ({ msg, sock, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return msg.reply('✎ Uso: #ams <canción o artista>')
    }

    await msg.reply('✎ Buscando en Apple Music / iTunes...')
    try {
      // Alyacore applemusic está caído → iTunes Search API pública
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=8`,
        { headers: { 'User-Agent': 'Luffy7' } }
      )
      const json = await res.json().catch(() => ({}))
      const list = json?.results || []
      if (!list.length) {
        return msg.reply(`✎ No encontré resultados para *${query}*`)
      }

      let texto = `✦ Apple Music / iTunes: *${query}*\n\n`
      list.forEach((song, i) => {
        texto += `➪ ${i + 1}. ${song.trackName || song.collectionName || '?'}\n`
        texto += `   › Artista: ${song.artistName || '?'}\n`
        texto += `   › Álbum: ${song.collectionName || '?'}\n`
        texto += `   › Enlace: ${song.trackViewUrl || song.collectionViewUrl || '?'}`
        if (i !== list.length - 1) texto += `\n\n`
      })

      const first = list[0]
      const thumb = first.artworkUrl100?.replace('100x100bb', '600x600bb') || first.artworkUrl100
      if (thumb) {
        await sock.sendMessage(
          msg.chat,
          { image: { url: thumb }, caption: texto.slice(0, 3500) },
          { quoted: msg }
        )
      } else {
        await msg.reply(texto.slice(0, 3500))
      }
    } catch (e) {
      console.error('[ams]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
