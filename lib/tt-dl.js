// Descarga de un TikTok por enlace: yt-dlp → tikwm (/api/?url=) → alyacore. Tope total 6 min.
// Si todo falla, revisa la página para decir por qué (en revisión, privado, eliminado).
import { MAX_VIDEO_MIN, MAX_VIDEO_SEC } from './limits.js'
import { ytdlpToFile, urlToFile, sendVideoFile, friendlyError, isNoCredit, mb } from './mediadl.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TOTAL_MS = 6 * 60 * 1000
const FINAL = /^(TOO_LONG|TOO_BIG|NO_SPACE):/

function apiBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}
function apiKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = 'LUFFY-FIX67'
  return key
}

async function viaTikwm(url) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json().catch(() => ({}))
  if (j?.code !== 0 || !j?.data) throw new Error(String(j?.msg || 'sin datos').slice(0, 60))
  const d = j.data
  if (Number(d.duration) > MAX_VIDEO_SEC) throw new Error(`TOO_LONG:${d.duration}`)
  const link = d.hdplay || d.play || d.wmplay
  if (!link) throw new Error(d.images?.length ? 'es un carrusel de fotos' : 'sin enlace de video')
  const abs = /^https?:/.test(link) ? link : `https://www.tikwm.com${link}`
  const got = await urlToFile(abs, { tag: 'tt-tikwm', headers: { Referer: 'https://www.tikwm.com/' } })
  return { ...got, title: d.title || '', quality: d.hdplay ? 'HD' : '' }
}

async function viaAlyacore(url) {
  const res = await fetch(`${apiBase()}/dl/tiktok?url=${encodeURIComponent(url)}&key=${encodeURIComponent(apiKey())}`, { signal: AbortSignal.timeout(30000) })
  const j = await res.json().catch(() => ({}))
  if (isNoCredit(j, res.status)) throw new Error('sin saldo (429)')
  const dl = j?.data?.dl
  if (!dl) throw new Error(String(j?.message || `HTTP ${res.status}`).slice(0, 60))
  const got = await urlToFile(dl, { tag: 'tt-api' })
  return { ...got, title: j.data.title || '' }
}

// Estado del post según la página de TikTok (statusCode 10204 = en revisión / no disponible, etc.)
export async function tiktokPostStatus(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9' }, signal: AbortSignal.timeout(15000) })
    const html = await res.text()
    const code = Number((html.match(/"statusCode":(\d+)/) || [])[1] || 0)
    const msg = (html.match(/"statusMsg":"([^"]*)"/) || [])[1] || ''
    if (!code) return ''
    if (/reviewing/.test(msg)) return 'TikTok tiene ese video *en revisión* o restringido: nadie lo puede bajar por ahora'
    if (/private/.test(msg) || code === 10222) return 'el video es *privado*'
    if (code === 10216 || /delete|removed/.test(msg)) return 'el video fue *eliminado*'
    return `TikTok no deja ver ese video (código ${code}${msg ? ', ' + msg : ''})`
  } catch { return '' }
}

async function intentar(url, onStatus) {
  const errs = []
  for (const [name, fn] of [
    ['yt-dlp', () => ytdlpToFile(url, { heights: [1080, 720, 480, 360], maxSec: MAX_VIDEO_SEC, tag: 'tt', timeoutMs: 4 * 60 * 1000, probeTimeoutMs: 60000 })],
    ['tikwm', () => viaTikwm(url)],
    ['alyacore', () => viaAlyacore(url)]
  ]) {
    try {
      if (name !== 'yt-dlp') await onStatus?.(`yt-dlp no pudo; pruebo con ${name}…`)
      return { got: await fn(), via: name }
    } catch (e) {
      const m = String(e?.message || e)
      if (FINAL.test(m)) throw e
      errs.push(`${name}: ${m.slice(0, 120)}`)
      console.error('[tiktok]', name, m.slice(0, 200))
    }
  }
  throw Object.assign(new Error('ALL_FAILED'), { errs })
}

export async function downloadTiktok({ msg, sock, url }) {
  await msg.reply('《✧》 Bajando TikTok en la mejor calidad…')
  let timer
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('TIMEOUT')), TOTAL_MS) })
  try {
    const { got, via } = await Promise.race([intentar(url, (t) => msg.reply(`《✧》 ${t}`).catch(() => {})), limite])
    const q = got.height ? `${got.height}p` : (got.quality || '')
    await sendVideoFile(sock, msg, got.file, { caption: `🎬 TikTok${q ? ' ' + q : ''} · ${mb(got.size)} MB${via !== 'yt-dlp' ? ` (${via})` : ''}${got.title ? '\n' + String(got.title).slice(0, 200) : ''}`, fileName: 'tiktok.mp4' })
  } catch (e) {
    const m = String(e?.message || e)
    if (FINAL.test(m)) return msg.reply(friendlyError(e, { maxMin: MAX_VIDEO_MIN, link: url }))
    if (m === 'TIMEOUT') return msg.reply(`《✧》 Se tardó más de ${TOTAL_MS / 60000} min y lo cancelé. Prueba otra vez o con otro video.\n${url}`)
    const estado = await tiktokPostStatus(url)
    return msg.reply(
      `《✧》 No pude bajar ese TikTok${estado ? `: ${estado}.` : '.'}\n` +
      (e.errs || []).map((x) => `• ${x}`).join('\n') +
      (estado ? '' : '\nSi sigue fallando: pkg upgrade yt-dlp') + `\n${url}`
    )
  } finally { clearTimeout(timer) }
}
