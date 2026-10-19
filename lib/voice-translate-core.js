// Traducción por voz: audio -> texto (Google Speech gratis) -> traducción (Google Translate gratis) -> voz (Google TTS gratis)
// Sin dependencias npm: usa fetch nativo (Node 18+) y ffmpeg.
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { vtPronounce } from './pronounce-core.js'
export { vtPronounce }

const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
// Llave pública del navegador Chromium para su dictado por voz (la misma que usa la librería SpeechRecognition).
const STT_KEY = 'AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw'
export const VT_MAX_SEC = Number(process.env.VT_MAX_SEC || 300)
const CHUNK_SEC = 25
const MAX_TTS_CHARS = 3000

// code -> { n: nombre en español, stt: código para el reconocimiento, tr: código de traducción, tts: código de voz }
export const VT_LANGS = {
  es: { n: 'español', stt: 'es-MX', tr: 'es', tts: 'es' },
  en: { n: 'inglés', stt: 'en-US', tr: 'en', tts: 'en' },
  pt: { n: 'portugués', stt: 'pt-BR', tr: 'pt', tts: 'pt' },
  fr: { n: 'francés', stt: 'fr-FR', tr: 'fr', tts: 'fr' },
  it: { n: 'italiano', stt: 'it-IT', tr: 'it', tts: 'it' },
  de: { n: 'alemán', stt: 'de-DE', tr: 'de', tts: 'de' },
  ja: { n: 'japonés', stt: 'ja-JP', tr: 'ja', tts: 'ja' },
  ko: { n: 'coreano', stt: 'ko-KR', tr: 'ko', tts: 'ko' },
  zh: { n: 'chino', stt: 'cmn-Hans-CN', tr: 'zh-CN', tts: 'zh-CN' },
  ru: { n: 'ruso', stt: 'ru-RU', tr: 'ru', tts: 'ru' },
  ar: { n: 'árabe', stt: 'ar-EG', tr: 'ar', tts: 'ar' },
  hi: { n: 'hindi', stt: 'hi-IN', tr: 'hi', tts: 'hi' },
  tr: { n: 'turco', stt: 'tr-TR', tr: 'tr', tts: 'tr' },
  nl: { n: 'neerlandés', stt: 'nl-NL', tr: 'nl', tts: 'nl' },
  pl: { n: 'polaco', stt: 'pl-PL', tr: 'pl', tts: 'pl' },
  uk: { n: 'ucraniano', stt: 'uk-UA', tr: 'uk', tts: 'uk' },
  el: { n: 'griego', stt: 'el-GR', tr: 'el', tts: 'el' },
  he: { n: 'hebreo', stt: 'he-IL', tr: 'iw', tts: 'iw' },
  sv: { n: 'sueco', stt: 'sv-SE', tr: 'sv', tts: 'sv' },
  id: { n: 'indonesio', stt: 'id-ID', tr: 'id', tts: 'id' },
  vi: { n: 'vietnamita', stt: 'vi-VN', tr: 'vi', tts: 'vi' },
  th: { n: 'tailandés', stt: 'th-TH', tr: 'th', tts: 'th' },
  ca: { n: 'catalán', stt: 'ca-ES', tr: 'ca', tts: 'ca' }
}
const ALIASES = {
  espanol: 'es', castellano: 'es', spanish: 'es', esp: 'es', mx: 'es',
  ingles: 'en', english: 'en', ing: 'en', eng: 'en',
  portugues: 'pt', portuguese: 'pt', brasileno: 'pt', 'pt-br': 'pt',
  frances: 'fr', french: 'fr', italiano: 'it', italian: 'it',
  aleman: 'de', german: 'de', japones: 'ja', japanese: 'ja', jp: 'ja',
  coreano: 'ko', korean: 'ko', kr: 'ko', chino: 'zh', chinese: 'zh', mandarin: 'zh', 'zh-cn': 'zh',
  ruso: 'ru', russian: 'ru', arabe: 'ar', arabic: 'ar', hindi: 'hi', turco: 'tr', turkish: 'tr',
  holandes: 'nl', neerlandes: 'nl', dutch: 'nl', polaco: 'pl', ucraniano: 'uk', griego: 'el',
  hebreo: 'he', iw: 'he', sueco: 'sv', indonesio: 'id', vietnamita: 'vi', tailandes: 'th', catalan: 'ca'
}
// Idiomas que se prueban para detectar el idioma del audio (si no le dices cuál es)
const DETECT_LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de', 'ja', 'ko', 'zh', 'ru', 'ar']

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

export function vtLang(word) {
  const k = plain(word).replace(/[.,;:!?]+$/, '')
  if (!k) return null
  if (VT_LANGS[k]) return k
  if (ALIASES[k]) return ALIASES[k]
  return null
}

export function vtLangName(code) {
  return VT_LANGS[code]?.n || code
}

// Lee el texto después del comando. Acepta: "en", "inglés", "ja>es", "de japones a español", "a ingles".
export function parseVoiceArgs(text) {
  const words = plain(text).split(/[\s]+/).filter(Boolean)
  const out = { target: null, source: null, unknown: null }
  if (!words.length) return out
  const one = words.join(' ')
  const m = one.match(/^([a-z\u00f1-]+)\s*(?:>|->|=>|a|al|to)\s*([a-z\u00f1-]+)$/) || one.match(/^de\s+([a-z\u00f1-]+)\s+a[l]?\s+([a-z\u00f1-]+)$/)
  if (m) {
    const s = vtLang(m[1]), t = vtLang(m[2])
    if (s && t) return { target: t, source: s, unknown: null }
  }
  let w = words.filter((x) => !['a', 'al', 'en', 'to'].includes(x) || vtLang(x))
  if (words[0] === 'a' || words[0] === 'al' || words[0] === 'to') w = words.slice(1)
  const t = vtLang(w[0])
  if (t) out.target = t
  else out.unknown = w[0]
  return out
}

export function vtLangList() {
  return Object.entries(VT_LANGS).map(([c, v]) => `${c} (${v.n})`).join(', ')
}

export function vtUsage(p = '/') {
  return [
    '🌐 *Traducir voz, imágenes y texto*',
    `Responde a una nota de voz, audio, foto o captura con *${p}traducir <idioma>*`,
    `(también ${p}traduce, ${p}tr, ${p}translate) o mándala con ese texto como pie.`,
    `Para texto: ${p}tr en Hola amigos`,
    '',
    `• ${p}traducir → español a inglés, y cualquier otro idioma a español`,
    `• ${p}traducir en · ${p}tr ja · ${p}traducir francés`,
    `• ${p}traducir ja>es (si quieres decirle en qué idioma está)`,
    '',
    `Te mando el texto original, la traducción y cómo se pronuncia. Audio máx. ${Math.round(VT_MAX_SEC / 60)} min.`,
    'Idiomas: ' + vtLangList()
  ].join('\n')
}

export function run(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, timeoutMs)
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(cmd + ' falló: ' + err.split('\n').slice(-3).join(' '))) })
  })
}

async function fetchT(url, opts = {}, ms = 30000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ac.signal }) } finally { clearTimeout(t) }
}

// ---------- Reconocimiento de voz ----------
async function sttChunk(flacPath, lang) {
  const body = fs.readFileSync(flacPath)
  const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=${encodeURIComponent(lang)}&key=${STT_KEY}&output=json&pFilter=0`
  let lastErr
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchT(url, { method: 'POST', body, headers: { 'Content-Type': 'audio/x-flac; rate=16000', 'User-Agent': UA } }, 45000)
      if (res.status === 429) throw new Error('límite de Google por ahora (429)')
      if (!res.ok) throw new Error('reconocimiento HTTP ' + res.status)
      const txt = await res.text()
      let best = { text: '', conf: 0 }
      for (const line of txt.split('\n')) {
        if (!line.trim()) continue
        let j
        try { j = JSON.parse(line) } catch { continue }
        for (const r of j.result || []) {
          const a = (r.alternative || [])[0]
          if (a?.transcript && a.transcript.length >= best.text.length) best = { text: a.transcript, conf: typeof a.confidence === 'number' ? a.confidence : 0.5 }
        }
      }
      return best
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 1200))
    }
  }
  throw lastErr
}

// ---------- Traducción ----------
function splitText(text, size) {
  const parts = []
  let rest = String(text || '').trim()
  while (rest.length > size) {
    let cut = Math.max(rest.lastIndexOf('. ', size), rest.lastIndexOf('? ', size), rest.lastIndexOf('! ', size), rest.lastIndexOf('。', size))
    if (cut < size * 0.4) cut = rest.lastIndexOf(', ', size)
    if (cut < size * 0.4) cut = rest.lastIndexOf(' ', size)
    if (cut < size * 0.4) cut = size - 1
    parts.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function trGtx(text, tl, sl = 'auto') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&dj=1&q=${encodeURIComponent(text)}`
  const res = await fetchT(url, { headers: { 'User-Agent': UA } }, 20000)
  if (!res.ok) throw new Error('gtx ' + res.status)
  const j = JSON.parse(await res.text())
  const out = (j.sentences || []).map((s) => s.trans || '').join('')
  if (!out) throw new Error('gtx vacío')
  return { text: out, src: j.src || null }
}

async function trDict(text, tl, sl = 'auto') {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=${tl}&q=${encodeURIComponent(text)}`
  const res = await fetchT(url, { headers: { 'User-Agent': UA } }, 20000)
  if (!res.ok) throw new Error('dict ' + res.status)
  const j = JSON.parse(await res.text())
  // Formatos: [["trad","es"]] o {sentences:[...], src}
  if (Array.isArray(j)) {
    const first = j[0]
    if (Array.isArray(first)) return { text: j.map((x) => x[0]).join(' '), src: first[1] || null }
    if (typeof first === 'string') return { text: j.join(' '), src: sl === 'auto' ? null : sl }
  }
  if (j?.sentences) return { text: j.sentences.map((s) => s.trans || '').join(''), src: j.src || null }
  throw new Error('dict formato')
}

async function trMyMemory(text, tl, sl) {
  if (!sl || sl === 'auto') throw new Error('mymemory necesita idioma de origen')
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`
  const res = await fetchT(url, { headers: { 'User-Agent': UA } }, 20000)
  const j = await res.json()
  const out = j?.responseData?.translatedText
  if (!out || j?.quotaFinished) throw new Error('mymemory sin traducción')
  return { text: String(out), src: sl }
}

export async function vtTranslate(text, target, source = 'auto') {
  const tl = VT_LANGS[target]?.tr || target
  const sl = source && source !== 'auto' ? (VT_LANGS[source]?.tr || source) : 'auto'
  const chunks = splitText(text, 1200)
  const out = []
  let src = null
  for (const c of chunks) {
    let got = null
    for (const fn of [trGtx, trDict, trMyMemory]) {
      try { got = await fn(c, tl, sl); if (got?.text) break } catch { got = null }
    }
    if (!got?.text) throw new Error('No se pudo traducir el texto (los servicios gratis no respondieron).')
    out.push(got.text)
    src = src || got.src
  }
  return { text: out.join(' ').replace(/[ \t]+/g, ' ').trim(), src }
}

export async function detectLang(text) {
  try {
    const r = await vtTranslate(text.slice(0, 300), 'en')
    const s = String(r.src || '').toLowerCase()
    if (s.startsWith('zh')) return 'zh'
    if (s === 'iw') return 'he'
    return s.split('-')[0] || null
  } catch { return null }
}

// ---------- Voz ----------
async function ttsPiece(text, tl, file) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`
  let lastErr
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchT(url, { headers: { 'User-Agent': UA, Referer: 'https://translate.google.com/' } }, 20000)
      if (!res.ok) throw new Error('voz HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 200) throw new Error('voz vacía')
      fs.writeFileSync(file, buf)
      return
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 800)) }
  }
  throw lastErr
}

async function toOpus(input, output) {
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', output])
  } catch {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'opus', '-strict', '-2', '-b:a', '48k', output])
  }
}

export async function vtSpeak(text, target, dir) {
  const tl = VT_LANGS[target]?.tts || target
  let t = String(text || '').trim()
  if (t.length > MAX_TTS_CHARS) t = t.slice(0, MAX_TTS_CHARS)
  const pieces = splitText(t, 190)
  const files = []
  for (let i = 0; i < pieces.length; i++) {
    const f = path.join(dir, `tts_${i}.mp3`)
    await ttsPiece(pieces[i], tl, f)
    files.push(f)
  }
  const list = path.join(dir, 'tts_list.txt')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  const mp3 = path.join(dir, 'tts_all.mp3')
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', mp3])
  const ogg = path.join(dir, 'traduccion.ogg')
  await toOpus(mp3, ogg)
  return { ogg, mp3 }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) }
  }))
  return out
}

// Cuántas "palabras" trae un texto (para chino/japonés/coreano cuenta caracteres).
function units(text) {
  const t = String(text || '')
  const cjk = (t.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length
  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(w)).length
  return words + cjk / 1.8
}

const NON_LATIN = new Set(['ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'el', 'he', 'uk', 'th'])
// Palabras que se escriben igual en español e inglés (no cuentan como "sin traducir")
const SAME_ES_EN = new Set(('doctor color hospital hotel radio taco tacos idea animal normal final general total popular chocolate piano error actor motor natural ' +
  'social capital central original simple real local metal hotel video audio internet chat super mama papa no me ok okay bye wifi pizza club bar plan ' +
  'familia mexico méxico').split(' '))
export const VT_SHORT_MSG = '🎙️ El audio está muy cortito y no te entendí bien. Habla un poco más (al menos 2 o 3 segundos) y mándalo otra vez.'

// ¿El texto que sacó el reconocedor en español parece de otro idioma? (ej. "konichiwa yo átomo… tomodachi")
// Se traduce es→en y se cuentan las palabras que quedaron igual (el traductor no las conoce en español).
async function looksForeign(text) {
  try {
    const words = plain(text).split(/\s+/).map((w) => w.replace(/[^a-z\u00f1]/g, '')).filter((w) => w.length >= 4 && !SAME_ES_EN.has(w))
    if (words.length < 3) return false
    const tr = plain((await vtTranslate(text, 'en', 'es')).text)
    const trWords = new Set(tr.split(/\s+/).map((w) => w.replace(/[^a-z\u00f1]/g, '')))
    const same = words.filter((w) => trWords.has(w)).length
    return same >= 2 && same / words.length >= 0.15
  } catch { return false }
}

async function scoreLang(flac, code, secs) {
  try {
    const r = await sttChunk(flac, VT_LANGS[code].stt)
    if (!r.text) return { code, ...r, score: 0, wps: 0 }
    const det = await detectLang(r.text)
    const agree = det === code
    const wps = units(r.text) / Math.max(1, secs)
    return { code, ...r, det, agree, wps, score: wps * (agree ? 1 : 0.3) }
  } catch (e) { return { code, text: '', conf: 0, score: 0, wps: 0, err: e } }
}

// Escoge el idioma del audio. Siempre se prefiere español (es-MX):
// 1) Se transcribe en español; si el traductor dice que el texto es español → español.
// 2) Solo si el texto en español sale vacío, parece de otro idioma, o el traductor dice que es otro idioma,
//    se prueban los demás. Otro idioma gana solo si su texto sí es de ese idioma y entiende claramente más
//    palabras que el español. Los de otra escritura (japonés, chino, coreano, ruso, árabe…) necesitan
//    audios de 3 s o más y ganar con mucha ventaja.
// (La "confianza" de Google es casi igual para cualquier idioma, por eso no se usa sola.)
async function pickSource(flac, secs, { target = null, onStatus = null } = {}) {
  const dbg = (...a) => process.env.VT_DEBUG && console.log('[vtr]', ...a)
  const es = await scoreLang(flac, 'es', secs)
  if (es.err && /429/.test(es.err.message)) throw new Error('Google puso un límite por ahora. Intenta en unos minutos.')
  dbg('es', es.det, es.score.toFixed(2), es.text)
  const toEnglish = target === 'en'
  if (es.text && es.agree) {
    // Si lo van a pasar a inglés casi seguro hablaron en español: no se busca más.
    if (toEnglish || !(await looksForeign(es.text))) return es
    dbg('el texto en español parece de otro idioma')
  }
  onStatus && onStatus('🔎 Revisando en qué idioma está el audio…')
  const others = await pool(DETECT_LANGS.filter((c) => c !== 'es'), 4, (c) => scoreLang(flac, c, secs))
  dbg('otros', others.map((x) => `${x.code}:${x.score.toFixed(2)}:${x.agree ? 'Y' : 'n'}:${x.text}`))
  const esBase = es.text ? Math.max(es.score, es.wps * 0.6) : 0 // el español conserva ventaja aunque el traductor dude
  const okOther = others
    .filter((x) => x.text && x.agree)
    .filter((x) => {
      // Si el traductor dijo que el texto "en español" era de este idioma (ej. inglés, o japonés escrito
      // "konichiwa…"), basta con que le gane al español.
      if (es.det === x.code) return x.score >= esBase * (NON_LATIN.has(x.code) ? 1.4 : 0.9)
      if (NON_LATIN.has(x.code)) return secs >= 3 && x.score >= esBase * (toEnglish ? 2 : 1.4) + 0.3
      return x.score >= esBase * (toEnglish ? 1.6 : 1.25) + 0.2
    })
    .sort((a, b) => (b.code === es.det) - (a.code === es.det) || b.score - a.score)
  if (okOther.length) return okOther[0]
  if (es.text) return es
  const any = others.filter((x) => x.text && x.agree && !NON_LATIN.has(x.code)).sort((a, b) => b.score - a.score)[0]
  if (any) return any
  if (others.some((x) => x.err && /429/.test(x.err.message))) throw new Error('Google puso un límite por ahora. Intenta en unos minutos.')
  throw new Error(VT_SHORT_MSG.replace('está muy cortito y ', ''))
}

/**
 * Traduce un archivo de audio. Regresa { source, target, transcript, translation, ogg, truncated, seconds, dir }.
 * Llama a vtCleanup(result.dir) cuando termines de enviar.
 */
export async function voiceTranslate(inputPath, { target = null, source = null, onStatus = null, tmpRoot = null } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), 'vtr-'))
  try {
    const wav = path.join(dir, 'in.wav')
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-t', String(VT_MAX_SEC + 1), '-c:a', 'pcm_s16le', wav])
    const seconds = Math.max(0, (fs.statSync(wav).size - 44) / 32000)
    if (seconds < 2) throw new Error(VT_SHORT_MSG)
    const truncated = seconds > VT_MAX_SEC
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-t', String(VT_MAX_SEC), '-f', 'segment', '-segment_time', String(CHUNK_SEC), '-c:a', 'flac', path.join(dir, 'part_%03d.flac')])
    const parts = fs.readdirSync(dir).filter((f) => /^part_\d+\.flac$/.test(f)).sort().map((f) => path.join(dir, f))
    if (!parts.length) throw new Error('No se pudo leer el audio.')

    onStatus && onStatus(source ? '📝 Pasando el audio a texto…' : '🔎 Detectando el idioma y pasando el audio a texto…')
    let src = source
    if (!src) {
      // Para detectar el idioma solo se mandan los primeros 12 segundos a cada idioma.
      const det = path.join(dir, 'detect.flac')
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-t', '12', '-c:a', 'flac', det])
      const best = await pickSource(det, Math.min(seconds, 12), { target, onStatus })
      src = best.code
    }
    let limited = false
    const texts = await pool(parts, 3, async (p) => {
      try { return (await sttChunk(p, VT_LANGS[src].stt)).text } catch (e) { if (/429/.test(e.message)) limited = true; return '' }
    })
    if (limited && !texts.some(Boolean)) throw new Error('Google puso un límite por ahora. Intenta en unos minutos.')
    const transcript = texts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (!transcript) throw new Error('🎙️ No entendí nada en el audio. Habla un poco más fuerte y más largo (al menos 2 o 3 segundos), o dime el idioma, por ejemplo ja>es.')

    const tgt = target || (src === 'es' ? 'en' : 'es')
    let translation = transcript
    if (tgt !== src) {
      onStatus && onStatus(`🌐 Traduciendo a ${vtLangName(tgt)}…`)
      translation = (await vtTranslate(transcript, tgt, src)).text
    }
    const pronounce = await vtPronounce(translation, tgt).catch(() => null)
    onStatus && onStatus('🔊 Haciendo la nota de voz…')
    let ogg = null
    let ttsError = null
    try { ogg = (await vtSpeak(translation, tgt, dir)).ogg } catch (e) { ttsError = e.message }
    return { source: src, forced: !!source, target: tgt, transcript, translation, pronounce, ogg, ttsError, truncated, seconds: Math.min(seconds, VT_MAX_SEC), dir }
  } catch (e) {
    vtCleanup(dir)
    throw e
  }
}

export function vtCleanup(dir) {
  try { if (dir) fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

export function vtFormat(r, { bold = (s) => `*${s}*` } = {}) {
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
  const img = r.kind === 'image'
  const lines = [
    img ? `🖼️ ${bold('Traducción de imagen')}` : `🎙️ ${bold('Traducción por voz')}`,
    `🗣️ ${r.forced ? (img ? 'Idioma del texto' : 'Idioma del audio') : 'Idioma detectado'}: ${vtLangName(r.source)} → ${vtLangName(r.target)}`,
    '',
    `📝 ${bold(img ? 'Texto de la imagen:' : 'Lo que dijo:')}`,
    cut(r.transcript, 1200),
    '',
    `🌐 ${bold('Traducción:')}`,
    cut(r.translation, 1200)
  ]
  if (r.pronounce) lines.push('', `🗣️ ${bold('Cómo se pronuncia:')}`, cut(r.pronounce, 1000))
  if (r.truncated) lines.push('', img ? '⚠️ La imagen trae mucho texto; solo traduje una parte.' : `⚠️ El audio dura más de ${Math.round(VT_MAX_SEC / 60)} minutos; solo traduje los primeros ${Math.round(VT_MAX_SEC / 60)}.`)
  if (r.ttsError) lines.push('', '⚠️ No pude hacer la nota de voz esta vez, pero aquí está el texto.')
  return lines.join('\n')
}

export function vtErrorText(e) {
  const m = String(e?.message || e || '')
  if (/ENOENT/.test(m) && /ffmpeg/.test(m)) return '❌ Falta ffmpeg en el servidor. En Termux: pkg install ffmpeg'
  if (/abort/i.test(m)) return '❌ El servicio tardó demasiado. Intenta otra vez en un ratito.'
  if (m.startsWith('🎙️') || m.startsWith('🖼️')) return m
  return '❌ ' + (m.length > 300 ? m.slice(0, 300) : m)
}
