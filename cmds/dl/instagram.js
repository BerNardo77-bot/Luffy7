import { downloadSocial } from '../../lib/social-dl.js'

export default {
  command: ["instagram", "ig", "reel"],
  category: "downloader",
  run: async ({ msg, sock, args }) => {
    if (!args.length) {
      return msg.reply("✎ Ingrese uno o varios enlaces de *Instagram*.")
    }
    const urls = args.filter(arg => arg.match(/instagram\.com\/(p|reel|reels|share|tv)\//))
    if (!urls.length) {
      return msg.reply("✿ El enlace no parece *válido*. Asegúrate de que sea de *Instagram*")
    }
    try {
      for (const url of urls.slice(0, 5)) {
        await downloadSocial({ msg, sock, url, endpoint: 'instagram', label: 'Instagram' })
      }
    } catch (e) {
      console.error('[ig]', e)
      await sock.reply(msg.chat, `《✧》 Error: ${e?.message || e}`, msg)
    }
  }
}
