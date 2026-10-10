import fetch from 'node-fetch'
import { prefijoActual } from '../../lib/prefijo.js';
import { miniaturaYouTube } from '../../lib/ytMiniatura.js';
import { savePick, readPick, clearPick, bareNumber } from '../../lib/nsfw-pick.js';
import play2, { MAX_DURATION_SEC, parseDurationToSeconds } from '../dl/play2.js';
import { MAX_VIDEO_MIN } from '../../lib/limits.js';
import { parseDurationFilter, filterLabel, passes } from '../../lib/dur-filter.js';
import { ytdlpSearch, fmtClock } from '../../lib/mediadl.js';

const FALLBACK_KEY = 'LUFFY-FIX67'
// Cuántos resultados se mandan (cada uno es un mensaje con su miniatura)
const MAX_RESULTADOS = 10
// Pausa entre mensajes para no hacer spam ni chocar con el límite de WhatsApp
const PAUSA_MS = 700

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const YT_SITE = 'youtube'

function resultUrl(v) {
  const direct = String(v?.url || v?.link || '').trim()
  if (/^https?:\/\//i.test(direct) && /youtu(\.be|be\.com)/i.test(direct)) return direct
  const id = String(v?.videoId || v?.id || '').trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return `https://youtu.be/${id}`
  const m = direct.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (m) return `https://youtu.be/${m[1]}`
  return /^https?:\/\//i.test(direct) ? direct : ''
}

// Segundos para el tope de ytvideo. 0 = desconocido (se deja que ytvideo lo mida).
function resultSeconds(v) {
  let best = 0
  const consider = (n) => {
    if (Number.isFinite(n) && n > best && n < 24 * 3600) best = n
  }
  consider(Number(v?.seconds))
  consider(parseDurationToSeconds(v?.duration))
  consider(parseDurationToSeconds(v?.timestamp))
  consider(parseDurationToSeconds(v?.length))
  const labeled = String(v?.duration || v?.timestamp || '').trim().toLowerCase()
  if (labeled && !labeled.includes(':')) {
    const h = labeled.match(/(\d+)\s*h/)
    const m = labeled.match(/(\d+)\s*m/)
    const s = labeled.match(/(\d+)\s*s/)
    if (h || m || s) {
      consider((Number(h?.[1] || 0) * 3600) + (Number(m?.[1] || 0) * 60) + Number(s?.[1] || 0))
    }
  }
  return best
}

function rememberResults(msg, list) {
  const items = []
  for (const v of (list || []).slice(0, MAX_RESULTADOS)) {
    const url = resultUrl(v)
    if (!url) continue
    items.push({
      title: String(v.title || 'Sin título'),
      url,
      duration: String(v.duration || v.timestamp || '').trim(),
      seconds: resultSeconds(v)
    })
  }
  if (!items.length) return 0
  savePick(msg.chat, { sender: msg.sender, site: YT_SITE, items, msg, fromMe: msg.fromMe })
  return items.length
}

async function takeNumber({ msg, sock, usedPrefix }) {
  const n = bareNumber(msg)
  if (n == null) return false
  const hit = readPick(msg)
  if (!hit || hit.site !== YT_SITE) return false
  if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
    await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
    return true
  }
  const item = hit.items[n - 1]
  if (!item?.url) {
    await msg.reply('Ese resultado no tiene enlace.')
    return true
  }
  const sec = Number(item.seconds) || parseDurationToSeconds(item.duration)
  if (sec > MAX_DURATION_SEC) {
    const P = await prefijoActual({ sock, usedPrefix })
    const title = String(item.title || 'Ese video').replace(/\s+/g, ' ').trim().slice(0, 160)
    await msg.reply(
      `《✧》 *${title}* dura ~${Math.round(sec / 60)} min.\n` +
      `El límite es ${MAX_VIDEO_MIN} min (como ${P}ytvideo). No lo bajo.\n` +
      `🔗 ${item.url}`
    )
    return true
  }
  clearPick(msg)
  try {
    await play2.run({ msg, sock, args: [item.url], usedPrefix })
  } catch (e) {
    console.error('[ytsearch] descarga', e?.message || e)
    await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
  }
  return true
}

export async function before(ctx) {
  try {
    return await takeNumber(ctx)
  } catch (e) {
    console.error('[ytsearch] pick', e?.message || e)
    let ours = false
    try {
      const hit = readPick(ctx?.msg)
      ours = !!(hit && hit.site === YT_SITE && bareNumber(ctx?.msg) != null)
    } catch {}
    if (!ours) return false
    try { await ctx.msg.reply(`《✧》 Error: ${e?.message || e}`) } catch {}
    return true
  }
}

// Pie de foto de un resultado
function textoResultado(v, i, total) {
  const title = v.title || '?'
  const author = v.autor || v.author?.name || v.author || v.channel || ''
  const dur = v.duration || v.timestamp || (resultSeconds(v) ? fmtClock(resultSeconds(v)) : '')
  // Los directos llegan con 0 vistas y sin duración: no se muestran esos campos
  const views = v.views && String(v.views) !== '0' ? v.views : ''
  const up = v.uploaded || v.ago || ''
  const link = v.url || ''
  return (
    `➩ *${i + 1}/${total}. ${title}*\n` +
    (dur ? `> ✤ Duración › ${dur}\n` : '') +
    (author ? `> ❀ Canal › ${author}\n` : '') +
    (views ? `> ꕥ Vistas › ${views}\n` : '') +
    (up ? `> ✰ Subido › ${up}\n` : '') +
    `> ❑ Enlace › ${link}`
  ).slice(0, 1000)
}

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}

function apiKeys() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  const keys = [key]
  if (key !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  return keys
}

export default {
  command: ['ytsearch', 'search', 'yts'],
  category: 'search',
  run: async ({ msg, sock, args, usedPrefix }) => {
    const P = await prefijoActual({ sock, usedPrefix })
    console.error('[ytsearch] build 1.1.33 numero descarga ytvideo', P)
    const raw = args.join(' ').trim()
    const filtro = parseDurationFilter(raw)
    const query = filtro.query
    if (!query) {
      return msg.reply(`✎ Uso: ${P}ytsearch <texto> [+20min | -5min | +1h | largo]\nEjemplo: ${P}ytsearch Naruto vs Orochimaru +20min`)
    }

    const status = await msg.reply(`✎ Buscando en YouTube${filtro.active ? ` videos ${filterLabel(filtro)}` : ''}...`)
    const base = apiBase()
    let last = 'Sin resultados'
    let list = null
    // Con filtro de duración se usa yt-dlp (trae duración exacta y más resultados)
    if (!filtro.active) {
      for (const key of apiKeys()) {
        try {
          const url = `${base}/search/yt?query=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`
          const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
          const json = await res.json().catch(() => ({}))
          const l = json?.result || json?.data || []
          if (!json?.status || !Array.isArray(l) || !l.length) {
            last = (res.status === 429 || json?.code === 429) ? 'alyacore sin saldo (429)' : (json?.message || last)
            continue
          }
          list = l
          break
        } catch (e) {
          last = e.message || last
        }
      }
    }
    if (!list) {
      try {
        list = await ytdlpSearch(query, filtro.active ? 40 : 15)
      } catch (e) {
        last += ` · yt-dlp: ${String(e?.message || e).slice(0, 120)}`
      }
    }
    let top = (list || []).filter((v) => passes(resultSeconds(v), filtro)).slice(0, MAX_RESULTADOS)
    if (!top.length) {
      return msg.reply(`✎ No encontré videos${filtro.active ? ` ${filterLabel(filtro)}` : ''} para *${query}*.\n${last}`)
    }

    const guardados = rememberResults(msg, top)

    // 2) Envío: un mensaje por resultado. Miniaturas en paralelo; si una falla, ese resultado va en texto
    try {
      const miniaturas = await Promise.all(
        top.map((v) => miniaturaYouTube(v.videoId, v.url, v.banner || v.thumbnail || v.image).catch(() => null))
      )
      try {
        const rango = guardados ? ` Responde con un número del 1 al ${guardados} (vale 5 min) para descargarlo.` : ''
        await sock.sendMessage(msg.chat, { text: `✎ ${top.length} resultado${top.length === 1 ? '' : 's'} para *${query}*.${rango}`, edit: status.key })
      } catch {}

      for (let i = 0; i < top.length; i++) {
        if (i > 0) await esperar(PAUSA_MS)
        const caption = textoResultado(top[i], i, top.length)
        const thumb = miniaturas[i]
        try {
          if (thumb) {
            await sock.sendMessage(msg.chat, { image: thumb.buffer, mimetype: thumb.mimetype, caption }, { quoted: msg })
            continue
          }
        } catch (e) {
          console.error(`[ytsearch] miniatura ${i + 1} no enviada, mando texto:`, e?.message || e)
        }
        try {
          await sock.sendMessage(msg.chat, { text: caption }, { quoted: msg })
        } catch (e) {
          console.error(`[ytsearch] resultado ${i + 1} no enviado:`, e?.message || e)
        }
      }
    } catch (e) {
      console.error('[ytsearch] envío', e)
      await msg.reply(typeof msgglobal !== 'undefined' ? msgglobal : String(e?.message || e))
    }
  }
}
