const path = require('path')
const fs = require('fs')
const readFile = require('util').promisify(fs.readFile)
const stat = require('util').promisify(fs.stat)
const parseUrl = require('parseurl')
const root = process.cwd()

/**
 * @description 给定文件资源，返回文件路径、文件数据和最后一次修改的时间
 */
async function readSource(req) {
  const { pathname } = parseUrl(req)
  const filepath = path.resolve(root, pathname.replace(/^\//, ''))
  
  return {
    filepath,
    source: await readFile(filepath, 'utf-8'),
    updateTime: (await stat(filepath)).mtime.getTime()
  }
}

exports.readSource = readSource
