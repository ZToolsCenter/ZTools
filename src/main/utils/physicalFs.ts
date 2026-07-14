/**
 * ASAR 实体文件操作入口。
 *
 * Electron 的普通 `fs` 会把 `.asar` 当作虚拟目录，适合读取插件内容；
 * 安装、替换和删除归档实体时必须使用 `original-fs`，避免修改进程级开关。
 */

import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * 安装器专用的物理文件系统。
 * 普通 Node 测试没有 `original-fs`，仅在 Electron 进程中按需加载。
 */
export const physicalFs: typeof nodeFs = process.versions.electron
  ? (require('original-fs') as typeof nodeFs)
  : nodeFs
