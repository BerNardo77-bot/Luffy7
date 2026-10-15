// Mapas: OpenStreetMap Nominatim (1 petición/s, User-Agent propio) con Photon de respaldo.
import fetch from 'node-fetch'

const UA = 'BotMapas/1.0 (WhatsApp/Telegram bot; contacto: github.com/BerNardo77-bot)'
let chain = Promise.resolve(), lastAt = 0
/** Cola global: Nominatim pide máximo 1 petición por segundo */
function nominatim(path) {
  const job = chain.then(async () => {
    const wait = lastAt + 1100 - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastAt = Date.now()
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, timeout: 10000 })
    if (!r.ok) throw new Error('Nominatim HTTP ' + r.status)
    return r.json()
  })
  chain = job.catch(() => {})
  return job
}

const short = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
export const mapsLink = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${(+lat).toFixed(6)},${(+lon).toFixed(6)}`

function fromNominatim(x) {
  const a = x.address || {}
  const name = x.name || x.display_name?.split(',')[0] || 'Lugar'
  let addr = String(x.display_name || '')
  if (addr.startsWith(name)) addr = addr.slice(name.length).replace(/^,\s*/, '')
  return { name: short(name, 100), address: short(addr, 200), country: a.country || '', lat: +x.lat, lon: +x.lon }
}
function fromPhoton(f) {
  const p = f.properties || {}
  const [lon, lat] = f.geometry?.coordinates || []
  const addr = [[p.street, p.housenumber].filter(Boolean).join(' '), p.district, p.city, p.state, p.postcode, p.country].filter(Boolean)
  return { name: short(p.name || addr[0] || 'Lugar', 100), address: short(addr.join(', '), 200), country: p.country || '', lat: +lat, lon: +lon }
}

/** Busca hasta `limit` lugares (sin preferir país). */
export async function geocode(q, limit = 10) {
  let out = []
  try { out = (await nominatim(`search?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`)).map(fromNominatim) } catch (e) { console.error('[mapa] nominatim', e?.message || e) }
  if (!out.length) {
    try {
      const r = await fetch(`https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' }, timeout: 10000 })
      if (r.ok) out = ((await r.json()).features || []).map(fromPhoton)
    } catch (e) { console.error('[mapa] photon', e?.message || e) }
  }
  const seen = new Set()
  return out.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).filter(p => { const k = p.lat.toFixed(4) + ',' + p.lon.toFixed(4); if (seen.has(k)) return false; seen.add(k); return true })
}

/** Nombre/dirección de unas coordenadas (si falla, solo las coordenadas). */
export async function reverse(lat, lon) {
  try {
    const x = await nominatim(`reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lon}`)
    if (x && !x.error) return { ...fromNominatim(x), lat: +lat, lon: +lon }
  } catch {}
  return { name: `${(+lat).toFixed(5)}, ${(+lon).toFixed(5)}`, address: '', country: '', lat: +lat, lon: +lon }
}

const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
function coordsIn(s) {
  s = decodeURIComponent(String(s || '')).replace(/%2C/gi, ',')
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/]
  for (const re of pats) { const m = s.match(re); if (m && valid(+m[1], +m[2])) return [+m[1], +m[2]] }
  return null
}

/**
 * Entiende "lat,lon", links de Google Maps (incluye maps.app.goo.gl) o texto.
 * → { kind:'point', place } | { kind:'query', q }
 */
export async function parseInput(text) {
  const t = String(text || '').trim()
  const c0 = coordsIn(t)
  if (c0 && !/https?:/i.test(t)) return { kind: 'point', place: await reverse(...c0) }
  let url = (t.match(/https?:\/\/\S+/) || [])[0]
  if (url && /google\.[^/]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url)) {
    // Links cortos: seguir redirecciones hasta el link largo
    for (let i = 0; i < 5 && /goo\.gl/i.test(url); i++) {
      try {
        const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 })
        const loc = r.headers.get('location'); if (!loc) break
        url = new URL(loc, url).href
      } catch { break }
    }
    const c = coordsIn(url)
    if (c) {
      const p = await reverse(...c)
      const pm = url.match(/\/maps\/place\/([^/@?]+)/)
      if (pm) p.name = short(decodeURIComponent(pm[1].replace(/\+/g, ' ')), 100)
      return { kind: 'point', place: p }
    }
    const pm = url.match(/\/maps\/(?:place|search)\/([^/@?]+)/) || url.match(/[?&](?:q|query)=([^&]+)/)
    if (pm) return { kind: 'query', q: decodeURIComponent(pm[1].replace(/\+/g, ' ')) }
    return { kind: 'bad' }
  }
  return { kind: 'query', q: t }
}

export const placeLine = (p, i) => `${i + 1}. ${p.name}${p.address ? ` — ${short(p.address, 120)}` : ''}${p.country && !String(p.address).includes(p.country) ? ` (${p.country})` : ''}`
