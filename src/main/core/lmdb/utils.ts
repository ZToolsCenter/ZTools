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
 * 比较两个版本号，与 CouchDB _rev 算法兼容
 * 格式: "N-hash"，先比较序列号（数字大的赢），同序则按 hash 字典序升序（更大的赢）
 * @returns 正数 = rev1 赢, 负数 = rev2 赢, 0 = 相同
 */
export function compareRevs(rev1: string | undefined, rev2: string | undefined): number {
  if (!rev1 && !rev2) return 0
  if (!rev1) return -1
  if (!rev2) return 1
  const [seq1Str, hash1 = ''] = rev1.split('-')
  const [seq2Str, hash2 = ''] = rev2.split('-')
  const s1 = parseInt(seq1Str, 10) || 0
  const s2 = parseInt(seq2Str, 10) || 0
  if (s1 !== s2) return s1 - s2
  if (hash1 < hash2) return -1
  if (hash1 > hash2) return 1
  return 0
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
    console.error('[LMDB] JSON parse error:', e)
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
    console.error('[LMDB] JSON stringify error:', e)
    return ''
  }
}
