// @ts-ignore
import cli from 'cli-ux'
import * as fs from 'fs'
import * as inquirer from 'inquirer'
import * as path from 'path'
// @ts-ignore
import * as copy from 'recursive-copy'
// @ts-ignore
import * as writePkgJson from 'write-pkg'

import Base from '../../base'
import {logger} from '../../services/logger'
import npm from '../../services/npm'
import render from '../../services/render'
import _ from '../../util'

export default class Create extends Base {
  static description = 'create a rde template project'

  static examples = [
    '$ rde template:create <rdtname>',
  ]

  static args = [{
    name: 'rdtName',
    required: true,
    description: 'rde template project name, used by package.json',
  }]

  public rdtName = ''

  public rdtStarter = ''

  public framework = ''

  public byExtend = false

  get rdtPkgDir() {
    return path.resolve(this.cwd, 'node_modules', this.rdtName)
  }

  public async preInit() {
    const {args} = this.parse(Create)
    const {rdtName} = args

    this.rdtName = rdtName.includes('rdt-') ? rdtName : `rdt-${rdtName}`

    if (fs.existsSync(this.rdtName)) {
      throw Error(`Directory ${this.rdtName} already exist`)
    }

    if (await npm.getInfo(this.rdtName)) {
      throw Error(`Module ${this.rdtName} already exist, please use another name and try again`)
    }

    return args
  }

  public async initialize() {
    await this.ask()
  }

  public async preRun() {
    await _.asyncExec(`mkdir ${this.rdtName}`)
    process.chdir(this.rdtName)

    await writePkgJson({name: this.rdtName})
    await npm.install(this.rdtStarter, false)
    await _.asyncExec('rm package*.json')

    const {resolve} = path
    if (this.byExtend) {
      const srcDir = resolve(this.mustachesDir, 'rde.template')
      await render.renderDir(srcDir, {
        parentRdtName: this.rdtStarter,
        framework: this.framework,
      }, ['.mustaches'], this.cwd)

    } else {
      await copy(this.rdtPkgDir, this.cwd, {overwrite: true})
      await copy(resolve(this.rdtPkgDir, '.npmignore'), resolve(this.cwd, '.gitignore'), {overwrite: true})

      this.renderPkgJson()
    }
  }

  renderPkgJson() {
    const json = require(path.resolve(this.cwd, 'package.json'))
    json.name = this.rdtName
    json.description = 'This is a rde-template, powered by rde'
    json.keywords = ['@rede/rdt', `${this.framework}`]

    Object.keys(json).forEach(key => {
      if (key[0] === '_') {
        delete json[key]
      }
    })

    writePkgJson(json)
  }

  async run() {
  }

  public async ask() {
    const {framework, byExtend} = await inquirer.prompt([{
      name: 'framework',
      message: 'select a framework',
      type: 'list',
      choices: Object.keys(this.frameworks).map(name => ({name}))
    }, {
      name: 'byExtend',
      message: 'do you want to extend an existing rdt template? (Y/N)',
      type: 'confirm',
      default: false,
    }])

    this.framework = framework
    this.byExtend = byExtend

    if (byExtend) {
      this.rdtStarter = await this.askParentRdt()
    } else {
      this.rdtStarter = this.frameworks[framework].rdtStarter
    }
  }

  public async askParentRdt() {
    let parentRdtName = await cli.prompt('parent rdt pkg name: ', {
      required: true,
    })

    if (!(await npm.getInfo(parentRdtName))) {
      logger.error(`package ${parentRdtName} does not exist in npm repo, please check`)
      parentRdtName = this.askParentRdt()
    }

    return parentRdtName
  }

  public async postRun() {
    logger.complete('Created project')
    logger.star('Start with command:')
    logger.star('$ rde template:serve')
  }
}
