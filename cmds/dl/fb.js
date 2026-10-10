import { downloadSocial } from '../../lib/social-dl.js'

export default {
  command: ['fb', 'facebook'],
  category: 'downloader',
  run: async ({ msg, sock, args }) => {
    if (!args.length) {
      return msg.reply('✎ Ingrese uno o varios enlaces de *Facebook*')
    }
    const urls = args.filter(arg => arg.match(/facebook\.com|fb\.watch|video\.fb\.com/))
    if (!urls.length) {
      return msg.reply('✿ Por favor, envía un link de Facebook válido')
    }
    try {
      for (const url of urls.slice(0, 5)) {
        await downloadSocial({ msg, sock, url, endpoint: 'facebookv2', label: 'Facebook' })
      }
    } catch (e) {
      console.error('[fb]', e)
      await msg.reply(`《✧》 Error: ${e?.message || e}`).catch(() => {})
    }
  }
}
