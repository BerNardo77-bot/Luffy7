import fetch from 'node-fetch'

export default {
  command: ['wiki', 'wikipedia'],
  category: 'search',
  run: async ({ msg, sock, args, text }) => {
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply('✎ Uso: #wiki <tema>')

    await msg.reply('✎ Buscando en Wikipedia...')
    try {
      const searchUrl =
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=` +
        `${encodeURIComponent(q)}&format=json&utf8=1`
      const res = await fetch(searchUrl, { headers: { 'User-Agent': 'Luffy7-WhatsApp' } })
      const json = await res.json().catch(() => ({}))
      const results = json?.query?.search || []
      if (!results.length) {
        return msg.reply(`✎ Sin resultados en Wikipedia para *${q}*`)
      }

      let replyText = `❑ *Wikipedia*\n> ✿ ${q}\n\n`
      for (const r of results.slice(0, 5)) {
        const snippet = String(r.snippet || '').replace(/<[^>]+>/g, '')
        replyText += `• *${r.title}*\n${snippet}\n\n`
      }
      await msg.reply(replyText.trim().slice(0, 3500))
    } catch (e) {
      console.error('[wiki]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
