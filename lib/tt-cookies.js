// TT_COOKIES (opcional): cookies.txt (formato Netscape) de una cuenta de TikTok, en base64.
// Se escribe UNA vez en un archivo temporal 0600 y se pasa a yt-dlp con --cookies. Nunca se loguea el contenido.
import fs from 'fs'
import os from 'os'
import path from 'path'

let state = null // { file } | { error }

export function ttCookiesFile(env = process.env) {
  if (!env.TT_COOKIES) return ''
  if (state) return state.file || ''
  try {
    const text = Buffer.from(String(env.TT_COOKIES).trim(), 'base64').toString('utf8')
    if (!/tiktok\.com/i.test(text)) throw new Error('no parece un cookies.txt de tiktok.com')
    const dir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR.replace(/\/$/, ''), 'tmp') : os.tmpdir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'tt-cookies.txt')
    fs.writeFileSync(file, text.startsWith('# Netscape') ? text : `# Netscape HTTP Cookie File\n${text}`, { mode: 0o600 })
    fs.chmodSync(file, 0o600)
    state = { file }
    console.error('[tiktok] TT_COOKIES cargado')
  } catch (e) {
    state = { error: e?.message || String(e) }
    console.error('[tiktok] TT_COOKIES inválido:', state.error)
  }
  return state.file || ''
}

export function ttCookieArgs(env = process.env) {
  const f = ttCookiesFile(env)
  return f ? ['--cookies', f] : []
}

export const hasTtCookies = (env = process.env) => !!ttCookiesFile(env)

export function _resetTtCookies() { state = null }

// Al arrancar: escribir el archivo una vez (si TT_COOKIES existe)
ttCookiesFile()
