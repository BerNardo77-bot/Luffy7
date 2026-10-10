import { makeCommand, makeBefore } from '../../lib/nsfw-list.js'

export const before = makeBefore('xvideos')
export default makeCommand('xvideos', ['xvideos', 'xvideossearch', 'xvideoss'])
