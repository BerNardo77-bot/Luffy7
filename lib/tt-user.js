// #ttsearch @usuario [palabras]: lista los videos de un creador con yt-dlp y filtra por palabras.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import axios from 'axios'
import { withProxyFallback, ytDlpProxyArgs, axiosOpts } from './dl-proxy.js'
import { ttCookieArgs, hasTtCookies } from './tt-cookies.js'

const execFileAsync = promisify(execFile)
const MAX_ITEMS = Number(process.env.TT_USER_MAX) || 1200
const CACHE_MS = 30 * 60 * 1000
const cache = new Map() // user → { at, list }
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'y', 'o', 'en', 'con', 'por', 'para', 'que', 'the', 'of', 'a'])

export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// "@antiheroe66 historia de itachi" → { user: 'antiheroe66', words: ['historia','itachi'] }
export function parseUserQuery(q) {
  const m = String(q || '').match(/(?:^|\s)@([A-Za-z0-9_.]{2,24})\b/)
  if (!m) return null
  const rest = String(q).replace(m[0], ' ')
  const words = [...new Set(norm(rest).split(/[^a-z0-9ñ]+/).filter(w => w && !STOP.has(w)))]
  return { user: m[1].replace(/\.$/, ''), words }
}

export function mapEntry(e, user) {
  const thumbs = e.thumbnails || []
  const cover = (thumbs.find(t => /cover|origin/i.test(t.id || '')) || thumbs[0] || {}).url || ''
  return {
    id: String(e.id),
    title: String(e.title || e.description || '').trim(),
    description: String(e.description || '').trim(),
    author: { unique_id: e.uploader || user, nickname: e.channel || '' },
    url: e.url && /tiktok\.com/.test(e.url) ? e.url : `https://www.tiktok.com/@${user}/video/${e.id}`,
    cover,
    duration: Number(e.duration) || 0,
    timestamp: Number(e.timestamp) || 0
  }
}

// Coincidencia sin acentos: cuenta palabras que aparecen (título + descripción). Sin palabras → más nuevos.
export function rankUserVideos(list, words, max = 10) {
  const sorted = [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  if (!words.length) return sorted.slice(0, max)
  const scored = []
  for (const v of sorted) {
    const title = norm(v.title)
    const all = norm(`${v.title} ${v.description}`)
    let n = 0
    let inTitle = 0
    for (const w of words) {
      if (all.includes(w)) n++
      if (title.includes(w)) inTitle++
    }
    if (!n) continue
    const phrase = title.includes(words.join(' ')) ? 1 : 0
    scored.push({ v, n, inTitle, phrase })
  }
  // 1) cuántas palabras aparecen, 2) cuántas en el TÍTULO (no solo en hashtags), 3) frase seguida, 4) más nuevo
  scored.sort((a, b) => b.n - a.n || b.inTitle - a.inTitle || b.phrase - a.phrase || (b.v.timestamp || 0) - (a.v.timestamp || 0))
  return scored.slice(0, max).map(x => x.v)
}

async function listOnce(user, useProxy) {
  const { stdout } = await execFileAsync('yt-dlp', [
    '--flat-playlist', '-J', '--playlist-end', String(MAX_ITEMS), ...ytDlpProxyArgs(useProxy), ...ttCookieArgs(),
    `https://www.tiktok.com/@${user}`
  ], { timeout: 180000, maxBuffer: 200 * 1024 * 1024 })
  const json = JSON.parse(stdout)
  const list = (json.entries || []).filter(e => e?.id).map(e => mapEntry(e, user))
  if (!list.length) throw new Error('el usuario no tiene videos públicos (o no existe)')
  return list
}

// Error de yt-dlp legible (sin el "please report this issue…")
export function ytDlpReason(e) {
  const raw = String(e?.stderr || e?.message || e || '')
  const line = raw.split('\n').filter(l => /ERROR/.test(l)).pop() || raw.split('\n').filter(Boolean).pop() || raw
  let m = line.replace(/^.*?ERROR:\s*/, '').replace(/;?\s*please report this issue.*$/i, '').trim()
  if (/Failed to parse JSON|Expecting value|empty|Unable to extract|status code 10\d{3}/i.test(m)) m = 'TikTok bloqueó la lista del creador desde el servidor'
  return m.slice(0, 160)
}

// Respaldo sin la API de usuario: la página embed trae los ~10 videos más nuevos con su descripción
export function parseEmbed(html, user) {
  const m = String(html || '').match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return []
  let data
  try { data = JSON.parse(m[1]) } catch { return [] }
  let list = []
  const walk = (o) => {
    if (!o || typeof o !== 'object' || list.length) return
    if (Array.isArray(o.videoList)) { list = o.videoList; return }
    for (const k in o) walk(o[k])
  }
  walk(data)
  return list.filter(v => v?.id).map(v => ({
    id: String(v.id),
    title: String(v.desc || '').trim(),
    description: String(v.desc || '').trim(),
    author: { unique_id: user, nickname: '' },
    url: `https://www.tiktok.com/@${user}/video/${v.id}`,
    cover: v.originCoverUrl || v.coverUrl || '',
    duration: Number(v.duration) || 0,
    timestamp: Number(v.createTime) || 0
  }))
}

async function embedOnce(user, useProxy) {
  const res = await axios.get(`https://www.tiktok.com/embed/@${encodeURIComponent(user)}`, axiosOpts(useProxy, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'es-MX,es;q=0.9' },
    timeout: 20000, responseType: 'text', validateStatus: () => true
  }))
  if (res.status >= 400) throw new Error(`embed HTTP ${res.status}`)
  const list = parseEmbed(res.data, user)
  if (!list.length) throw new Error('embed sin videos')
  return list
}

// Devuelve { list, limited } — limited=true si solo se pudo leer el embed (~10 más nuevos)
export async function listUserVideos(user) {
  const key = user.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  let value
  try {
    const list = await withProxyFallback(p => listOnce(user, p).catch(e => { throw new Error(ytDlpReason(e)) }), `ttsearch @${user}`)
    value = { list, limited: false }
  } catch (e1) {
    console.error('[ttsearch] yt-dlp usuario', e1?.message || e1)
    try {
      const list = await withProxyFallback(p => embedOnce(user, p), `ttsearch embed @${user}`)
      value = { list, limited: true, noCookies: !hasTtCookies() }
    } catch (e2) {
      throw new Error(`TikTok bloqueó la lista del creador desde el servidor (yt-dlp: ${String(e1?.message || e1).slice(0, 120)}; embed: ${String(e2?.message || e2).slice(0, 80)})${hasTtCookies() ? '' : '. Configura TT_COOKIES para que funcione.'}`)
    }
  }
  cache.set(key, { at: Date.now(), value })
  return value
}
