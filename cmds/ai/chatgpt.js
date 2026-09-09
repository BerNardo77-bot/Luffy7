import { runAiChat } from './_helper.js'

export default {
  command: ['ia', 'chatgpt', 'gpt'],
  category: 'ai',
  run: async (ctx) => runAiChat({ ...ctx, label: 'ChatGPT', endpoint: 'chatgpt' })
}
