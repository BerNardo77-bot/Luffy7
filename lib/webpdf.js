import fs from 'fs'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import PDFDocument from 'pdfkit'

// Convierte una página web (artículo HTML) en un PDF legible.
// Todo en JS puro (linkedom + Readability + pdfkit): sin Chromium ni binarios nativos, apto para Termux.
// Usa las fuentes estándar del PDF (Helvetica / Courier): no hay que empaquetar TTF.

export const MIN_TEXT = 100 // menos texto que esto = no hay artículo legible
const MAX_TEXT = 400000 // tope de caracteres para no generar PDFs gigantes

// ── Decodificar HTML respetando el charset ─────────────────────────
export function decodeHtml(buf, ctype = '') {
  let cs = (String(ctype).match(/charset=["']?([\w.:-]+)/i) || [])[1]
  if (!cs) {
    const head = buf.subarray(0, 4096).toString('latin1')
    cs = (head.match(/<meta[^>]+charset=["']?([\w.:-]+)/i) || [])[1]
  }
  cs = String(cs || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(cs).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

// ── Texto compatible con Helvetica/Courier (WinAnsi) ───────────────
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const REPLACE = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2212': '-', '\u2043': '-',
  '\u2192': '->', '\u2190': '<-', '\u2194': '<->', '\u21d2': '=>', '\u2264': '<=', '\u2265': '>=', '\u2260': '!=',
  '\u2713': 'v', '\u2714': 'v', '\u2717': 'x', '\u2718': 'x', '\u25cf': '•', '\u25aa': '•', '\u25e6': '•', '\u2023': '•',
  '\u2032': "'", '\u2033': '"', '\u00ad': '', '\u200b': '', '\u200c': '', '\u200d': '', '\u2060': '', '\ufeff': '',
  '\u2028': '\n', '\u2029': '\n', '\u2009': ' ', '\u200a': ' ', '\u2002': ' ', '\u2003': ' ', '\u202f': ' ', '\u2007': ' '
}
export function pdfSafe(s = '') {
  let out = ''
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    if (ch === '\n' || ch === '\t' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch)) { out += ch; continue }
    if (ch in REPLACE) { out += REPLACE[ch]; continue }
    const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    if (base && [...base].every((b) => { const k = b.codePointAt(0); return (k >= 0x20 && k <= 0x7e) || (k >= 0xa0 && k <= 0xff) })) out += base
    // el resto (emojis, CJK, etc.) no existe en las fuentes estándar: se omite
  }
  return out
}

export function slugify(s = '', max = 80) {
  const slug = String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'pagina-web'
}

// ── Extraer el artículo ────────────────────────────────────────────
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'img', 'picture', 'video', 'audio', 'source',
  'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'nav', 'aside', 'map', 'math', 'head'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'figure', 'figcaption', 'blockquote',
  'ul', 'ol', 'li', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'dl', 'dt', 'dd', 'hr', 'details', 'summary', 'address', 'center'])
const CODE_INLINE = new Set(['code', 'kbd', 'samp', 'tt', 'var'])

const clean = (t) => t.replace(/[\s\u00a0]+/g, ' ')

// Recorre el HTML del artículo y lo convierte en bloques simples.
export function htmlToBlocks(html) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  const blocks = []
  let runs = [] // texto inline pendiente: [{ text, code }]
  let pending = null // viñeta/número de la lista que espera su primer párrafo

  const flush = (ctx) => {
    const merged = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (last && last.code === r.code) last.text += r.text
      else merged.push({ ...r })
    }
    runs = []
    // recortar espacios de los extremos
    while (merged.length && !merged[0].text.trim()) merged.shift()
    while (merged.length && !merged[merged.length - 1].text.trim()) merged.pop()
    if (!merged.length) return
    merged[0].text = merged[0].text.replace(/^\s+/, '')
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
    const b = { type: ctx.heading ? 'h' : ctx.quote ? 'quote' : 'p', level: ctx.heading || 0, runs: merged, indent: ctx.indent || 0 }
    if (pending != null) { b.marker = pending; pending = null }
    blocks.push(b)
  }

  const walk = (node, ctx) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const t = clean(child.textContent || '')
        if (t) runs.push({ text: t, code: !!ctx.code })
        continue
      }
      if (child.nodeType !== 1) continue
      const tag = child.localName || String(child.tagName || '').toLowerCase()
      if (SKIP.has(tag)) continue
      if (child.getAttribute?.('hidden') != null || /display:\s*none/i.test(child.getAttribute?.('style') || '')) continue
      if (tag === 'br') { runs.push({ text: '\n', code: !!ctx.code }); continue }
      if (tag === 'pre') {
        flush(ctx)
        const text = (child.textContent || '').replace(/\t/g, '  ').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '')
        if (text) blocks.push({ type: 'pre', text, indent: ctx.indent || 0 })
        continue
      }
      if (/^h[1-6]$/.test(tag)) {
        flush(ctx)
        walk(child, { ...ctx, heading: Number(tag[1]) })
        flush({ ...ctx, heading: Number(tag[1]) })
        continue
      }
      if (tag === 'hr') { flush(ctx); blocks.push({ type: 'hr' }); continue }
      if (tag === 'ul' || tag === 'ol') {
        flush(ctx)
        let n = Number(child.getAttribute('start')) || 1
        for (const li of [...child.children]) {
          const liTag = li.localName || String(li.tagName || '').toLowerCase()
          if (liTag !== 'li') { walk({ childNodes: [li] }, { ...ctx, indent: (ctx.indent || 0) + 1 }); continue }
          pending = tag === 'ol' ? `${n++}.` : '•'
          const inner = { ...ctx, indent: (ctx.indent || 0) + 1, heading: 0 }
          walk(li, inner)
          flush(inner)
          pending = null
        }
        continue
      }
      if (tag === 'tr') {
        flush(ctx)
        const cells = [...child.children].map((c) => clean(c.textContent || '').trim()).filter(Boolean)
        if (cells.length) blocks.push({ type: 'p', runs: [{ text: cells.join('  |  '), code: false }], indent: ctx.indent || 0 })
        continue
      }
      if (tag === 'blockquote') {
        flush(ctx)
        const q = { ...ctx, quote: true, indent: (ctx.indent || 0) + 1 }
        walk(child, q)
        flush(q)
        continue
      }
      if (BLOCK.has(tag)) {
        flush(ctx)
        walk(child, ctx)
        flush(ctx)
        continue
      }
      walk(child, CODE_INLINE.has(tag) ? { ...ctx, code: true } : ctx)
    }
  }
  walk(document.body, { indent: 0 })
  flush({ indent: 0 })
  return blocks
}

const blocksText = (blocks) => blocks.map((b) => (b.text || (b.runs || []).map((r) => r.text).join(''))).join('\n')

// Páginas de desafío anti-bots (Cloudflare, etc.): no son el artículo.
export function isChallengePage(html = '') {
  const h = String(html).slice(0, 20000)
  return /<title>\s*(just a moment|attention required|un momento|access denied|ddos-guard)/i.test(h) ||
    /cf-browser-verification|cf_chl_opt|challenge-platform|captcha-delivery\.com/i.test(h)
}

// Si Readability no encuentra artículo (páginas cortas), usar <main>/<article>/<body> sin menús.
function fallbackArticle(html) {
  try {
    const { document } = parseHTML(html)
    for (const el of [...document.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe,svg')]) el.remove()
    const root = document.querySelector('main') || document.querySelector('article') || document.body
    if (!root) return null
    return { title: document.querySelector('title')?.textContent || '', content: root.innerHTML, byline: '', siteName: '' }
  } catch { return null }
}

// Devuelve { title, byline, siteName, blocks, textLength } o null si no hay artículo legible.
export function extractArticle(html, url) {
  if (isChallengePage(html)) return null
  let article = null
  try {
    const { document } = parseHTML(html)
    try { if (url && !document.querySelector('base')) { const b = document.createElement('base'); b.setAttribute('href', url); document.head?.appendChild(b) } } catch {}
    const metaTitle =
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      document.querySelector('title')?.textContent || ''
    article = new Readability(document, { charThreshold: 300, keepClasses: false }).parse()
    if (article && !article.title) article.title = metaTitle
  } catch (e) {
    console.error('[webpdf] readability', e?.message || e)
    article = null
  }
  let blocks = article?.content ? htmlToBlocks(article.content) : []
  let text = blocksText(blocks).replace(/\s+/g, ' ').trim()
  if (text.length < MIN_TEXT) {
    const fb = fallbackArticle(html)
    const fbBlocks = fb?.content ? htmlToBlocks(fb.content) : []
    const fbText = blocksText(fbBlocks).replace(/\s+/g, ' ').trim()
    if (fbText.length > text.length) {
      article = { ...fb, title: article?.title || fb.title, siteName: article?.siteName || '' }
      blocks = fbBlocks
      text = fbText
    }
  }
  if (!article || text.length < MIN_TEXT) return null
  let title = clean(String(article.title || '')).trim()
  // Quitar " | Sitio" / " - Sitio" del final si coincide con el nombre del sitio
  if (article.siteName && title.length > article.siteName.length + 3) {
    const sn = article.siteName.trim()
    title = title.replace(new RegExp(`\\s*[|\\-–—:]\\s*${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '')
  }
  return {
    title: title || 'Página web',
    byline: clean(String(article.byline || '')).trim(),
    siteName: clean(String(article.siteName || '')).trim(),
    blocks,
    textLength: text.length
  }
}

function fechaMx(d = new Date()) {
  try {
    return d.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' }) + ' (hora CDMX)'
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  }
}

// ── Generar el PDF ─────────────────────────────────────────────────
export function buildPdf(article, { url, fetchedAt = new Date() } = {}, outFile) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      bufferPages: false,
      info: { Title: pdfSafe(article.title), Author: pdfSafe(article.byline || article.siteName || ''), Subject: pdfSafe(url || ''), Creator: 'Luffy7' }
    })
    const out = fs.createWriteStream(outFile)
    out.on('finish', () => resolve(outFile))
    out.on('error', reject)
    doc.on('error', reject)
    doc.pipe(out)

    const left = doc.page.margins.left
    const fullW = doc.page.width - left - doc.page.margins.right
    const bottom = () => doc.page.height - doc.page.margins.bottom
    const ensure = (h) => { if (doc.y + h > bottom()) doc.addPage() }
    const IND = 16

    // Encabezado
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(pdfSafe(article.title), left, doc.y, { width: fullW })
    doc.moveDown(0.4)
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
    if (article.byline || article.siteName) doc.text(pdfSafe([article.byline, article.siteName].filter(Boolean).join(' · ')), { width: fullW })
    doc.text(pdfSafe(`Fuente: ${url}`), { width: fullW, link: url })
    doc.text(pdfSafe(`Descargado: ${fechaMx(fetchedAt)}`), { width: fullW })
    doc.moveDown(0.5)
    doc.moveTo(left, doc.y).lineTo(left + fullW, doc.y).lineWidth(0.7).strokeColor('#bbbbbb').stroke()
    doc.moveDown(0.8)

    let total = 0
    for (const b of article.blocks) {
      if (total > MAX_TEXT) {
        doc.font('Helvetica-Oblique').fontSize(10).fillColor('#777777').text('[Texto recortado: la página es demasiado larga.]', left, doc.y, { width: fullW })
        break
      }
      const x = left + (b.indent || 0) * IND
      const w = fullW - (b.indent || 0) * IND
      if (b.type === 'hr') {
        ensure(14)
        doc.moveDown(0.3)
        doc.moveTo(left, doc.y).lineTo(left + fullW, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke()
        doc.moveDown(0.6)
        continue
      }
      if (b.type === 'pre') {
        total += b.text.length
        doc.font('Courier').fontSize(8.5)
        const pad = 5
        const lines = pdfSafe(b.text).split('\n')
        ensure(20)
        doc.y += 2
        for (const line of lines) {
          const t = line.length ? line : ' '
          const h = doc.heightOfString(t, { width: w - pad * 2, lineGap: 1 })
          ensure(h + 2)
          doc.save().rect(x, doc.y - 1, w, h + 2).fill('#f0f0f0').restore()
          doc.fillColor('#1a1a1a').font('Courier').fontSize(8.5).text(t, x + pad, doc.y, { width: w - pad * 2, lineGap: 1 })
        }
        doc.x = left
        doc.moveDown(0.7)
        continue
      }
      const runs = b.runs.map((r) => ({ ...r, text: pdfSafe(r.text) })).filter((r) => r.text)
      if (!runs.length) continue
      total += runs.reduce((a, r) => a + r.text.length, 0)
      let size = 11
      let bold = false
      let color = '#222222'
      if (b.type === 'h') {
        size = b.level <= 1 ? 17 : b.level === 2 ? 15 : b.level === 3 ? 13 : 12
        bold = true
        color = '#111111'
        ensure(size * 3)
        doc.moveDown(0.3)
      } else ensure(size * 1.6)
      if (b.type === 'quote') color = '#444444'
      let tx = x
      let tw = w
      if (b.marker) {
        const mw = 16
        const y0 = doc.y
        doc.font('Helvetica').fontSize(size).fillColor(color).text(b.marker, x - mw + 2, y0, { width: mw, lineBreak: false })
        doc.y = y0
        tx = x + 4
        tw = w - 4
      }
      const baseFont = bold ? 'Helvetica-Bold' : b.type === 'quote' ? 'Helvetica-Oblique' : 'Helvetica'
      runs.forEach((r, i) => {
        const last = i === runs.length - 1
        doc.font(r.code ? 'Courier' : baseFont).fontSize(r.code ? size - 1 : size).fillColor(r.code ? '#8b1a1a' : color)
        const opts = { width: tw, continued: !last, lineGap: 2 }
        if (i === 0) doc.text(r.text, tx, doc.y, opts)
        else doc.text(r.text, opts)
      })
      doc.x = left
      doc.moveDown(b.type === 'h' ? 0.35 : b.marker ? 0.25 : 0.55)
    }
    doc.end()
  })
}

// Atajo: HTML -> archivo PDF. Devuelve { file, title, fileName, size } o null si no se pudo extraer.
export async function htmlToPdfFile(html, url, outFile) {
  const article = extractArticle(html, url)
  if (!article) return null
  await buildPdf(article, { url }, outFile)
  const size = fs.statSync(outFile).size
  return { file: outFile, title: article.title, fileName: `${slugify(article.title)}.pdf`, size, article }
}
