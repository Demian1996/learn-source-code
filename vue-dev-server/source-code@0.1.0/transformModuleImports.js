const recast = require('recast')
const isPkg = require('validate-npm-package-name')

/**
 * @description 将代码转为ast，然后解析裸模块，并将其source改写为__modules/${source}
 */
function transformModuleImports(code) {
  const ast = recast.parse(code)
  recast.types.visit(ast, {
    visitImportDeclaration(path) {
      const source = path.node.source.value
      if (!/^\.\/?/.test(source) && isPkg(source)) {
        path.node.source = recast.types.builders.literal(`/__modules/${source}`)
      }
      this.traverse(path)
    }
  })
  return recast.print(ast).code
}

exports.transformModuleImports = transformModuleImports
