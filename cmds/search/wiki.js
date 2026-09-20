import fetch from 'node-fetch'

const UA = { 'User-Agent': 'Luffy7-WhatsApp/1.1.15 (wiki)' }

async function wikiSearch(q) {
  const searchUrl =
    `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=` +
    `${encodeURIComponent(q)}&format=json&utf8=1&srlimit=5`
  const res = await fetch(searchUrl, { headers: UA })
  const json = await res.json().catch(() => ({}))
  return json?.query?.search || []
}

async function wikiExtract(title) {
  const url =
    `https://es.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=0&explaintext=1` +
    `&redirects=1&format=json&titles=${encodeURIComponent(title)}`
  const res = await fetch(url, { headers: UA })
  const json = await res.json().catch(() => ({}))
  const pages = json?.query?.pages || {}
  const page = Object.values(pages)[0]
  if (!page || page.missing != null) return null
  return {
    title: page.title,
    extract: String(page.extract || '').trim(),
    pageid: page.pageid
  }
}

function articleUrl(title) {
  return `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

export default {
  command: ['wiki', 'wikipedia'],
  category: 'search',
  run: async ({ msg, sock, args, text }) => {
    console.error('[wiki] build 121 summary+link')
    const q = (text || args.join(' ')).trim()
    if (!q) return msg.reply('✎ Uso: #wiki <tema>\nEjemplo: #wiki Albert Einstein')

    await msg.reply('✎ Buscando en Wikipedia...')
    try {
      const results = await wikiSearch(q)
      if (!results.length) {
        return msg.reply(`✎ Sin resultados en Wikipedia para *${q}*`)
      }

      // 1) Artículo principal: resumen + link
      const best = results[0]
      const full = await wikiExtract(best.title)
      const link = articleUrl(full?.title || best.title)
      const body = (full?.extract || String(best.snippet || '').replace(/<[^>]+>/g, '')).trim()
      const summary = body.length > 2800 ? body.slice(0, 2800).trim() + '…' : body

      let mainMsg =
        `❑ *Wikipedia*\n` +
        `> ✿ ${q}\n\n` +
        `*${full?.title || best.title}*\n\n` +
        `${summary || '(sin extracto)'}\n\n` +
        `🔗 Artículo completo:\n${link}`

      await msg.reply(mainMsg.slice(0, 3500))

      // 2) Otras coincidencias (cortas)
      if (results.length > 1) {
        let more = `❑ *Otras coincidencias*\n\n`
        for (const r of results.slice(1, 5)) {
          const snippet = String(r.snippet || '').replace(/<[^>]+>/g, '')
          more += `• *${r.title}*\n${snippet}\n🔗 ${articleUrl(r.title)}\n\n`
        }
        await msg.reply(more.trim().slice(0, 3500))
      }
    } catch (e) {
      console.error('[wiki]', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
