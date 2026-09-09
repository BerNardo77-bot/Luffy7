import fetch from 'node-fetch'

const FALLBACK_KEY = 'LUFFY-FIX67'

export function getApiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}

export function getApiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

export function extractAiText(json) {
  if (!json) return ''
  const v = json.result ?? json.response ?? json.data?.result ?? json.data?.response ?? json.message
  if (typeof v === 'string') return v.trim()
  if (v != null) return String(v).trim()
  return ''
}

/**
 * @param {{ msg: any, sock: any, args: string[], label: string, endpoint: string }} opts
 */
export async function runAiChat({ msg, sock, args, label, endpoint }) {
  const text = args.join(' ').trim()
  if (!text) {
    return msg.reply(`✎ Escribe una petición para *${label}*.\nEjemplo: #${endpoint} hola`)
  }

  const base = getApiBase()
  const keys = [getApiKey()]
  if (keys[0] !== FALLBACK_KEY) keys.push(FALLBACK_KEY)

  const status = await sock.sendMessage(
    msg.chat,
    { text: `✎ *${label}* está pensando...` },
    { quoted: msg }
  )

  let last = 'Sin respuesta'
  try {
    for (const key of keys) {
      try {
        const url = `${base}/ai/${endpoint}?text=${encodeURIComponent(text)}&key=${encodeURIComponent(key)}`
        const res = await fetch(url)
        const json = await res.json().catch(() => ({}))
        const out = extractAiText(json)
        if (json?.status && out) {
          await sock.sendMessage(msg.chat, { text: out.slice(0, 4000), edit: status.key })
          return
        }
        last = json?.message || last
      } catch (e) {
        last = e.message || last
      }
    }
    await sock.sendMessage(msg.chat, {
      text: `✎ No pude obtener respuesta de *${label}*.\n${last}`,
      edit: status.key
    })
  } catch (error) {
    console.error(`[ai/${endpoint}]`, error)
    await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(error?.message || error))
  }
}
