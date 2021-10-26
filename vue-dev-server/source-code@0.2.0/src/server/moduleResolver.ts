import path from 'path'
import resolve from 'resolve-from'
import { sendJSStream } from './utils'
import { ServerResponse } from 'http'

const fileToIdMap = new Map()

export function resolveModule(id: string, cwd: string, res: ServerResponse) {
  let modulePath: string
  let sourceMapPath: string | undefined = undefined
  // TODO support custom imports map e.g. for snowpack web_modules

  // 如果访问的是.map文件，则先保留该文件路径，然后将去掉.map后缀的id作为模块判断是否存在该模块
  // 若模块还未加载，则认为该模块的map文件加载失败
  if (id.endsWith('.map')) {
    sourceMapPath = id
    id = fileToIdMap.get(id.replace(/\.map$/, ''))
    if (!id) {
      res.statusCode = 404
      res.end()
      return
    }
  }

  // fallback to node resolve
  try {
    modulePath = resolve(cwd, `${id}/package.json`)
    if (id === 'vue') {
      modulePath = path.join(
        path.dirname(modulePath),
        'dist/vue.runtime.esm-browser.js'
      )
    } else {
      // module resolved, try to locate its "module" entry
      const pkg = require(modulePath)
      modulePath = path.join(path.dirname(modulePath), pkg.module || pkg.main)
      fileToIdMap.set(path.basename(modulePath), id)
      // this is a source map request.
      if (sourceMapPath) {
        modulePath = path.join(path.dirname(modulePath), sourceMapPath)
      }
    }

    sendJSStream(res, modulePath)
  } catch (e) {
    console.error(e)
    res.statusCode = 404
    res.end()
  }
}
