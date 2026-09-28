import db from "#db"
import { promises as fs } from 'fs';
import { esImagen, obtenerImagen } from '../../lib/gachaImagen.js';

const charactersFilePath = './lib/characters.json'

async function loadCharacters() {
  try {
    const data = await fs.readFile(charactersFilePath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('❀ Error al cargar characters.json:', error)
    throw new Error('❀ No se pudo cargar el archivo characters.json')
  }
}

function findSimilarCharacter(name, characters) {
  name = name.toLowerCase().trim()
  return (
    characters.find((c) => c.name.toLowerCase() === name) ||
    characters.find((c) => c.name.toLowerCase().includes(name)) ||
    characters.find((c) => name.includes(c.name.toLowerCase()))
  )
}

export default {
  command: ['charimage', 'wimage', 'cimage'],
  category: 'gacha',
  run: async ({ msg, sock, args }) => {
    const chatId = msg.chat
    
    const chatConfig = await db.getChat(chatId)
    
    if (chatConfig.adminonly || !chatConfig.gacha)
      return msg.reply(mess.comandooff)

    if (args.length === 0)
      return msg.reply(`《✤》 Por favor, proporciona el nombre de un personaje.`)

    try {
      const characterName = args.join(' ').toLowerCase().trim()
      const characters = await loadCharacters()
      const character = findSimilarCharacter(characterName, characters)

      if (!character)
        return msg.reply(`✎ No se ha encontrado el personaje *${characterName}*, ni uno similar.`)

      const message = `➭ Nombre › *${character.name}*

ੈ⚥‧₊˚ Género › *${character.gender}*
ੈ⛁₊˚ Valor › *${character.value.toLocaleString()}*
ੈ❀︎‧₊˚ Fuente › *${character.source}*

${dev}`

const imagen = await obtenerImagen(character.keyword, character.name, character.source, { tag: '[charimage]' });

// Sin imagen válida: manda solo el texto en vez de una imagen rota
if (!imagen || imagen.error || !esImagen(imagen)) {
  console.error(`[charimage] Sin imagen válida para ${character.name}, enviando solo texto`);
  return msg.reply(message);
}

const payload = {
  image: imagen, 
  caption: message, 
  mimetype: esImagen(imagen)
};

await sock.sendMessage(chatId, payload, { quoted: msg });

    } catch (error) {
      console.error(error)
      await msg.reply(msgglobal)
    }
  },
}
