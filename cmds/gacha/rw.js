import db from "#db"
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';


// Valida que el buffer sea una imagen real (JPEG/PNG/GIF/WEBP), no una página HTML
const esImagen = (buf) => {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return false;
};

// Respaldo directo: API pública de Danbooru solo con imágenes seguras (rating:g)
const danbooruDirecto = async (kw) => {
  try {
    const url = `https://danbooru.donmai.us/posts.json?limit=20&tags=${encodeURIComponent(kw)}+rating:g`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Luffy7Bot/1.0' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`danbooru directo HTTP ${res.status}`);
    const posts = (await res.json()).filter(p => {
      const ext = String(p.file_ext || '').toLowerCase();
      return ['jpg', 'jpeg', 'png', 'webp'].includes(ext) && (p.large_file_url || p.file_url);
    });
    for (const post of posts.sort(() => Math.random() - 0.5).slice(0, 3)) {
      const img = await fetch(post.large_file_url || post.file_url, { headers: { 'User-Agent': 'Luffy7Bot/1.0' }, signal: AbortSignal.timeout(15000) });
      if (!img.ok) continue;
      const buf = Buffer.from(await img.arrayBuffer());
      if (esImagen(buf)) return buf;
    }
  } catch (err) {
    console.error(`Error en danbooru directo (${kw}):`, err.message);
  }
  return null;
};

const obtenerImagen = async (keyword, name = '') => {
  const endpoints = ["safebooru", "gelbooru", "danbooru"];
  const FALLBACK_KEY = 'LUFFY-FIX67';
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim();
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY;

  const variants = [];
  const add = (k) => {
    const v = (k || '').trim();
    if (v && !variants.includes(v)) variants.push(v);
  };
  add(keyword);
  if (keyword && keyword.includes('(')) add(keyword.split('(')[0].replace(/_+$/, ''));
  if (name) add(String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));

  const tryFetch = async (kw, useKey) => {
    const q = encodeURIComponent(kw);
    for (const endpoint of endpoints) {
      try {
        const url = `${api.url}/nsfw/${endpoint}?keyword=${q}&key=${useKey}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (res.status === 401) throw new Error(`${endpoint} HTTP 401`);
        if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
        const ctype = (res.headers.get('content-type') || '').toLowerCase();
        if (ctype.includes('application/json')) {
          const j = await res.json();
          throw new Error(j?.message || `${endpoint} JSON sin imagen`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!esImagen(buffer)) throw new Error(`${endpoint} no devolvió una imagen válida`);
        return buffer;
      } catch (err) {
        console.error(`Error en ${endpoint} (${kw}):`, err.message);
        if (String(err.message).includes('401')) return { error: 'api_key' };
      }
    }
    return null;
  };

  for (const kw of variants) {
    let got = await tryFetch(kw, key);
    if (got && !got.error) return got;
    // Si 401 o fallo, reintenta con la key conocida del bot
    if (key !== FALLBACK_KEY) {
      console.error('[rw] Reintentando imagen con key fallback LUFFY-FIX67');
      got = await tryFetch(kw, FALLBACK_KEY);
      if (got && !got.error) return got;
    }
    if (got?.error === 'api_key') continue;
  }

  for (const kw of variants) {
    const directo = await danbooruDirecto(kw);
    if (directo) return directo;
  }

  return null;
};

const obtenerPersonajes = () => {
  try {
    const contenido = fs.readFileSync('./lib/characters.json', 'utf-8')
    return JSON.parse(contenido)
  } catch (error) {
    console.error('[Error] characters.json:', error)
    return []
  }
}

const msToTime = (duration) => {
  const seconds = Math.floor((duration / 1000) % 60)
  const minutes = Math.floor((duration / (1000 * 60)) % 60)
  const s = seconds.toString().padStart(2, '0')
  const msg = minutes.toString().padStart(2, '0')
  return msg === '00'
    ? `${s} segundo${s > 1 ? 's' : ''}`
    : `${msg} minuto${msg > 1 ? 's' : ''}, ${s} segundo${s > 1 ? 's' : ''}`
}

export default {
  command: ['rollwaifu', 'roll', 'rw', 'rf'],
  category: 'gacha',
  run: async ({ msg, sock, args }) => {
    const chatId = msg.chat
    const userId = msg.sender
    const chat = await db.getChat(chatId)
    const user = await db.getUser(userId)
    const chatUser = await db.getChatUser(chatId, userId)
    const now = Date.now()

    if (chat.adminonly || !chat.gacha)
      return msg.reply(mess.comandooff)

    const cooldown = chatUser.rwCooldown || 0
    const restante = cooldown - now
    if (restante > 0) {
      return msg.reply(`✎ Espera *${msToTime(restante)}* para volver a usar este comando.`)
    }

    const personajes = obtenerPersonajes()
    const personaje = personajes[Math.floor(Math.random() * personajes.length)]
    if (!personaje) return msg.reply('《✤》 No se encontró ningún personaje disponible.')

    const reservado = Array.isArray(chat.personajesReservados)
      ? chat.personajesReservados.find((p) => p.name === personaje.name)
      : null

    const chatUsers = await db.getChatUser(chatId)
    const poseedor = chatUsers.find(user =>
      Array.isArray(user.characters) && user.characters.some((c) => c.name === personaje.name)
    )

    try {
      let estado = 'Libre'
      if (poseedor) {
        const userData = await db.getUser(poseedor.user_id)
        estado = `Reclamado por ${userData.name || 'Alguien'}`
      } else if (reservado) {
        const userData = await db.getUser(reservado.userId)
        estado = `Reservado por ${userData.name || 'Alguien'}`
      }

      await db.updateChatUser(chatId, userId, 'rwCooldown', now + 15 * 60000)

      const valorPersonaje =
        typeof personaje.value === 'number' ? personaje.value.toLocaleString() : '0'
      const mensaje = `➩ Nombre › *${personaje.name || 'Desconocido'}*

ੈ⚥‧₊˚ Género › *${personaje.gender || 'Desconocido'}*
ੈ⛁‧₊˚ Valor › *${valorPersonaje}*
ੈ❖‧₊˚ Estado › *${estado}*
ੈ❀︎‧₊˚ Fuente › *${personaje.source || 'Desconocido'}*

${dev}`

const imagen = await obtenerImagen(personaje.keyword, personaje.name);

if (!imagen || imagen.error) {
  await db.updateChatUser(chatId, userId, 'rwCooldown', 0)
  if (imagen?.error === 'api_key') {
    return msg.reply('✎ API key inválida. En Termux edita settings.js y pon key: \'LUFFY-FIX67\' luego reinicia el bot.');
  }
  return msg.reply(`✎ No se pudo obtener una imagen para *${personaje.name}*. Prueba /rw de nuevo.`);
}

const payload = {
  image: imagen,
  caption: mensaje,
  mimetype: esImagen(imagen) || 'image/jpeg'
};

const sent = await sock.sendMessage(chatId, payload, { quoted: msg });

      if (!poseedor) {
        const idUnico = uuidv4().slice(0, 8)
        const nuevoReservado = {
          id: idUnico,
          name: personaje.name,
          value: personaje.value || 0,
          gender: personaje.gender,
          source: personaje.source,
          keyword: personaje.keyword,
          userId: userId,
          reservedUntil: now + 20000,
          expiresAt: now + 60000,
          messageId: sent.key.id
        }
        
        let personajesReservados = chat.personajesReservados || []
        const indexExistente = personajesReservados.findIndex(
          p => p.name === personaje.name
        )
        
        if (indexExistente !== -1) {
          personajesReservados[indexExistente] = nuevoReservado
        } else {
          personajesReservados.push(nuevoReservado)
        }
        
        await db.updateChat(chatId, 'personajesReservados', personajesReservados)
      }
    } catch (e) {
      await db.updateChatUser(chatId, userId, 'rwCooldown', 0)
      return msg.reply(msgglobal)
    }
  },
};
