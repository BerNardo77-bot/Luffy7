// Búsqueda de imágenes de personajes para los comandos gacha (#rw, #charimage).
// Vive en lib/ para que el cargador de comandos (cmds/) no lo trate como comando.
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

// Busca en Danbooru la etiqueta de personaje correcta (ej. "Karin Uzumaki" de Naruto -> karin_(naruto))
const resolverEtiqueta = async (keyword, name = '', source = '') => {
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const tokens = norm(name).split('_').filter(t => t.length > 1);
  const fuente = norm(source);
  const consultas = [...new Set([norm(keyword), ...tokens].filter(Boolean))].slice(0, 4);
  const candidatos = new Map();
  for (const q of consultas) {
    try {
      const params = new URLSearchParams({ 'search[name_matches]': `${q}*`, 'search[category]': '4', 'search[order]': 'count', limit: '20' });
      const res = await fetch(`https://danbooru.donmai.us/tags.json?${params}`, { headers: { 'User-Agent': 'Luffy7Bot/1.0' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      for (const t of await res.json()) if (t.post_count > 0) candidatos.set(t.name, t.post_count);
    } catch (err) {
      console.error(`Error buscando etiqueta (${q}):`, err.message);
    }
  }
  let mejor = null;
  for (const [tag, count] of candidatos) {
    const partes = tag.split(/[_()]+/).filter(Boolean);
    const hits = tokens.filter(t => partes.includes(t)).length;
    // La serie solo cuenta si va entre paréntesis, ej. karin_(naruto); así uzumaki_naruto no pasa por Karin Uzumaki
    const parentesis = (tag.match(/\(([^)]+)\)/g) || []).join('_').split(/[_()]+/).filter(Boolean);
    const conFuente = fuente && fuente.split('_').some(f => f.length > 2 && parentesis.includes(f));
    const valido = (tokens.length && hits === tokens.length) || (hits >= 1 && conFuente);
    if (!valido) continue;
    const puntos = hits + (conFuente ? 2 : 0);
    if (!mejor || puntos > mejor.puntos || (puntos === mejor.puntos && count > mejor.count)) mejor = { tag, puntos, count };
  }
  return mejor?.tag || null;
};

const obtenerImagen = async (keyword, name = '', source = '', { tag = '[rw]' } = {}) => {
  // 1) Danbooru directo (rápido y solo imágenes seguras)
  const rapido = await danbooruDirecto(keyword);
  if (rapido) return rapido;
  const etiqueta = await resolverEtiqueta(keyword, name, source);
  if (etiqueta && etiqueta !== keyword) {
    const porEtiqueta = await danbooruDirecto(etiqueta);
    if (porEtiqueta) return porEtiqueta;
  }

  // 2) API del bot como respaldo
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
      console.error(`${tag} Reintentando imagen con key fallback LUFFY-FIX67`);
      got = await tryFetch(kw, FALLBACK_KEY);
      if (got && !got.error) return got;
    }
    if (got?.error === 'api_key') continue;
  }

  return null;
};

export { esImagen, danbooruDirecto, resolverEtiqueta, obtenerImagen };
