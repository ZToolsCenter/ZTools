/**
 * [ZT-Enhance] 源码构建部署脚本
 * ------------------------------------------------------
 * 在 ZTools-main 源码目录改完代码后，运行本脚本即可把改动部署到已安装的 ZTools：
 *   node deploy-build.js
 * 流程：构建设置插件 → 构建主进程 → 解包当前 app.asar → 换入新 out/ →
 *       同步设置插件 dist → 重打包 → unpacked 一致性校验 → 备份并替换 → 重启 ZTools。
 * 前置：ZTools-main 目录已完成 pnpm install（见 ENHANCEMENTS.md）。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, spawn } = require('child_process')
const { pathToFileURL } = require('url')

const HOME = os.homedir()
const REPO = 'D:\\Software_Data\\ZTools\\ZTools-main'
const RES_DIR = 'D:\\Software_Data\\ZTools\\resources'
const APP_ASAR = path.join(RES_DIR, 'app.asar')
const BACKUP = APP_ASAR + '.pre-autopin.bak'
const SETTING_DIST = path.join(REPO, 'internal-plugins', 'setting', 'dist')
const SETTING_INSTALLED = path.join(RES_DIR, 'app.asar.unpacked', 'internal-plugins', 'setting')
const WORK = path.join(os.tmpdir(), 'ztools-deploy')
const TOOL_LIB = path.join(
  HOME,
  '.ztools-autopin',
  'tools',
  'node_modules',
  '@electron/asar',
  'lib',
  'asar.js'
)
const GLOBS =
  '{**/internal-plugins/**,**/app/resources/**,**/node_modules/@lmdb/**,**/node_modules/@msgpackr-extract/**,**/node_modules/uiohook-napi/**}'

function sh(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: REPO, ...opts })
}

async function main() {
  for (const p of [REPO, path.join(REPO, 'out'), TOOL_LIB]) {
    if (!fs.existsSync(p)) {
      console.error('缺少必要路径:', p)
      process.exit(1)
    }
  }

  // 1) 构建设置插件（Vue → dist）
  sh('pnpm exec vite build', { cwd: path.join(REPO, 'internal-plugins', 'setting') })
  // 2) 构建主进程/预加载/渲染层（electron-vite → out/）
  sh('pnpm exec electron-vite build')

  // 3) 关闭 ZTools
  console.log('关闭 ZTools ...')
  try {
    execSync('taskkill /F /IM ZTools.exe', { stdio: 'ignore' })
  } catch {}
  await new Promise((r) => setTimeout(r, 2000))

  // 4) 解包当前 app.asar，换入新 out/
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  const asar = await import(pathToFileURL(TOOL_LIB).href)
  console.log('提取当前 app.asar 内容 ...')
  // 不用 extractAll：asar 头部可能残留指向已更新磁盘文件的 unpacked 旧条目（内置插件
  // assets 带内容哈希，会随部署变化），整体解包会 ENOENT。逐条目处理：
  //   unpacked 条目 → 以磁盘 app.asar.unpacked 里的文件为准（运行时读的就是它）；
  //   internal-plugins 旧条目 → 直接跳过（官方包不含它，加载器只读 unpacked 目录）；
  //   其余条目 → 从 asar 提取。
  const appTree = path.join(WORK, 'app')
  const header = (await asar.getRawHeader(APP_ASAR, true)).header
  const copyEntry = async (rel) => {
    const dest = path.join(appTree, rel.split('/').join(path.sep))
    if (fs.existsSync(dest)) return
    // 该 asar 库在 Windows 上按 path.sep 解析路径，必须用反斜杠
    const buf = await asar.extractFile(APP_ASAR, rel.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, buf)
  }
  const walkExtract = async (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const rel = prefix ? `${prefix}/${name}` : name
      if (child.files) {
        await walkExtract(child, rel)
      } else if (child.unpacked) {
        if (rel.startsWith('internal-plugins/')) continue
        const disk = path.join(RES_DIR, 'app.asar.unpacked', rel.split('/').join(path.sep))
        if (!fs.existsSync(disk)) continue
        const dest = path.join(appTree, rel.split('/').join(path.sep))
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(disk, dest)
      } else {
        await copyEntry(rel)
      }
    }
  }
  await walkExtract(header, '')
  // 写入主进程入口使用的 package.json（与 asar 头部一致）
  if (!fs.existsSync(path.join(appTree, 'package.json'))) {
    const pkg = await asar.extractFile(APP_ASAR, 'package.json')
    fs.writeFileSync(path.join(appTree, 'package.json'), pkg)
  }
  fs.rmSync(path.join(WORK, 'app', 'out'), { recursive: true, force: true })
  fs.cpSync(path.join(REPO, 'out'), path.join(WORK, 'app', 'out'), { recursive: true })
  // internal-plugins 不打进 asar（与官方包一致）：生产加载器只读 app.asar.unpacked 下的
  // 内置插件目录。若保留旧条目，其 unpacked 引用会随磁盘 assets 更新而失效。
  fs.rmSync(path.join(WORK, 'app', 'internal-plugins'), { recursive: true, force: true })

  // 5) 重打包 + 一致性校验
  console.log('重新打包 ...')
  const outAsar = path.join(WORK, 'app-new.asar')
  await asar.createPackageWithOptions(path.join(WORK, 'app'), outAsar, { unpack: GLOBS })
  const newHeader = (await asar.getRawHeader(outAsar, true)).header
  const missing = []
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const p = prefix + '/' + name
      if (child.files) walk(child, p)
      else if (child.unpacked) {
        if (!fs.existsSync(path.join(RES_DIR, 'app.asar.unpacked', p.split('/').join(path.sep))))
          missing.push(p)
      }
    }
  }
  walk(newHeader, '')
  if (missing.length > 0) {
    console.error('一致性校验失败（', missing.length, '个 unpacked 条目缺磁盘文件），原包未动。')
    missing.slice(0, 5).forEach((m) => console.error('  MISSING:', m))
    process.exit(1)
  }

  // 6) 备份（仅首次）并替换 asar
  if (!fs.existsSync(BACKUP)) fs.copyFileSync(APP_ASAR, BACKUP)
  fs.copyFileSync(outAsar, APP_ASAR)

  // 7) 同步设置插件 dist 到 unpacked 目录
  //    先清空旧 assets（文件名带内容哈希，旧文件会残留），防止缓存旧页面时加载到过期资源
  if (fs.existsSync(SETTING_DIST) && fs.existsSync(SETTING_INSTALLED)) {
    const installedAssets = path.join(SETTING_INSTALLED, 'assets')
    if (fs.existsSync(installedAssets)) fs.rmSync(installedAssets, { recursive: true, force: true })
    fs.cpSync(SETTING_DIST, SETTING_INSTALLED, { recursive: true })
    console.log('设置插件 dist 已同步（旧 assets 已清理）')
  }

  // 8) 清除设置插件分区的网页缓存。
  //    插件页面经 file:// 加载，Chromium 启发式缓存可能长期不重新验证 index.html，
  //    导致部署后界面仍是旧版本。保留 Local Storage / Network 等用户数据。
  const settingPartition = path.join(os.homedir(), '.ztools', 'Partitions', 'setting')
  for (const dir of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
    fs.rmSync(path.join(settingPartition, dir), { recursive: true, force: true })
  }
  console.log('设置插件分区缓存已清理')

  // 9) 重启
  console.log('启动 ZTools ...')
  spawn('D:\\Software_Data\\ZTools\\ZTools.exe', [], { detached: true, stdio: 'ignore' }).unref()
  console.log('部署完成。')
}

main().catch((e) => {
  console.error('部署失败:', e)
  process.exit(1)
})
