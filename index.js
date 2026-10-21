import "./settings.js";
import "#db";
import handler from '#handler';
import events from '#events';
import makeWASocket, { Browsers, makeCacheableSignalKeyStore, useMultiFileAuthState, fetchLatestBaileysVersion, jidDecode, DisconnectReason } from 'baileys';
import { waVersion } from './lib/wa-version.js';
import pino from "pino";
import qrcode from "qrcode-terminal";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import readlineSync from "readline-sync";
import { smsg, getCachedMeta, setCachedMeta } from "#serialize";
import cmdsLoader from '#cmdsloader';
import { startSubBot } from '#cmds/socket/subbot';
import db from '#db';

const log = {
  info: (msg) => console.log(chalk.bgBlue.white.bold(` INFO `), chalk.white(msg)),
  success: (msg) => console.log(chalk.bgGreen.white.bold(` SUCCESS `), chalk.greenBright(msg)),
  warn: (msg) => console.log(chalk.bgYellowBright.blueBright.bold(` WARNING `), chalk.yellow(msg)),
  error: (msg) => console.log(chalk.bgRed.white.bold(` ERROR `), chalk.redBright(msg))
};

let phoneNumber = "";
let phoneInput = "";
let lineM = '⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ ⋯ 》'
const methodCodeQR = process.argv.includes("--qr");
const methodCode = process.argv.includes("code");
const DATA_DIR = (process.env.DATA_DIR || process.cwd()).replace(/\/$/, '')
const SESSION_OWNER = path.join(DATA_DIR, 'Sessions', 'Owner')
fs.mkdirSync(SESSION_OWNER, { recursive: true })
const cloudPhone = String(process.env.WHATSAPP_NUMBER || process.env.BOT_PHONE || '').replace(/\D/g, '')
const isCloud = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RENDER || process.env.DATA_DIR || cloudPhone)

const cloudPort = Number(process.env.PORT)
if (Number.isFinite(cloudPort) && cloudPort > 0) {
  import('http').then((http) => {
    http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Luffy7 WhatsApp ok\n')
    }).listen(cloudPort, '0.0.0.0', () => console.log('[cloud] HTTP health', cloudPort))
  }).catch((e) => console.error('[cloud] http', e?.message || e))
}
function normalizePhone(input) {
  let s = String(input).replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('0')) s = s.replace(/^0+/, '');
  if (s.length === 10 && s.startsWith('3')) s = '57' + s;
  if (s.startsWith('52') && !s.startsWith('521') && s.length >= 12) s = '521' + s.slice(2);
  if (s.startsWith('54') && !s.startsWith('549') && s.length >= 11) s = '549' + s.slice(2);
  return s;
}

console.log(chalk.blue.bold('\n INICIANDO SISTEMA ...'))
console.log(chalk.cyan(`
      Stellar | Wa Bot
     Powered by I'm Diego ~
`))

const BOT_TYPES = [
  { name: 'SubBot', folder: './Sessions/Subs', starter: startSubBot }
]

if (!fs.existsSync('./lib/system/tmp')) fs.mkdirSync('./lib/system/tmp', { recursive: true });
global.conns = global.conns || [];
const reconnecting = new Set();
const msgStore = new Map();
const msgLimit = 500;

async function loadBots() {
  for (const { name, folder, starter } of BOT_TYPES) {
    if (!fs.existsSync(folder)) continue;
    const botIds = fs.readdirSync(folder);
    for (const userId of botIds) {
      const sessionPath = path.join(folder, userId);
      const credsPath = path.join(sessionPath, 'creds.json');
      if (!fs.existsSync(credsPath)) continue;
      if (global.conns.some((conn) => conn.userId === userId)) continue;
      if (reconnecting.has(userId)) continue;
      try {
        reconnecting.add(userId);
        await starter(null, null, '', false, userId, '');
      } catch (e) {
        console.log(chalk.gray(`[ loadBots ] Error iniciando ${name} ${userId}: ${e?.message || e}`));
        reconnecting.delete(userId);
      }
      await new Promise((res) => setTimeout(res, 2500));
    }
  }
 // setTimeout(loadBots, 60 * 1000);
}

async function initDB() {
  try {
    db.initDB()
    db.clearCache('user')
    db.clearCache('chat')
    db.clearCache('set')
    db.clearCache('chatuser')
    db.clearCache('packsticker')
    log.info('Base de datos inicializada.')
  } catch (e) {
    log.error(`Error DB: ${e.message}`)
  }
}

function clearSession() {
  try {
    const sessionDir = SESSION_OWNER;
    if (!fs.existsSync(sessionDir)) return;
    for (const file of fs.readdirSync(sessionDir)) {
      try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
    }
    log.warn('Sesión del principal eliminada — reiniciando para vincular de nuevo...');
  } catch (e) {
    log.error(`clearSession → ${e?.message || e}`);
  }
}

let opcion;
// Sesión a medias: creds.json existe pero WhatsApp nunca confirmó el vínculo (registered=false).
// Antes el bot no pedía código ni QR y se quedaba en "Tiempo de conexión agotado" para siempre.
try {
  const cp = path.join(SESSION_OWNER, 'creds.json')
  if (fs.existsSync(cp)) {
    const c = JSON.parse(fs.readFileSync(cp, 'utf8'))
    if (!c?.registered && !c?.me?.id) {
      console.log(chalk.yellow('[ ✿ ] La sesión guardada quedó a medias (sin vincular). Se borra para vincular de nuevo.'))
      fs.rmSync(SESSION_OWNER, { recursive: true, force: true })
      fs.mkdirSync(SESSION_OWNER, { recursive: true })
    }
  }
} catch (e) { console.log(chalk.yellow('[ ✿ ] No pude leer creds.json:'), e?.message || e) }
if (isCloud && !fs.existsSync(path.join(SESSION_OWNER, 'creds.json'))) {
  if (!cloudPhone) {
    console.error('Falta WHATSAPP_NUMBER (codigo pais + numero, sin +). Ejemplo: 5215512345678')
    process.exit(1)
  }
  opcion = "2"
  phoneNumber = normalizePhone(cloudPhone)
  console.log('[cloud] Pairing para', phoneNumber)
} else if (methodCodeQR) {
  opcion = "1";
} else if (methodCode) {
  opcion = "2";
  if (!phoneNumber) {
    console.log(chalk.bold.redBright(`\nPor favor, Ingrese el número de WhatsApp.\n${chalk.bold.yellowBright("Ejemplo: +57301******")}\n${chalk.bold.magentaBright('---> ')}`));
    phoneInput = readlineSync.question("");
    phoneNumber = normalizePhone(phoneInput);
  }
} else if (!fs.existsSync(path.join(SESSION_OWNER, 'creds.json'))) {
    opcion = readlineSync.question(`╭${lineM}  
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('┊')} ${chalk.blue.bgBlue.bold.cyan('METODO DE VINCULACION')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}   
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}     
┊ ${chalk.blueBright('┊')} ${chalk.green.bgMagenta.bold.yellow('COMO DESEA CONECTARSE?')}
┊ ${chalk.blueBright('┊')} ${chalk.bold.redBright('=>  Opcion 1:')} ${chalk.greenBright('Codigo QR.')}
┊ ${chalk.blueBright('┊')} ${chalk.bold.redBright('=>  Opcion 2:')} ${chalk.greenBright('Codigo de 8 digitos.')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}
┊ ${chalk.blueBright('╭┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')}     
┊ ${chalk.blueBright('┊')} ${chalk.italic.magenta('Escriba solo el numero de')}
┊ ${chalk.blueBright('┊')} ${chalk.italic.magenta('la opcion para conectarse.')}
┊ ${chalk.blueBright('╰┅┅┅┅┅┅┅┅┅┅┅┅┅┅┅')} 
╰${lineM}\n${chalk.bold.magentaBright('---> ')}`);
  while (!/^[1-2]$/.test(opcion)) {
    console.log(chalk.bold.redBright(`No se permiten numeros que no sean 1 o 2, tampoco letras o símbolos especiales.`));
    opcion = readlineSync.question("--> ");
  }
  if (opcion === "2") {
    console.log(chalk.bold.redBright(`\nPor favor, Ingrese el número de WhatsApp.\n${chalk.bold.yellowBright("Ejemplo: +57301******")}\n${chalk.bold.magentaBright('---> ')}`));
    phoneInput = readlineSync.question("");
    phoneNumber = normalizePhone(phoneInput);
  }
}

let bootTime = Date.now();
const handledIds = new Set(); // ids de mensajes ya procesados (sobrevive a reconexiones)
let reconexion = 0;
let botReady = false;
let isRestarting = false;
const retriesLimit = 15;
async function warmupGroups(sock) {
  try {
    const allChats = db.getChat()
    const chatIds = allChats.map(c => c.id).filter(id => typeof id === 'string' && id.endsWith('@g.us')).slice(0, 50)
    if (!chatIds.length) return
    console.log(chalk.gray(`[ ✿ ] Precargando metadata de ${chatIds.length} grupos...`))
    const t = Date.now()
    const batches = []
    for (let i = 0; i < chatIds.length; i += 10) {
      batches.push(chatIds.slice(i, i + 10))
    }
    await Promise.allSettled(batches.map(batch => Promise.allSettled(batch.map(async id => {
    try {
    const meta = await sock.groupMetadata(id)
    if (meta) setCachedMeta(id, meta) } catch {}}))))
    console.log(chalk.gray(`[ ✿ ] Warmup completado en ${Date.now() - t}ms`))
  } catch (e) {
    console.log(chalk.gray(`[ ✿ ] warmupGroups → ${e?.message || e}`))
  }
}

export async function startBot() {
  if (isRestarting) return;
  isRestarting = true;
  bootTime = Date.now();
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_OWNER);
  const version = await waVersion();
  console.info = () => {};
  console.debug = () => {};
  // Cerrar el socket anterior antes de abrir otro (evita dos conexiones peleando)
  try { global.sock?.ev?.removeAllListeners?.(); global.sock?.end?.(undefined) } catch {}
  const sock = makeWASocket({
    version,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: undefined,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    shouldIgnoreJid: (jid) => jid.endsWith('@broadcast'),
    keepAliveIntervalMs: 25_000,
    getMessage: async (key) => msgStore.get(key.remoteJid + ':' + key.id),
  });

  global.sock = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.sendText = (jid, text, quoted = "", options) => sock.sendMessage(jid, { text, ...options }, { quoted });
  sock.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    }
    return jid;
  };

  if (opcion === "2" && !state.creds.registered) {
    setTimeout(async () => {
      try {
        if (!state.creds.registered) {
          const pairing = await sock.requestPairingCode(phoneNumber);
          const codeBot = pairing?.match(/.{1,4}/g)?.join("-") || pairing;
          console.log('========================================')
          console.log('CODIGO WHATSAPP (8 digitos):', codeBot)
          console.log('WhatsApp → Dispositivos vinculados → Vincular con numero de telefono')
          console.log('========================================')
          console.log(chalk.bold.white(chalk.bgMagenta(`Código de emparejamiento:`)), chalk.bold.white(chalk.white(codeBot)));
        }
      } catch (err) {
        console.log(chalk.red("Error al generar código:"), err);
      }
    }, 3000);
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!botReady) return;
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg?.message && msg?.key?.id) {
        const sid = msg.key.remoteJid + ':' + msg.key.id;
        msgStore.set(sid, msg.message);
        if (msgStore.size > msgLimit) msgStore.delete(msgStore.keys().next().value);
      }
      try {
        if (!msg?.message || msg.key?.remoteJid === "status@broadcast") continue;
        if ((msg.messageTimestamp * 1000) < bootTime - 15_000) continue;
        // Tras reconectar WhatsApp puede reenviar mensajes ya atendidos: cada id se procesa una sola vez
        const did = (msg.key.remoteJid || '') + ':' + (msg.key.id || '')
        if (handledIds.has(did)) continue
        handledIds.add(did)
        if (handledIds.size > 3000) handledIds.delete(handledIds.values().next().value)
        if (msg.message.ephemeralMessage) msg.message = msg.message.ephemeralMessage.message;
        const m = await smsg(sock, msg);
        if (typeof handler === 'function') handler(sock, m, messages).catch((err) => console.error('[ ✿  ]  Main Owner »', err?.message));
      } catch (err) {
        console.error('Error:', err);
      }
    }
  });

  try { await events(sock, null); } catch (err) { console.log(chalk.gray(`[ EVENT ERROR ] → ${err}`)); }

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect, isNewLogin, receivedPendingNotifications } = update;
    if (qr != 0 && qr != undefined || methodCodeQR) {
      if (opcion == '1' || methodCodeQR || (!opcion && !state.creds.registered)) {
        console.log(chalk.green.bold("[ ✿ ] Escanea este código QR"));
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") {
      bootTime = Date.now();
      reconexion = 0;
      isRestarting = false;
      // db.getSettings es síncrono: no lleva .catch (eso tumbaba el bot al conectar)
      let botSets = null
      try { if (sock.user?.id) botSets = await Promise.resolve(db.getSettings(sock.user.id.split(':')[0] + '@s.whatsapp.net')) } catch {}
      const userName = sock.user?.name || botSets?.namebot2 || 'Luffy';
      log.success(`Conectado a: ${userName}`);
      if (!botReady) {
        botReady = true;
        warmupGroups(sock);
      }
    }
    if (isNewLogin) log.info("Nuevo dispositivo detectado");
    if (receivedPendingNotifications === true) {
      log.warn("Por favor espere aproximadamente 1 minuto...");
      sock.ev.flush();
    }
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      if ([DisconnectReason.loggedOut, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(reason)) {
        log.warn(`Principal desvinculado (${reason}) — limpiando sesión y reiniciando...`);
        botReady = false;
        isRestarting = false;
        clearSession();
        process.exit(1);
      }
      if (reason === DisconnectReason.connectionReplaced) {
        log.warn("Conexión reemplazada — cerrá la otra sesión antes de reconectar.");
        isRestarting = false;
        return;
      }
      reconexion++;
      // 408 (sin red / versión vieja) no es sesión dañada: no borrar la sesión, solo esperar y reintentar
      if (reason === DisconnectReason.timedOut && reconexion > retriesLimit) reconexion = retriesLimit;
      if (reconexion > retriesLimit) {
        // Antes aquí se borraba la sesión. Un error de red/stream (500, 408, 428…) NO es sesión dañada:
        // nunca borrar Sessions por esto; solo seguir reintentando con espera máxima.
        log.warn(`Muchos reintentos (${reconexion}); sigo intentando sin borrar la sesión...`);
        reconexion = retriesLimit;
      }
      const delay = Math.min(3000 * reconexion, 30000);
      const reasonMessages = {
        [DisconnectReason.connectionLost]: "Se perdió la conexión al servidor, intentando reconectar...",
        [DisconnectReason.connectionClosed]: "Conexión cerrada, intentando reconectarse...",
        [DisconnectReason.restartRequired]: "Es necesario reiniciar...",
        [DisconnectReason.timedOut]: "Tiempo de conexión agotado, intentando reconectarse...",
        [DisconnectReason.badSession]: "Error de conexión con WhatsApp (500, p. ej. al subir un archivo). La sesión NO se borra; reconectando...",
      };
      const err = lastDisconnect?.error
      const det = [err?.message, err?.data && JSON.stringify(err.data).slice(0, 80)].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 160)
      log.warn(`${reasonMessages[reason] || `Desconexión (${reason}), reconectando en ${delay / 1000}s...`} [${reason}${det ? ': ' + det : ''}${state.creds.registered ? '' : ' · sesión sin vincular'}]`);
      isRestarting = false;
      setTimeout(startBot, delay);
    }
  });
}

// Un error suelto (por ejemplo en connection.update) no debe tumbar el bot en Node 24
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.stack || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.stack || e));

(async () => {
  await initDB();
  await cmdsLoader();
  loadBots();
  await startBot();
})();