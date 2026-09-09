import { runAiChat } from './_helper.js'

export default {
  command: ['deepseek', 'ds'],
  category: 'ai',
  run: async (ctx) => runAiChat({ ...ctx, label: 'DeepSeek', endpoint: 'deepseek' })
}
