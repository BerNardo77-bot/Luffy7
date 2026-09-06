import { watchFile, unwatchFile } from 'fs'
import { fileURLToPath } from 'url'

// Pon aquí tus números (código país + número, sin +). Ejemplo: '52155...'
global.owner = []

global.api = {
  url: 'https://api.alyacore.xyz',
  // Cambia esta key por la tuya si la API lo requiere
  key: process.env.ALYACORE_API_KEY || 'TU-API-KEY'
}

// Opcional para NSFW Rule34 (no dejes claves reales en el repo)
global.rule34 = {
  apiKey: process.env.RULE34_API_KEY || '',
  userId: process.env.RULE34_USER_ID || ''
}

global.msgglobal = '🏴‍☠️👒 Ocurrió un problema, contacte al creador. ¡Shishishi!'
global.dev = `ʙᴜɪʟᴛ ʙʏ ʙᴇʀɴɪᴇ · Luffy7`

global.mess = {
  socket: '⚓🔗 Este comando solo puede ser ejecutado por un Socket. ¡Gomu Gomu no...!',
  admin: '👑⚔️ Este comando solo puede ser ejecutado por los Administradores del Grupo. ¡Rey de los Piratas!',
  botAdmin: '🤖👒 Este comando solo puede ser ejecutado si el Socket es Administrador del Grupo. ¡Shishishi!',
  nsfw: '🔞🚫 Los comandos de *NSFW* están desactivados en este grupo. ¡No es divertido!',
  comandooff: '💤❌ Estos comandos están desactivados en este grupo. ¡Zzz... Shishishi!'
}

global.my = {
  ch: '',
  ch2: ''
}

let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  unwatchFile(file)
  import(`${file}?update=${Date.now()}`)
})
