import { runAiChat } from './_helper.js'

export default {
  command: ['gemini', 'geminis'],
  category: 'ai',
  run: async (ctx) => runAiChat({ ...ctx, label: 'Gemini', endpoint: 'gemini' })
}
