// Traducción de imágenes: OCR (texto de la imagen) → traducción → "Cómo se pronuncia" (+ nota de voz si es corto).
// OCR gratis y sin llaves privadas:
//  1) tesseract (programa) si está instalado: Termux `pkg install tesseract`, en Docker viene en la imagen.
//     Modelos "fast" de github.com/tesseract-ocr/tessdata_fast, bajados la primera vez y guardados en caché
//     (~/.cache/tessdata-fast). Español+inglés por defecto; otros idiomas se bajan cuando se piden.
//  2) Respaldo: OCR.space con su llave pública de prueba "helloworld" (gratis, límite bajo, máx. 1 MB).
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { run, detectLang, vtTranslate, vtSpeak, vtPronounce, vtCleanup } from './voice-translate-core.js'

const UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
const TESS_LANG = {
  es: 'spa', en: 'eng', pt: 'por', fr: 'fra', it: 'ita', de: 'deu', ja: 'jpn', ko: 'kor', zh: 'chi_sim', ru: 'rus', ar: 'ara',
  hi: 'hin', tr: 'tur', nl: 'nld', pl: 'pol', uk: 'ukr', el: 'ell', he: 'heb', sv: 'swe', id: 'ind', vi: 'vie', th: 'tha', ca: 'cat'
}
const OCRSPACE_LANG = { es: 'spa', en: 'eng', pt: 'por', fr: 'fre', it: 'ita', de: 'ger', ja: 'jpn', ko: 'kor', zh: 'chs', ru: 'rus', ar: 'ara', tr: 'tur', nl: 'dut', pl: 'pol', uk: 'ukr', el: 'gre', sv: 'swe', vi: 'vnm', th: 'tha', hi: 'hin' }
const SCRIPT_LANG = { Japanese: 'ja', Han: 'zh', HanS: 'zh', HanT: 'zh', Hangul: 'ko', Korean: 'ko', Cyrillic: 'ru', Arabic: 'ar', Devanagari: 'hi', Greek: 'el', Hebrew: 'he', Thai: 'th' }
const MAX_CHARS = 2500
export const OCR_EMPTY_MSG = '🖼️ No encontré texto en la imagen. Prueba con una foto más clara, derecha y de cerca (o una captura de pantalla).'

const CACHE = process.env.TESSDATA_CACHE || path.join(os.homedir() || os.tmpdir(), '.cache', 'tessdata-fast')
let tessOk = null

function runOut(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const t = setTimeout(() => { try { p.kill('SIGKILL') } catch {} }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} falló: ${err.trim().split('\n').slice(-2).join(' ')}`)) })
  })
}

async function hasTesseract() {
  if (tessOk !== null) return tessOk
  try { await runOut('tesseract', ['--version'], 15000); tessOk = true } catch { tessOk = false }
  if (!tessOk) console.log('[ocr] tesseract no está instalado; uso OCR.space (en Termux: pkg install tesseract)')
  return tessOk
}

const downloading = new Map()
async function ensureModel(code) {
  const file = path.join(CACHE, `${code}.traineddata`)
  if (fs.existsSync(file) && fs.statSync(file).size > 100000) return
  if (downloading.has(code)) return downloading.get(code)
  const job = (async () => {
    fs.mkdirSync(CACHE, { recursive: true })
    const url = `https://github.com/tesseract-ocr/tessdata_fast/raw/main/${code}.traineddata`
    console.log('[ocr] bajando modelo', code)
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) })
    if (!res.ok) throw new Error(`no pude bajar el idioma ${code} para el OCR (HTTP ${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100000) throw new Error(`modelo ${code} incompleto`)
    const tmp = file + '.part' + process.pid
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, file)
  })().finally(() => downloading.delete(code))
  downloading.set(code, job)
  return job
}

// Pasa la imagen a PNG en gris: agranda si es chica (<1000 px) y achica si es enorme (>2400 px).
async function prep(input, dir) {
  const out = path.join(dir, 'ocr.png')
  const vf = "scale='if(lt(max(iw,ih),1000),iw*2,if(gt(max(iw,ih),2400),iw*2400/max(iw,ih),iw))':-2:flags=lanczos,format=gray"
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', '-vf', vf, out], 60000)
  return out
}

function tsvToText(tsv) {
  const lines = new Map()
  let confSum = 0
  let n = 0
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const word = c[11].trim()
    const conf = Number(c[10])
    if (!word || conf < 0) continue
    const key = `${c[2]}-${c[3]}-${c[4]}`
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push(word)
    confSum += conf * word.length
    n += word.length
  }
  const text = [...lines.values()].map((w) => w.join(' ')).join('\n')
  return { text, conf: n ? confSum / n : 0 }
}

async function tesseract(png, codes, psm = '3') {
  for (const c of codes) await ensureModel(c)
  const tsv = await runOut('tesseract', [png, 'stdout', '--tessdata-dir', CACHE, '-l', codes.join('+'), '--psm', psm, 'tsv'], 180000)
  return tsvToText(tsv)
}

async function detectScript(png) {
  try {
    await ensureModel('osd')
    const out = await runOut('tesseract', [png, 'stdout', '--tessdata-dir', CACHE, '--psm', '0'], 60000)
    const m = out.match(/Script:\s*(\w+)/)
    const conf = Number((out.match(/Script confidence:\s*([\d.]+)/) || [])[1] || 0)
    return m && conf >= 1 ? SCRIPT_LANG[m[1]] || null : null
  } catch { return null }
}

async function ocrSpace(input, dir, lang) {
  // Máx. 1 MB con la llave pública: JPG reducido
  let jpg = path.join(dir, 'ocrspace.jpg')
  for (const [size, q] of [[1800, 4], [1400, 6], [1000, 9]]) {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-frames:v', '1', '-vf', `scale='min(${size},iw)':-2`, '-q:v', String(q), jpg], 60000)
    if (fs.statSync(jpg).size < 1000000) break
  }
  const latin = !lang || !['ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'el', 'th', 'uk'].includes(lang)
  const fd = new FormData()
  fd.append('apikey', process.env.OCR_SPACE_KEY || 'helloworld')
  fd.append('language', lang ? OCRSPACE_LANG[lang] || 'auto' : 'auto')
  fd.append('OCREngine', latin ? '2' : '1')
  fd.append('scale', 'true')
  fd.append('file', new Blob([fs.readFileSync(jpg)], { type: 'image/jpeg' }), 'imagen.jpg')
  const res = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) })
  const j = await res.json().catch(() => null)
  if (!res.ok || !j || j.IsErroredOnProcessing) {
    const msg = [].concat(j?.ErrorMessage || []).join(' ') || `HTTP ${res.status}`
    throw new Error('OCR.space: ' + msg)
  }
  return { text: (j.ParsedResults || []).map((r) => r.ParsedText || '').join('\n').trim(), conf: 80 }
}

const clean = (t) => String(t || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trim()).filter((l) => /[\p{L}\p{N}]/u.test(l)).join('\n').trim()
const letters = (t) => (String(t).match(/\p{L}/gu) || []).length

/** Saca el texto de una imagen. source = código del idioma si el usuario lo dijo. */
export async function ocrImage(input, { source = null, dir }) {
  const png = await prep(input, dir)
  let best = null
  let lang = source
  const errs = []
  if (await hasTesseract()) {
    try {
      if (source) {
        const codes = [TESS_LANG[source] || 'eng']
        if (source !== 'en' && !codes.includes('eng')) codes.push('eng')
        best = await tesseract(png, codes)
      } else {
        best = await tesseract(png, ['spa', 'eng'])
        // ¿Poco texto o muy dudoso? Puede ser otra escritura (japonés, chino, ruso…): se detecta y se repite.
        if (best.conf < 60 || letters(best.text) < 4) {
          const sl = await detectScript(png)
          let fixed = false
          if (sl && TESS_LANG[sl]) {
            const again = await tesseract(png, [TESS_LANG[sl]])
            if (letters(again.text) >= 2 && again.conf > best.conf) { best = again; lang = sl; fixed = true }
          }
          if (!fixed) {
            // Texto corto en otra escritura (la detección necesita bastantes letras): se prueba OCR.space
            try {
              const r = await ocrSpace(input, dir, null)
              r.text = clean(r.text)
              if (letters(r.text) >= 2) best = r
            } catch (e) { console.error('[ocr]', e.message) }
          }
        }
      }
      best.text = clean(best.text)
      if (best.text && best.conf < 35) best.text = '' // ruido (fotos sin texto)
    } catch (e) {
      errs.push(e.message)
      console.error('[ocr] tesseract:', e.message)
      best = null
    }
  }
  if (!best || !best.text) {
    try {
      const r = await ocrSpace(input, dir, source)
      r.text = clean(r.text)
      if (r.text) best = r
    } catch (e) {
      errs.push(e.message)
      console.error('[ocr]', e.message)
    }
  }
  if (!best?.text) {
    if (errs.length && !(await hasTesseract())) throw new Error('🖼️ No pude leer la imagen ahorita (el servicio de OCR gratis no respondió). Intenta en unos minutos.')
    throw new Error(OCR_EMPTY_MSG)
  }
  return { text: best.text, lang }
}

/** Imagen → { kind:'image', source, target, transcript, translation, pronounce, ogg, dir } */
export async function imageTranslate(input, { target = null, source = null, onStatus = null, tmpRoot = null, voice = true } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), 'ocr-'))
  try {
    onStatus && onStatus('🔎 Leyendo el texto de la imagen…')
    const o = await ocrImage(input, { source, dir })
    let text = o.text
    let truncated = false
    if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true }
    // Idioma: el que dijo el usuario; si no, español primero (si el traductor no está seguro, se queda en español).
    let src = source || o.lang
    if (!src) {
      const det = await detectLang(text)
      src = det && det !== 'es' && TESS_LANG[det] ? det : 'es'
    }
    const tgt = target || (src === 'es' ? 'en' : 'es')
    let translation = text
    if (tgt !== src) {
      onStatus && onStatus('🌐 Traduciendo…')
      translation = (await vtTranslate(text, tgt, src)).text
    }
    const pronounce = await vtPronounce(translation, tgt).catch(() => null)
    let ogg = null
    let ttsError = null
    // Nota de voz solo si la traducción es corta (es barato); con textos largos va solo el texto.
    if (voice && translation.length <= 600) {
      try { ogg = (await vtSpeak(translation, tgt, dir)).ogg } catch (e) { ttsError = e.message }
    }
    return { kind: 'image', source: src, forced: !!source, target: tgt, transcript: text, translation, pronounce, ogg, ttsError, truncated, dir }
  } catch (e) {
    vtCleanup(dir)
    throw e
  }
}
