// Búsqueda de TikTok con región MX / español: tikwm (region=MX), por el proxy LatAm (DL_PROXY/YT_PROXY)
// primero y directo si falla. tikwm está detrás de Cloudflare: desde IPs de datacenter suele dar 403,
// por eso el proxy ISP va primero. Si todo falla, #ttsearch usa la API alyacore como antes.
import axios from 'axios'
import { axiosOpts, dlProxyUrl, redact } from './dl-proxy.js'

export function ttRegion(env = process.env) {
  return { region: String(env.TT_SEARCH_REGION || 'MX').toUpperCase(), lang: String(env.TT_SEARCH_LANG || 'es') }
}

// tikwm → mismo formato que la API alyacore (id, title, author{unique_id,nickname}, cover, duration)
export function parseTikwm(json) {
  const vids = json?.data?.videos || []
  return vids.filter(v => v?.video_id || v?.id).map(v => ({
    id: String(v.video_id || v.id),
    title: String(v.title || '').trim(),
    author: { unique_id: v.author?.unique_id || '', nickname: v.author?.nickname || '' },
    url: v.author?.unique_id ? `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id || v.id}` : '',
    cover: v.cover || v.origin_cover || '',
    origin_cover: v.origin_cover || '',
    duration: Number(v.duration) || 0,
    region: v.region || '',
    play_count: v.play_count || 0,
    create_time: v.create_time || 0
  }))
}

async function once(query, useProxy, count) {
  const { region, lang } = ttRegion()
  const body = new URLSearchParams({ keywords: query, count: String(count), cursor: '0', HD: '1', region, web: '1' })
  const res = await axios.post('https://www.tikwm.com/api/feed/search', body.toString(), axiosOpts(useProxy, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': `${lang}-MX,${lang};q=0.9`,
      Origin: 'https://www.tikwm.com',
      Referer: 'https://www.tikwm.com/'
    },
    timeout: 15000,
    validateStatus: () => true
  }))
  if (res.status >= 400) throw new Error(`tikwm HTTP ${res.status}`)
  if (typeof res.data !== 'object' || res.data?.code !== 0) throw new Error(`tikwm: ${res.data?.msg || 'respuesta inválida'}`)
  const list = parseTikwm(res.data)
  if (!list.length) throw new Error('tikwm sin resultados')
  return list
}

export async function searchTiktokMx(query, count = 30) {
  const errs = []
  for (const useProxy of dlProxyUrl() ? [true, false] : [false]) {
    try {
      return await once(query, useProxy, count)
    } catch (e) {
      errs.push(`${useProxy ? 'proxy' : 'directo'}: ${redact(e?.message || e)}`)
    }
  }
  throw new Error(errs.join(' · '))
}
