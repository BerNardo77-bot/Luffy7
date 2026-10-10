// Tope de duración para #ytvideo, #ytsearch (número), #tiktok y #ttsearch (número).
// Variable de entorno MAX_VIDEO_MIN lo cambia (por defecto 60 min).
export function maxVideoMin(env = process.env) {
  const n = Number(env.MAX_VIDEO_MIN)
  return Number.isFinite(n) && n > 0 ? n : 60
}
export const MAX_VIDEO_MIN = maxVideoMin()
export const MAX_VIDEO_SEC = MAX_VIDEO_MIN * 60
