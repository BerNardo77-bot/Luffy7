// WhatsApp: cada comando corre en su propio "trabajo" para poder cancelar/pausar/continuar
// la descarga del que lo mandó (comandos cancelar, pausar, continuar).
import path from 'path'
import { runJob, currentJob, activeJobs, cancelJob, pauseJob, resumeJob, outsideJob, PAUSE_MAX_MS, configurePending, takePending, setReplay, markDownload, isShuttingDown, RESTART_TEXT, noRestartText } from './dl-control.js'

// Descargas cortadas por un reinicio: se guardan aquí (sobrevive en Termux / volumen con DATA_DIR)
const PENDING_FILE = path.join(process.env.DATA_DIR || process.cwd(), 'pending-downloads.json')
configurePending(PENDING_FILE)
const restartsById = new Map()

const PROGRESS_RE = /Bajando|Descargando/i
const CONTROL = ['cancelar', 'cancel', 'pausar', 'pause', 'continuar', 'reanudar', 'resume']
const SKIP = ['tv', 'canal', 'canaltv', 'television', 'tvcancel', 'tvcancelar', 'cancelartv', 'tvmin', 'tvminutos']
const mins = () => Math.round(PAUSE_MAX_MS / 60000)

function patchSock(sock) {
  if (!sock || sock.__dlControl) return
  sock.__dlControl = true
  const orig = sock.sendMessage.bind(sock)
  sock.sendMessage = async (jid, content, options) => {
    const job = currentJob()
    if (job && !job.skip) {
      if (job.state === 'cancelled' || isShuttingDown()) return undefined // ya se avisó; no mandar errores ni archivos a medias
      if (content && typeof content.text === 'string' && PROGRESS_RE.test(content.text) && !job.hinted) {
        job.hinted = true
        markDownload(job)
        const p = job.prefix || ''
        content = { ...content, text: `${content.text}\n\n✎ Para cancelar: *${p}cancelar* · pausar: *${p}pausar*` }
      }
    }
    return orig(jid, content, options)
  }
}

// Envuelve la ejecución del comando
export function runCommand({ sock, msg, command, usedPrefix, replay }, fn) {
  patchSock(sock)
  const cmd = String(command || '').toLowerCase()
  const id = msg.key?.id
  const job = { user: msg.sender, chat: msg.chat, skip: CONTROL.includes(cmd) || SKIP.includes(cmd),
    replay: replay || null, restarts: restartsById.get(id) || 0,
    meta: msg.key ? { key: msg.key, pushName: msg.pushName || '', prefix: usedPrefix || '' } : null }
  return runJob(job, () => {
    const j = currentJob()
    if (j) {
      j.prefix = usedPrefix
      j.onChange = (jj, st, reason) => {
        if (st !== 'cancelled') return
        outsideJob(() => sock.sendMessage(jj.chat, { text: reason && reason !== 'usuario' ? `❌ Descarga cancelada (${reason}).` : '❌ Descarga cancelada.' }, { quoted: msg }).catch(() => {}))
      }
    }
    return fn()
  })
}

// Comandos cancelar / pausar / continuar
export async function controlCommand({ msg, command, usedPrefix }) {
  const c = String(command || '').toLowerCase()
  const action = /cancel/.test(c) ? 'cancel' : /paus/.test(c) ? 'pause' : 'resume'
  const p = usedPrefix || ''
  const list = activeJobs(msg.sender).filter((j) => action === 'cancel' || (action === 'pause' ? j.state === 'running' : j.state === 'paused'))
  if (!list.length) {
    return msg.reply({ cancel: `《✧》 No tienes ninguna descarga en curso. (Para la TV usa *${p}tvcancel*.)`, pause: '《✧》 No tienes ninguna descarga en curso para pausar.', resume: '《✧》 No tienes ninguna descarga pausada.' }[action])
  }
  const job = list[0]
  if (action === 'cancel') { cancelJob(job); return } // el aviso lo manda onChange
  if (action === 'pause') { pauseJob(job); return msg.reply(`⏸️ Pausado. Usa *${p}continuar* para seguir o *${p}cancelar* (se cancela solo tras ${mins()} min).`) }
  resumeJob(job)
  return msg.reply('▶️ Continuando la descarga…')
}
export const CONTROL_COMMANDS = CONTROL

// Para elecciones (responder con un número, etc.): cuando un comando llama a otro con su URL,
// eso es lo que se repite tras un reinicio. Lo usa cmdsloader.
export function wrapRun(run, name) {
  return function (ctx = {}, ...rest) {
    const j = currentJob()
    if (j && !j.replay && !j.skip) {
      const p = j.meta?.prefix || ctx.usedPrefix || ''
      const args = Array.isArray(ctx.args) ? ctx.args.join(' ') : ''
      setReplay(`${p}${ctx.command || name} ${args}`.trim())
    }
    return run.call(this, ctx, ...rest)
  }
}

// Al conectar: avisa y repite las descargas que cortó el reinicio
let resumed = false
export async function resumePending(sock, { handler, smsg }) {
  if (resumed) return
  resumed = true
  const list = takePending()
  if (!list.length) return
  console.log(`[dl-resume] ${list.length} descarga(s) cortadas por reinicio`)
  for (const e of list) {
    const key = e.meta?.key
    if (!key?.remoteJid) continue
    const quoted = { key, message: { conversation: e.replay || '' } }
    const text = e.ok ? RESTART_TEXT : noRestartText(e.reason)
    try { await sock.sendMessage(key.remoteJid, { text }, { quoted }) } catch (err) { console.error('[dl-resume] aviso', err?.message) }
    if (!e.ok) continue
    const id = `DLR${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
    restartsById.set(id, (e.restarts || 0) + 1)
    const raw = { key: { ...key, id }, message: { conversation: e.replay }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: e.meta?.pushName || '' }
    console.log(`[dl-resume] repitiendo para ${e.user}: ${e.replay.slice(0, 80)} (reinicio ${(e.restarts || 0) + 1})`)
    try { const m = await smsg(sock, raw); handler(sock, m, [raw]).catch((err) => console.error('[dl-resume]', err?.message)) } catch (err) { console.error('[dl-resume]', err?.message) }
  }
}
