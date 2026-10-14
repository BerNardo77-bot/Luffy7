import { replyDlError } from './oversize.js'
// #xnxx / #xvideos: texto → lista de 10 (miniatura por resultado), número 1-10 → descarga,
// enlace → descarga directa. Mejor calidad con yt-dlp (≤1080p, H.264, sin recomprimir, ≤500 MB).
import db from '#db'
import { prefijoActual } from './prefijo.js'
import { normalizeResults, savePick, readPick, clearPick, bareNumber } from './nsfw-pick.js'
import { bajarMiniatura } from './nsfw-choice.js'
import { fillResults, cleanVideoUrl, cleanThumbUrl, NSFW_LIST_MAX } from './nsfw-site-search.js'
import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from './limits.js'
import { ytdlpToFile, urlToFile, sendVideoFile, friendlyError, isNoCredit, mb } from './mediadl.js'

const PAUSA_MS = 1200
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const SITES = {
  xnxx: { name: 'XNXX', host: /xnxx\.(com|tv|es)/i, apiDl: (u) => `/nsfw/dl/xnxx?url=${encodeURIComponent(u)}` },
  xvideos: { name: 'XVideos', host: /xvideos\.(com|es|red)|xvideos\d*\.com/i, apiDl: (u) => `/nsfw/dl/xvideos?url=${encodeURIComponent(u)}` }
}

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}
function apiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = 'LUFFY-FIX67'
  return key
}

async function apiSearch(site, query) {
  try {
    const res = await fetch(`${apiBase()}/nsfw/search/${site}?query=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey())}`, { signal: AbortSignal.timeout(20000) })
    const json = await res.json().catch(() => ({}))
    if (isNoCredit(json, res.status)) { console.error(`[${site}] alyacore sin saldo (429)`); return [] }
    return json?.status ? normalizeResults(json.resultados || json.result || json.data || []) : []
  } catch (e) {
    console.error(`[${site}] api búsqueda`, e?.message || e)
    return []
  }
}

function caption(it, i, total, site) {
  const title = String(it?.title || 'Sin título').replace(/\s+/g, ' ').trim().slice(0, 160)
  return `➩ *${i + 1}/${total}. ${title}*\n` +
    (it.duration ? `> ✤ Duración › ${it.duration}\n` : '') +
    `> ❑ Enlace › ${it.url}`
}

export async function listResults({ msg, sock, site, query }) {
  const S = SITES[site]
  const status = await msg.reply(`✎ Buscando en ${S.name}…`)
  const api = await apiSearch(site, query)
  const all = (await fillResults(site, query, api, NSFW_LIST_MAX))
    .map((it) => ({ ...it, url: cleanVideoUrl(it.url), thumb: cleanThumbUrl(it.thumb) }))
    .slice(0, NSFW_LIST_MAX)
  if (!all.length) {
    return msg.reply(`✎ No encontré videos de ${S.name} para *${query}*.`)
  }
  savePick(msg.chat, { sender: msg.sender, site, items: all, msg, fromMe: msg.fromMe })
  try { await sock.sendMessage(msg.chat, { text: `✎ ${all.length} resultados de ${S.name} para *${query}*.`, edit: status.key }) } catch {}
  const thumbs = await Promise.all(all.map((it) => (it.thumb ? bajarMiniatura(it.thumb).catch(() => null) : null)))
  for (let i = 0; i < all.length; i++) {
    if (i > 0) await esperar(PAUSA_MS)
    const cap = caption(all[i], i, all.length, site)
    const t = thumbs[i]
    try {
      if (t) {
        await sock.sendMessage(msg.chat, { image: t.buffer || t, caption: cap }, { quoted: msg })
        continue
      }
    } catch (e) { console.error(`[${site}] miniatura ${i + 1}`, e?.message || e) }
    await sock.sendMessage(msg.chat, { text: cap }, { quoted: msg }).catch((e) => console.error(`[${site}] resultado ${i + 1}`, e?.message || e))
  }
  await esperar(PAUSA_MS)
  await sock.sendMessage(msg.chat, { text: `Responde con el número (1-${all.length}) para descargar · vale 5 min` }, { quoted: msg }).catch(() => {})
}

export async function downloadNsfw({ msg, sock, site, url }) {
  const S = SITES[site]
  url = cleanVideoUrl(url)
  await msg.reply(`《✧》 Bajando ${S.name} en la mejor calidad (hasta 1080p)…`)
  let ytErr
  try {
    const got = await ytdlpToFile(url, { heights: [1080, 720, 480, 360], maxSec: MAX_VIDEO_SEC, tag: site, onStatus: (t) => msg.reply(`《✧》 ${t}`).catch(() => {}) })
    await sendVideoFile(sock, msg, got.file, { caption: `${S.name} ${got.height ? got.height + 'p · ' : ''}${mb(got.size)} MB${got.title ? '\n' + got.title.slice(0, 150) : ''}`, fileName: `${site}.mp4` })
    return
  } catch (e) {
    ytErr = e
    console.error(`[${site}] yt-dlp`, e?.message || e)
    if (/^(TOO_LONG|TOO_BIG|NO_SPACE):/.test(String(e?.message))) return replyDlError({ msg, sock, e, url: url, maxSec: MAX_VIDEO_SEC, maxMin: MAX_VIDEO_MIN })
  }
  // Respaldo: enlaces de la API (alyacore)
  let motivo = 'sin respuesta'
  try {
    const res = await fetch(`${apiBase()}${S.apiDl(url)}&key=${encodeURIComponent(apiKey())}`, { signal: AbortSignal.timeout(60000) })
    const json = await res.json().catch(() => ({}))
    if (isNoCredit(json, res.status)) motivo = 'alyacore sin saldo (429)'
    const r = json?.resultado?.result || json?.result || json?.data || {}
    const dl = r.download || r.dl || r.files || {}
    const links = [dl.high, dl.url, dl.low, typeof dl === 'string' ? dl : ''].filter((x) => typeof x === 'string' && /^https?:/.test(x) && !/\.m3u8/.test(x))
    for (const link of links) {
      try {
        const got = await urlToFile(link, { tag: site })
        await sendVideoFile(sock, msg, got.file, { caption: `${S.name} · ${mb(got.size)} MB`, fileName: `${site}.mp4` })
        return
      } catch (e) { motivo = e?.message || motivo; if (/^(NO_SPACE|TOO_BIG):/.test(motivo)) return replyDlError({ msg, sock, e, url: url, maxSec: MAX_VIDEO_SEC, maxMin: MAX_VIDEO_MIN }) }
    }
    if (!links.length && motivo === 'sin respuesta') motivo = json?.message || 'la API no dio enlace'
  } catch (e) { motivo = e?.message || motivo }
  return msg.reply(`《✧》 No pude bajar el video.\n• yt-dlp: ${String(ytErr?.message || ytErr).slice(0, 180)}\n• Respaldo: ${motivo}\nSi sigue fallando: pkg upgrade yt-dlp\n${url}`)
}

// Número 1-10 en respuesta a la lista más reciente del chat (también desde la cuenta del bot).
export function makeBefore(site) {
  return async function before({ msg, sock }) {
    try {
      const n = bareNumber(msg)
      if (n == null) return false
      const hit = readPick(msg)
      if (!hit || hit.site !== site) return false
      if (!Number.isInteger(n) || n < 1 || n > hit.items.length) {
        await msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
        return true
      }
      const item = hit.items[n - 1]
      clearPick(msg)
      const chat = await db.getChat(msg.chat)
      if (!chat?.nsfw) { await msg.reply(typeof mess !== 'undefined' ? mess.nsfw : 'NSFW desactivado.'); return true }
      await downloadNsfw({ msg, sock, site, url: item.url })
      return true
    } catch (e) {
      console.error(`[${site}] número`, e?.message || e)
      return false
    }
  }
}

export function makeCommand(site, aliases) {
  const S = SITES[site]
  return {
    command: aliases,
    category: 'nsfw',
    run: async ({ msg, sock, args, usedPrefix }) => {
      const P = await prefijoActual({ sock, usedPrefix })
      console.error(`[${site}] build 1.1.47 lista 10 + número + yt-dlp HQ`)
      const chat = await db.getChat(msg.chat)
      if (!chat.nsfw) return msg.reply(mess.nsfw)
      try {
        const query = args.join(' ').trim()
        if (!query) return msg.reply(`✿ Uso: ${P}${site} <texto> (lista de 10) o ${P}${site} <enlace> (descarga).`)
        const link = query.match(/https?:\/\/\S+/)?.[0]
        if (link) {
          if (!S.host.test(link)) return msg.reply(`✿ Ese enlace no es de ${S.name}.`)
          return downloadNsfw({ msg, sock, site, url: link })
        }
        if (/^\d{1,2}$/.test(query)) {
          const hit = readPick(msg)
          if (hit && hit.site === site) {
            const n = Number(query)
            if (n < 1 || n > hit.items.length) return msg.reply(`Elige un número del 1 al ${hit.items.length}.`)
            clearPick(msg)
            return downloadNsfw({ msg, sock, site, url: hit.items[n - 1].url })
          }
        }
        return listResults({ msg, sock, site, query })
      } catch (err) {
        console.error(`[${site}]`, err)
        return msg.reply(`《✧》 Error: ${err?.message || err}`)
      }
    }
  }
}
