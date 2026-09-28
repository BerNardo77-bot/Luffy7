// Búsqueda de imágenes en la web para #imagen / #img.
// Varias fuentes sin API key; cada imagen se descarga como buffer y se valida por sus bytes
// antes de enviarla (WhatsApp no muestra GIF/HTML como imagen y queda solo el texto).
import fetch from 'node-fetch';
import { esImagen } from './gachaImagen.js';

const TIMEOUT = 12000;
const MAX_BYTES = 8 * 1024 * 1024; // imágenes enormes tardan mucho en Termux
const MIN_BYTES = 2048;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FALLBACK_KEY = 'LUFFY-FIX67';
// WhatsApp solo muestra bien JPEG/PNG como mensaje de imagen (GIF animado/WEBP fallan o salen sin imagen)
const ACEPTADOS = ['image/jpeg', 'image/png'];

const apiBase = () =>
  (typeof api !== 'undefined' && api?.url ? String(api.url) : 'https://api.alyacore.xyz').replace(/\/$/, '');

function apiKeys() {
  let key = (typeof api !== 'undefined' && api?.key ? String(api.key) : '').trim();
  if (!key || key === 'TU-API-KEY' || key === 'undefined') key = FALLBACK_KEY;
  return key === FALLBACK_KEY ? [key] : [key, FALLBACK_KEY];
}

const pedir = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT) });

const decodeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const pareceGif = (u) => /\.gif(\?|$)/i.test(u);

// sharp es opcional (en Termux a veces no carga): si falla, esa URL simplemente se descarta
let sharpMod;
async function aJpeg(buffer) {
  try {
    if (sharpMod === undefined) sharpMod = (await import('sharp')).default;
    if (!sharpMod) return null;
    const out = await sharpMod(buffer, { animated: false }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    return esImagen(out) === 'image/jpeg' ? { buffer: out, mimetype: 'image/jpeg' } : null;
  } catch {
    sharpMod = sharpMod || null;
    return null;
  }
}

// Descarga una URL y devuelve { buffer, mimetype } solo si es JPEG/PNG real
export async function descargarImagen(url) {
  try {
    const res = await pedir(url, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8' } });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return null;
    const mimetype = esImagen(buffer);
    if (ACEPTADOS.includes(mimetype)) return { buffer, mimetype };
    // WEBP/GIF: WhatsApp los muestra como recuadro gris; se convierten a JPEG si sharp está disponible
    if (mimetype === 'image/webp' || mimetype === 'image/gif') return await aJpeg(buffer);
    return null;
  } catch {
    return null;
  }
}

// ── Fuentes ─────────────────────────────────────────────────────────

// Alyacore googleimagen: devuelve la imagen directa (a veces está en mantenimiento → 503 JSON)
async function alyacoreGoogle(q) {
  for (const key of apiKeys()) {
    try {
      const res = await pedir(`${apiBase()}/search/googleimagen?query=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mimetype = esImagen(buffer);
      if (buffer.length >= MIN_BYTES && ACEPTADOS.includes(mimetype)) return { buffer, mimetype, fuente: 'google' };
    } catch {}
  }
  return null;
}

// Bing Imágenes (scraping del HTML, SafeSearch estricto salvo NSFW activo)
async function bingUrls(q, safe) {
  const res = await pedir(`https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=35&mmasync=1&adlt=${safe ? 'strict' : 'off'}`, {
    headers: { Cookie: `SRCHHPGUSR=ADLT=${safe ? 'STRICT' : 'OFF'}` }
  });
  if (!res.ok) throw new Error(`bing HTTP ${res.status}`);
  const html = await res.text();
  const urls = [];
  for (const m of html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)) urls.push(decodeHtml(m[1]));
  return urls;
}

// Pinterest vía alyacore (JSON con hd/mini)
async function pinterestUrls(q) {
  for (const key of apiKeys()) {
    try {
      const res = await pedir(`${apiBase()}/search/pinterest?query=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`);
      const json = await res.json().catch(() => ({}));
      if (!json?.status || !Array.isArray(json.data)) continue;
      const urls = [];
      for (const it of json.data) {
        // hd a veces es un GIF animado enorme: en ese caso usar una versión JPG estática
        // (GIF animado → versión estática JPG de 736px de pinimg)
        if (it?.hd && !pareceGif(it.hd)) urls.push(it.hd);
        else if (it?.hd && /i\.pinimg\.com\/originals\//.test(it.hd)) urls.push(it.hd.replace('/originals/', '/736x/').replace(/\.gif(\?|$)/i, '.jpg$1'));
        else if (it?.mini) urls.push(it.mini);
        else if (it?.url) urls.push(it.url);
      }
      return urls;
    } catch {}
  }
  return [];
}

// DuckDuckGo Imágenes (token vqd + i.js)
async function duckUrls(q, safe) {
  const home = await pedir(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`);
  const html = await home.text();
  const vqd = (html.match(/vqd=["']?([\d-]+)["']?/) || [])[1];
  if (!vqd) throw new Error('duckduckgo sin vqd');
  const res = await pedir(`https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,,,&p=${safe ? 1 : -1}`, {
    headers: { Referer: 'https://duckduckgo.com/', Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`duckduckgo HTTP ${res.status}`);
  const json = await res.json();
  return (json.results || []).map((r) => r.image).filter(Boolean);
}

// Openverse (imágenes libres, API pública sin key)
async function openverseUrls(q, safe) {
  const res = await pedir(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20${safe ? '&mature=false' : ''}`, {
    headers: { 'User-Agent': 'Luffy7Bot/1.0 (https://github.com/BerNardo77-bot/Luffy7)' }
  });
  if (!res.ok) throw new Error(`openverse HTTP ${res.status}`);
  const json = await res.json();
  return (json.results || []).map((r) => r.url).filter(Boolean);
}

const FUENTES = [
  ['bing', bingUrls],
  ['pinterest', pinterestUrls],
  ['duckduckgo', duckUrls],
  ['openverse', openverseUrls]
];

// Busca y devuelve { buffer, mimetype, fuente, url } de la primera imagen real, o null.
// intentosPorFuente: cuántas URLs candidatas se descargan de cada fuente.
// omitir: nombres de fuentes a saltar (útil para probar los respaldos).
export async function buscarImagen(query, { safe = true, intentosPorFuente = 5, omitir = [], log = console.error } = {}) {
  if (!omitir.includes('google')) {
    const google = await alyacoreGoogle(query);
    if (google) return google;
  }

  const vistas = new Set();
  for (const [nombre, fn] of FUENTES) {
    if (omitir.includes(nombre)) continue;
    let urls = [];
    try {
      urls = await fn(query, safe);
    } catch (e) {
      log(`[imagen] ${nombre}: ${e?.message || e}`);
      continue;
    }
    const candidatas = urls.filter((u) => /^https?:\/\//i.test(u) && !pareceGif(u) && !vistas.has(u)).slice(0, intentosPorFuente);
    candidatas.forEach((u) => vistas.add(u));
    // Descarga de 3 en 3 en paralelo (respeta el orden de relevancia)
    for (let i = 0; i < candidatas.length; i += 3) {
      const lote = candidatas.slice(i, i + 3);
      const imgs = await Promise.all(lote.map(descargarImagen));
      const k = imgs.findIndex(Boolean);
      if (k !== -1) return { ...imgs[k], fuente: nombre, url: lote[k] };
    }
    log(`[imagen] ${nombre}: ${urls.length} resultados, ninguna imagen válida en ${candidatas.length} intentos`);
  }
  return null;
}
