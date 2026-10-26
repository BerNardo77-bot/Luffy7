// Control de descargas en curso: cancelar, pausar y continuar.
// Cada comando corre dentro de un contexto (AsyncLocalStorage). Los procesos hijos (yt-dlp, ffmpeg…)
// que se lancen dentro quedan registrados. Pausar = SIGSTOP a todo el árbol; continuar = SIGCONT;
// cancelar = SIGKILL al árbol + borrar los archivos de salida/parciales (.part, .ytdl, -Frag…).
// Una pausa de más de 30 min se cancela sola para no dejar archivos temporales atorados.
import { AsyncLocalStorage } from 'async_hooks'
import cp from 'child_process'
import fs from 'fs'
import path from 'path'
import { syncBuiltinESMExports } from 'module'

const als = new AsyncLocalStorage()
const jobs = new Map() // id -> job
let seq = 0
export const PAUSE_MAX_MS = Number(process.env.DL_PAUSE_MAX_MIN || 30) * 60 * 1000

export const currentJob = () => als.getStore() || null
export const getJob = (id) => jobs.get(String(id)) || null

// Corre fn dentro de un contexto de descarga del usuario
export function runJob(info, fn) {
  const job = {
    id: String(++seq),
    user: String(info.user || ''),
    chat: String(info.chat || ''),
    label: info.label || '',
    skip: !!info.skip,
    children: new Set(),
    outputs: new Set(),
    state: 'running', // running | paused | cancelled | done
    pending: true,
    lastSeen: Date.now(),
    status: null, // { chat_id, message_id, text } del mensaje de progreso (Telegram)
    pauseTimer: null,
    onChange: null,
    // reanudar tras reinicio
    replay: info.replay || null,
    meta: info.meta || null,
    restarts: Number(info.restarts) || 0,
    saved: false
  }
  jobs.set(job.id, job)
  const end = () => {
    if (!shuttingDown) unsave(job) // terminó, falló normal o se canceló
    job.pending = false
    job.lastSeen = Date.now()
    setTimeout(() => { if (!job.children.size) { if (job.state === 'running' || job.state === 'paused') job.state = 'done'; jobs.delete(job.id) } }, 10 * 60 * 1000).unref?.()
  }
  let r
  try { r = als.run(job, fn) } catch (e) { end(); throw e }
  return Promise.resolve(r).finally(end)
}

// Descargas activas de un usuario (las más nuevas primero)
export function activeJobs(user, chat) {
  const now = Date.now()
  return [...jobs.values()].filter((j) => !j.skip && j.user === String(user) && (!chat || j.chat === String(chat)) && (j.state === 'running' || j.state === 'paused') && (j.children.size || j.pending || now - j.lastSeen < 2 * 60 * 1000))
    .sort((a, b) => Number(b.id) - Number(a.id))
}

// ---- árbol de procesos (Linux / Android: /proc) ----
function descendants(pid) {
  const kids = new Map()
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue
      try {
        const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8')
        const ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
        if (!kids.has(ppid)) kids.set(ppid, [])
        kids.get(ppid).push(Number(d))
      } catch {}
    }
  } catch {}
  const out = []
  const stack = [pid]
  while (stack.length) { const p = stack.pop(); for (const k of kids.get(p) || []) { out.push(k); stack.push(k) } }
  return out
}
function signalTree(pid, sig) {
  if (!pid) return
  // primero los nietos (ffmpeg dentro de yt-dlp), luego el proceso
  for (const p of [...descendants(pid)].reverse().concat(pid)) { try { process.kill(p, sig) } catch {} }
}

// ---- archivos de salida que hay que borrar al cancelar ----
function outputsFromArgs(file, args) {
  const out = []
  const a = (args || []).map(String)
  const base = path.basename(String(file || '')).toLowerCase()
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === '-o' || a[i] === '--output') && a[i + 1]) out.push(a[i + 1])
    else if (a[i].startsWith('--output=')) out.push(a[i].slice(9))
  }
  if (/ffmpeg/.test(base) && a.length && !a[a.length - 1].startsWith('-')) out.push(a[a.length - 1])
  return out.filter((p) => p && p !== '-' && !/^(pipe:|https?:|rtmp)/.test(p) && path.isAbsolute(p))
}
export function trackOutput(p, job = currentJob()) { if (job && p) job.outputs.add(String(p)) }

function cleanOutputs(job) {
  let n = 0
  for (const o of job.outputs) {
    const dir = path.dirname(o)
    const prefix = path.basename(o).split('%(')[0].replace(/\.(mp4|mkv|webm|m4a|mp3|opus|ogg|ts|aac)$/i, '')
    if (!prefix || prefix.length < 4) continue
    try {
      for (const f of fs.readdirSync(dir)) if (f.startsWith(prefix)) { try { fs.rmSync(path.join(dir, f), { force: true, recursive: true }); n++ } catch {} }
    } catch {}
  }
  return n
}

// ---- parche de child_process: registra los hijos lanzados dentro de un trabajo ----
function register(child, file, args) {
  const job = currentJob()
  if (!job || job.skip || !child || !child.pid) return child
  job.children.add(child)
  job.lastSeen = Date.now()
  if (!job.saved && job.meta && job.state !== 'cancelled' && /yt-dlp|ffmpeg|aria2c|gallery-dl|streamlink/i.test(path.basename(String(file || '').split(' ')[0]))) save(job)
  for (const o of outputsFromArgs(file, args)) job.outputs.add(o)
  child.once('exit', () => { job.children.delete(child); job.lastSeen = Date.now() })
  if (job.state === 'cancelled') signalTree(child.pid, 'SIGKILL')
  else if (job.state === 'paused') signalTree(child.pid, 'SIGSTOP')
  return child
}
if (!globalThis.__dlControlPatched) {
  globalThis.__dlControlPatched = true
  const oSpawn = cp.spawn, oExecFile = cp.execFile, oExec = cp.exec
  cp.spawn = function (file, args, ...rest) { const c = oSpawn.call(this, file, args, ...rest); return register(c, file, Array.isArray(args) ? args : []) }
  cp.execFile = function (file, args, ...rest) { const c = oExecFile.call(this, file, args, ...rest); return register(c, file, Array.isArray(args) ? args : []) }
  cp.exec = function (cmd, ...rest) { const c = oExec.call(this, cmd, ...rest); return register(c, cmd, []) }
  // execFile de util.promisify usa el símbolo custom; se vuelve a crear sobre el execFile parchado
  try {
    const custom = Symbol.for('nodejs.util.promisify.custom')
    const promisified = oExecFile[custom]
    if (promisified) {
      cp.execFile[custom] = (...a) => new Promise((resolve, reject) => {
        const c = cp.execFile(...a, (err, stdout, stderr) => { if (err) { err.stdout = stdout; err.stderr = stderr; reject(err) } else resolve({ stdout, stderr }) })
        void c
      })
    }
    const pe = oExec[custom]
    if (pe) cp.exec[custom] = (...a) => new Promise((resolve, reject) => { cp.exec(...a, (err, stdout, stderr) => { if (err) { err.stdout = stdout; err.stderr = stderr; reject(err) } else resolve({ stdout, stderr }) }) })
  } catch {}
  syncBuiltinESMExports()
}

// ---- acciones ----
export function cancelJob(job, reason = 'usuario') {
  if (!job || job.state === 'cancelled') return { ok: false }
  job.state = 'cancelled'
  clearTimeout(job.pauseTimer)
  unsave(job)
  const killed = job.children.size
  for (const c of job.children) { signalTree(c.pid, 'SIGCONT'); signalTree(c.pid, 'SIGKILL') }
  // el proceso tarda un poco en soltar los archivos
  const removed = cleanOutputs(job)
  setTimeout(() => cleanOutputs(job), 1500).unref?.()
  setTimeout(() => cleanOutputs(job), 8000).unref?.()
  console.log(`[dl-control] cancelado #${job.id} (${reason}): ${killed} proceso(s), ${removed} archivo(s)`)
  job.onChange?.(job, 'cancelled', reason)
  return { ok: true, killed, removed }
}
export function pauseJob(job) {
  if (!job || job.state !== 'running') return { ok: false }
  job.state = 'paused'
  for (const c of job.children) signalTree(c.pid, 'SIGSTOP')
  clearTimeout(job.pauseTimer)
  job.pauseTimer = setTimeout(() => cancelJob(job, `pausa de más de ${Math.round(PAUSE_MAX_MS / 60000)} min`), PAUSE_MAX_MS)
  job.pauseTimer.unref?.()
  job.onChange?.(job, 'paused')
  return { ok: true }
}
export function resumeJob(job) {
  if (!job || job.state !== 'paused') return { ok: false }
  job.state = 'running'
  clearTimeout(job.pauseTimer)
  for (const c of job.children) signalTree(c.pid, 'SIGCONT')
  job.onChange?.(job, 'running')
  return { ok: true }
}
export const isCancelled = (job = currentJob()) => job?.state === 'cancelled'
// Ejecuta fn fuera de cualquier trabajo (para que los mensajes de control no se bloqueen)
export const outsideJob = (fn) => als.exit(fn)

// ---- descargas pendientes: si el bot se reinicia a media descarga, se vuelve a empezar ----
let pendingFile = ''
let shuttingDown = false
export const MAX_RESTARTS = 2
export const MAX_AGE_MS = 6 * 60 * 60 * 1000
export const isShuttingDown = () => shuttingDown

function readPending() {
  if (!pendingFile) return []
  try { const a = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
}
function writePending(list) {
  if (!pendingFile) return
  try {
    fs.mkdirSync(path.dirname(pendingFile), { recursive: true })
    const tmp = `${pendingFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(list, null, 1))
    fs.renameSync(tmp, pendingFile)
  } catch (e) { console.error('[dl-resume] no pude guardar', e?.message || e) }
}
const entryOf = (job) => ({
  key: `${process.pid}-${job.id}`, user: job.user, chat: job.chat, replay: job.replay || null,
  meta: job.meta || null, status: job.status ? { chat_id: job.status.chat_id, message_id: job.status.message_id } : null,
  startedAt: job.startedAt || Date.now(), restarts: job.restarts || 0
})
function save(job) {
  if (!pendingFile || job.skip) return
  job.saved = true
  job.startedAt = job.startedAt || Date.now()
  const e = entryOf(job)
  writePending(readPending().filter((x) => x.key !== e.key).concat(e))
}
function unsave(job) {
  if (!job.saved) return
  job.saved = false
  const k = `${process.pid}-${job.id}`
  writePending(readPending().filter((x) => x.key !== k))
}
// Actualiza lo guardado (p. ej. ya se conoce el mensaje de progreso o el comando a repetir)
// El comando mostró un mensaje de progreso de descarga: cuenta como descarga activa
export function markDownload(job = currentJob()) { if (job && !job.saved && job.meta && job.state !== 'cancelled' && !shuttingDown) save(job) }
export function touchJob(job = currentJob()) { if (job?.saved && !shuttingDown) save(job) }
// Lo que hay que mandar otra vez para repetir la descarga (para elecciones por número/botón)
export function setReplay(text, job = currentJob()) {
  if (!job || !text) return
  job.replay = String(text)
  touchJob(job)
}

let startupPending = null
export function configurePending(file) {
  pendingFile = file
  // lo que quedó del arranque anterior se lee YA, antes de que empiece cualquier descarga nueva
  startupPending = readPending()
  writePending([])
  // Al apagarse (redeploy, CTRL+C) los procesos mueren y el comando "falla": no borrar su pendiente
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, function onSig() {
      shuttingDown = true
      // no dejar yt-dlp/ffmpeg huérfanos
      for (const j of jobs.values()) for (const c of j.children) { signalTree(c.pid, 'SIGCONT'); signalTree(c.pid, 'SIGKILL') }
      // si nadie más escucha esta señal, mantener el comportamiento normal (salir)
      if (process.listenerCount(sig) === 1) process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[sig]))
    })
  }
  console.log(`[dl-resume] descargas pendientes en ${file}`)
}

// Al arrancar: devuelve y limpia los pendientes. ok = se puede repetir; si no, reason.
export function takePending(now = Date.now()) {
  const list = startupPending || []
  startupPending = []
  return list.map((e) => {
    if (!e.replay) return { ...e, ok: false, reason: 'pick' }
    if (now - (e.startedAt || 0) > MAX_AGE_MS) return { ...e, ok: false, reason: 'old' }
    if ((e.restarts || 0) >= MAX_RESTARTS) return { ...e, ok: false, reason: 'max' }
    return { ...e, ok: true }
  })
}
export const RESTART_TEXT = '🔄 El bot se reinició y se cortó tu descarga. La vuelvo a empezar…'
export const noRestartText = (reason) => reason === 'max'
  ? '🔄 El bot se reinició y se cortó tu descarga. Ya la reintenté varias veces, así que no la vuelvo a empezar: pídela de nuevo si la quieres.'
  : reason === 'old'
    ? '🔄 El bot se reinició y se cortó tu descarga hace mucho; pídela de nuevo si todavía la quieres.'
    : '🔄 El bot se reinició y se cortó tu descarga. Vuelve a pedirla (la lista para elegir se perdió).'
