// Parte un video largo en trozos por tiempo (ffmpeg -c copy, corta en keyframes), cada uno < maxBytes.
import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
const run = promisify(execFile)

export function freeDisk(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize) } catch { return Infinity }
}
const DISK_MARGIN = 300 * 1024 * 1024
/** ¿Cabe bajar `size` y además partirlo (≈ el doble) en `dir`? */
export function hasRoomToSplit(size, dir) { return freeDisk(dir) > size * 2 + DISK_MARGIN }
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
export async function splitVideo(file, maxBytes, { title = 'video', maxParts = 20, deleteSource = true } = {}) {
  const size = fs.statSync(file).size
  const dur = await probeDur(file)
  if (!dur) throw new Error('no pude leer la duración del video')
  if (freeDisk(path.dirname(file)) < size + DISK_MARGIN / 2) throw Object.assign(new Error('sin espacio para partir'), { noDisk: true })
  const safe = String(title).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'video'
  let n = partsFor(size, maxBytes)
  for (let attempt = 0; attempt < 4; attempt++) {
    if (n > maxParts) throw Object.assign(new Error(`saldrían ${n} partes (máx. ${maxParts})`), { tooManyParts: true, parts: n })
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
