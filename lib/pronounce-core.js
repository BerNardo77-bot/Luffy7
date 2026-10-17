// "Cómo se pronuncia": la traducción escrita como la leería alguien que habla español de México.
// - Inglés: diccionario CMU (cmudict.txt.gz, 135 mil palabras, incluido en el repo) → letras en español,
//   con reglas de respaldo para palabras que no estén.
// - Japonés, chino, coreano, ruso, árabe, etc.: romanización de Google Translate (gratis) adaptada al español.
// - Portugués, italiano y alemán: reglas sencillas. Francés y otros: no se muestra (no sería confiable).
// Sin dependencias npm.
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
let DICT = null

function dict() {
  if (DICT) return DICT
  DICT = new Map()
  try {
    const txt = zlib.gunzipSync(fs.readFileSync(path.join(HERE, 'cmudict.txt.gz'))).toString('utf8')
    for (const line of txt.split('\n')) {
      const i = line.indexOf(' ')
      if (i > 0) DICT.set(line.slice(0, i), line.slice(i + 1))
    }
  } catch (e) {
    console.error('[pronuncia] no se pudo leer cmudict.txt.gz:', e.message)
  }
  return DICT
}

// ---------- Inglés ----------
const VOW = { AA: 'a', AE: 'a', AH: 'a', AO: 'o', AW: 'au', AY: 'ai', EH: 'e', ER: 'er', EY: 'ei', IH: 'i', IY: 'i', OW: 'ou', OY: 'oi', UH: 'u', UW: 'u' }
const CONS = { B: 'b', CH: 'ch', D: 'd', DH: 'd', F: 'f', G: 'g', HH: 'j', JH: 'y', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng', P: 'p', R: 'r', S: 's', SH: 'sh', T: 't', TH: 't', V: 'v', W: 'u', Y: 'y', Z: 's', ZH: 'sh' }
const EN_FIXED = { the: 'de', a: 'a', an: 'an', of: 'ov', to: 'tu', i: 'ai', you: 'yu', your: 'yur', are: 'ar', is: 'is', and: 'and', or: 'or', okay: 'okei', ok: 'okei' }

function arpaToEs(ph, word = '') {
  // AA se oye "a" (father) o "o" (hot, lot, problem): se usa la ortografía como pista
  const aaO = /o/.test(word)
  const p = ph.trim().split(/\s+/)
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const x = p[i]
    const next = (p[i + 1] === 'AX' ? 'a' : VOW[p[i + 1]]) || CONS[p[i + 1]] || ''
    if (x === 'AX') {
      // vocal débil (schwa): "a" si es la primera vocal o la última letra (about, sofa), "e" en medio (tennis, market)
      const firstVowel = !p.slice(0, i).some((y) => VOW[y] || y === 'AX')
      out += firstVowel || i === p.length - 1 ? 'a' : 'e'
      continue
    }
    if (VOW[x]) {
      let v = VOW[x]
      if (x === 'AA' && aaO) v = 'o'
      // "w" + "u" → "u" (wood → "ud"), "y" + "i"
      if (x === 'ER' && p[i + 1] === 'R') v = 'e'
      out += v
      continue
    }
    let c = CONS[x] || ''
    if (x === 'G' && /^[ei]/.test(next)) c = 'gu'
    if (x === 'W' && /^u/.test(next)) c = ''
    if (x === 'Y' && /^i/.test(next)) c = ''
    if (x === 'K' && p[i + 1] === 'S') { out += 'ks'; i++; continue }
    if (x === 'NG' && (p[i + 1] === 'K' || p[i + 1] === 'G')) c = 'n'
    out += c
  }
  return out.replace(/(.)\1+/g, (m, ch) => (ch === 'r' || ch === 'o' ? m.slice(0, 2) : ch))
}

function enGuess(w) {
  let s = w.toLowerCase()
  s = s.replace(/tion/g, 'shon').replace(/sion/g, 'shon').replace(/ph/g, 'f').replace(/th/g, 't').replace(/ck/g, 'k')
    .replace(/qu/g, 'ku').replace(/igh/g, 'ai').replace(/ee|ea/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'au')
    .replace(/ow/g, 'ou').replace(/ai|ay/g, 'ei').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/x/g, 'ks')
    .replace(/j/g, 'y').replace(/(^|[^sckt])h/g, '$1j').replace(/w/g, 'u').replace(/y$/g, 'i').replace(/g(?=[ei])/g, 'gu')
  if (s.length > 3) s = s.replace(/([^aeiou])e$/, '$1')
  return s.replace(/(.)\1+/g, '$1')
}

function enWord(w) {
  const low = w.toLowerCase()
  if (EN_FIXED[low]) return EN_FIXED[low]
  const d = dict()
  if (d.has(low)) return arpaToEs(d.get(low), low)
  if (/'s$/.test(low) && d.has(low.slice(0, -2))) return arpaToEs(d.get(low.slice(0, -2)), low) + 's'
  if (/s$/.test(low) && d.has(low.slice(0, -1))) return arpaToEs(d.get(low.slice(0, -1)), low) + 's'
  return enGuess(low.replace(/'/g, ''))
}

export function englishToEs(text) {
  return String(text || '').replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (w) => enWord(w)).toLowerCase()
}

// ---------- Otros alfabetos (romanización) ----------
async function romanize(text, lang) {
  const tl = lang === 'zh' ? 'zh-CN' : lang === 'he' ? 'iw' : lang
  const q = encodeURIComponent(String(text).slice(0, 1500))
  const urls = [
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${tl}&tl=en&dt=t&dt=rm&q=${q}`,
    `https://clients5.google.com/translate_a/single?client=dict-chrome-ex&sl=${tl}&tl=en&dt=t&dt=rm&q=${q}`
  ]
  for (const url of urls) {
    try {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), 15000)
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal }).finally(() => clearTimeout(t))
      if (!res.ok) continue
      const j = JSON.parse(await res.text())
      const rm = (j?.[0] || []).filter((x) => Array.isArray(x) && x[0] == null).map((x) => x[3] || x[2]).filter(Boolean).join(' ')
      if (rm) return rm
    } catch {}
  }
  return null
}

const stripAcc = (s) => s.replace(/ñ/g, '\u0001').normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/\u0001/g, 'ñ')
const softG = (s) => s.replace(/g(?=[ei])/g, 'gu')

function romToEs(rm, lang) {
  let s = String(rm).toLowerCase()
  if (lang === 'ja') s = s.replace(/ō/g, 'oo').replace(/ū/g, 'uu').replace(/ā/g, 'aa').replace(/ī/g, 'ii').replace(/ē/g, 'ee')
  s = stripAcc(s).replace(/ü/g, 'iu').replace(/(\d)-(?=\p{L})/gu, '$1 ').replace(/(\p{L})-(?=\p{L})/gu, '$1').replace(/['ʼʻʿʾ`]/g, '')
  if (lang === 'ja') s = softG(s.replace(/j/g, 'y').replace(/z/g, 's').replace(/(^|[^sc])h/g, '$1j'))
  else if (lang === 'zh') s = softG(s.replace(/zh/g, 'ch').replace(/x/g, 'sh').replace(/q/g, 'ch').replace(/j/g, 'ch').replace(/c(?!h)/g, 'ts').replace(/z/g, 'ds').replace(/(^|[^scd])h/g, '$1j').replace(/w/g, 'u').replace(/ian\b/g, 'ien').replace(/ong\b/g, 'ung'))
  else if (lang === 'ko') s = softG(s.replace(/eo/g, 'o').replace(/eu/g, 'u').replace(/ae/g, 'e').replace(/oe/g, 'ue').replace(/j/g, 'ch').replace(/(^|[^sc])h/g, '$1j').replace(/(kk|tt|pp|ss)/g, (m) => m[0]).replace(/w/g, 'u'))
  else if (lang === 'ru' || lang === 'uk') s = softG(s.replace(/shch/g, 'sh').replace(/kh/g, 'j').replace(/zh/g, 'y').replace(/z/g, 's'))
  else if (lang === 'ar') s = softG(s.replace(/kh/g, 'j').replace(/gh/g, 'g').replace(/th/g, 's').replace(/dh/g, 'd').replace(/(^|[^sc])h/g, '$1j').replace(/q/g, 'k').replace(/j(?![aeiou]?$)/g, 'y').replace(/z/g, 's').replace(/w/g, 'u'))
  else s = softG(s.replace(/kh/g, 'j').replace(/(^|[^sct])h/g, '$1j').replace(/z/g, 's').replace(/w/g, 'u'))
  return s.replace(/\s+/g, ' ').trim()
}

// ---------- Portugués, italiano, alemán ----------
function ptToEs(t) {
  let s = t.toLowerCase()
  s = s.replace(/lh/g, 'li').replace(/nh/g, 'ñ').replace(/ç/g, 's').replace(/ch/g, 'sh').replace(/ões/g, 'oins').replace(/ãos/g, 'auns').replace(/ão/g, 'aun').replace(/ães/g, 'ains').replace(/ãe/g, 'ain').replace(/ã/g, 'an').replace(/õ/g, 'on')
  s = s.replace(/qu(?=[ei])/g, 'k').replace(/gu(?=[ei])/g, 'GU').replace(/g(?=[ei])/g, 'y').replace(/GU/g, 'gu').replace(/j/g, 'y').replace(/ss/g, 's').replace(/x/g, 'sh').replace(/\bh/g, '').replace(/ou/g, 'o')
  return stripAcc(s).replace(/\bum\b/g, 'un').replace(/\buma\b/g, 'uma')
}
function itToEs(t) {
  let s = stripAcc(t.toLowerCase())
  s = s.replace(/qu/g, 'cu').replace(/sc(?=[ei])/g, 'sh').replace(/ch(?=[ei])/g, 'qu').replace(/gh(?=[ei])/g, 'gu').replace(/gli/g, 'lli').replace(/gn/g, 'ñ')
    .replace(/ci(?=[aou])/g, 'ch').replace(/c(?=[ei])/g, 'ch').replace(/gi(?=[aou])/g, 'y').replace(/g(?=[ei])/g, 'y').replace(/z+/g, 'ts').replace(/h/g, (m, i, all) => (all[i - 1] === 's' || all[i - 1] === 'c' ? 'h' : ''))
  return s
}
function deToEs(t) {
  let s = t.toLowerCase()
  s = s.replace(/tsch/g, 'ch').replace(/sch/g, 'SH').replace(/\bsp/g, 'SHp').replace(/\bst/g, 'SHt').replace(/ch/g, 'j').replace(/SH/g, 'sh')
    .replace(/ei|ai/g, 'ai').replace(/ie/g, 'i').replace(/eu|äu/g, 'oi').replace(/ä/g, 'e').replace(/ö/g, 'e').replace(/ü/g, 'i').replace(/ß/g, 's')
    .replace(/qu/g, 'kv').replace(/ck/g, 'k').replace(/th/g, 't').replace(/v/g, 'f').replace(/w/g, 'v').replace(/z/g, 'ts').replace(/j(?=[aeiou])/g, (m, i, all) => (all[i - 1] === undefined || /\s/.test(all[i - 1]) ? 'y' : m))
    .replace(/([aeiou])h/g, '$1').replace(/\bh/g, 'j').replace(/ig\b/g, 'ij')
  return softG(s.replace(/sh/g, 'sh'))
}

const NON_LATIN = new Set(['ja', 'zh', 'ko', 'ru', 'ar', 'hi', 'el', 'he', 'uk', 'th'])

/** Regresa la pronunciación en letras del español, o null si no aplica. */
export async function vtPronounce(text, target) {
  const t = String(text || '').trim()
  if (!t || !target || target === 'es') return null
  let out = null
  try {
    if (target === 'en') out = englishToEs(t)
    else if (target === 'pt') out = ptToEs(t)
    else if (target === 'it') out = itToEs(t)
    else if (target === 'de') out = deToEs(t)
    else if (NON_LATIN.has(target)) {
      const rm = await romanize(t, target)
      if (rm) out = romToEs(rm, target)
    }
  } catch (e) {
    console.error('[pronuncia]', e?.message || e)
    out = null
  }
  if (!out) return null
  out = out.replace(/\s+/g, ' ').trim()
  if (!out || out === t.toLowerCase()) return null
  return out.length > 1700 ? out.slice(0, 1700) + '…' : out
}
