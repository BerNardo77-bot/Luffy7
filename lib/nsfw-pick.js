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

function normJid(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  if (!s) return ''
  const m = s.match(/^([^@]+):\d+@(.+)$/)
  if (m) s = `${m[1]}@${m[2]}`
  return s
}

function bareUser(jid) {
  const s = normJid(jid)
  return s ? s.split('@')[0] : ''
}

// Chat privado: remoteJid y remoteJidAlt (pn y lid). Grupo: el @g.us.
export function jidsOf(msg) {
  if (!msg) return []
  if (typeof msg === 'string') {
    const n = normJid(msg)
    return n ? [n] : []
  }
  const out = []
  const add = (j) => {
    const n = normJid(j)
    if (n && !out.includes(n)) out.push(n)
  }
  add(msg.chat)
  add(msg.key?.remoteJid)
  add(msg.key?.remoteJidAlt)
  return out
}

export function sendersOf(msg) {
  if (!msg || typeof msg === 'string') return []
  const out = []
  const add = (j) => {
    const n = normJid(j)
    if (!n || n.endsWith('@g.us') || n.endsWith('@broadcast')) return
    if (!out.includes(n)) out.push(n)
  }
  add(msg.sender)
  add(msg.key?.participant)
  add(msg.key?.participantAlt)
  const chat = normJid(msg.chat || msg.key?.remoteJid || '')
  const group = !!(msg.isGroup || chat.endsWith('@g.us'))
  if (!group) {
    add(msg.key?.remoteJid)
    add(msg.key?.remoteJidAlt)
    add(msg.chat)
  }
  return out
}

function senderMatches(hit, senders) {
  const stored = hit.senders?.length
    ? hit.senders
    : (hit.sender ? [normJid(hit.sender)].filter(Boolean) : [])
  if (!stored.length || !senders.length) return true
  const bareStored = new Set(stored.map(bareUser))
  for (const s of senders) {
    const n = normJid(s)
    if (!n) continue
    if (stored.includes(n) || bareStored.has(bareUser(n))) return true
  }
  return false
}

function clearRecord(rec) {
  if (!rec) return
  for (const c of rec.chats || []) picks.delete(c)
  for (const s of rec.senders || []) picks.delete('sender:' + bareUser(s))
  if (rec.sender) picks.delete('sender:' + bareUser(rec.sender))
}

export function savePick(jid, data, now = Date.now()) {
  const chats = []
  const addChat = (j) => {
    const n = normJid(j)
    if (n && !chats.includes(n)) chats.push(n)
  }
  addChat(typeof jid === 'string' ? jid : '')
  if (data?.msg) for (const c of jidsOf(data.msg)) addChat(c)
  if (Array.isArray(data?.chats)) for (const c of data.chats) addChat(c)

  const senders = []
  const addSender = (j) => {
    const n = normJid(j)
    if (!n || n.endsWith('@g.us') || n.endsWith('@broadcast')) return
    if (!senders.includes(n)) senders.push(n)
  }
  addSender(data?.sender)
  if (data?.msg) for (const s of sendersOf(data.msg)) addSender(s)
  if (Array.isArray(data?.senders)) for (const s of data.senders) addSender(s)

  const rec = {
    sender: senders[0] || data?.sender || '',
    senders,
    chats,
    fromMe: !!(data?.fromMe || data?.msg?.fromMe),
    site: data.site,
    // xvideos/xnxx guardan 5; ytsearch guarda hasta 10. No recortar YouTube a 5.
    items: (data.items || []).slice(0, 10),
    exp: now + PICK_TTL_MS
  }
  const keys = chats.length ? chats : [normJid(jid)].filter(Boolean)
  for (const c of keys) picks.set(c, rec)
  for (const s of senders) picks.set('sender:' + bareUser(s), rec)
}

export function readPick(jid, sender, now = Date.now()) {
  const msg = jid && typeof jid === 'object' ? jid : null
  const chats = msg ? jidsOf(msg) : [normJid(jid)].filter(Boolean)
  const senders = msg ? sendersOf(msg) : []
  if (!msg && sender) {
    const n = normJid(sender)
    if (n && !senders.includes(n)) senders.push(n)
  }

  const take = (key) => {
    const h = picks.get(key)
    if (!h) return null
    if (now > h.exp) {
      clearRecord(h)
      return null
    }
    return h
  }

  let hit = null
  for (const c of chats) {
    hit = take(c)
    if (hit) break
  }
  if (!hit) {
    const nowGroup = chats.filter(c => c.endsWith('@g.us'))
    for (const s of senders) {
      const h = take('sender:' + bareUser(s))
      if (!h) continue
      const storedGroup = (h.chats || []).filter(c => c.endsWith('@g.us'))
      if (storedGroup.length && nowGroup.length && !storedGroup.some(g => nowGroup.includes(g))) continue
      if (storedGroup.length !== nowGroup.length && (storedGroup.length === 0 || nowGroup.length === 0)) continue
      hit = h
      break
    }
  }
  if (!hit) return null
  if (!senderMatches(hit, senders)) {
    const chatHit = (hit.chats || []).some(c => chats.includes(c))
    const group = (hit.chats || []).some(c => c.endsWith('@g.us')) || chats.some(c => c.endsWith('@g.us'))
    const sameAccount = chatHit && hit.fromMe && !!(msg?.fromMe)
    const privateChat = chatHit && !group
    if (!sameAccount && !privateChat) return null
  }
  return hit
}

export function clearPick(jid) {
  const keys = typeof jid === 'object' ? jidsOf(jid) : [normJid(jid)].filter(Boolean)
  const seen = new Set()
  const drop = (h) => {
    if (!h || seen.has(h)) return
    seen.add(h)
    clearRecord(h)
  }
  for (const k of keys) drop(picks.get(k))
  if (typeof jid === 'object') {
    for (const s of sendersOf(jid)) drop(picks.get('sender:' + bareUser(s)))
  }
  if (!seen.size) {
    for (const k of keys) picks.delete(k)
  }
}

// Mensaje que es solo dígitos (1, 03, 12). null si hay más texto.
// Hasta 4 dígitos: un teléfono suelto no se trata como elección.
// 0 cuenta como número (fuera de rango), no como "no es número".
export function bareNumber(msg) {
  const candidates = [msg?.body, msg?.text]
  for (const c of candidates) {
    const s = String(c ?? '').trim()
    if (!/^\d{1,4}$/.test(s)) continue
    return Number(s)
  }
  return null
}

export function choiceNumber(msg) {
  const n = bareNumber(msg)
  if (n >= 1 && n <= 5) return n
  return 0
}
