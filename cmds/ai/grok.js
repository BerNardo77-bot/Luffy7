import { runAiChat } from './_helper.js'

export default {
  command: ['grok'],
  category: 'ai',
  run: async (ctx) => runAiChat({ ...ctx, label: 'Grok', endpoint: 'grok' })
}
