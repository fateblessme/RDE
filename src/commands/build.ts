import Base from '../base'
import _ from '../util'

import Run from './run'

export default class Build extends Base {
  public static examples = [
    '$ rde build',
  ]

  public static flags = {
    ...Base.flags,
    ...Run.flags,
  }

  public async run() {
    const {flags} = this.parse(Build)

    const list = _.restoreFlags(flags)

    await _.asyncExec('rm -rf .rde')
    await Run.run(['build', ...list])
  }
}
