import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import databaseAPI from '../api/shared/database'

const execFileAsync = promisify(execFile)

// ==================== 类型 ====================

/** 预设选项（供 UI 下拉使用） */
export interface PresetOption {
  label: string
  value: string
}

/** 预设的启动方式 */
type Preset =
  | { type: 'cli'; command: string; args: string[] } // args 中可含 '{path}' 占位符
  | { type: 'applescript'; build: (path: string) => string } // 返回完整 AppleScript
  | { type: 'handler'; run: (path: string) => Promise<boolean> } // 自定义启动（回退链等）

interface PresetEntry {
  id: string
  label: string
  preset: Preset
}

// ==================== 路径转义（从 systemCommands 迁入，行为不变）====================

export function escapePowerShellPath(folderPath: string): string {
  const escaped = folderPath.replace(/'/g, "''")
  return `'${escaped}'`
}

export function escapeCmdPath(folderPath: string): string {
  const escaped = folderPath.replace(/"/g, '^"')
  return `"${escaped}"`
}

/** 转义路径中的反斜杠和双引号，安全嵌入 AppleScript 双引号字符串 */
export function escapeAppleScriptString(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

// ==================== 命令字符串解析（内联，避免耦合 commandLauncher）====================

/** 将命令字符串拆分为 [可执行文件, 参数列表]，处理引号 */
function parseCommandString(cmd: string): [string | undefined, string[]] {
  const parts: string[] = []
  let current = ''
  let inQuote: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return [parts[0], parts.slice(1)]
}

// ==================== 执行原语 ====================

/** 执行 AppleScript：直接调用 osascript（不经 shell），避免 shell 注入 */
async function runAppleScript(script: string): Promise<void> {
  await execFileAsync('osascript', ['-e', script])
}

/** detached 启动 CLI 命令，返回是否成功拿到 pid */
function runCli(command: string, args: string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    if (child.pid) {
      child.unref()
      resolve(true)
    }
  })
}

// ==================== 默认处理器（从 systemCommands 迁入，行为不变）====================
// 注：macOS 默认预设直接使用 applescript build（Terminal.app 始终存在，无需回退链），
// 故此处不再保留 launchDefaultMac；Linux/Windows 需要回退链，保留对应 handler。

async function launchDefaultLinux(path: string): Promise<boolean> {
  return (
    (await runCli('exo-open', ['--launch', 'TerminalEmulator', '--working-directory', path])) ||
    (await runCli('gnome-terminal', [`--working-directory=${path}`])) ||
    (await runCli('xterm', ['-cd', path]))
  )
}

async function launchDefaultWindows(path: string): Promise<boolean> {
  return (
    (await runCli('wt.exe', ['-d', path])) ||
    (await runCli('powershell.exe', [
      '-NoExit',
      '-Command',
      `Set-Location -Path ${escapePowerShellPath(path)}`
    ])) ||
    (await runCli('cmd.exe', ['/K', `cd /d ${escapeCmdPath(path)}`]))
  )
}

// ==================== 预设注册表 ====================

const MAC_PRESETS: PresetEntry[] = [
  {
    id: 'default',
    label: '系统默认 (Terminal)',
    preset: {
      type: 'applescript',
      build: (p) => {
        const safePath = escapeAppleScriptString(p)
        return `
    tell application "Terminal"
      activate
      do script "cd " & quoted form of "${safePath}"
    end tell
  `
      }
    }
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    preset: {
      type: 'cli',
      command: 'open',
      args: ['-na', 'Ghostty.app', '--args', '--working-directory={path}']
    }
  },
  {
    id: 'iterm2',
    label: 'iTerm2',
    preset: {
      type: 'applescript',
      build: (p) => {
        const safePath = escapeAppleScriptString(p)
        return `
    tell application "iTerm"
      activate
      tell (create window with default profile)
        write session "cd " & quoted form of "${safePath}"
      end tell
    end tell
  `
      }
    }
  }
]

const LINUX_PRESETS: PresetEntry[] = [
  { id: 'default', label: '系统默认', preset: { type: 'handler', run: launchDefaultLinux } },
  {
    id: 'gnome-terminal',
    label: 'GNOME Terminal',
    preset: { type: 'cli', command: 'gnome-terminal', args: ['--working-directory={path}'] }
  },
  {
    id: 'konsole',
    label: 'Konsole',
    preset: { type: 'cli', command: 'konsole', args: ['--workdir', '{path}'] }
  },
  {
    id: 'xterm',
    label: 'XTerm',
    preset: { type: 'cli', command: 'xterm', args: ['-cd', '{path}'] }
  }
]

const WINDOWS_PRESETS: PresetEntry[] = [
  { id: 'default', label: '系统默认', preset: { type: 'handler', run: launchDefaultWindows } },
  {
    id: 'wt',
    label: 'Windows Terminal',
    preset: { type: 'cli', command: 'wt.exe', args: ['-d', '{path}'] }
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    preset: {
      type: 'handler',
      run: (p) =>
        runCli('powershell.exe', [
          '-NoExit',
          '-Command',
          `Set-Location -Path ${escapePowerShellPath(p)}`
        ])
    }
  },
  {
    id: 'cmd',
    label: 'CMD',
    preset: {
      type: 'handler',
      run: (p) => runCli('cmd.exe', ['/K', `cd /d ${escapeCmdPath(p)}`])
    }
  }
]

// ==================== 纯函数（可单测）====================

function getPlatformPresets(platform: string): PresetEntry[] {
  if (platform === 'darwin') return MAC_PRESETS
  if (platform === 'linux') return LINUX_PRESETS
  if (platform === 'win32') return WINDOWS_PRESETS
  return []
}

/** 返回当前平台的下拉选项（含「自定义」）；未知平台返回空数组 */
export function getPresetOptions(platform: string): PresetOption[] {
  const presets = getPlatformPresets(platform)
  if (presets.length === 0) return []
  const options = presets.map((p) => ({ label: p.label, value: p.id }))
  options.push({ label: '自定义', value: 'custom' })
  return options
}

/** 按 terminal 值解析预设；空值/无效值回退默认，'custom' 返回 null（由编排函数处理） */
export function resolvePreset(terminal: string | undefined, platform: string): PresetEntry | null {
  const presets = getPlatformPresets(platform)
  if (!terminal) {
    return presets.find((p) => p.id === 'default') ?? null
  }
  if (terminal === 'custom') return null
  return presets.find((p) => p.id === terminal) ?? presets.find((p) => p.id === 'default') ?? null
}

/** 将 args 中的 {path} 占位符替换为实际路径 */
export function applyPathToArgs(args: string[], folderPath: string): string[] {
  return args.map((a) => a.replaceAll('{path}', folderPath))
}

/** 解析自定义命令模板；空字符串返回 null */
export function parseCustomCommand(template: string): { command: string; args: string[] } | null {
  const trimmed = template.trim()
  if (!trimmed) return null
  const [command, args] = parseCommandString(trimmed)
  if (!command) return null
  return { command, args }
}

// ==================== 编排：读取配置 → 分发 ====================

async function executePreset(entry: PresetEntry | null, folderPath: string): Promise<boolean> {
  if (!entry) return false
  const preset = entry.preset
  if (preset.type === 'cli') {
    return runCli(preset.command, applyPathToArgs(preset.args, folderPath))
  }
  if (preset.type === 'applescript') {
    await runAppleScript(preset.build(folderPath))
    return true
  }
  return preset.run(folderPath)
}

export async function openInTerminal(folderPath: string): Promise<boolean> {
  try {
    const settings = (databaseAPI.dbGet('settings-general') as Record<string, any>) || {}
    const terminal: string | undefined = settings.terminal
    const customCommand: string | undefined = settings.terminalCustomCommand

    // 自定义命令优先
    if (terminal === 'custom') {
      const parsed = parseCustomCommand(customCommand ?? '')
      if (parsed) {
        return await runCli(parsed.command, applyPathToArgs(parsed.args, folderPath))
      }
      // 自定义命令为空 → 回退默认
      return await executePreset(resolvePreset('default', process.platform), folderPath)
    }

    return await executePreset(resolvePreset(terminal, process.platform), folderPath)
  } catch (error) {
    console.error('[TerminalLauncher] 打开终端失败:', error)
    return false
  }
}
