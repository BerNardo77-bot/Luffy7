import fetch from 'node-fetch'
import FormData from 'form-data'

const NANO_API = 'https://api-faa.my.id/faa/nano-banana'
const OMEGA_EDIT = 'https://omegatech-api.dixonomega.tech/api/ai/nano-banana'
const OMEGA_TXT = 'https://omegatech-api.dixonomega.tech/api/ai/nano-banana-pro'

async function uploadToUguu(buffer) {
  const body = new FormData()
  body.append('files[]', buffer, 'image.jpg')
  const res = await fetch('https://uguu.se/upload.php', {
    method: 'POST',
    body,
    headers: body.getHeaders()
  })
  const json = await res.json().catch(() => ({}))
  return json.files?.[0]?.url || null
}

function isImageMime(mime) {
  return /image\/(jpe?g|png|webp)/i.test(mime || '')
}

async function fetchEditBuffer(imageUrl, prompt) {
  const qs = `url=${encodeURIComponent(imageUrl)}&prompt=${encodeURIComponent(prompt)}`

  // Primary: api-faa (returns raw PNG)
  try {
    const res = await fetch(`${NANO_API}?${qs}`, { timeout: 120000 })
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = String(res.headers.get('content-type') || '')
      if (ct.startsWith('image/') && buf.length > 256) return buf
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length > 256) return buf
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 256) return buf
    }
  } catch (e) {
    console.error('[nano] api-faa', e?.message || e)
  }

  // Fallback: omega edit (JSON or image)
  try {
    const res = await fetch(`${OMEGA_EDIT}?${qs}`, { timeout: 120000 })
    const ct = String(res.headers.get('content-type') || '')
    const buf = Buffer.from(await res.arrayBuffer())
    if (ct.startsWith('image/') && buf.length > 256) return buf
    try {
      const json = JSON.parse(buf.toString('utf8'))
      const out =
        json?.image ||
        json?.url ||
        json?.result ||
        json?.data?.image ||
        json?.data?.url
      if (typeof out === 'string' && /^https?:\/\//i.test(out)) {
        const img = await fetch(out, { timeout: 60000 })
        if (img.ok) {
          const ib = Buffer.from(await img.arrayBuffer())
          if (ib.length > 256) return ib
        }
      }
    } catch {}
  } catch (e) {
    console.error('[nano] omega-edit', e?.message || e)
  }

  return null
}

async function fetchTextToImage(prompt) {
  try {
    const res = await fetch(
      `${OMEGA_TXT}?prompt=${encodeURIComponent(prompt)}`,
      { timeout: 120000 }
    )
    const json = await res.json().catch(() => ({}))
    const out = json?.image || json?.url || json?.result || json?.data?.image
    if (typeof out === 'string' && /^https?:\/\//i.test(out)) {
      const img = await fetch(out, { timeout: 60000 })
      if (img.ok) {
        const ib = Buffer.from(await img.arrayBuffer())
        if (ib.length > 256) return ib
      }
    }
  } catch (e) {
    console.error('[nano] omega-txt', e?.message || e)
  }
  return null
}

export default {
  command: ['nano', 'nanobanana'],
  category: 'ai',
  run: async ({ msg, sock, args, command, text, usedPrefix: prefix }) => {
    const prompt = (text || args.join(' ') || '').trim()
    const q = msg.quoted || msg
    const mime = q.mimetype || q.msg?.mimetype || ''

    try {
      if (!prompt) {
        return msg.reply(
          `✎ Responde a una *imagen* con:\n*${prefix}${command}* <descripción>\n\nEjemplo:\n*${prefix}${command}* hazla estilo anime`
        )
      }

      const hasImage = isImageMime(mime)

      const status = await sock.sendMessage(
        msg.chat,
        { text: '✎ *NanoBanana* está editando tu imagen…' },
        { quoted: msg }
      )

      let result = null

      if (hasImage) {
        const buffer = await q.download()
        if (!buffer?.length) {
          return sock.sendMessage(msg.chat, {
            text: '✎ No pude descargar la imagen.',
            edit: status.key
          })
        }

        const uploadedUrl = await uploadToUguu(buffer)
        if (!uploadedUrl) {
          return sock.sendMessage(msg.chat, {
            text: '✎ No pude subir la imagen para editarla.',
            edit: status.key
          })
        }

        result = await fetchEditBuffer(uploadedUrl, prompt)
      } else {
        // Sin imagen: generar desde texto
        await sock.sendMessage(msg.chat, {
          text: '✎ No hay imagen citada; generando desde el prompt…',
          edit: status.key
        })
        result = await fetchTextToImage(prompt)
      }

      if (!result) {
        return sock.sendMessage(msg.chat, {
          text: '✎ NanoBanana no devolvió una imagen. Intenta de nuevo en un rato.',
          edit: status.key
        })
      }

      await sock.sendMessage(
        msg.chat,
        {
          image: result,
          caption: `🍌 *NanoBanana*\n✎ ${prompt.slice(0, 200)}`
        },
        { quoted: msg }
      )

      try {
        await sock.sendMessage(msg.chat, {
          text: '✎ Listo.',
          edit: status.key
        })
      } catch {}
    } catch (error) {
      console.error('[nano]', error)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(error?.message || error))
    }
  }
}
