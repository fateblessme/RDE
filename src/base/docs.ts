import Command from '@oclif/command/lib/command'
import * as flags from '@oclif/command/lib/flags'
import * as dirTree from 'directory-tree'
import * as fs from 'fs'
import * as path from 'path'
import * as copy from 'recursive-copy'
import * as rimraf from 'rimraf'
import * as through from 'through2'

import conf from '../services/conf'
import {logger} from '../services/logger'
import mdIt from '../services/markdown'
import {MCOMMON, MDOCS} from '../services/message'
import render from '../services/render'
import { TError, TStart } from '../services/track'

const {resolve, join} = path
const {RdTypes} = conf
export default abstract class DocsBase extends Command {
  public static flags = {
    verbose: flags.boolean({char: 'v', required: false, description: 'show verbose logs'}),
  }

  public static excludeDirRule = /^_docs\/[^\/]+\/(?!([^\/]*\.md$))+/

  public pages: DocPageRoute[]

  public localConfig: RdcConf | RdsConf

  public verbose = false

  public get navs() {
    const navs = [
      {title: '文档', main: true},
      {title: 'FAQ', url: '/FAQ.html'},
      {title: '日志', url: '/changelog.html'},
    ]

    if (conf.rdType === RdTypes.Container) {
      const nav = {title: '速查', url: '/cheatSheet.html'}
      navs.splice(1, 0, nav)
      return navs
    }

    return navs
  }

  public get userStyles() {
    const {docs} = this.localConfig
    return docs.userStyles || []
  }

  public get userScripts() {
    const {docs} = this.localConfig
    return docs.userScripts || []
  }

  public get frameworkScripts() {
    const {framework = 'vue'} = this.localConfig

    if (!conf.frameworks[framework]) {
      throw Error(MCOMMON.UNSUPPORTED_FRAMEWORK)
    }

    const {cdn = []} = conf.frameworks[framework]

    let scripts = ''
    cdn.forEach(url => {
      scripts += `<script src="${url}"><script>`
    })

    return scripts
  }

  public get options() {
    return {
      overwrite: true,

      rename(filePath) {
        if (filePath.endsWith('.md')) {
          const dirname = path.dirname(filePath)
          const filename = path.basename(filePath, '.md')
          return join(dirname, `${filename}.html`)
        }
        return filePath
      },

      filter(src) {
        src = join(conf.docsDir, src)
        if (DocsBase.excludeDirRule.test(src)) {
          return false
        }

        return true
      },

      transform: () => {
        return through((chunk, _enc, done) => {
          const content = mdIt.render(chunk.toString())

          const {loadTemplate: load} = render
          const index = load('docs/index')
          const style = load('docs/style')
          const layout = load('docs/layout')

          const output = render.render(index, {
            title: 'RDE',
            content,
            navs: JSON.stringify(this.navs),
            pages: JSON.stringify(this.pages),
            userStyles: this.userStyles,
            userScripts: this.userScripts,
          }, ['<%', '%>'], {
            style,
            layout,
            frameworkScripts: this.frameworkScripts,
          })

          done(null, output)
        })
      }
    }
  }

  @TError({ conf })
  @TStart
  public async init() {
    // @ts-ignore
    const {flags} = this.parse(this.constructor)
    this.verbose = flags.verbose

    const {appConfPath, rdcConfPath, RdTypes} = conf
    if (fs.existsSync(appConfPath)) {
      conf.rdType = RdTypes.Application
    } else if (fs.existsSync(rdcConfPath)) {
      conf.rdType = RdTypes.Container
    }

    if (!conf.rdType) {
      throw Error(MDOCS.UNRECOGNIZED)
    }

    if (!fs.existsSync(conf.docsDir)) {
      throw Error(MDOCS.MISSING_DOCS_DIR)
    }

    const homepagePath = resolve(conf.docsDir, 'index.md')
    const faqPath = resolve(conf.docsDir, 'faq.md')

    if (!fs.existsSync(homepagePath) || !fs.existsSync(faqPath)) {
      throw Error(MDOCS.MISSING_REQUIRED_MD)
    }

    if (conf.rdType === RdTypes.Container) {
      this.localConfig = require(rdcConfPath)
    } else {
      this.localConfig = require(appConfPath)
    }

    this.pages = this.getPages()

    await this.render()

    process.on('SIGINT', () => {
      rimraf.sync(conf.docsPagesDir)
      process.exit()
    })
  }

  public async postRun() {}

  public async catch(e) {
    if (this.verbose) {
      logger.error(e)
    } else {
      logger.error(e.message)
    }
    this.exit(1)
  }

  public async finally(e: any) {
    if (!e) {
      await this.postRun()
    }
  }

  public getPages() {
    const pages: DocPageRoute[] = []

    const files = dirTree(conf.docsDir, {
      extensions: /\.md$/,
      exclude: DocsBase.excludeDirRule,
    })

    files.children.forEach(file => {
      if (file.type === 'file') {
        let content = fs.readFileSync(file.path).toString()
        mdIt.render(content)
        const {meta = {}} = mdIt

        pages.push({
          title: meta.title || file.name,
          url: `/${file.name.slice(0, -3)}.html`
        })
      }

      if (file.type === 'directory') {
        let category
        const page = {
          title: file.name,
          children: file.children.map(child => {
            let content = fs.readFileSync(child.path).toString()
            mdIt.render(content)
            const {meta = {}} = mdIt

            if (meta.category) {
              category = meta.category
            }

            return {
              title: meta.title || child.name,
              url: `/${file.name}/${child.name.slice(0, -3)}.html`
            }
          })
        }
        page.title = category || file.name
        pages.push(page)
      }
    })

    return pages
  }

  public async render(): Promise<any> {
    const {docsDir, docsPagesDir} = conf

    await copy(docsDir, docsPagesDir, this.options)
  }
}
