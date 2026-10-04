import db from "#db"
import fetch from 'node-fetch'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'

const execFileAsync = promisify(execFile)
const GIF_UA = 'Luffy7/1.1.44 (https://github.com/BerNardo77-bot/Luffy7)'
const FALLBACK_KEY = 'LUFFY-FIX67'

// Alyacore /nsfw/interaction responde HTTP 500. Estas categorías de Purrbot sí existen (sin clave).
const PURR = {
  anal: ['anal'],
  cum: ['cum'],
  cumshot: ['cum'],
  cummouth: ['cum'],
  undress: ['solo'],
  fuck: ['fuck'],
  spank: ['spank'],
  lickpussy: ['pussylick'],
  fap: ['solo', 'solo_male'],
  grope: ['solo'],
  sixnine: ['blowjob'],
  suckboobs: ['solo'],
  grabboobs: ['solo'],
  blowjob: ['blowjob'],
  boobjob: ['solo'],
  yuri: ['yuri'],
  footjob: ['fuck'],
  handjob: ['solo_male'],
  lickass: ['anal'],
  lickdick: ['blowjob'],
}

const captions = {
  anal: (from, to) => from === to ? 'se la metió en el ano.' : 'se la metió en el ano a',
  cum: (from, to) => from === to ? 'se vino dentro de... Omitiremos eso.' : 'se vino dentro de',
  undress: (from, to) => from === to ? 'se está quitando la ropa' : 'le está quitando la ropa a',
  fuck: (from, to) => from === to ? 'se entrega al deseo' : 'se está cogiendo a',
  spank: (from, to) => from === to ? 'está dando una nalgada' : 'le está dando una nalgada a',
  lickpussy: (from, to) => from === to ? 'está lamiendo un coño' : 'le está lamiendo el coño a',
  fap: (from, to) => from === to ? 'se está masturbando' : 'se está masturbando pensando en',
  grope: (from, to) => from === to ? 'se lo está manoseando' : 'se lo está manoseando a',
  sixnine: (from, to) => from === to ? 'está haciendo un 69' : 'está haciendo un 69 con',
  suckboobs: (from, to) => from === to ? 'está chupando unas ricas tetas' : 'le está chupando las tetas a',
  grabboobs: (from, to) => from === to ? 'está agarrando unas tetas' : 'le está agarrando las tetas a',
  blowjob: (from, to) => from === to ? 'está dando una rica mamada' : 'le dio una mamada a',
  boobjob: (from, to) => from === to ? 'esta haciendo una rusa' : 'le está haciendo una rusa a',
  footjob: (from, to) => from === to ? 'está haciendo una paja con los pies' : 'le está haciendo una paja con los pies a',
  yuri: (from, to) => from === to ? 'está haciendo tijeras!' : 'hizo tijeras con',
  cummouth: (from, to) => from === to ? 'está llenando la boca de alguien con cariño' : 'está llenando la boca de',
  cumshot: (from, to) => from === to ? 'se la metió a alguien y ahora viene el regalo' : 'le dio un regalo sorpresa a',
  handjob: (from, to) => from === to ? 'le da una paja a alguien con cariño' : 'le está haciendo una paja a',
  lickass: (from, to) => from === to ? 'saborea un culo sin detenerse' : 'le está lamiendo el culo a',
  lickdick: (from, to) => from === to ? 'chupa con ganas un pene' : 'se la mete todo en la boca para'
}

const symbols = ['(⁠◠⁠‿⁠◕⁠)', '˃͈◡˂͈', '૮(˶ᵔᵕᵔ˶)ა', '(づ｡◕‿‿◕｡)づ', '(✿◡‿◡)', '(꒪⌓꒪)', '(✿✪‿✪｡)', '(*≧ω≦)', '(✧ω◕)', '˃ 𖥦 ˂', '(⌒‿⌒)', '(¬‿¬)', '(✧ω✧)',  '✿(◕ ‿◕)✿',  'ʕ•́ᴥ•̀ʔっ', '(ㅇㅅㅇ❀)',  '(∩︵∩)',  '(✪ω✪)',  '(✯◕‿◕✯)', '(•̀ᴗ•́)و ̑̑']

function getRandomSymbol() {
  return symbols[Math.floor(Math.random() * symbols.length)]
}

const commandAliases = {
  anal: ['anal','violar'],
  cum: ['cum', 'eyacular'],
  undress: ['undress','encuerar'],
  fuck: ['fuck','coger'],
  spank: ['spank','nalgada'],
  lickpussy: ['lickpussy', 'lameruncoño'],
  fap: ['fap','paja'],
  grope: ['grope'],
  sixnine: ['sixnine','69'],
  suckboobs: ['suckboobs', 'chupartetas'],
  grabboobs: ['grabboobs'],
  blowjob: ['blowjob','mamar','bj'],
  boobjob: ['boobjob', 'rusa'],
  yuri: ['yuri','tijeras'],
  footjob: ['footjob'],
  cummouth: ['cummouth'],
  cumshot: ['cumshot'],
  handjob: ['handjob'],
  lickass: ['lickass', 'lamercullo'],
  lickdick: ['lickdick', 'lamerpolla']
}

function resolveCommand(cmd) {
  for (const [base, aliases] of Object.entries(commandAliases)) {
    if (aliases.includes(cmd)) return base
  }
  return cmd
}

function getKey() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim()
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY
  return key
}

function getBase() {
  return (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '')
}

function isTransient(err) {
  const code = err?.code || err?.errno || ''
  const msg = String(err?.message || err || '')
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(msg)
  )
}

async function alyaGif(inter) {
  const base = getBase()
  const keys = [getKey()]
  if (keys[0] !== FALLBACK_KEY) keys.push(FALLBACK_KEY)
  let lastErr = null
  for (const key of keys) {
    const url = `${base}/nsfw/interaction?inter=${encodeURIComponent(inter)}&key=${encodeURIComponent(key)}`
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': GIF_UA,
          Accept: 'application/json'
        },
        timeout: 12000
      })
      if (!response.ok) {
        lastErr = new Error(`HTTP ${response.status}`)
        continue
      }
      const json = await response.json().catch(() => ({}))
      if (json?.status && json?.result) return String(json.result)
      lastErr = new Error(json?.message || 'sin resultado')
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) console.error('[nsfw/inter] alyacore', lastErr?.message || lastErr)
  return null
}

async function purrGif(inter) {
  const cats = PURR[inter] || []
  let last = null
  for (const cat of cats) {
    const url = `https://api.purrbot.site/v2/img/nsfw/${encodeURIComponent(cat)}/gif`
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': GIF_UA },
        timeout: 15000
      })
      if (!response.ok) {
        last = new Error(`purrbot HTTP ${response.status}`)
        continue
      }
      const json = await response.json().catch(() => ({}))
      if (json && json.error === false && json.link) return String(json.link)
      last = new Error('purrbot sin link')
    } catch (e) {
      last = e
    }
  }
  if (last) throw last
  return null
}

async function mediaUrl(inter) {
  const alya = await alyaGif(inter)
  if (alya) return alya
  const purr = await purrGif(inter)
  if (purr) return purr
  throw new Error('HTTP 500')
}

async function toMp4(buf, mime, url) {
  const kind = `${mime || ''} ${url || ''}`.toLowerCase()
  if (kind.includes('mp4') || kind.includes('video/')) return buf
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luffy-nsfw-'))
  const inp = path.join(dir, 'in.bin')
  const out = path.join(dir, 'out.mp4')
  try {
    fs.writeFileSync(inp, buf)
    await execFileAsync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inp,
      '-movflags', 'faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-an', '-t', '8',
      out
    ], { timeout: 25000 })
    if (!fs.existsSync(out)) throw new Error('ffmpeg no escribió el mp4')
    return fs.readFileSync(out)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export default {
  command: [
    'anal','lameruncoño','chupartetas','rusa','violar','cum','eyacular','undress','encuerar',
    'fuck','coger','spank','nalgada','lickpussy','fap','paja','grope','sixnine','69',
    'lamerpolla','lamercullo','suckboobs','grabboobs','blowjob','mamar','bj','boobjob','yuri',
    'tijeras','footjob','cummouth','cumshot','handjob','lickass','lickdick'
  ],
  category: 'nsfw',
  run: async ({ msg, sock, args, command, text, usedPrefix: prefix }) => {
    const chat = await db.getChat(msg.chat)
    if (!chat.nsfw) return msg.reply(mess.nsfw)

    const baseCommand = resolveCommand(command)
    if (!captions[baseCommand]) return

    let who
    const texto = msg.mentionedJid
    if (msg.isGroup) {
      who = texto.length > 0 ? texto[0] : msg.quoted ? msg.quoted.sender : msg.sender
    } else {
      who = msg.quoted ? msg.quoted.sender : msg.sender
    }

    const user = await db.getUser(who)
    const fromName = msg.pushName || 'Alguien'
    const toName = user.name || 'alguien'

    const captionText = captions[baseCommand](fromName, toName)
    const caption =
      who !== msg.sender
        ? `@${msg.sender.split('@')[0]} ${captionText} @${who.split('@')[0]} ${getRandomSymbol()}.`
        : `${fromName} ${captionText} ${getRandomSymbol()}.`

    try {
      const videoUrl = await mediaUrl(baseCommand)
      const videoRes = await fetch(videoUrl, {
        timeout: 20000,
        headers: { 'User-Agent': GIF_UA }
      })
      if (!videoRes.ok) throw new Error(`No se pudo bajar el gif (${videoRes.status})`)
      const raw = await videoRes.buffer()
      const videoBuffer = await toMp4(raw, videoRes.headers.get('content-type'), videoUrl)
      await sock.sendMessage(
        msg.chat,
        {
          video: videoBuffer,
          gifPlayback: true,
          caption,
          mentions: [who, msg.sender]
        },
        { quoted: msg }
      )
    } catch (e) {
      console.error('[nsfw/inter]', e)
      const hint = isTransient(e)
        ? '\n📌 La API se cayo un momento (red). Proba de nuevo en unos segundos.'
        : ''
      await msg.reply(`《✧》 Error NSFW: ${e?.message || e}${hint}`).catch(() => msg.reply(msgglobal))
    }
  }
}
