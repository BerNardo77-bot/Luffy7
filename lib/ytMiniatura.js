// Miniaturas de YouTube como buffer validado.
// hq720/maxresdefault no existen en todos los videos: i.ytimg.com responde 404 con una
// imagen gris de ~1 KB y Baileys falla con "Failed to fetch stream" si se manda como { url }.
import fetch from 'node-fetch';
import { esImagen } from './gachaImagen.js';

const NOMBRES = ['hq720', 'maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];
const TIMEOUT = 10000;
const MIN_BYTES = 1500; // el placeholder gris de YouTube pesa ~1 KB

// Saca el ID de un link de YouTube (watch?v=, youtu.be/, shorts/, embed/, /vi/<id>/) o de un ID suelto
export function idYouTube(texto) {
  const s = String(texto || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/|\/vi(?:_webp)?\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Descarga una imagen y devuelve { buffer, mimetype } solo si es JPEG/PNG real (HTTP 200)
export async function bajarImagen(url, { timeout = TIMEOUT } = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_BYTES) return null;
    const mimetype = esImagen(buffer);
    if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') return null;
    return { buffer, mimetype };
  } catch {
    return null;
  }
}

// Prueba hq720 → maxresdefault → sddefault → hqdefault → mqdefault → default.
// `fuente` puede ser el ID, el link del video o la URL de miniatura que dio la API.
export async function miniaturaYouTube(...fuentes) {
  let id = null;
  for (const f of fuentes) if (!id) id = idYouTube(f);
  const urls = id ? NOMBRES.map((n) => `https://i.ytimg.com/vi/${id}/${n}.jpg`) : [];
  // Si la API dio una miniatura que no es de i.ytimg, se prueba al final
  for (const f of fuentes) if (/^https?:\/\//i.test(String(f || '')) && !idYouTube(f) && !urls.includes(f)) urls.push(f);
  for (const url of urls) {
    const img = await bajarImagen(url);
    if (img) return { ...img, url };
  }
  return null;
}
