const vueCompiler = require('@vue/component-compiler')
const fs = require('fs')
const stat = require('util').promisify(fs.stat)
const root = process.cwd()
const path = require('path')
const parseUrl = require('parseurl')
const { transformModuleImports } = require('./transformModuleImports')
const { loadPkg } = require('./loadPkg')
const { readSource } = require('./readSource')

const defaultOptions = {
  cache: true
}

const vueMiddleware = (options = defaultOptions) => {
  // 缓存文件和缓存时间
  let cache
  let time = {}
  if (options.cache) {
    const LRU = require('lru-cache')

    cache = new LRU({
      max: 500,
      length: function (n, key) { return n * 2 + key.length }
    })
  }

  const compiler = vueCompiler.createDefaultCompiler()

  /**
   * @description 将处理后的文件返回给用户
   */
  function send(res, source, mime) {
    res.setHeader('Content-Type', mime)
    res.end(source)
  }

  /**
   * @description 往js和css代码块中注入sourcemap
   */
  function injectSourceMapToBlock (block, lang) {
    const map = Base64.toBase64(
      JSON.stringify(block.map)
    )
    let mapInject

    // 注入sourcemap
    switch (lang) {
      case 'js': mapInject = `//# sourceMappingURL=data:application/json;base64,${map}\n`; break;
      case 'css': mapInject = `/*# sourceMappingURL=data:application/json;base64,${map}*/\n`; break;
      default: break;
    }

    return {
      ...block,
      code: mapInject + block.code
    }
  }

  function injectSourceMapToScript (script) {
    return injectSourceMapToBlock(script, 'js')
  }

  function injectSourceMapsToStyles (styles) {
    return styles.map(style => injectSourceMapToBlock(style, 'css'))
  }
  
  async function tryCache (key, checkUpdateTime = true) {
    const data = cache.get(key)

    if (checkUpdateTime) {
      const cacheUpdateTime = time[key]
      // mtime 最后一次修改该文件的时间戳
      const fileUpdateTime = (await stat(path.resolve(root, key.replace(/^\//, '')))).mtime.getTime()
      // 如果最后一次修改时间比缓存的时间新，就不返回缓存
      if (cacheUpdateTime < fileUpdateTime) return null
    }

    return data
  }

  function cacheData (key, data, updateTime) {
    const old = cache.peek(key)

    if (old != data) {
      cache.set(key, data)
      if (updateTime) time[key] = updateTime
      return true
    } else return false
  }

  async function bundleSFC (req) {
    const { filepath, source, updateTime } = await readSource(req)

    // 具体转化效果见该文件末尾注释
    // 将源文件的每个块如template、script等转换为特定格式的描述文件
    const descriptorResult = compiler.compileToDescriptor(filepath, source)
    // 将描述文件注入sourcemap后，转换为js代码
    const assembledResult = vueCompiler.assemble(compiler, filepath, {
      ...descriptorResult,
      script: injectSourceMapToScript(descriptorResult.script),
      styles: injectSourceMapsToStyles(descriptorResult.styles)
    })
    return { ...assembledResult, updateTime }
  }

  return async (req, res, next) => {
    // 如果监听到用户访问.vue文件，则将其转为.js文件
    if (req.path.endsWith('.vue')) {      
      const key = parseUrl(req).pathname
      let out = await tryCache(key)

      // 如果该文件没有从缓存中取出，则重新bundle
      if (!out) {
        // Bundle Single-File Component
        const result = await bundleSFC(req)
        out = result
        // 缓存转换后的js文件
        cacheData(key, out, result.updateTime)
      }
      
      // 将js文件返回给用户
      send(res, out.code, 'application/javascript')
    } else if (req.path.endsWith('.js')) {
      // 如果用户访问的是.js文件，则将其裸模块依赖改写
      const key = parseUrl(req).pathname
      let out = await tryCache(key)

      if (!out) {
        // transform import statements
        const result = await readSource(req)
        out = transformModuleImports(result.source)
        cacheData(key, out, result.updateTime)
      }

      // 返回裸模块路径改写后的js文件
      send(res, out, 'application/javascript')
    } else if (req.path.startsWith('/__modules/')) {
      // 如果用户加载依赖文件
      const key = parseUrl(req).pathname
      const pkg = req.path.replace(/^\/__modules\//, '')

      // 直接使用缓存的依赖，不需要检查是否过期
      let out = await tryCache(key, false) // Do not outdate modules
      if (!out) {
        out = (await loadPkg(pkg)).toString()
        cacheData(key, out, false) // Do not outdate modules
      }

      send(res, out, 'application/javascript')
    } else {
      next()
    }
  }
}

exports.vueMiddleware = vueMiddleware


/**
 * @description compileToDescriptor转换效果
 */

/*
-----------------------test.vue文件-------------------------
<template>
  <div id="content">
    {{ message }}
  </div>
</template>

<script>
export default {
  data() {
    return {
      message: 'hello world',
    };
  },
};
</script>

<style scoped>
.content {
  font-size: 20px;
}
</style>

----------------------转换结果-----------------------------
{
  scopeId: 'data-v-dbaa6506',
  template: {
    functional: false,
    ast: {
      type: 1,
      tag: 'div',
      attrsList: [Array],
      attrsMap: [Object],
      rawAttrsMap: {},
      parent: undefined,
      children: [Array],
      plain: false,
      attrs: [Array],
      static: false,
      staticRoot: false
    },
    code: 'var render = function() {\n' +
      '  var _vm = this\n' +
      '  var _h = _vm.$createElement\n' +
      '  var _c = _vm._self._c || _h\n' +
      '  return _c("div", { attrs: { id: "content" } }, [\n' +
      '    _vm._v("\\n  " + _vm._s(_vm.message) + "\\n")\n' +
      '  ])\n' +
      '}\n' +
      'var staticRenderFns = []\n' +
      'render._withStripped = true\n',
    source: '\n<div id="content">\n  {{ message }}\n</div>\n',
    tips: [],
    errors: []
  },
  styles: [
    {
      media: undefined,
      scoped: true,
      moduleName: undefined,
      module: undefined,
      code: '\n.content[data-v-dbaa6506] {\n  font-size: 20px;\n}\n',
      map: [Object],
      errors: [],
      rawResult: [LazyResult]
    }
  ],
  script: {
    code: '//\n' +
      '//\n' +
      '//\n' +
      '//\n' +
      '//\n' +
      '//\n' +
      '\n' +
      'export default {\n' +
      '  data() {\n' +
      '    return {\n' +
      "      message: 'hello world',\n" +
      '    };\n' +
      '  },\n' +
      '};\n',
    map: {
      version: 3,
      sources: [Array],
      names: [],
      mappings: ';;;;;;;AAOA;AACA;AACA;AACA;AACA;AACA;AACA',
      file: '/Users/user/Desktop/wdz/Demos/vue-compiler-demo/test.vue',
      sourceRoot: '',
      sourcesContent: [Array]
    }
  },
  customBlocks: []
}
*/


/**
 * @description assemble的输出结果展示
 */

// {
//   code: '/* script */\n' +
//     '//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy91c2VyL0Rlc2t0b3Avd2R6L0RlbW9zL3Z1ZS1jb21waWxlci1kZW1vL3Rlc3QudnVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFPQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiIvVXNlcnMvdXNlci9EZXNrdG9wL3dkei9EZW1vcy92dWUtY29tcGlsZXItZGVtby90ZXN0LnZ1ZSIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyI8dGVtcGxhdGU+XG4gIDxkaXYgaWQ9XCJjb250ZW50XCI+XG4gICAge3sgbWVzc2FnZSB9fVxuICA8L2Rpdj5cbjwvdGVtcGxhdGU+XG5cbjxzY3JpcHQ+XG5leHBvcnQgZGVmYXVsdCB7XG4gIGRhdGEoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1lc3NhZ2U6ICdoZWxsbyB3b3JsZCcsXG4gICAgfTtcbiAgfSxcbn07XG48L3NjcmlwdD5cblxuPHN0eWxlIHNjb3BlZD5cbi5jb250ZW50IHtcbiAgZm9udC1zaXplOiAyMHB4O1xufVxuPC9zdHlsZT5cbiJdfQ==\n' +
//     '//\n' +
//     '//\n' +
//     '//\n' +
//     '//\n' +
//     '//\n' +
//     '//\n' +
//     '\n' +
//     'const __vue_script__ = {\n' +
//     '  data() {\n' +
//     '    return {\n' +
//     "      message: 'hello world',\n" +
//     '    };\n' +
//     '  },\n' +
//     '};\n' +
//     '\n' +
//     '/* template */\n' +
//     'var __vue_render__ = function() {\n' +
//     '  var _vm = this\n' +
//     '  var _h = _vm.$createElement\n' +
//     '  var _c = _vm._self._c || _h\n' +
//     '  return _c("div", { attrs: { id: "content" } }, [\n' +
//     '    _vm._v("\\n  " + _vm._s(_vm.message) + "\\n")\n' +
//     '  ])\n' +
//     '}\n' +
//     'var __vue_staticRenderFns__ = []\n' +
//     '__vue_render__._withStripped = true\n' +
//     '\n' +
//     '  /* style */\n' +
//     '  const __vue_inject_styles__ = function (inject) {\n' +
//     '    if (!inject) return\n' +
//     `    inject("data-v-dbaa6506_0", { source: "/*# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9Vc2Vycy91c2VyL0Rlc2t0b3Avd2R6L0RlbW9zL3Z1ZS1jb21waWxlci1kZW1vL3Rlc3QudnVlIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFpQkE7RUFDQSxlQUFBO0FBQ0EiLCJmaWxlIjoidGVzdC52dWUiLCJzb3VyY2VzQ29udGVudCI6WyI8dGVtcGxhdGU+XG4gIDxkaXYgaWQ9XCJjb250ZW50XCI+XG4gICAge3sgbWVzc2FnZSB9fVxuICA8L2Rpdj5cbjwvdGVtcGxhdGU+XG5cbjxzY3JpcHQ+XG5leHBvcnQgZGVmYXVsdCB7XG4gIGRhdGEoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1lc3NhZ2U6ICdoZWxsbyB3b3JsZCcsXG4gICAgfTtcbiAgfSxcbn07XG48L3NjcmlwdD5cblxuPHN0eWxlIHNjb3BlZD5cbi5jb250ZW50IHtcbiAgZm9udC1zaXplOiAyMHB4O1xufVxuPC9zdHlsZT5cbiJdfQ==*/\\n\\n.content[data-v-dbaa6506] {\\n  font-size: 20px;\\n}\\n", map: {"version":3,"sources":["/Users/user/Desktop/wdz/Demos/vue-compiler-demo/test.vue"],"names":[],"mappings":";AAiBA;EACA,eAAA;AACA","file":"test.vue","sourcesContent":["<template>\\n  <div id=\\"content\\">\\n    {{ message }}\\n  </div>\\n</template>\\n\\n<script>\\nexport default {\\n  data() {\\n    return {\\n      message: 'hello world',\\n    };\\n  },\\n};\\n</script>\\n\\n<style scoped>\\n.content {\\n  font-size: 20px;\\n}\\n</style>\\n"]}, media: undefined })\n` +
//     '\n' +
//     '  }\n' +
//     '  /* scoped */\n' +
//     '  const __vue_scope_id__ = "data-v-dbaa6506"\n' +
//     '  /* module identifier */\n' +
//     '  const __vue_module_identifier__ = undefined\n' +
//     '  /* functional template */\n' +
//     '  const __vue_is_functional_template__ = false\n' +
//     '  /* component normalizer */\n' +
//     '  function __vue_normalize__(\n' +
//     '    template, style, script,\n' +
//     '    scope, functional, moduleIdentifier, shadowMode,\n' +
//     '    createInjector, createInjectorSSR, createInjectorShadow\n' +
//     '  ) {\n' +
//     "    const component = (typeof script === 'function' ? script.options : script) || {}\n" +
//     '\n' +
//     '    // For security concerns, we use only base name in production mode.\n' +
//     '    component.__file = "/Users/user/Desktop/wdz/Demos/vue-compiler-demo/test.vue"\n' +
//     '\n' +
//     '    if (!component.render) {\n' +
//     '      component.render = template.render\n' +
//     '      component.staticRenderFns = template.staticRenderFns\n' +
//     '      component._compiled = true\n' +
//     '\n' +
//     '      if (functional) component.functional = true\n' +
//     '    }\n' +
//     '\n' +
//     '    component._scopeId = scope\n' +
//     '\n' +
//     '    if (true) {\n' +
//     '      let hook\n' +
//     '      if (false) {\n' +
//     '        // In SSR.\n' +
//     '        hook = function(context) {\n' +
//     '          // 2.3 injection\n' +
//     '          context =\n' +
//     '            context || // cached call\n' +
//     '            (this.$vnode && this.$vnode.ssrContext) || // stateful\n' +
//     '            (this.parent && this.parent.$vnode && this.parent.$vnode.ssrContext) // functional\n' +
//     '          // 2.2 with runInNewContext: true\n' +
//     "          if (!context && typeof __VUE_SSR_CONTEXT__ !== 'undefined') {\n" +
//     '            context = __VUE_SSR_CONTEXT__\n' +
//     '          }\n' +
//     '          // inject component styles\n' +
//     '          if (style) {\n' +
//     '            style.call(this, createInjectorSSR(context))\n' +
//     '          }\n' +
//     '          // register component module identifier for async chunk inference\n' +
//     '          if (context && context._registeredComponents) {\n' +
//     '            context._registeredComponents.add(moduleIdentifier)\n' +
//     '          }\n' +
//     '        }\n' +
//     '        // used by ssr in case component is cached and beforeCreate\n' +
//     '        // never gets called\n' +
//     '        component._ssrRegister = hook\n' +
//     '      }\n' +
//     '      else if (style) {\n' +
//     '        hook = shadowMode \n' +
//     '          ? function(context) {\n' +
//     '              style.call(this, createInjectorShadow(context, this.$root.$options.shadowRoot))\n' +
//     '            }\n' +
//     '          : function(context) {\n' +
//     '              style.call(this, createInjector(context))\n' +
//     '            }\n' +
//     '      }\n' +
//     '\n' +
//     '      if (hook !== undefined) {\n' +
//     '        if (component.functional) {\n' +
//     '          // register for functional component in vue file\n' +
//     '          const originalRender = component.render\n' +
//     '          component.render = function renderWithStyleInjection(h, context) {\n' +
//     '            hook.call(context)\n' +
//     '            return originalRender(h, context)\n' +
//     '          }\n' +
//     '        } else {\n' +
//     '          // inject component registration as beforeCreate hook\n' +
//     '          const existing = component.beforeCreate\n' +
//     '          component.beforeCreate = existing ? [].concat(existing, hook) : [hook]\n' +
//     '        }\n' +
//     '      }\n' +
//     '    }\n' +
//     '\n' +
//     '    return component\n' +
//     '  }\n' +
//     '  /* style inject */\n' +
//     '  function __vue_create_injector__() {\n' +
//     '    const styles = __vue_create_injector__.styles || (__vue_create_injector__.styles = {})\n' +
//     '    const isOldIE =\n' +
//     "      typeof navigator !== 'undefined' &&\n" +
//     '      /msie [6-9]\\\\b/.test(navigator.userAgent.toLowerCase())\n' +
//     '\n' +
//     '    return function addStyle(id, css) {\n' +
//     `      if (document.querySelector('style[data-vue-ssr-id~="' + id + '"]')) return // SSR styles are present.\n` +
//     '\n' +
//     "      const group = isOldIE ? css.media || 'default' : id\n" +
//     '      const style = styles[group] || (styles[group] = { ids: [], parts: [], element: undefined })\n' +
//     '\n' +
//     '      if (!style.ids.includes(id)) {\n' +
//     '        let code = css.source\n' +
//     '        let index = style.ids.length\n' +
//     '\n' +
//     '        style.ids.push(id)\n' +
//     '\n' +
//     '        if (false && css.map) {\n' +
//     '          // https://developer.chrome.com/devtools/docs/javascript-debugging\n' +
//     '          // this makes source maps inside style tags work properly in Chrome\n' +
//     "          code += '\\n/*# sourceURL=' + css.map.sources[0] + ' */'\n" +
//     '          // http://stackoverflow.com/a/26603875\n' +
//     '          code +=\n' +
//     "            '\\n/*# sourceMappingURL=data:application/json;base64,' +\n" +
//     '            btoa(unescape(encodeURIComponent(JSON.stringify(css.map)))) +\n' +
//     "            ' */'\n" +
//     '        }\n' +
//     '\n' +
//     '        if (isOldIE) {\n' +
//     "          style.element = style.element || document.querySelector('style[data-group=' + group + ']')\n" +
//     '        }\n' +
//     '\n' +
//     '        if (!style.element) {\n' +
//     "          const head = document.head || document.getElementsByTagName('head')[0]\n" +
//     "          const el = style.element = document.createElement('style')\n" +
//     "          el.type = 'text/css'\n" +
//     '\n' +
//     "          if (css.media) el.setAttribute('media', css.media)\n" +
//     '          if (isOldIE) {\n' +
//     "            el.setAttribute('data-group', group)\n" +
//     "            el.setAttribute('data-next-index', '0')\n" +
//     '          }\n' +
//     '\n' +
//     '          head.appendChild(el)\n' +
//     '        }\n' +
//     '\n' +
//     '        if (isOldIE) {\n' +
//     "          index = parseInt(style.element.getAttribute('data-next-index'))\n" +
//     "          style.element.setAttribute('data-next-index', index + 1)\n" +
//     '        }\n' +
//     '\n' +
//     '        if (style.element.styleSheet) {\n' +
//     '          style.parts.push(code)\n' +
//     '          style.element.styleSheet.cssText = style.parts\n' +
//     '            .filter(Boolean)\n' +
//     "            .join('\\n')\n" +
//     '        } else {\n' +
//     '          const textNode = document.createTextNode(code)\n' +
//     '          const nodes = style.element.childNodes\n' +
//     '          if (nodes[index]) style.element.removeChild(nodes[index])\n' +
//     '          if (nodes.length) style.element.insertBefore(textNode, nodes[index])\n' +
//     '          else style.element.appendChild(textNode)\n' +
//     '        }\n' +
//     '      }\n' +
//     '    }\n' +
//     '  }\n' +
//     '  /* style inject SSR */\n' +
//     '  \n' +
//     '  /* style inject shadow dom */\n' +
//     '  \n' +
//     '\n' +
//     '  \n' +
//     '  const __vue_component__ = /*#__PURE__*/__vue_normalize__(\n' +
//     '    { render: __vue_render__, staticRenderFns: __vue_staticRenderFns__ },\n' +
//     '    __vue_inject_styles__,\n' +
//     '    __vue_script__,\n' +
//     '    __vue_scope_id__,\n' +
//     '    __vue_is_functional_template__,\n' +
//     '    __vue_module_identifier__,\n' +
//     '    false,\n' +
//     '    __vue_create_injector__,\n' +
//     '    undefined,\n' +
//     '    undefined\n' +
//     '  )\n' +
//     '\n' +
//     '  export default __vue_component__',
//   map: {
//     version: 3,
//     sources: [ '/Users/user/Desktop/wdz/Demos/vue-compiler-demo/test.vue' ],
//     names: [],
//     mappings: ';;;;;;;;;AAQA,sBAAA;AACA;AACA;AACA;AACA;AACA',
//     sourcesContent: [
//       '<template>\n' +
//         '  <div id="content">\n' +
//         '    {{ message }}\n' +
//         '  </div>\n' +
//         '</template>\n' +
//         '\n' +
//         '<script>\n' +
//         'export default {\n' +
//         '  data() {\n' +
//         '    return {\n' +
//         "      message: 'hello world',\n" +
//         '    };\n' +
//         '  },\n' +
//         '};\n' +
//         '</script>\n' +
//         '\n' +
//         '<style scoped>\n' +
//         '.content {\n' +
//         '  font-size: 20px;\n' +
//         '}\n' +
//         '</style>\n'
//     ]
//   }
// }