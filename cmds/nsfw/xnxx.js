import { makeCommand, makeBefore } from '../../lib/nsfw-list.js'

export const before = makeBefore('xnxx')
export default makeCommand('xnxx', ['xnxx', 'xnxxsearch', 'xnxxs'])
