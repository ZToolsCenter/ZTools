/**
 * 访问 ASAR 实体文件时使用的文件系统。
 * Electron 的普通 fs 会把 `.asar` 当作虚拟目录；安装器需要直接移动、删除归档文件。
 */
import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const physicalFs: typeof nodeFs = process.versions.electron
  ? (require('original-fs') as typeof nodeFs)
  : nodeFs
