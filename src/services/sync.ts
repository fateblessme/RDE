import * as deepExtend from 'deep-extend'
import * as fs from 'fs'
import * as path from 'path'
import * as writePkg from 'write-pkg'

import conf from '../services/conf'
import docker from '../services/docker'
import _ from '../util'

import ide from './ide'
import {MRDA} from './message'
import render from './render'

const {resolve, join} = path
const {
  RdTypes,
  rdcConfName,
  dockerWorkDirRoot,
} = conf

class Sync {
  public get appConf(): AppConf {
    return require(resolve(conf.cwd, conf.appConfName))
  }

  public get from() {
    if (conf.isApp) {
      const {container} = conf.getAppConf()
      return container.name
    }

    if (conf.rdType === RdTypes.Container) {
      const rdcConfPath = resolve(conf.cwd, rdcConfName)
      const rdcConf = require(rdcConfPath)

      return rdcConf.nodeVersion || 'node:latest'
    }
  }

  public get ports() {
    if (conf.isApp) {
      const {docker} = conf.getAppConf()
      return docker.ports || []
    }

    if (conf.rdType === RdTypes.Container) {
      const rdcConf = require(join(conf.cwd, conf.rdcConfName))
      return rdcConf.docker.ports || []
    }
  }

  /**
   * sync all
   * used for local dev env, resync is needed when container updates
   * 1. generate Dockerfile to local .cache
   * 2. generate docker-compose to local .cache
   *
   * if rdType is app
   * need to gen extra staged files
   */
  public async start({watch, cmd, skipInstall = false}) {
    if (conf.isApp) {
      await this.genAppStagedFiles()
    }

    await docker.genDockerFile(
      conf.dockerWorkDirRoot,
      this.from,
      conf.localCacheDir,
      conf.isApp,
    )

    // @TODO: docker-compose merge
    // needed in order to let container developer write multiple services like mongo
    await docker.genDockerCompose(
      conf.dockerWorkDirRoot,
      cmd,
      this.ports,
      watch,
      `dev-${conf.tag}`,
      conf.localCacheDir,
      conf.isApp,
      cmd === 'build',
    )

    await ide.initSettings(conf.isApp)

    if (!skipInstall) {
      await this.install()
    }
  }

  /**
   * 1. copy rdc/package.json to .cache/package.json
   * 2. copy rdc/rdc.config.js to .cache/rdc.config.js
   * 3. add suite to package.json
   * 4. merge app optional pkg.json & rdc package.json
   */
  public async genAppStagedFiles(createRdc = null) {
    const {
      cwd,
      rdcConfName,
      dockerWorkDirRoot,
      templateDir,
      localCacheDir,
    } = conf

    // only create application will pass rdc param
    const image = createRdc || this.appConf.container.name
    await docker.copy(image, [{
      from: resolve(dockerWorkDirRoot, templateDir, 'package.json'),
      to: localCacheDir,
    }, {
      from: resolve(dockerWorkDirRoot, templateDir),
      to: cwd
    }, {
      from: resolve(dockerWorkDirRoot, rdcConfName),
      to: localCacheDir,
    }])

    if (!createRdc) {
      await this.mergePkgJson(
        resolve(cwd, 'package.json'),
        resolve(cwd, localCacheDir, 'package.json'),
        resolve(localCacheDir),
      )
    }

    await this.genDevcontainer(createRdc)
  }

  public async genDevcontainer(createRdc) {
    const rdcConfPath = resolve(conf.localCacheDir, rdcConfName)
    const rdcConf: RdcConf = require(rdcConfPath)

    const map = {
      devcontainer: 'devcontainer.json',
      'docker-compose': 'docker-compose.yml',
      Dockerfile: 'Dockerfile',
    }

    const from = createRdc || this.from
    rdcConf.docker = rdcConf.docker || {}
    const ports = createRdc ? rdcConf.docker.ports || [] : this.ports
    const exportFiles = rdcConf.mappings.map(item => item.from) || []
    const extensions = rdcConf.extensions || []

    for (let [key, value] of Object.entries(map)) {
      await render.renderTo(`devcontainer/${key}`, {
        tag: conf.tag,
        workDir: dockerWorkDirRoot,
        extensions: JSON.stringify(extensions),
        from,
        ports,
        exportFiles,
      }, resolve(conf.cwd, '.devcontainer', value), {
        overwrite: true,
      })
    }
  }

  public async mergePkgJson(appPkgPath, rdcPkgPath, destPath) {
    let pkgJson = require(rdcPkgPath)
    this.appConf.suites.map(item => {
      pkgJson.dependencies = pkgJson.dependencies || {}
      pkgJson.dependencies[item.name] = item.version
    })

    if (
      fs.existsSync(appPkgPath) &&
      fs.statSync(appPkgPath).isFile()
    ) {
      const appPkgJson = require(appPkgPath)

      deepExtend(pkgJson, appPkgJson)
    }

    await writePkg(destPath, pkgJson)
  }

  public async install() {
    const {
      cwd,
      RdTypes,
      templateDir,
      localCacheDir,
    } = conf

    if (conf.isApp) {
      const cachePkgJsonPath = resolve(localCacheDir, 'package.json')
      if (!fs.existsSync(cachePkgJsonPath)) {
        throw Error(MRDA.NO_PKG_IN_CACHE_DIR)
      }

      const symPkgJsonPath = resolve(cwd, 'package.json')
      fs.symlinkSync(cachePkgJsonPath, symPkgJsonPath)
      await _.asyncSpawn('npm', ['i', '--package-lock', 'false'], {
        cwd,
      })
      fs.unlinkSync(symPkgJsonPath)
    }

    if (conf.rdType === RdTypes.Container) {
      const runtimePkgJsonPath = resolve(templateDir, 'package.json')
      const symPkgJsonPath = resolve(cwd, 'package.json')
      fs.symlinkSync(runtimePkgJsonPath, symPkgJsonPath)
      await _.asyncSpawn('npm', ['i', '--package-lock', 'false'], {
        cwd,
      })
      fs.unlinkSync(symPkgJsonPath)
    }
  }
}
export default new Sync()