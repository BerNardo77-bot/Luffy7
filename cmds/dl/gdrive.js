import fetch from 'node-fetch'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'

// #pdf / #gdrive — descarga archivos PÚBLICOS de Google Drive sin API key.
// Soporta: drive.google.com/file/d/<id>, open?id=, uc?id=, drive.usercontent.google.com,
// y docs.google.com/document|spreadsheets|presentation/d/<id> (exporta a pdf / xlsx / pptx).
// Mantiene el resourcekey (archivos viejos 0B... lo necesitan).

const MAX_SEND = 90 * 1024 * 1024 // misma regla que #apk
const TIMEOUT = 30000
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

export default {
  command: ['pdf', 'gdrive', 'drive', 'gd', 'googledrive'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    const text = (args || []).join(' ').trim()
    if (!text) {
      return msg.reply(
        '✿ *GOOGLE DRIVE*\n\n' +
          '✎ Uso: #pdf <link de Google Drive>\n' +
          'Ejemplo: #pdf https://drive.google.com/file/d/XXXXXXXX/view\n\n' +
          '❖ También: #gdrive · #drive · #gd\n' +
          '❖ El archivo debe estar compartido como "Cualquier persona con el enlace".'
      )
    }

    const info = parseDriveUrl(text)
    if (!info && /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?)?folders\//i.test(text)) {
      return msg.reply('✖️ Ese link es de una *carpeta*. Envía el link de un archivo (abre el archivo y copia su enlace).')
    }
    if (!info) {
      return msg.reply(
        '✖️ Link inválido. Envía un enlace de Google Drive o Google Docs.\n' +
          'Ejemplo: #pdf https://drive.google.com/file/d/XXXXXXXX/view'
      )
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
