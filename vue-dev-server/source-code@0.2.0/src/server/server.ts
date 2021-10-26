/**
 * @description 本地开发服务器
 */
import { promises as fs } from 'fs'
import path from 'path'
import http, { Server } from 'http'
import url from 'url'
import WebSocket from 'ws'
import serve from 'serve-handler'
import { vueMiddleware } from './vueCompiler'
import { resolveModule } from './moduleResolver'
import { createFileWatcher } from './watcher'
import { sendJS } from './utils'
import { rewrite } from './moduleRewriter'

export interface ServerConfig {
  port?: number
  cwd?: string
}

export async function createServer({
  port = 3000,
  cwd = process.cwd()
}: ServerConfig = {}): Promise<Server> {
  // 客户端热更新相关的代码
  const hmrClientCode = await fs.readFile(path.resolve(__dirname, '../client/client.js'));

  // 创建服务器
  const server = http.createServer(async (req, res) => {
    const pathname = url.parse(req.url!).pathname!;
    if (pathname === '/__hmrClient') {
      // 如果用户请求的是热更新的相关文件，则返回该文件
      return sendJS(res, hmrClientCode);
    } else if (pathname.startsWith('/__modules/')) {
      // 如果用户请求的是三方依赖，则返回处理后的三方依赖（通过main和module指向入口）
      return resolveModule(pathname.replace('/__modules/', ''), cwd, res);
    } else if (pathname.endsWith('.vue')) {
      // 如果用户请求的是vue文件，则将其解析为js文件后返回
      return vueMiddleware(cwd, req, res);
    } else if (pathname.endsWith('.js')) {
      // 如果用户请求的是.js文件，则将裸模块改写路径后返回
      const filename = path.join(cwd, pathname.slice(1));
      try {
        const content = await fs.readFile(filename, 'utf-8');
        return sendJS(res, rewrite(content));
      } catch (e) {
        if (e.code === 'ENOENT') {
          // fallthrough to serve-handler
        } else {
          console.error(e);
        }
      }
    }

    serve(req, res, {
      public: cwd ? path.relative(process.cwd(), cwd) : '/',
      rewrites: [{ source: '**', destination: '/index.html' }],
    });
  });

  const wss = new WebSocket.Server({ server });
  const sockets = new Set<WebSocket>();

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'connected' }));
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  wss.on('error', (e: Error & { code: string }) => {
    if (e.code !== 'EADDRINUSE') {
      console.error(e);
    }
  });

  // 监听文件，并通过比对文件前后修改的差异判断本次的行为类型
  // 第二个参数是钩子函数，接受本次行为的类型和路径
  // payload: ServerNotification
  createFileWatcher(cwd, (payload) => sockets.forEach((s) => s.send(JSON.stringify(payload))));

  return new Promise((resolve, reject) => {
    server.on('error', (e: Error & { code: string }) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`port ${port} is in use, trying another one...`);
        setTimeout(() => {
          server.close();
          server.listen(++port);
        }, 100);
      } else {
        console.error(e);
        reject(e);
      }
    });

    server.on('listening', () => {
      console.log(`Running at http://localhost:${port}`);
      resolve(server);
    });

    server.listen(port);
  });
}
