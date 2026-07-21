/**
 * 命令上下文匹配所需的最小文件输入结构。
 */
export interface PastedFileLike {
  path?: string
  name: string
  isDirectory: boolean
}

/**
 * 命令上下文匹配所需的最小窗口信息结构。
 */
export interface WindowInfoLike {
  app?: string
  title?: string
  className?: string
}

/**
 * Regex 类型命令的最小字段集合。
 */
export interface RegexCmdLike {
  type: 'regex'
  label?: string
  match?: string
  regex?: string
  minLength?: number
}

/**
 * Over 类型命令的最小字段集合。
 */
export interface OverCmdLike {
  type: 'over'
  label?: string
  exclude?: string
  minLength?: number
  maxLength?: number
}

/**
 * Files 类型命令的最小字段集合。
 */
export interface FilesCmdLike {
  type: 'files'
  label?: string
  fileType?: 'file' | 'directory'
  extensions?: string[]
  match?: string
  minLength?: number
  maxLength?: number
}

/**
 * Window 类型命令的最小字段集合。
 */
export interface WindowCmdLike {
  type: 'window'
  label?: string
  match: {
    app?: string[]
    title?: string
    className?: string[]
  }
}

/**
 * 可参与上下文匹配的命令联合类型。
 */
export type MatchCmdLike = RegexCmdLike | OverCmdLike | FilesCmdLike | WindowCmdLike

/**
 * 解析命令匹配中使用的 pattern，兼容是否保留 flags 和普通字符串回退。
 */
export function parseMatchPattern(
  pattern?: string,
  options: {
    preserveFlags?: boolean
    allowPlainString?: boolean
  } = {}
): RegExp | null {
  if (!pattern) {
    return null
  }

  try {
    const slashMatch = pattern.match(/^\/(.+)\/([gimuy]*)$/)
    if (slashMatch) {
      const flags = options.preserveFlags ? slashMatch[2] : ''
      return new RegExp(slashMatch[1], flags)
    }

    if (options.allowPlainString) {
      return new RegExp(pattern)
    }
  } catch {
    return null
  }

  return null
}

/**
 * 判断 regex 类型命令是否匹配指定文本。
 */
export function matchesRegexText(
  text: string,
  cmd: RegexCmdLike,
  options: {
    preserveFlags?: boolean
  } = {}
): boolean {
  if (!text) {
    return false
  }

  const minLength = cmd.minLength ?? 1
  if (text.length < minLength) {
    return false
  }

  const regex = parseMatchPattern(cmd.match ?? cmd.regex, {
    preserveFlags: options.preserveFlags
  })
  return regex ? regex.test(text) : false
}

/**
 * 判断 over 类型命令是否匹配指定文本。
 */
export function matchesOverText(
  text: string,
  cmd: OverCmdLike,
  options: {
    useExclude?: boolean
    preserveExcludeFlags?: boolean
    allowPlainExclude?: boolean
  } = {}
): boolean {
  if (!text) {
    return false
  }

  const minLength = cmd.minLength ?? 1
  const maxLength = cmd.maxLength ?? 10000
  if (text.length < minLength || text.length > maxLength) {
    return false
  }

  if (options.useExclude && cmd.exclude) {
    const excludeRegex = parseMatchPattern(cmd.exclude, {
      preserveFlags: options.preserveExcludeFlags,
      allowPlainString: options.allowPlainExclude
    })
    if (excludeRegex?.test(text)) {
      return false
    }
  }

  return true
}

/**
 * 判断 files 类型命令是否匹配指定文件输入。
 */
export function matchesFilesInput(
  files: PastedFileLike[],
  cmd: FilesCmdLike,
  options: {
    preserveFlags?: boolean
    allowPlainString?: boolean
  } = {}
): boolean {
  if (files.length === 0) {
    return false
  }

  const minLength = cmd.minLength ?? 1
  const maxLength = cmd.maxLength ?? 10000
  if (files.length < minLength || files.length > maxLength) {
    return false
  }

  return files.every((file) => {
    if (cmd.fileType === 'file' && file.isDirectory) {
      return false
    }

    if (cmd.fileType === 'directory' && !file.isDirectory) {
      return false
    }

    if (Array.isArray(cmd.extensions) && cmd.extensions.length > 0 && !file.isDirectory) {
      const ext = file.name.split('.').pop()?.toLowerCase()
      const allowedExts = cmd.extensions.map((item) => item.toLowerCase())
      if (!ext || !allowedExts.includes(ext)) {
        return false
      }
    }

    if (cmd.match) {
      const regex = parseMatchPattern(cmd.match, {
        preserveFlags: options.preserveFlags
      })
      if (regex) {
        return regex.test(file.name)
      }

      if (options.allowPlainString) {
        return file.name.includes(cmd.match)
      }

      return false
    }

    return true
  })
}

/**
 * 判断 window 类型命令是否匹配指定窗口信息。
 */
export function matchesWindowInput(
  windowInfo: WindowInfoLike | null | undefined,
  cmd: WindowCmdLike,
  options: {
    titleRegex?: RegExp | null
    preserveTitleFlags?: boolean
  } = {}
): boolean {
  if (!windowInfo || (!windowInfo.app && !windowInfo.title)) {
    return false
  }

  if (cmd.match.app && windowInfo.app) {
    const appMatches = cmd.match.app.some((appPattern) => windowInfo.app === appPattern)
    const classNameMatches = cmd.match.className?.some(
      (classNamePattern) => classNamePattern === (windowInfo.className || '')
    )
    if (appMatches && (!cmd.match.className || classNameMatches)) {
      return true
    }
  }

  if (cmd.match.title && windowInfo.title) {
    const titleRegex =
      options.titleRegex ??
      parseMatchPattern(cmd.match.title, {
        preserveFlags: options.preserveTitleFlags,
        allowPlainString: true
      })
    if (titleRegex?.test(windowInfo.title)) {
      return true
    }
  }

  return false
}
