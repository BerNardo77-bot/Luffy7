import fetch from 'node-fetch'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import dns from 'dns/promises'
import net from 'net'

// #pdf / #gdrive — descarga archivos PÚBLICOS de Google Drive sin API key.
// Soporta: drive.google.com/file/d/<id>, open?id=, uc?id=, drive.usercontent.google.com,
// y docs.google.com/document|spreadsheets|presentation/d/<id> (exporta a pdf / xlsx / pptx).
// Mantiene el resourcekey (archivos viejos 0B... lo necesitan).
// También acepta links DIRECTOS a PDF (cualquier http/https que entregue un PDF).
// Si el link es una PÁGINA WEB (artículo, guía), extrae el contenido y lo convierte a PDF (lib/webpdf.js).
// Scribd / Studocu / etc. exigen cuenta o suscripción: solo se avisa, no se descarga ni se convierte.

const MAX_SEND = 90 * 1024 * 1024 // misma regla que #apk
const TIMEOUT = 30000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const WEBPDF_PATH = new URL('../../lib/webpdf.js', import.meta.url).href
const WEBPDF_TMP = () => path.join(os.tmpdir(), `webpdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`)

const MIME = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  apk: 'application/vnd.android.package-archive',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  epub: 'application/epub+zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp'
}

const EXPORT = {
  document: { format: 'pdf', ext: 'pdf' },
  spreadsheets: { format: 'xlsx', ext: 'xlsx' },
  presentation: { format: 'pptx', ext: 'pptx' }
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '?'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i ? 2 : 0)} ${u[i]}`
}

// ── Parseo del link ────────────────────────────────────────────────
export function parseDriveUrl(input = '') {
  const m = String(input).match(/https?:\/\/[^\s<>"]+/i)
  if (!m) return null
  let u
  try { u = new URL(m[0]) } catch { return null }
  const host = u.hostname.toLowerCase()
  if (!/(^|\.)(drive|docs|drive\.usercontent)\.google\.com$/.test(host)) return null

  const resourceKey = u.searchParams.get('resourcekey') || null
  const idOk = (s) => (s && /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null)
  let id = null
  let kind = 'file'

  const docs = u.pathname.match(/^\/(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/)
  if (docs) {
    kind = docs[1]
    id = idOk(docs[2])
  } else {
    const fd = u.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/)
    if (fd) id = idOk(fd[1])
    else if (/^\/(open|uc|download)\/?$/.test(u.pathname) || u.searchParams.has('id')) id = idOk(u.searchParams.get('id'))
  }
  if (!id) return null
  return { id, kind, resourceKey, link: m[0] }
}

function buildUrl({ id, kind, resourceKey }) {
  if (EXPORT[kind]) {
    const q = new URLSearchParams({ format: EXPORT[kind].format })
    if (resourceKey) q.set('resourcekey', resourceKey)
    return `https://docs.google.com/${kind}/d/${id}/export?${q}`
  }
  const q = new URLSearchParams({ id, export: 'download', confirm: 't' })
  if (resourceKey) q.set('resourcekey', resourceKey)
  return `https://drive.usercontent.google.com/download?${q}`
}

function headersFor({ id, resourceKey }, extra = {}) {
  const h = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'es-419,es;q=0.9', ...extra }
  if (resourceKey) h['X-Goog-Drive-Resource-Keys'] = `${id}/${resourceKey}`
  return h
}

async function req(url, headers, { timeout = TIMEOUT } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal })
    return { res, done: () => clearTimeout(t), ctrl }
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

export function parseDisposition(cd = '') {
  if (!cd) return null
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i)
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) } catch {} }
  const plain = cd.match(/filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i)
  if (plain) {
    const raw = (plain[1] ?? plain[2] ?? '').trim()
    // node-fetch entrega los headers como latin1: re-decodificar a UTF-8
    try { return Buffer.from(raw, 'latin1').toString('utf8') } catch { return raw }
  }
  return null
}

// Página "no se puede analizar en busca de virus": form con inputs ocultos.
export function parseConfirmForm(html = '') {
  const form = html.match(/<form[^>]+id=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i) ||
    html.match(/<form[^>]+action=["'][^"']*download[^"']*["'][^>]*>([\s\S]*?)<\/form>/i)
  if (!form) return null
  const action = (form[0].match(/action=["']([^"']+)["']/i) || [])[1]
  const params = new URLSearchParams()
  for (const inp of form[1].matchAll(/<input[^>]+>/gi)) {
    const name = (inp[0].match(/name=["']([^"']+)["']/i) || [])[1]
    const value = (inp[0].match(/value=["']([^"']*)["']/i) || [])[1] ?? ''
    if (name) params.set(name, value.replace(/&amp;/g, '&'))
  }
  if (!action || !params.get('id')) return null
  const base = action.replace(/&amp;/g, '&')
  return `${base}${base.includes('?') ? '&' : '?'}${params}`
}

function htmlError(html = '', status = 200) {
  const t = html.toLowerCase()
  if (status === 404 || /error 404|not found|no existe/.test(t)) return 'El archivo no existe o fue eliminado.'
  if (/accounts\.google\.com|servicelogin|you need access|necesitas acceso|solicitar acceso|request access|permission/.test(t))
    return 'El archivo es *privado*: el dueño no lo compartió con "Cualquier persona con el enlace".'
  if (/quota|cuota|too many users|demasiados usuarios/.test(t))
    return 'Google Drive bloqueó la descarga por *exceso de descargas* (cuota). Intenta más tarde.'
  return 'Google Drive no entregó el archivo (puede ser privado o requerir inicio de sesión).'
}

function guessMime(name, ctype) {
  const ext = (String(name).match(/\.([a-z0-9]{1,5})$/i) || [])[1]?.toLowerCase()
  if (ext && MIME[ext]) return MIME[ext]
  const c = String(ctype || '').split(';')[0].trim().toLowerCase()
  if (c && c !== 'application/octet-stream' && c !== 'binary/octet-stream') return c
  return 'application/octet-stream'
}

function extFor(mime) {
  const hit = Object.entries(MIME).find(([, m]) => m === mime)
  return hit ? hit[0] : 'bin'
}

// Pide 1 byte para leer nombre, tipo y tamaño real sin bajar el archivo.
export async function probe(info) {
  let url = buildUrl(info)
  for (let step = 0; step < 3; step++) {
    const { res, done, ctrl } = await req(url, headersFor(info, { Range: 'bytes=0-0' }))
    try {
      const ctype = res.headers.get('content-type') || ''
      const cd = res.headers.get('content-disposition') || ''
      if (/text\/html/i.test(ctype) && !cd) {
        const html = await res.text().catch(() => '')
        const next = parseConfirmForm(html)
        if (next && step < 2) { url = next; continue }
        return { ok: false, error: htmlError(html, res.status) }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: res.status === 404 ? htmlError(body, 404) : res.status === 403 ? htmlError('permission', 403) : `Google Drive respondió HTTP ${res.status}.` }
      }
      const range = res.headers.get('content-range') || ''
      let size = Number((range.match(/\/(\d+)\s*$/) || [])[1])
      if (!Number.isFinite(size) || size <= 0) {
        const cl = Number(res.headers.get('content-length'))
        size = res.status === 200 && cl > 1 ? cl : 0 // export de Docs no siempre da tamaño
      }
      let name = parseDisposition(cd)
      const mimetype = guessMime(name || '', ctype)
      if (!name) name = `drive_${info.id}.${EXPORT[info.kind]?.ext || extFor(mimetype)}`
      // Cortar la conexión: solo se querían los headers (si no, el socket queda abierto)
      try { res.body?.on?.('error', () => {}); ctrl.abort() } catch {}
      return { ok: true, url, name, size, mimetype, ctype }
    } finally {
      done()
    }
  }
  return { ok: false, error: 'Google Drive no entregó el archivo.' }
}

// Descarga en streaming a un archivo temporal con tope de tamaño (no llena la RAM).
export async function downloadToFile(info, url, max = MAX_SEND) {
  const file = path.join(os.tmpdir(), `gdrive_${info.id}_${Date.now()}`)
  const { res, done, ctrl } = await req(url, headersFor(info), { timeout: 10 * 60 * 1000 })
  try {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (/text\/html/i.test(res.headers.get('content-type') || '') && !res.headers.get('content-disposition')) {
      throw new Error(htmlError(await res.text().catch(() => ''), res.status))
    }
    let got = 0
    const limiter = new Transform({
      transform(chunk, _e, cb) {
        got += chunk.length
        if (got > max) { ctrl.abort(); return cb(new Error('TOO_BIG')) }
        cb(null, chunk)
      }
    })
    await pipeline(res.body, limiter, fs.createWriteStream(file))
    return { file, size: got }
  } catch (e) {
    try { fs.unlinkSync(file) } catch {}
    throw e
  } finally {
    done()
  }
}

async function react(msg, e) {
  try { await msg.react(e) } catch {}
}

// ── Sitios de documentos con cuenta/suscripción (no se descargan) ──
const PAYWALL_SITES = [
  { re: /(^|\.)scribd\.com$/, name: 'Scribd' },
  { re: /(^|\.)studocu\.com$/, name: 'Studocu' },
  { re: /(^|\.)pdfcoffee\.com$/, name: 'PDFCOFFEE' },
  { re: /(^|\.)dokumen\.pub$/, name: 'dokumen.pub' },
  { re: /(^|\.)fdocuments\.[a-z.]+$/, name: 'fdocuments' },
  { re: /(^|\.)vdocuments\.[a-z.]+$/, name: 'vdocuments' },
  { re: /(^|\.)coursehero\.com$/, name: 'Course Hero' },
  { re: /(^|\.)slideshare\.net$/, name: 'SlideShare' }
]

export function extractUrl(input = '') {
  const m = String(input).match(/https?:\/\/[^\s<>"]+/i)
  if (!m) return null
  try {
    const u = new URL(m[0])
    if (!/^https?:$/.test(u.protocol)) return null
    return u
  } catch { return null }
}

export function paywallSite(input = '') {
  const u = typeof input === 'string' ? extractUrl(input) : input
  if (!u) return null
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  return PAYWALL_SITES.find((s) => s.re.test(host))?.name || null
}

function paywallMessage(site, link) {
  return (
    `✖️ *${site}* exige una cuenta o suscripción para descargar documentos, ` +
    `así que el bot *no puede* descargar desde ahí.\n\n` +
    `✎ Opciones:\n` +
    `❖ Busca el título con *#google <título> pdf* para encontrar una versión pública y gratuita.\n` +
    `❖ Pide a quien lo compartió un link de *Google Drive* o un link *directo* al PDF.\n\n` +
    `❖ Link › ${link}`
  )
}

// ── Links directos a PDF ───────────────────────────────────────────
// Evita que el bot pida URLs internas (localhost, redes privadas, metadata de la nube).
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224
  }
  const x = ip.toLowerCase()
  if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7))
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff')
}

async function assertPublicHost(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('Ese link apunta a una dirección interna.')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw new Error('No se pudo resolver el dominio del link.')
  })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Ese link apunta a una dirección interna.')
}

// fetch siguiendo redirecciones a mano (máx. 6) y validando cada destino (bloquea localhost/IPs privadas
// también en las redirecciones). Headers de navegador real: muchos sitios (Cloudflare, WordPress con WAF)
// rechazan peticiones sin User-Agent/Accept/Accept-Language/Referer de navegador.
const UA_ALT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
const UA_FALLBACK = 'curl/8.5.0' // último recurso solo ante 403 (algunos CDN rechazan UAs de navegador "falsos")
const MAX_HTML = 5 * 1024 * 1024 // tope al leer una página web para convertirla

export function browserHeaders(url, ua = UA, extra = {}) {
  let referer
  try { referer = `${new URL(url).origin}/` } catch {}
  return {
    'User-Agent': ua,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    ...(referer ? { Referer: referer } : {}),
    'Upgrade-Insecure-Requests': '1',
    ...extra
  }
}

async function reqDirect(url, { method = 'GET', headers = {}, timeout = TIMEOUT, ua = UA } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  let cur = url
  try {
    for (let hop = 0; hop <= 6; hop++) {
      const u = new URL(cur)
      if (!/^https?:$/.test(u.protocol)) throw new Error('Redirección no soportada.')
      await assertPublicHost(u)
      const res = await fetch(cur, { method, headers: browserHeaders(cur, ua, headers), redirect: 'manual', signal: ctrl.signal })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        try { res.body?.resume?.() } catch {}
        cur = new URL(loc, cur).href
        continue
      }
      return { res, finalUrl: cur, done: () => clearTimeout(t), ctrl }
    }
    throw new Error('Demasiadas redirecciones.')
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

// Lee los primeros `n` bytes; si `more(head)` dice que sí, sigue leyendo hasta `max` bytes.
// Siempre corta la conexión al final.
async function readBody(res, ctrl, { n = 2048, max = MAX_HTML, more = () => false } = {}) {
  const chunks = []
  let got = 0
  let head = Buffer.alloc(0)
  let full = false
  try {
    const it = res.body[Symbol.asyncIterator]()
    while (got < n) {
      const { value, done } = await it.next()
      if (done) { full = true; break }
      chunks.push(Buffer.from(value))
      got += value.length
    }
    head = Buffer.concat(chunks).subarray(0, n)
    if (!full && more(head)) {
      while (got < max) {
        const { value, done } = await it.next()
        if (done) { full = true; break }
        chunks.push(Buffer.from(value))
        got += value.length
      }
    }
  } catch (e) {
    if (!chunks.length) throw e
  }
  try { res.body?.on?.('error', () => {}); ctrl.abort() } catch {}
  if (!head.length) head = Buffer.concat(chunks).subarray(0, n)
  return { head, body: Buffer.concat(chunks).subarray(0, max), full }
}

const looksPdf = (buf) => buf.subarray(0, 1024).includes('%PDF')
const looksHtml = (buf) => /^\s*(<!doctype html|<html|<head|<body|<\?xml[^>]*>\s*<(!doctype )?html|<!--[\s\S]*?-->\s*<(!doctype html|html))/i.test(buf.toString('utf8', 0, 1024).replace(/^\uFEFF/, ''))

export function pdfFileName(cd, finalUrl, origUrl) {
  let name = parseDisposition(cd)
  if (!name) {
    for (const link of [finalUrl, origUrl]) {
      try {
        const seg = new URL(link).pathname.split('/').filter(Boolean).pop() || ''
        const dec = decodeURIComponent(seg)
        if (dec && /\.pdf$/i.test(dec)) { name = dec; break }
        if (!name && dec) name = dec
      } catch {}
    }
  }
  name = String(name || 'documento').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 150) || 'documento'
  if (!/\.pdf$/i.test(name)) name = name.replace(/\.[a-z0-9]{1,5}$/i, '') + '.pdf'
  return name
}

export const blockedMessage = (status) =>
  status
    ? `El sitio bloqueó la descarga o está caído (HTTP ${status}). Intenta más tarde o manda el link directo del PDF.`
    : 'El sitio no respondió (está caído o bloqueó la descarga). Intenta más tarde o manda el link directo del PDF.'

// HEAD (si falla, GET) + GET: decide si el link entrega un PDF o una página web.
// Ante 5xx/403/429 o error de red reintenta una vez con otro User-Agent.
export async function probeDirect(link) {
  let last = null
  for (const ua of [UA, UA_ALT]) {
    const r = await probeDirectWith(link, ua)
    if (!r.retry) return r
    last = r
  }
  if (last?.status === 403 || last?.status === 429) {
    const r = await probeDirectWith(link, UA_FALLBACK)
    if (!r.retry) return r
  }
  return { ok: false, blocked: true, status: last?.status || 0, error: blockedMessage(last?.status || 0) }
}

async function probeDirectWith(link, ua) {
  let headSize = 0
  let headType = ''
  let headCd = ''
  try {
    const { res, done, ctrl } = await reqDirect(link, { method: 'HEAD', timeout: 15000, ua })
    try {
      if (res.ok) {
        headType = res.headers.get('content-type') || ''
        headCd = res.headers.get('content-disposition') || ''
        headSize = Number(res.headers.get('content-length')) || 0
      }
      // 4xx/5xx/405 en HEAD: no se confía, se sigue con GET
      try { ctrl.abort() } catch {}
    } finally { done() }
  } catch (e) {
    if (/interna|resolver|Redirección|redirecciones/.test(e?.message || '')) return { ok: false, error: e.message }
    // muchos servidores no aceptan HEAD: se sigue con GET
  }

  let r
  try {
    r = await reqDirect(link, { ua })
  } catch (e) {
    if (/interna|resolver|Redirección|redirecciones/.test(e?.message || '')) return { ok: false, error: e.message }
    return { retry: true, status: 0, error: e?.message }
  }
  const { res, finalUrl, done, ctrl } = r
  try {
    if (!res.ok) {
      try { res.body?.on?.('error', () => {}); ctrl.abort() } catch {}
      if (res.status >= 500 || res.status === 403 || res.status === 429) return { retry: true, status: res.status }
      const why = res.status === 404 ? 'El archivo o la página no existe (HTTP 404).'
        : res.status === 401 ? 'El sitio pide iniciar sesión (HTTP 401).'
          : `El servidor respondió HTTP ${res.status}.`
      return { ok: false, error: why }
    }
    const ctype = res.headers.get('content-type') || headType
    const cd = res.headers.get('content-disposition') || headCd
    const cl = Number(res.headers.get('content-length'))
    const size = cl > 0 ? cl : headSize
    const ctPdf = /application\/(x-)?pdf/i.test(ctype)
    const ctHtml = /text\/html|application\/xhtml/i.test(ctype)
    const { head, body } = await readBody(res, ctrl, { more: (h) => !looksPdf(h) && (looksHtml(h) || (ctHtml && !ctPdf)) })
    const pathPdf = (() => { try { return /\.pdf$/i.test(new URL(finalUrl).pathname) } catch { return false } })()
    let isPdf
    if (looksPdf(head)) isPdf = true
    else if (looksHtml(head) || ctHtml) isPdf = false
    else isPdf = ctPdf || pathPdf
    if (!isPdf) {
      const html = ctHtml || looksHtml(head)
      return { ok: false, notPdf: true, html, body: html ? body : null, finalUrl, ctype: ctype.split(';')[0].trim(), rawCtype: ctype }
    }
    return { ok: true, url: finalUrl, name: pdfFileName(cd, finalUrl, link), size: size || 0, mimetype: 'application/pdf', ua }
  } finally {
    done()
  }
}

export async function downloadDirectToFile(url, max = MAX_SEND, ua = UA) {
  const file = path.join(os.tmpdir(), `pdfdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
  const { res, done, ctrl } = await reqDirect(url, { timeout: 10 * 60 * 1000, ua })
  try {
    if (!res.ok) throw new Error(res.status >= 500 || res.status === 403 ? blockedMessage(res.status) : `El servidor respondió HTTP ${res.status}.`)
    let got = 0
    let tooBig = false
    const limiter = new Transform({
      transform(chunk, _e, cb) {
        got += chunk.length
        if (got > max) { tooBig = true; ctrl.abort(); return cb(new Error('TOO_BIG')) }
        cb(null, chunk)
      }
    })
    try {
      await pipeline(res.body, limiter, fs.createWriteStream(file))
    } catch (e) {
      if (tooBig) throw new Error('TOO_BIG')
      throw e
    }
    // Verificación final: debe ser un PDF de verdad
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(1024)
    const n = fs.readSync(fd, buf, 0, 1024, 0)
    fs.closeSync(fd)
    if (!looksPdf(buf.subarray(0, n))) throw new Error('El archivo descargado no es un PDF válido.')
    return { file, size: got }
  } catch (e) {
    try { fs.unlinkSync(file) } catch {}
    throw e
  } finally {
    done()
  }
}

// ── Página web → PDF ───────────────────────────────────────────────
let webpdfMod = null
async function loadWebPdf() {
  if (webpdfMod) return webpdfMod
  try {
    webpdfMod = await import(WEBPDF_PATH)
    return webpdfMod
  } catch (e) {
    console.error('[pdf] webpdf', e?.message || e)
    const err = new Error(/Cannot find (package|module)|ERR_MODULE_NOT_FOUND/i.test(`${e?.code} ${e?.message}`)
      ? 'Faltan dependencias para convertir páginas web. En la terminal del bot ejecuta: npm install'
      : 'No se pudo cargar el convertidor de páginas web.')
    err.userFacing = true
    throw err
  }
}

// Convierte el HTML ya descargado en un PDF temporal.
// Devuelve { ok: true, file, fileName, title, size } o { ok: false, error }.
export async function webPageToPdf(meta, max = MAX_SEND) {
  const { decodeHtml, isChallengePage, htmlToPdfFile } = await loadWebPdf()
  const html = decodeHtml(meta.body || Buffer.alloc(0), meta.rawCtype || meta.ctype)
  if (isChallengePage(html)) return { ok: false, error: 'El sitio bloqueó la descarga (protección anti-bots). Intenta más tarde o manda el link directo del PDF.' }
  const file = WEBPDF_TMP()
  let r
  try {
    r = await htmlToPdfFile(html, meta.finalUrl, file)
  } catch (e) {
    try { fs.unlinkSync(file) } catch {}
    throw e
  }
  if (!r) {
    try { fs.unlinkSync(file) } catch {}
    return { ok: false, error: 'No pude convertir esta página a PDF: no encontré un artículo legible (la página está vacía o tiene muy poco texto).' }
  }
  if (r.size > max) {
    try { fs.unlinkSync(file) } catch {}
    return { ok: false, tooBig: true, error: `El PDF generado pesa ${formatBytes(r.size)}: es demasiado grande para enviarlo.` }
  }
  return { ok: true, file, fileName: r.fileName, title: r.title, size: r.size }
}

const NOT_PDF_MSG = (link, what) =>
  `✖️ Ese link no es un *PDF* ni una *página web*${what ? ` (${what})` : ''}.\n\n` +
  `✎ Envía un link de *Google Drive/Docs*, un link directo al PDF o el link de un artículo, por ejemplo:\n` +
  `#pdf https://drive.google.com/file/d/XXXXXXXX/view\n` +
  `#pdf https://sitio.com/archivo.pdf\n\n` +
  `❖ Link › ${link}`

async function sendWebPdf(meta, link, { msg, sock }) {
  const site = paywallSite(meta.finalUrl)
  if (site) {
    await react(msg, '✖️')
    return msg.reply(paywallMessage(site, link))
  }
  let conv
  try {
    conv = await webPageToPdf(meta, MAX_SEND)
  } catch (e) {
    console.error('[pdf] web', e?.message || e)
    await react(msg, '✖️')
    return msg.reply(`✖️ ${e?.userFacing ? e.message : 'No pude convertir esta página a PDF.'}\n\n❖ Link › ${link}`)
  }
  if (!conv.ok) {
    await react(msg, '✖️')
    return msg.reply(`✖️ ${conv.error}\n\n❖ Link › ${link}`)
  }
  try {
    const caption =
      `✿ *${conv.title}*\n\n` +
      `❖ Página web convertida a PDF\n` +
      `❖ Tamaño › ${formatBytes(conv.size)}\n` +
      `❖ Fuente › ${link}`
    await sock.sendMessage(
      msg.chat,
      { document: { url: conv.file }, fileName: conv.fileName, mimetype: 'application/pdf', caption },
      { quoted: msg }
    )
    await react(msg, '✔️')
  } finally {
    try { fs.unlinkSync(conv.file) } catch {}
  }
}

async function handleDirect(url, { msg, sock }) {
  const link = url.href
  await react(msg, '🕒')
  let tmp = null
  try {
    const meta = await probeDirect(link)
    if (!meta.ok) {
      if (meta.notPdf && meta.html) return sendWebPdf(meta, link, { msg, sock })
      await react(msg, '✖️')
      if (meta.notPdf) return msg.reply(NOT_PDF_MSG(link, meta.ctype ? `tipo: ${meta.ctype}` : ''))
      return msg.reply(`✖️ ${meta.error}\n\n❖ Link › ${link}`)
    }
    const site = paywallSite(meta.url)
    if (site) {
      await react(msg, '✖️')
      return msg.reply(paywallMessage(site, link))
    }
    const caption =
      `✿ *PDF*\n\n` +
      `❖ Nombre › ${meta.name}\n` +
      `❖ Tamaño › ${formatBytes(meta.size)}\n` +
      `❖ Link › ${link}`
    if (meta.size > MAX_SEND) {
      await react(msg, '✔️')
      return msg.reply(caption + `\n\n✎ Pesa más de 90 MB: no lo subo por WhatsApp (se cuelga).\nAbre el *link* en el navegador para descargarlo.`)
    }
    let dl
    try {
      dl = await downloadDirectToFile(meta.url, MAX_SEND, meta.ua)
    } catch (e) {
      if (e?.message === 'TOO_BIG') {
        await react(msg, '✔️')
        return msg.reply(caption.replace(/Tamaño › .*/, 'Tamaño › más de 90 MB') +
          `\n\n✎ Pesa más de 90 MB: no lo subo por WhatsApp.\nAbre el *link* en el navegador para descargarlo.`)
      }
      throw e
    }
    tmp = dl.file
    const finalCaption = meta.size ? caption : caption.replace(/Tamaño › .*/, `Tamaño › ${formatBytes(dl.size)}`)
    await sock.sendMessage(
      msg.chat,
      { document: { url: tmp }, fileName: meta.name, mimetype: 'application/pdf', caption: finalCaption },
      { quoted: msg }
    )
    await react(msg, '✔️')
  } catch (e) {
    console.error('[pdf]', e?.message || e)
    await react(msg, '✖️')
    await msg.reply(`✖️ No pude descargar el PDF.\n${e?.name === 'AbortError' ? 'Tiempo de espera agotado.' : e?.message || e}\n\n❖ Link › ${link}`)
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp) } catch {} }
  }
}

export default {
  command: ['pdf', 'gdrive', 'drive', 'gd', 'googledrive'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    const text = (args || []).join(' ').trim()
    if (!text) {
      return msg.reply(
        '✿ *PDF / GOOGLE DRIVE*\n\n' +
          '✎ Uso: #pdf <link de Google Drive/Docs, link directo a un PDF o página web>\n' +
          'Ejemplos:\n' +
          '#pdf https://drive.google.com/file/d/XXXXXXXX/view\n' +
          '#pdf https://sitio.com/archivo.pdf\n' +
          '#pdf https://sitio.com/articulo-o-guia\n\n' +
          '❖ Si mandas una *página web* (artículo, guía), la convierto a PDF con su texto.\n' +
          '❖ También: #gdrive · #drive · #gd\n' +
          '❖ En Drive el archivo debe estar compartido como "Cualquier persona con el enlace".\n' +
          '❖ Scribd, Studocu y similares exigen cuenta: no se pueden descargar.'
      )
    }

    const info = parseDriveUrl(text)
    if (!info && /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?)?folders\//i.test(text)) {
      return msg.reply('✖️ Ese link es de una *carpeta*. Envía el link de un archivo (abre el archivo y copia su enlace).')
    }
    if (!info) {
      const url = extractUrl(text)
      if (!url) {
        return msg.reply(
          '✖️ Link inválido. Envía un enlace de Google Drive/Docs, un link directo a un PDF o el link de una página web.\n' +
            'Ejemplo: #pdf https://drive.google.com/file/d/XXXXXXXX/view'
        )
      }
      const site = paywallSite(url)
      if (site) return msg.reply(paywallMessage(site, url.href))
      if (/(^|\.)google\.com$/i.test(url.hostname) && /^(drive|docs)\./i.test(url.hostname)) {
        return msg.reply(
          '✖️ Link de Google Drive/Docs inválido. Abre el archivo y copia su enlace.\n' +
            'Ejemplo: #pdf https://drive.google.com/file/d/XXXXXXXX/view'
        )
      }
      return handleDirect(url, { msg, sock })
    }

    await react(msg, '🕒')
    let tmp = null
    try {
      const meta = await probe(info)
      if (!meta.ok) {
        await react(msg, '✖️')
        return msg.reply(`✖️ ${meta.error}\n\n❖ Link › ${info.link}`)
      }

      const caption =
        `✿ *GOOGLE DRIVE*\n\n` +
        `❖ Nombre › ${meta.name}\n` +
        `❖ Tamaño › ${formatBytes(meta.size)}\n` +
        `❖ Link › ${info.link}`

      if (meta.size > MAX_SEND) {
        await react(msg, '✔️')
        return msg.reply(
          caption +
            `\n\n✎ Pesa más de 90 MB: no lo subo por WhatsApp (se cuelga).\n` +
            `Abre el *link* en el navegador para descargarlo.`
        )
      }

      let dl
      try {
        dl = await downloadToFile(info, meta.url)
      } catch (e) {
        if (e?.message === 'TOO_BIG') {
          await react(msg, '✔️')
          return msg.reply(caption.replace(/Tamaño › .*/, 'Tamaño › más de 90 MB') +
            `\n\n✎ Pesa más de 90 MB: no lo subo por WhatsApp.\nAbre el *link* en el navegador para descargarlo.`)
        }
        throw e
      }
      tmp = dl.file
      const finalCaption = meta.size ? caption : caption.replace(/Tamaño › .*/, `Tamaño › ${formatBytes(dl.size)}`)

      await sock.sendMessage(
        msg.chat,
        { document: { url: tmp }, fileName: meta.name, mimetype: meta.mimetype, caption: finalCaption },
        { quoted: msg }
      )
      await react(msg, '✔️')
    } catch (e) {
      console.error('[gdrive]', e?.message || e)
      await react(msg, '✖️')
      await msg.reply(
        `✖️ No pude descargar el archivo de Google Drive.\n${e?.name === 'AbortError' ? 'Tiempo de espera agotado.' : e?.message || e}\n\n❖ Link › ${info.link}`
      )
    } finally {
      if (tmp) { try { fs.unlinkSync(tmp) } catch {} }
    }
  }
}
