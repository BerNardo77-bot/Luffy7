// Parte un video largo en trozos por tiempo (ffmpeg -c copy, corta en keyframes), cada uno < maxBytes.
import fs from 'fs'
import path from 'path'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
const run = promisify(execFile)

export function freeDisk(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize) } catch {}
  try { const o = execFileSync('df', ['-k', dir], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').pop().split(/\s+/); const kb = Number(o[3]); if (kb >= 0) return kb * 1024 } catch {}
  return 0 // desconocido: no arriesgar (teléfono con poco espacio)
}
const DISK_MARGIN = 300 * 1024 * 1024
/** ¿Cabe bajar `size` y además partirlo (≈ el doble) en `dir`? */
export function hasRoomToSplit(size, dir) { return freeDisk(dir) > size * 2 + DISK_MARGIN }
// Tope TOTAL de un video (todas las partes juntas). MAX_TOTAL_GB=40 por defecto.
export const MAX_TOTAL_BYTES = (Number(process.env.MAX_TOTAL_GB) || 40) * 1024 ** 3
/** Máximo de partes permitido para un límite por archivo (p. ej. 40 GB / 1950 MB ≈ 23). */
export const maxPartsFor = (maxBytes) => Math.max(1, Math.ceil(MAX_TOTAL_BYTES / (maxBytes * 0.9)))
/** Aviso si el total es grande (>5 GB). */
export const bigWarning = (size, parts) => size > 5 * 1024 ** 3 ? `⚠️ Son ${parts} partes (${(size / 1024 ** 3).toFixed(1)} GB): gasta muchos datos y espacio en tu teléfono.` : ''
export const partsFor = (size, maxBytes) => Math.max(1, Math.ceil(size / (maxBytes * 0.9)))

async function probeDur(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 60000 })
    return Number(stdout.trim()) || 0
  } catch { return 0 }
}

/**
 * → [{ file, name, index, total }]. Borra el original al terminar bien (deleteSource).
 * Lanza Error si no se pudo (no hay ffmpeg, no cabe, etc.).
 */
export async function splitVideo(file, maxBytes, { title = 'video', maxParts = 0, deleteSource = true } = {}) {
  const size = fs.statSync(file).size
  const dur = await probeDur(file)
  if (!dur) throw new Error('no pude leer la duración del video')
  if (freeDisk(path.dirname(file)) < size + DISK_MARGIN / 2) throw Object.assign(new Error('sin espacio para partir'), { noDisk: true })
  const safe = String(title).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'video'
  let n = partsFor(size, maxBytes)
  for (let attempt = 0; attempt < 4; attempt++) {
    if (n > (maxParts || maxPartsFor(maxBytes))) throw Object.assign(new Error(`saldrían ${n} partes (máx. ${maxParts || maxPartsFor(maxBytes)})`), { tooManyParts: true, parts: n })
    const dir = fs.mkdtempSync(path.join(path.dirname(file), 'split-'))
    const segTime = Math.max(10, Math.floor(dur / n))
    try {
      await run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
        '-f', 'segment', '-segment_time', String(segTime), '-reset_timestamps', '1',
        '-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart',
        path.join(dir, 'p%03d.mp4')], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 })
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error('ffmpeg no pudo partir: ' + String(e.stderr || e.message).slice(-160)) }
    let files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort().map(f => path.join(dir, f))
    // último trozo de pocos segundos: se queda (es válido), pero si alguno se pasa del límite → más partes
    const big = files.some(f => fs.statSync(f).size > maxBytes)
    if (!big && files.length) {
      const total = files.length
      const out = files.map((f, i) => {
        const name = `${safe} (Parte ${i + 1} de ${total}).mp4`
        return { file: f, name, index: i + 1, total, size: fs.statSync(f).size, dir }
      })
      if (deleteSource) try { fs.unlinkSync(file) } catch {}
      return out
    }
    fs.rmSync(dir, { recursive: true, force: true })
    n = Math.ceil(n * 1.25) + 1
  }
  throw new Error('no logré partes bajo el límite')
}
export function cleanParts(parts) { for (const d of new Set((parts || []).map(p => p.dir))) try { fs.rmSync(d, { recursive: true, force: true }) } catch {} }

// ── Partir y mandar de una en una (para teléfonos con poco espacio) ─────────────────────
// Solo hace falta espacio para el video completo + UNA parte: cada parte se corta (ffmpeg -c copy,
// empieza en keyframe y se reproduce sola en VLC), se manda con onPart y se borra antes de cortar la siguiente.
/** Máximo de partes por video (más que esto no tiene caso: mejor bajar la calidad). */
export const MAX_SPLIT_PARTS = Number(process.env.YT_MAX_PARTS) || 10
/** ¿Cabe bajar `size` y partirlo de una en una (partes de hasta maxBytes)? */
export function hasRoomToSplitEach(size, maxBytes, dir) { return freeDisk(dir) > size + Math.min(size, maxBytes) + DISK_MARGIN }
/** Texto con lo que falta de espacio (para avisar al usuario). */
export function roomText(size, maxBytes, dir) {
  const mbs = (n) => (n / 1024 / 1024).toFixed(0)
  return `hay ${mbs(freeDisk(dir))} MB libres y hacen falta ~${mbs(size + Math.min(size, maxBytes) + DISK_MARGIN)} MB`
}

/**
 * Parte `file` en ~partsFor(size, maxBytes) trozos por tiempo y llama onPart({file,name,index,total,size}) con cada uno.
 * Borra cada parte después de mandarla y el original al final (deleteSource). Devuelve el número de partes.
 */
export async function splitVideoEach(file, maxBytes, { title = 'video', maxParts = MAX_SPLIT_PARTS, deleteSource = true, onPart } = {}) {
  const size = fs.statSync(file).size
  const dur = await probeDur(file)
  if (!dur) throw new Error('no pude leer la duración del video')
  let total = partsFor(size, maxBytes)
  if (total > maxParts) throw Object.assign(new Error(`saldrían ${total} partes (máx. ${maxParts})`), { tooManyParts: true, parts: total })
  if (freeDisk(path.dirname(file)) < Math.min(size, maxBytes) + DISK_MARGIN / 2) throw Object.assign(new Error('sin espacio para partir'), { noDisk: true })
  const safe = String(title).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'video'
  const dir = fs.mkdtempSync(path.join(path.dirname(file), 'split-'))
  let seg = dur / total
  let start = 0
  let index = 0
  try {
    while (start < dur - 1) {
      const out = path.join(dir, `p${String(index + 1).padStart(3, '0')}.mp4`)
      let len = Math.min(seg, dur - start)
      for (let tries = 0; ; tries++) {
        try {
          await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(start), '-i', file, '-t', String(len), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
            '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', out], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 })
        } catch (e) { throw new Error('ffmpeg no pudo partir: ' + String(e.stderr || e.message).slice(-160)) }
        const s = fs.statSync(out).size
        if (s <= maxBytes || len < 20 || tries >= 4) break
        len = len * (maxBytes * 0.95 / s) // se pasó del límite: un trozo más corto
      }
      index++
      if (start + len < dur - 1 && index >= total) total = index + Math.ceil((dur - start - len) / seg)
      if (total > maxParts + 3) throw Object.assign(new Error(`saldrían más de ${maxParts} partes`), { tooManyParts: true })
      const name = `${safe} (Parte ${index} de ${total}).mp4`
      await onPart?.({ file: out, name, index, total, size: fs.statSync(out).size })
      try { fs.unlinkSync(out) } catch {}
      start += len
    }
    if (deleteSource) try { fs.unlinkSync(file) } catch {}
    return index
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
