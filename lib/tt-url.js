// Enlaces de TikTok, incluidos los cortos para compartir (tt.site, vm./vt.tiktok.com, tiktok.com/t/, tiktokv.com).
// resolveTiktokUrl sigue las redirecciones hasta https://www.tiktok.com/@usuario/video/ID.
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
export const TT_HOST_RE = /(?:^|\.)(?:tiktok\.com|tiktokv\.com|tt\.site)$/i
export const TT_URL_RE = /(?:https?:\/\/)?(?:[\w-]+\.)*(?:tiktok\.com|tiktokv\.com|tt\.site)\/[^\s<>"']*/gi
export function isTiktokUrl(s) {
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return TT_HOST_RE.test(u.hostname) } catch { return false }
}
export function findTiktokUrls(text) {
  return (String(text || '').match(TT_URL_RE) || []).map((u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u).replace(/[).,]+$/, ''))
}
const CANON = /tiktok\.com\/@[\w.-]+\/(?:video|photo)\/\d+/i
export async function resolveTiktokUrl(url) {
  url = (/^https?:\/\//i.test(url) ? url : 'https://' + url).trim()
  if (CANON.test(url)) return url.split('?')[0]
  let cur = url
  for (let i = 0; i < 8; i++) {
    let res
    try {
      res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
    } catch { break }
    try { await res.body?.cancel?.() } catch {}
    const loc = res.headers.get('location')
    if (!loc) break
    cur = new URL(loc, cur).toString()
    if (CANON.test(cur)) return cur.split('?')[0]
  }
  const m = cur.match(/\/video\/(\d{8,25})/)
  return m && !CANON.test(cur) ? `https://www.tiktok.com/@_/video/${m[1]}` : cur
}
