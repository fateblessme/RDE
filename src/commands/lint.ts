import Base from '../base'
import _ from '../util'

import Run from './run'

export default class Lint extends Base {
  public static strict = false

  public static examples = [
    '$ rde lint',
  ]

  public static flags = {
    ...Base.flags,
    ...Run.flags,
  }

  public async run() {
    const {flags} = this.parse(Lint)

    const list = _.restoreFlags(flags)

    await Run.run(['lint', ...list])
  }
}