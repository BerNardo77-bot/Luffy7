import db from "#db"
import fetch from 'node-fetch'
import { getBuffer } from "#serialize"
import { bajarImagen } from '../../lib/ytMiniatura.js'

export default {
  command: ['sp', 'spotify'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    try {
      if (!args[0]) {
        return msg.reply('✎ Por favor, menciona el nombre o URL de la canción que deseas descargar de Spotify')
      }

      const query = args.join(' ')
      let url, songInfo

      if (/open\.spotify\.com\/track\//i.test(query)) {
        url = query
        const resInfo = await fetch(`${api.url}/dl/spotify?url=${encodeURIComponent(url)}&key=${encodeURIComponent(api.key || "LUFFY-FIX67")}`)
        const resultInfo = await resInfo.json()
        if (!resultInfo.status) return msg.reply('❖ No se pudo procesar el enlace de Spotify.')
        songInfo = resultInfo.data
      } else {
        const search = await fetch(`${api.url}/search/spotify?query=${encodeURIComponent(query)}&key=${encodeURIComponent(api.key || "LUFFY-FIX67")}`)
        const data = await search.json()
        if (!data.status || !data.data.length) {
          return msg.reply('❖ No se encontraron resultados en Spotify')
        }
        songInfo = data.data[0]
        url = songInfo.url
      }

      const duracion = (!songInfo.duration || songInfo.duration.includes('NaN'))
        ? 'Desconocida'
        : songInfo.duration || ""

      const caption = `➪ Descargando › ${songInfo.title || songInfo.name}

> ✿⃘࣪◌ ֪ Artista › ${songInfo.artist || ""}
> ✿⃘࣪◌ ֪ Álbum › ${songInfo.album || ""}
> ✿⃘࣪◌ ֪ Fecha › ${songInfo.publish || songInfo.year}
> ✿⃘࣪◌ ֪ Duración › ${duracion || ""}
> ✿⃘࣪◌ ֪ Enlace › ${url || ""}

𐙚 ❀ ｡ ↻ El archivo se está enviando, espera un momento... ˙𐙚`

      let yi = songInfo.image || songInfo.cover

      // Portada descargada y validada; si falla, solo el texto (y sigue con el audio)
      const portada = yi ? await bajarImagen(yi) : null
      try {
        if (portada) await sock.sendMessage(msg.chat, { image: portada.buffer, mimetype: portada.mimetype, caption }, { quoted: msg })
        else await msg.reply(caption)
      } catch (e) {
        console.error('[sp] portada', e?.message || e)
        await msg.reply(caption).catch(() => {})
      }

      const resAudio = await fetch(`${api.url}/dl/spotify?url=${encodeURIComponent(url)}&key=${encodeURIComponent(api.key || "LUFFY-FIX67")}`)
      const resultAudio = await resAudio.json()
      if (!resultAudio.status || !resultAudio.data?.dl) {
        return msg.reply('❖ No se pudo descargar el audio de Spotify.')
      }

      const audioRes = await fetch(resultAudio.data.dl)
      if (!audioRes.ok) {
        return msg.reply('❖ Error al obtener el archivo de audio.')
      }
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer())

const mensaje = {
  document: audioBuffer, 
  mimetype: "audio/mpeg", 
  fileName: `${resultAudio.data.title || 'music'}.mp3` 
};

await sock.sendMessage(msg.chat, mensaje, { quoted: msg });

    } catch (e) {
      console.error('[sp]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => msg.reply(msgglobal))
    }
  }
}