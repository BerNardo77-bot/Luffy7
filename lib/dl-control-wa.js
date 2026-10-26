// WhatsApp: cada comando corre en su propio "trabajo" para poder cancelar/pausar/continuar
// la descarga del que lo mandó (comandos cancelar, pausar, continuar).
import { runJob, currentJob, activeJobs, cancelJob, pauseJob, resumeJob, outsideJob, PAUSE_MAX_MS } from './dl-control.js'

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
      if (job.state === 'cancelled') return undefined // ya se avisó; no mandar errores ni archivos a medias
      if (content && typeof content.text === 'string' && PROGRESS_RE.test(content.text) && !job.hinted) {
        job.hinted = true
        const p = job.prefix || ''
        content = { ...content, text: `${content.text}\n\n✎ Para cancelar: *${p}cancelar* · pausar: *${p}pausar*` }
      }
    }
    return orig(jid, content, options)
  }
}

// Envuelve la ejecución del comando
export function runCommand({ sock, msg, command, usedPrefix }, fn) {
  patchSock(sock)
  const cmd = String(command || '').toLowerCase()
  const job = { user: msg.sender, chat: msg.chat, skip: CONTROL.includes(cmd) || SKIP.includes(cmd) }
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
