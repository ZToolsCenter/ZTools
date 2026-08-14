#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WAKE_ARG = '--ztools-wake'
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// ESM 模块没有全局 require，用 createRequire 桥接以解析本地 electron 依赖。
const require = createRequire(import.meta.url)

/**
 * 定位 ZTools 可执行文件。
 *
 * 优先使用 ZTOOLS_BIN 环境变量；其次探测常见打包安装位置；
 * 最后回退到开发环境中的 electron 二进制。
 *
 * @returns 可执行文件绝对路径；找不到时返回 null。
 */
function resolveZToolsBinary() {
  if (process.env.ZTOOLS_BIN) return process.env.ZTOOLS_BIN

  const candidates = []
  if (process.platform === 'darwin') {
    candidates.push('/Applications/ZTools.app/Contents/MacOS/ZTools')
  } else if (process.platform === 'linux') {
    candidates.push('/opt/ZTools/ztools')
    candidates.push('/opt/ZTools/ZTools')
    candidates.push('/usr/lib/ztools/ztools')
  } else if (process.platform === 'win32') {
    candidates.push(path.join(projectRoot, 'dist', 'win-unpacked', 'ZTools.exe'))
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  // 开发环境：使用项目本地的 electron 二进制（需要先构建 out/main）。
  try {
    return require.resolve('electron')
  } catch {
    return null
  }
}

function printHelp() {
  console.log(`用法: ztools [选项]

唤起已运行的 ZTools 实例并显示主窗口；如果应用尚未运行则先启动。

选项:
  --help    显示本帮助信息

环境变量:
  ZTOOLS_BIN  指定 ZTools 可执行文件路径（打包后的应用或 electron 二进制）`)
}

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  printHelp()
  process.exit(0)
}

const binary = resolveZToolsBinary()
if (!binary) {
  console.error(
    '未找到 ZTools 可执行文件。请先执行 pnpm build 构建应用，或通过 ZTOOLS_BIN 指定二进制路径。'
  )
  process.exit(1)
}

// 开发环境使用本地 electron，需要把项目目录作为应用入口传入；
// 打包后的二进制则直接携带唤醒参数启动。
const launchArgs = binary.includes('electron') ? [projectRoot, WAKE_ARG] : [WAKE_ARG]

console.log(`[ztools] 启动唤醒进程: ${binary}`)
const child = spawn(binary, launchArgs, {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
})
child.unref()
process.exit(0)
