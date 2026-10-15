// Pone portada (APIC) y etiquetas ID3 (título/artista/álbum) a un MP3 con ffmpeg.
// Si ffmpeg falla o no está, devuelve el audio original (nunca rompe el envío).
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import fetch from 'node-fetch'

const run = promisify(execFile)

export async function fetchCover(url) {
  if (!url) return null
  try {
    const big = String(url).replace(/\/\d+x\d+bb\./, '/600x600bb.')
    const r = await fetch(big, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) return null
    const b = Buffer.from(await r.arrayBuffer())
    return b.length > 1000 ? b : null
  } catch { return null }
}

export async function tagMp3(audio, { title = '', artist = '', album = '', cover = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-'))
  const inF = path.join(dir, 'in.bin'), cF = path.join(dir, 'cover.jpg'), outF = path.join(dir, 'out.mp3')
  try {
    fs.writeFileSync(inF, audio)
    const meta = []
    if (title) meta.push('-metadata', `title=${title}`)
    if (artist) meta.push('-metadata', `artist=${artist}`)
    if (album) meta.push('-metadata', `album=${album}`)
    const base = ['-y', '-loglevel', 'error', '-i', inF]
    let maps = ['-map', '0:a:0']
    if (cover?.length) {
      fs.writeFileSync(cF, cover)
      base.push('-i', cF)
      maps = ['-map', '0:a:0', '-map', '1:v:0', '-c:v', 'mjpeg', '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v', 'attached_pic']
    }
    const tail = ['-id3v2_version', '3', ...meta, '-f', 'mp3', outF]
    try {
      await run('ffmpeg', [...base, ...maps, '-c:a', 'copy', ...tail], { timeout: 120000 })
    } catch {
      // No era MP3: se convierte (192k)
      await run('ffmpeg', [...base, ...maps, '-c:a', 'libmp3lame', '-b:a', '192k', ...tail], { timeout: 300000 })
    }
    const out = fs.readFileSync(outF)
    return out.length > audio.length * 0.5 ? out : audio
  } catch (e) {
    console.error('[audio-tags]', String(e?.message || e).slice(0, 200))
    return audio
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

/** JPEG chico (~300 px) para miniaturas de WhatsApp (jpegThumbnail / externalAdReply) */
export async function makeThumb(img, size = 300) {
  if (!img?.length) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'))
  try {
    const i = path.join(dir, 'in'), o = path.join(dir, 'o.jpg')
    fs.writeFileSync(i, img)
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', i, '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-q:v', '6', '-frames:v', '1', o], { timeout: 30000 })
    const b = fs.readFileSync(o)
    return b.length ? b : null
  } catch { return img.length < 60000 ? img : null } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
}
