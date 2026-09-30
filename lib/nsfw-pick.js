// Puntaje de títulos y lista recordada de #xvideos / #xnxx. Sin red.
// El prefijo real lo pone el comando (lib/prefijo.js); aquí no hay símbolo fijo.

const picks = new Map()
export const PICK_TTL_MS = 5 * 60 * 1000

export function queryWords(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(w => w.length > 1)
}

export function scoreTitle(title, words) {
  const t = String(title || '').toLowerCase()
  let n = 0
  for (const w of words) {
    if (w && t.includes(w)) n++
  }
  return n
}

// Mayor puntaje. Empate: el primero. 0 = ninguna palabra aparece.
export function bestMatch(items, query) {
  const words = queryWords(query)
  let score = 0
  let index = -1
  for (let i = 0; i < items.length; i++) {
    const title = items[i]?.title ?? items[i]
    const s = scoreTitle(title, words)
    if (s > score) {
      score = s
      index = i
    }
  }
  return { score, index, words }
}

// Descarga solo si cada palabra de la búsqueda está en el título.
export function isFullMatch(hit) {
  return !!(hit && hit.words.length > 0 && hit.score === hit.words.length)
}

const THUMB_KEYS = ['thumb', 'thumbnail', 'thumbnailUrl', 'thumbNail', 'image', 'img', 'poster', 'cover']

function httpUrl(v, depth = 0) {
  if (depth > 2 || v == null) return ''
  if (typeof v === 'string') {
    const s = v.trim()
    return /^https?:\/\//i.test(s) ? s : ''
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const u = httpUrl(item, depth + 1)
      if (u) return u
    }
    return ''
  }
  if (typeof v === 'object') {
    for (const k of ['url', 'src', 'thumb', 'thumbnail', 'image', 'img', 'poster', 'cover']) {
      const u = httpUrl(v[k], depth + 1)
      if (u) return u
    }
  }
  return ''
}

// URL de miniatura que ya trae la búsqueda (cover en alyacore, o thumb/image/poster).
// No usa la url del video.
export function pickThumbUrl(item) {
  if (!item || typeof item !== 'object') return ''
  for (const k of THUMB_KEYS) {
    const u = httpUrl(item[k])
    if (u) return u
  }
  return ''
}

export function normalizeResults(list) {
  const out = []
  for (const r of list || []) {
    const url = r?.url || r?.link || ''
    if (!url || typeof url !== 'string') continue
    out.push({
      title: String(r.title || r.name || r.titulo || 'Sin título'),
      duration: String(r.duration || r.duracion || r.length || '').trim(),
      url,
      thumb: pickThumbUrl(r)
    })
  }
  return out
}

export function itemCaption(it, i) {
  const title = String(it?.title || 'Sin título').replace(/\s+/g, ' ').trim().slice(0, 160)
  const dur = String(it?.duration || '').trim()
  return `${i + 1}. ${title}${dur ? `\n${dur}` : ''}\n${it?.url || ''}`
}

export function savePick(jid, data, now = Date.now()) {
  if (!jid) return
  picks.set(String(jid), {
    sender: data.sender || '',
    site: data.site,
    items: (data.items || []).slice(0, 5),
    exp: now + PICK_TTL_MS
  })
}

export function readPick(jid, sender, now = Date.now()) {
  const hit = picks.get(String(jid))
  if (!hit) return null
  if (now > hit.exp) {
    picks.delete(String(jid))
    return null
  }
  if (hit.sender && sender && hit.sender !== sender) return null
  return hit
}

export function clearPick(jid) {
  picks.delete(String(jid))
}

export function choiceNumber(msg) {
  const candidates = [msg?.body, msg?.text]
  for (const c of candidates) {
    const m = String(c || '').trim().match(/^([1-5])$/)
    if (m) return Number(m[1])
  }
  return 0
}
