const fs = require('fs')
const path = require('path')
const readFile = require('util').promisify(fs.readFile)

/**
 * @description 加载三方依赖
 */
async function loadPkg(pkg) {
  // 如果是vue包，则返回相应的运行环境的文件
  if (pkg === 'vue') {
    const dir = path.dirname(require.resolve('vue'))
    const filepath = path.join(dir, 'vue.esm.browser.js')
    return readFile(filepath)
  }
  else {
    // TODO
    // check if the package has a browser es module that can be used
    // otherwise bundle it with rollup on the fly?
    throw new Error('npm imports support are not ready yet.')
  }
}

exports.loadPkg = loadPkg
