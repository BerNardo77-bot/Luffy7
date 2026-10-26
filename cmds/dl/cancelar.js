// cancelar / pausar / continuar la descarga en curso de quien lo manda
import { controlCommand, CONTROL_COMMANDS } from '../../lib/dl-control-wa.js'

export default {
  command: CONTROL_COMMANDS,
  category: 'downloader',
  run: async (ctx) => controlCommand(ctx)
}
