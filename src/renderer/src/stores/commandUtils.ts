/**
 * 指令相关纯函数工具
 * 提取自 commandDataStore.ts，便于单元测试
 */

import { getCommandId as _getCommandId, type CommandIdLike } from '@shared/commandShared'

interface CommandLike extends CommandIdLike {
  path: string
  subType?: string
  [key: string]: any
}

/**
 * 生成指令唯一标识（与设置插件保持一致）
 * 格式: pluginName:featureCode:cmdName:cmdType
 */
export function getCommandId(cmd: CommandIdLike): string {
  return _getCommandId(cmd)
}

/**
 * 应用特殊指令配置
 * @param command 原始指令
 * @param specialCommands 特殊指令配置表
 * @returns 应用了特殊配置的指令
 */
export function applySpecialConfig<T extends CommandLike>(
  command: T,
  specialCommands: Record<string, Partial<T>>
): T {
  // 1. 优先通过 path 精确匹配
  const pathConfig = specialCommands[command.path]
  if (pathConfig) {
    return { ...command, ...pathConfig }
  }

  // 2. 通过 subType 匹配
  if (command.subType) {
    const subTypeKey = `subType:${command.subType}`
    const subTypeConfig = specialCommands[subTypeKey]
    if (subTypeConfig) {
      return { ...command, ...subTypeConfig }
    }
  }

  return command
}
