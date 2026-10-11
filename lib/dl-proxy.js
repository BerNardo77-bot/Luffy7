// Luffy7 corre en el teléfono (IP de México): sin proxy. Mismas funciones que AndrewWife,
// pero todo va directo. Si algún día se configura DL_PROXY, se podría reemplazar este archivo.
export const dlProxyUrl = () => ''
export const axiosOpts = (_useProxy, opts = {}) => ({ ...opts })
export const ytDlpProxyArgs = () => []
export const redact = (s) => String(s ?? '')
export async function withProxyFallback(fn) { return fn(false) }
