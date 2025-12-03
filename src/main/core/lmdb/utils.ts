import crypto from 'crypto'
import { DbResult } from './types'

/**
 * 生成新的文档版本号
 * 格式: 序列号-哈希值 (例如: "1-abc123", "2-def456")
 * @param existingRev 已存在的版本号
 * @returns 新的版本号
 */
export function generateNewRev(existingRev?: string): string {
  let sequence = 1

  if (existingRev) {
    const parts = existingRev.split('-')
    if (parts.length >= 2) {
      const currentSeq = parseInt(parts[0], 10)
      if (!isNaN(currentSeq)) {
        sequence = currentSeq + 1
      }
    }
  }

  const hash = crypto.randomBytes(16).toString('hex')
  return `${sequence}-${hash}`
}

/**
 * 创建错误结果对象
 * @param name 错误名称
 * @param message 错误消息
 * @param id 文档 ID（可选）
 * @returns DbResult 错误对象
 */
export function createErrorResult(name: string, message: string, id?: string): DbResult {
  const result: DbResult = {
    id: id || '',
    error: true,
    name,
    message
  }
  return result
}

/**
 * 创建成功结果对象
 * @param id 文档 ID
 * @param rev 文档版本号（可选）
 * @returns DbResult 成功对象
 */
export function createSuccessResult(id: string, rev?: string): DbResult {
  const result: DbResult = {
    id,
    ok: true
  }
  if (rev) {
    result.rev = rev
  }
  return result
}

/**
 * 验证文档 ID 是否有效
 * @param id 文档 ID
 * @returns 是否有效
 */
export function isValidDocId(id: any): boolean {
  return typeof id === 'string' && id.length > 0
}

/**
 * 检查文档大小是否超过限制
 * @param doc 文档对象
 * @param maxSize 最大大小（字节），默认 1MB
 * @returns 是否超过限制
 */
export function isDocSizeExceeded(doc: any, maxSize: number = 1024 * 1024): boolean {
  const docStr = JSON.stringify(doc)
  const size = Buffer.byteLength(docStr, 'utf8')
  return size > maxSize
}

/**
 * 安全的 JSON 解析
 * @param str JSON 字符串
 * @returns 解析后的对象，失败返回 null
 */
export function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str)
  } catch (e) {
    console.error('JSON parse error:', e)
    return null
  }
}

/**
 * 安全的 JSON 字符串化
 * @param obj 对象
 * @returns JSON 字符串，失败返回空字符串
 */
export function safeJsonStringify(obj: any): string {
  try {
    return JSON.stringify(obj)
  } catch (e) {
    console.error('JSON stringify error:', e)
    return ''
  }
}
