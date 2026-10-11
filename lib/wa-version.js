// Versión de WhatsApp Web para Baileys. fetchLatestBaileysVersion() da una versión vieja
// (WhatsApp la rechaza y la conexión termina en 408 "Tiempo de conexión agotado").
// fetchLatestWaWebVersion() la lee de web.whatsapp.com; si falla, se usa la de Baileys.
import { fetchLatestWaWebVersion, fetchLatestBaileysVersion } from 'baileys'

let cache = null
export async function waVersion() {
  if (cache && Date.now() - cache.at < 30 * 60 * 1000) return cache.version
  try {
    const r = await fetchLatestWaWebVersion({ timeout: 15000 })
    if (Array.isArray(r?.version) && r.version[2]) { cache = { at: Date.now(), version: r.version }; return r.version }
  } catch (e) { console.error('[wa-version] web', e?.message || e) }
  const { version } = await fetchLatestBaileysVersion()
  return version
}
