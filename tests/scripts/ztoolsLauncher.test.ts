import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

interface LauncherResult {
  exitCode: number | null
  stderr: string
  invocation: { binary: string; args: string[] } | null
}

/**
 * 读取仓库中的启动器脚本源码。
 *
 * @returns 启动器脚本的完整文本内容。
 */
async function readLauncherSource(): Promise<string> {
  return fs.readFile(path.join(projectRoot, 'build', 'ztools-launcher.sh'), 'utf8')
}

/**
 * 在临时目录中搭建模拟安装布局，并放置记录 argv 的假二进制。
 *
 * @param launcherRelPath 启动器脚本相对布局根目录的路径。
 * @param binaryRelPath 可执行文件相对布局根目录的路径。
 * @returns 布局根目录、启动器绝对路径、二进制绝对路径与记录文件路径。
 */
async function makeLauncherFixture(
  launcherRelPath: string,
  binaryRelPath: string
): Promise<{
  root: string
  launcherPath: string
  binaryPath: string
  recordPath: string
}> {
  // realpath 消除 macOS /var -> /private/var 等系统符号链接，确保断言路径与 pwd -P 一致。
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-launcher-')))
  const launcherPath = path.join(root, launcherRelPath)
  const binaryPath = path.join(root, binaryRelPath)
  const recordPath = path.join(root, 'record.txt')

  await fs.mkdir(path.dirname(launcherPath), { recursive: true })
  await fs.writeFile(launcherPath, await readLauncherSource(), 'utf8')
  await fs.chmod(launcherPath, 0o755)

  await fs.mkdir(path.dirname(binaryPath), { recursive: true })
  // 假二进制把自身路径与收到的参数写入记录文件，便于断言选中了正确目标并收到唤醒参数。
  const fakeBinary = [
    '#!/bin/sh',
    'printf "%s\\n" "$0" > "$ZTOOLS_LAUNCHER_RECORD"',
    'for arg in "$@"; do',
    '  printf "%s\\n" "$arg" >> "$ZTOOLS_LAUNCHER_RECORD"',
    'done',
    ''
  ].join('\n')
  await fs.writeFile(binaryPath, fakeBinary, 'utf8')
  await fs.chmod(binaryPath, 0o755)

  return { root, launcherPath, binaryPath, recordPath }
}

/**
 * 通过 /bin/ztools 符号链接执行启动器并采集执行结果。
 *
 * @param root 模拟安装布局根目录。
 * @param launcherPath 启动器脚本绝对路径。
 * @param recordPath 假二进制写入 argv 的记录文件路径。
 * @param relativeSymlinkTarget 符号链接目标是否使用相对路径。
 * @returns 退出码、标准错误输出与记录到的调用信息。
 */
async function invokeLauncher(
  root: string,
  launcherPath: string,
  recordPath: string,
  relativeSymlinkTarget: boolean
): Promise<LauncherResult> {
  const binDir = path.join(root, 'bin')
  await fs.mkdir(binDir, { recursive: true })
  const linkPath = path.join(binDir, 'ztools')
  const target = relativeSymlinkTarget ? path.relative(binDir, launcherPath) : launcherPath
  await fs.symlink(target, linkPath)

  const child = spawn(linkPath, [], {
    env: { ...process.env, ZTOOLS_LAUNCHER_RECORD: recordPath },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  let invocation: LauncherResult['invocation'] = null
  try {
    const lines = (await fs.readFile(recordPath, 'utf8')).trim().split('\n').filter(Boolean)
    invocation = { binary: lines[0] ?? '', args: lines.slice(1) }
  } catch {
    // 记录文件不存在说明启动器没有 exec 任何可执行文件。
  }
  return { exitCode, stderr, invocation }
}

describe.runIf(process.platform !== 'win32')('ztools-launcher.sh', () => {
  it('Linux 布局经符号链接唤起 opt/ZTools/ztools', async () => {
    const fixture = await makeLauncherFixture(
      path.join('opt', 'ZTools', 'resources', 'ztools', 'ztools-launcher.sh'),
      path.join('opt', 'ZTools', 'ztools')
    )

    const result = await invokeLauncher(
      fixture.root,
      fixture.launcherPath,
      fixture.recordPath,
      false
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    // exec 原样传递探测路径（含 .. 段），解析后应与真实二进制完全一致。
    expect(path.resolve(result.invocation?.binary ?? '')).toBe(fixture.binaryPath)
    expect(result.invocation?.args).toEqual(['--ztools-wake'])
  })

  it('macOS 布局经相对目标符号链接唤起 Contents/MacOS/ZTools', async () => {
    const fixture = await makeLauncherFixture(
      path.join(
        'Applications',
        'ZTools.app',
        'Contents',
        'Resources',
        'ztools',
        'ztools-launcher.sh'
      ),
      path.join('Applications', 'ZTools.app', 'Contents', 'MacOS', 'ZTools')
    )

    const result = await invokeLauncher(
      fixture.root,
      fixture.launcherPath,
      fixture.recordPath,
      true
    )

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(path.resolve(result.invocation?.binary ?? '')).toBe(fixture.binaryPath)
    expect(result.invocation?.args).toEqual(['--ztools-wake'])
  })

  it('找不到可执行文件时报错退出，不 exec 同名目录', async () => {
    // 只放启动器、不放可执行文件；resources/ztools 目录本身带执行位，
    // 旧版会把它误当作二进制 exec 并以 126 退出。
    const fixture = await makeLauncherFixture(
      path.join('opt', 'ZTools', 'resources', 'ztools', 'ztools-launcher.sh'),
      path.join('opt', 'ZTools', 'missing-ztools')
    )

    const result = await invokeLauncher(
      fixture.root,
      fixture.launcherPath,
      fixture.recordPath,
      false
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('未找到 ZTools 可执行文件')
    expect(result.invocation).toBeNull()
  })
})
