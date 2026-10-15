// Páginas de música (Apple Music, Spotify, Genius, Deezer, YouTube Music):
// canción → "artista título" para buscar el audio en YouTube; álbum → lista de canciones.
import fetch from 'node-fetch'
import yts from 'yt-search'

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const MAX_TRACKS = 20

const get = async (url, json = false) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8', 'Accept-Encoding': 'identity' }, timeout: 20000 })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return json ? r.json() : r.text()
}
const decode = (s = '') => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'))
  return m ? decode(m[1]) : ''
}
const slugText = (s = '') => decodeURIComponent(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Qué tipo de página de música es (sin red). null si no es de música. */
export function musicKind(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  const p = u.pathname
  if (host === 'music.apple.com' || host === 'itunes.apple.com') {
    if (u.searchParams.get('i')) return { svc: 'apple', kind: 'track', id: u.searchParams.get('i') }
    const m = p.match(/\/(album|song|playlist)\/(?:[^/]+\/)?((?:id)?\d+|pl\.[\w-]+)/)
    if (!m) return null
    const id = m[2].replace(/^id/, '')
    return { svc: 'apple', kind: m[1] === 'song' ? 'track' : m[1] === 'album' ? 'album' : 'other', id }
  }
  if (host === 'open.spotify.com') {
    const m = p.match(/\/(?:intl-[\w-]+\/)?(track|album|playlist)\/(\w+)/)
    return m ? { svc: 'spotify', kind: m[1] === 'track' ? 'track' : 'album', type: m[1], id: m[2] } : null
  }
  if (host === 'genius.com') {
    if (/^\/albums\//.test(p)) return { svc: 'genius', kind: 'album' }
    if (/-lyrics\/?$/.test(p) || /^\/songs\/\d+/.test(p)) return { svc: 'genius', kind: 'track' }
    return null
  }
  if (/(^|\.)deezer\.com$/.test(host)) {
    const m = p.match(/\/(track|album|playlist)\/(\d+)/)
    return m ? { svc: 'deezer', kind: m[1] === 'track' ? 'track' : 'album', type: m[1], id: m[2] } : null
  }
  if (host === 'music.youtube.com') {
    if (u.searchParams.get('v')) return { svc: 'ytmusic', kind: 'track', id: u.searchParams.get('v') }
    if (u.searchParams.get('list') || /^\/browse\//.test(p)) return { svc: 'ytmusic', kind: 'album' }
  }
  return null
}

const itunes = (id) => get(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&limit=200`, true)
const art = (u = '') => u ? u.replace(/\/\d+x\d+bb\./, '/600x600bb.') : ''

async function appleTrack(k, url) {
  const d = await itunes(k.id).catch(() => null)
  const t = d?.results?.find(r => r.wrapperType === 'track' && String(r.trackId) === String(k.id)) || d?.results?.find(r => r.wrapperType === 'track')
  if (t) return { artist: t.artistName, title: t.trackName, image: art(t.artworkUrl100) }
  return ogTrack(url)
}
async function appleAlbum(k, url) {
  const d = await itunes(k.id).catch(() => null)
  const col = d?.results?.find(r => r.wrapperType === 'collection')
  const tracks = (d?.results || []).filter(r => r.wrapperType === 'track')
  if (tracks.length) {
    return {
      album: col?.collectionName || '', artist: col?.artistName || tracks[0].artistName, image: art(col?.artworkUrl100 || tracks[0].artworkUrl100),
      tracks: tracks.map(t => ({ artist: t.artistName, title: t.trackName }))
    }
  }
  // Respaldo: og:title de la página ("Álbum de Artista en Apple Music")
  const html = await get(url)
  const og = meta(html, 'og:title').replace(/\s+(en|on) Apple Music$/i, '')
  const m = og.match(/^(.*?)\s+(?:de|by)\s+(.*)$/)
  return { album: m ? m[1] : og, artist: m ? m[2] : '', image: meta(html, 'og:image'), tracks: [] }
}

async function spotifyEmbed(k) {
  const html = await get(`https://open.spotify.com/embed/${k.type}/${k.id}`)
  const j = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  const ent = j ? JSON.parse(j[1])?.props?.pageProps?.state?.data?.entity : null
  if (!ent) throw new Error('Spotify sin datos')
  return ent
}
async function spotifyTrack(k) {
  try {
    const e = await spotifyEmbed(k)
    return { artist: (e.artists || []).map(a => a.name).join(', '), title: e.name || e.title, image: e.visualIdentity?.image?.[0]?.url || e.coverArt?.sources?.[0]?.url || '' }
  } catch {
    const o = await get(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${k.id}`, true)
    return { artist: '', title: o.title, image: o.thumbnail_url }
  }
}
async function spotifyAlbum(k) {
  const e = await spotifyEmbed(k)
  return {
    album: e.name || e.title || '', artist: e.subtitle || (e.artists || []).map(a => a.name).join(', '),
    image: e.visualIdentity?.image?.slice(-1)[0]?.url || e.coverArt?.sources?.slice(-1)[0]?.url || '',
    tracks: (e.trackList || []).map(t => ({ artist: t.subtitle || '', title: t.title }))
  }
}

function geniusSlug(url) {
  const p = new URL(url).pathname
  const a = p.match(/^\/albums\/([^/]+)\/([^/]+)/)
  if (a) return { artist: slugText(a[1]), album: slugText(a[2]) }
  const s = p.match(/^\/([^/]+)-lyrics/)
  return s ? { title: slugText(s[1]) } : {}
}
async function geniusTrack(url) {
  try {
    const html = await get(url)
    const t = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s*\|\s*Genius.*$/i, '').replace(/\s+Lyrics$/i, '')
    const m = t.match(/^(.*?)\s+[–-]\s+(.*)$/)
    if (m) return { artist: m[1], title: m[2], image: meta(html, 'og:image') }
    const og = meta(html, 'og:title')
    if (og) return { artist: '', title: og.replace(/\s+Lyrics$/i, ''), image: meta(html, 'og:image') }
  } catch {}
  const s = geniusSlug(url)
  return { artist: '', title: s.title || '' }
}
export function parseGeniusAlbum(html) {
  const t = decode((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s*\|\s*Genius.*$/i, '').replace(/\s+Lyrics and Tracklist$/i, '')
  const m = t.match(/^(.*?)\s+[–-]\s+(.*)$/)
  const tracks = []
  const re = /<h3[^>]*class="(?:chart_row-content-title|tracklist_row-header-content-title)"[^>]*>([^<]*)<span[^>]*>\s*Lyrics/gi
  let x
  while ((x = re.exec(html))) tracks.push({ artist: '', title: decode(x[1].replace(/<[^>]+>/g, '')) })
  if (!tracks.length) {
    // Páginas nuevas: datos en JSON ("tracklist"/"song":{"title":…})
    const re2 = /"song":\{[^{}]*?"title":"((?:[^"\\]|\\.)*)"/g
    const seen = new Set()
    while ((x = re2.exec(html))) {
      const ti = decode(JSON.parse(`"${x[1]}"`))
      if (!seen.has(ti)) { seen.add(ti); tracks.push({ artist: '', title: ti }) }
    }
  }
  return { album: m ? m[2] : t, artist: m ? m[1] : '', image: meta(html, 'og:image'), tracks }
}
async function geniusAlbum(url) {
  let r = null
  try { r = parseGeniusAlbum(await get(url)) } catch {}
  const s = geniusSlug(url)
  if (!r) r = { album: s.album || '', artist: s.artist || '', image: '', tracks: [] }
  r.album = r.album || s.album || ''
  r.artist = r.artist || s.artist || ''
  r.tracks.forEach(t => { t.artist = t.artist || r.artist })
  return r
}

async function deezerTrack(k) {
  const t = await get(`https://api.deezer.com/track/${k.id}`, true)
  return { artist: t?.artist?.name || '', title: t?.title || '', image: t?.album?.cover_xl || '' }
}
async function deezerAlbum(k) {
  const a = await get(`https://api.deezer.com/${k.type}/${k.id}`, true)
  return {
    album: a?.title || '', artist: a?.artist?.name || a?.creator?.name || '', image: a?.cover_xl || a?.picture_xl || '',
    tracks: (a?.tracks?.data || []).map(t => ({ artist: t?.artist?.name || '', title: t?.title || '' }))
  }
}

async function ogTrack(url) {
  const html = await get(url)
  const og = meta(html, 'og:title').replace(/\s+(en|on) Apple Music$/i, '')
  const m = og.match(/^(.*?)\s+(?:de|by)\s+(.*)$/)
  return { artist: m ? m[2] : '', title: m ? m[1] : og, image: meta(html, 'og:image') }
}

/** Canción → { artist, title, image } */
export async function resolveTrack(url, k = musicKind(url)) {
  if (!k) return null
  if (k.svc === 'apple') return appleTrack(k, url)
  if (k.svc === 'spotify') return spotifyTrack(k)
  if (k.svc === 'genius') return geniusTrack(url)
  if (k.svc === 'deezer') return deezerTrack(k)
  return null
}
/** Álbum → { album, artist, image, tracks:[{artist,title}] } (máx. 20) */
export async function resolveAlbum(url, k = musicKind(url)) {
  if (!k) return null
  let r = null
  if (k.svc === 'apple') r = await appleAlbum(k, url)
  else if (k.svc === 'spotify') r = await spotifyAlbum(k)
  else if (k.svc === 'genius') r = await geniusAlbum(url)
  else if (k.svc === 'deezer') r = await deezerAlbum(k)
  if (r && !r.tracks.length && (r.album || r.artist)) {
    // Respaldo (p. ej. Genius bloqueado): canciones de YouTube para "artista álbum"
    try {
      const res = await yts(`${r.artist} ${r.album}`.trim())
      r.tracks = (res?.videos || []).slice(0, 10).map(v => ({ artist: '', title: v.title, url: v.url }))
      r.fromYt = true
    } catch {}
  }
  if (r) r.tracks = r.tracks.filter(t => t.title).slice(0, MAX_TRACKS)
  return r
}
export const searchQuery = (t) => [t.artist, t.title].filter(Boolean).join(' ').replace(/\s*[([]\s*(feat|ft)\.?[^)\]]*[)\]]/i, '').trim()
