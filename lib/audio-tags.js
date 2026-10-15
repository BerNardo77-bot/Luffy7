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

// ── Audio para enviar: siempre MP3 real y verificado; si no se puede, el original con su tipo correcto ──
export function sniffAudio(b) {
  if (!b || b.length < 12) return { ext: 'bin', mime: 'application/octet-stream', kind: 'unknown' }
  const h = b.subarray(0, 12)
  if (h.toString('latin1', 0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0 && (h[1] & 0x06) !== 0)) return { ext: 'mp3', mime: 'audio/mpeg', kind: 'mp3' }
  if (h.toString('latin1', 4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4', kind: 'm4a' }
  if (h.toString('latin1', 0, 4) === 'OggS') return { ext: 'opus', mime: 'audio/ogg; codecs=opus', kind: 'ogg' }
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return { ext: 'webm', mime: 'audio/webm', kind: 'webm' }
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return { ext: 'aac', mime: 'audio/aac', kind: 'aac' }
  if (h.toString('latin1', 0, 4) === 'RIFF') return { ext: 'wav', mime: 'audio/wav', kind: 'wav' }
  return { ext: 'bin', mime: 'application/octet-stream', kind: 'unknown' }
}

let ffOk = null
export async function haveFfmpeg() {
  if (ffOk !== null) return ffOk
  try { await run('ffmpeg', ['-version'], { timeout: 15000 }); await run('ffprobe', ['-version'], { timeout: 15000 }); ffOk = true } catch { ffOk = false }
  return ffOk
}

async function verifyMp3(file) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file], { timeout: 60000 })
    const j = JSON.parse(stdout)
    if (j?.streams?.[0]?.codec_name !== 'mp3') return false
    if (!(Number(j?.format?.duration) > 1)) return false
    // Decodifica todo para confirmar que se reproduce
    const { stderr } = await run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'null', '-'], { timeout: 180000 })
    return !String(stderr || '').trim()
  } catch { return false }
}

/**
 * Devuelve { buffer, ext, mime, tagged } listo para mandar.
 * 1) MP3 192k (libmp3lame) + portada + ID3v2.3, verificado con ffprobe y decodificación completa.
 * 2) Si falla: MP3 sin portada (verificado).
 * 3) Sin ffmpeg / todo falla: el archivo original con su extensión y mime reales.
 */
export async function prepareAudio(audio, { title = '', artist = '', album = '', cover = null } = {}) {
  const orig = sniffAudio(audio)
  if (!(await haveFfmpeg())) {
    console.error('[audio] ffmpeg no está instalado (pkg install ffmpeg); mando el original como', orig.ext)
    return { buffer: audio, ...orig, tagged: false }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'))
  try {
    const inF = path.join(dir, 'in.' + orig.ext), cF = path.join(dir, 'cover.jpg'), outF = path.join(dir, 'out.mp3')
    fs.writeFileSync(inF, audio)
    const meta = []
    if (title) meta.push('-metadata', `title=${title}`)
    if (artist) meta.push('-metadata', `artist=${artist}`)
    if (album) meta.push('-metadata', `album=${album}`)
    const enc = ['-c:a', 'libmp3lame', '-b:a', '192k', '-abr', '0', '-ar', '44100', '-ac', '2', '-write_xing', '1', '-id3v2_version', '3', '-write_id3v1', '1', ...meta, '-f', 'mp3', outF]
    const tries = []
    if (cover?.length && process.env.PLAY_NO_COVER !== '1') {
      // Portada siempre como JPEG 500px (evita PNG/WebP que algunos reproductores no aceptan)
      let jpg = null
      try {
        fs.writeFileSync(path.join(dir, 'c.in'), cover)
        await run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'c.in'), '-vf', 'scale=500:500:force_original_aspect_ratio=decrease,format=yuvj420p', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '4', '-f', 'mjpeg', cF], { timeout: 30000 })
        jpg = fs.existsSync(cF) && fs.statSync(cF).size > 500
      } catch {}
      if (jpg) tries.push(['-y', '-v', 'error', '-i', inF, '-i', cF, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'copy', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', '-disposition:v', 'attached_pic', ...enc])
    }
    tries.push(['-y', '-v', 'error', '-i', inF, '-map', '0:a:0', '-vn', ...enc])
    for (let i = 0; i < tries.length; i++) {
      try {
        try { fs.unlinkSync(outF) } catch {}
        await run('ffmpeg', tries[i], { timeout: 300000 })
        if (await verifyMp3(outF)) return { buffer: fs.readFileSync(outF), ext: 'mp3', mime: 'audio/mpeg', tagged: i === 0 && tries.length > 1 }
        console.error('[audio] verificación falló en intento', i + 1)
      } catch (e) {
        console.error('[audio] ffmpeg intento', i + 1, String(e?.stderr || e?.message || e).slice(0, 200))
      }
    }
    return { buffer: audio, ...orig, tagged: false }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

/** ffprobe de un buffer: { codec, duration, bitrate } o null si no es audio válido */
export async function probeAudio(buf) {
  if (!buf?.length || !(await haveFfmpeg())) return null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'))
  try {
    const f = path.join(dir, 'a.' + sniffAudio(buf).ext)
    fs.writeFileSync(f, buf)
    return await probeFile(f)
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
}
export async function probeFile(f) {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate', '-of', 'json', f], { timeout: 60000 })
    const j = JSON.parse(stdout)
    const s = j?.streams?.[0]
    if (!s) return null
    return { codec: s.codec_name, duration: Number(j?.format?.duration) || 0, bitrate: Number(s.bit_rate || j?.format?.bit_rate) || 0, rate: Number(s.sample_rate) || 0, channels: Number(s.channels) || 0 }
  } catch { return null }
}

/** Respaldo: mejor audio con yt-dlp (si está instalado) → buffer, o null */
export async function ytdlpAudio(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ya-'))
  try {
    const out = path.join(dir, 'a.%(ext)s')
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '--no-playlist', '-q', '--no-warnings', '-o', out, url]
    let ok = false
    for (const [bin, pre] of [['yt-dlp', []], ['python', ['-m', 'yt_dlp']], ['python3', ['-m', 'yt_dlp']]]) {
      try { await run(bin, [...pre, ...args], { timeout: 600000 }); ok = true; break } catch (e) { if (e?.code !== 'ENOENT') console.error('[audio] yt-dlp', String(e?.stderr || e?.message || e).slice(0, 200)) }
    }
    if (!ok) return null
    const f = fs.readdirSync(dir).find(x => x.startsWith('a.'))
    return f ? fs.readFileSync(path.join(dir, f)) : null
  } catch { return null } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} }
}
