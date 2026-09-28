// Prefijo que se muestra en el menú y en los textos de ayuda/uso de los comandos.
// No cambia cómo el handler reconoce los comandos: solo decide qué símbolo enseñar
// (ej. con `#setbotprefix $` los textos muestran `$menu`, `$rw`, etc.).
import db from '#db';

const PREFIJO_DEFECTO = '#';

// usedPrefix: lo que el handler detectó en el mensaje (puede incluir el nombre del bot, ej. "Luffy$").
// settings: ajustes del bot (settings.prefijo = array de símbolos, 1 = sin prefijo, null/undefined = no configurado).
export function prefijoMostrar(usedPrefix, settings) {
  const cfg = settings?.prefijo;
  if (cfg === 1) return '';
  const lista = Array.isArray(cfg)
    ? cfg.filter((p) => typeof p === 'string' && p)
    : typeof cfg === 'string' && cfg ? [cfg] : [];
  if (typeof usedPrefix === 'string' && usedPrefix) {
    const usado = [...lista].sort((a, b) => b.length - a.length).find((p) => usedPrefix.endsWith(p));
    if (usado) return usado;
  }
  return lista[0] ?? PREFIJO_DEFECTO;
}

// Igual que prefijoMostrar pero lee los ajustes del bot (sock) desde la base de datos.
export async function prefijoActual({ sock, usedPrefix, settings } = {}) {
  let ajustes = settings;
  if (!ajustes) {
    try {
      const id = sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
      if (id) ajustes = await db.getSettings(id);
    } catch {}
  }
  return prefijoMostrar(usedPrefix, ajustes);
}
