// Filtro de duración en búsquedas: "+20min", "+1h", "-5min", "largo(s)" (= +10 min).
const UNIT = { s: 1, seg: 1, m: 60, min: 60, mins: 60, minutos: 60, h: 3600, hr: 3600, hora: 3600, horas: 3600 }

export function parseDurationFilter(raw) {
  let minSec = 0
  let maxSec = 0
  const keep = []
  for (const tok of String(raw || '').split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^([+-])(\d+(?:[.,]\d+)?)\s*(s|seg|m|min|mins|minutos|h|hr|hora|horas)?$/i)
    if (m) {
      const sec = Math.round(Number(m[2].replace(',', '.')) * (UNIT[(m[3] || 'min').toLowerCase()] || 60))
      if (m[1] === '+') minSec = Math.max(minSec, sec)
      else maxSec = maxSec ? Math.min(maxSec, sec) : sec
      continue
    }
    if (/^largos?$/i.test(tok)) { minSec = Math.max(minSec, 600); continue }
    keep.push(tok)
  }
  return { query: keep.join(' '), minSec, maxSec, active: !!(minSec || maxSec) }
}

export function fmtMin(sec) {
  return sec >= 3600 ? `${Math.floor(sec / 3600)} h${sec % 3600 ? ` ${Math.round((sec % 3600) / 60)} min` : ''}` : `${Math.round(sec / 60)} min`
}

export function filterLabel(f) {
  if (f.minSec && f.maxSec) return `entre ${fmtMin(f.minSec)} y ${fmtMin(f.maxSec)}`
  if (f.minSec) return `de más de ${fmtMin(f.minSec)}`
  if (f.maxSec) return `de menos de ${fmtMin(f.maxSec)}`
  return ''
}

// sec = 0 (desconocido) no pasa un filtro activo
export function passes(sec, f) {
  if (!f.active) return true
  if (!sec) return false
  if (f.minSec && sec < f.minSec) return false
  if (f.maxSec && sec > f.maxSec) return false
  return true
}

export const LONG_VARIANTS = ['completo', 'capítulo', 'episodio', 'película', 'parte']
