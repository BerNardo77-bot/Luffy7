// Tope de duración para $ytvideo, $ytsearch (número), $tiktok, $ttsearch (número), $xnxx, $xvideos.
// Por defecto 120 min. La variable de entorno MAX_VIDEO_MIN solo puede SUBIRLO (si vale 60, se usa 120).
export const DEFAULT_VIDEO_MIN = 120
export function maxVideoMin(env = process.env) {
  const n = Number(env.MAX_VIDEO_MIN)
  return Number.isFinite(n) && n > 0 ? Math.max(n, DEFAULT_VIDEO_MIN) : DEFAULT_VIDEO_MIN
}
export const MAX_VIDEO_MIN = maxVideoMin()
export const MAX_VIDEO_SEC = MAX_VIDEO_MIN * 60
