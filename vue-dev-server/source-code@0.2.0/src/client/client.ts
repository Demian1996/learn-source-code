// This file runs in the browser.
import { HMRRuntime } from 'vue'

declare var __VUE_HMR_RUNTIME__: HMRRuntime

const socket = new WebSocket(`ws://${location.host}`)

// 监听dev-server推送的消息
// Listen for messages
socket.addEventListener('message', ({ data }) => {
  const { type, path, id, index } = JSON.parse(data)
  switch (type) {
    case 'connected':
      console.log(`[vds] connected.`)
      break
    case 'reload':
      import(`${path}?t=${Date.now()}`).then((m) => {
        __VUE_HMR_RUNTIME__.reload(path, m.default)
        console.log(`[vds] ${path} reloaded.`)
      })
      break
    case 'rerender':
      import(`${path}?type=template&t=${Date.now()}`).then((m) => {
        __VUE_HMR_RUNTIME__.rerender(path, m.render)
        console.log(`[vds] ${path} template updated.`)
      })
      break
    case 'style-update':
      console.log(`[vds] ${path} style${index > 0 ? `#${index}` : ``} updated.`)
      import(`${path}?type=style&index=${index}&t=${Date.now()}`)
      break
    case 'style-remove':
      const style = document.getElementById(`vue-style-${id}`)
      if (style) {
        style.parentNode!.removeChild(style)
      }
      break
    case 'full-reload':
      location.reload()
  }
})

// ping server
socket.addEventListener('close', () => {
  console.log(`[vds] server connection lost. polling for restart...`)
  setInterval(() => {
    new WebSocket(`ws://${location.host}`).addEventListener('open', () => {
      location.reload()
    })
  }, 1000)
})
