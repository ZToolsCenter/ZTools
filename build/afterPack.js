const fs = require('fs/promises')
const path = require('path')

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function remove(p) {
  await fs.rm(p, { recursive: true, force: true })
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

async function copy(src, dest) {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await ensureDir(dest)
    const entries = await fs.readdir(src)
    for (const entry of entries) {
      await copy(path.join(src, entry), path.join(dest, entry))
    }
  } else {
    await ensureDir(path.dirname(dest))
    await fs.copyFile(src, dest)
  }
}

/**
 * 为 Windows 和 macOS 完整安装包写入标准更新兼容标记。
 * @param {import('app-builder-lib').AfterPackContext} context Electron Builder 打包上下文。
 * @returns {Promise<void>} 安装标记写入完成后结束的 Promise。
 * @throws {Error} 无法创建或写入安装标记时抛出错误。
 */
async function writeFullInstallInfo(context) {
  if (!['darwin', 'win32'].includes(context.electronPlatformName)) return

  // 标记必须位于最终 Resources 目录中，并在正式签名前完成写入。
  const packageJson = require('../package.json')
  const appId = 'top.z-tools'
  let resourcesPath = ''
  let updater = ''

  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename
    resourcesPath = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources')
    updater = 'electron-updater-mac'
  } else {
    resourcesPath = path.join(context.appOutDir, 'resources')
    updater = 'electron-updater-nsis'
  }

  const installInfo = {
    schemaVersion: 1,
    appId,
    electronVersion: packageJson.devDependencies.electron,
    updater
  }
  const installInfoPath = path.join(resourcesPath, 'ztools-install-info.json')

  // 确保非标准框架输出也能创建标记目录。
  await ensureDir(resourcesPath)
  await fs.writeFile(installInfoPath, `${JSON.stringify(installInfo, null, 2)}\n`)
  console.log(`已写入 ${context.electronPlatformName} 完整安装标记: ${installInfoPath}`)
}

/**
 * 完成 Electron Builder afterPack 阶段的资源清理、内置插件复制和更新包生成。
 * @param {import('app-builder-lib').AfterPackContext} context Electron Builder 打包上下文。
 * @returns {Promise<void>} 所有 afterPack 操作完成后结束的 Promise。
 * @throws {Error} 内置插件复制或其他必须的打包步骤失败时抛出错误。
 */
module.exports = async function (context) {
  console.log('开始清理国际化文件...')

  // 定义要保留的语言包
  const keepLocales = ['en.lproj', 'zh_CN.lproj']

  // macOS 平台
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename
    const appPath = path.join(context.appOutDir, `${appName}.app`)

    // 需要清理的路径列表
    const resourcesPaths = [
      // 应用主 Resources
      path.join(appPath, 'Contents', 'Resources'),
      // Electron Framework Resources
      path.join(
        appPath,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources'
      )
    ]

    let totalDeleted = 0
    let totalSize = 0

    for (const resourcesPath of resourcesPaths) {
      try {
        if (await pathExists(resourcesPath)) {
          console.log(`\n清理目录: ${resourcesPath}`)
          const files = await fs.readdir(resourcesPath)
          let deletedCount = 0

          for (const file of files) {
            if (file.endsWith('.lproj') && !keepLocales.includes(file)) {
              const filePath = path.join(resourcesPath, file)

              // 计算大小
              try {
                const size = await getFolderSize(filePath)
                totalSize += size
              } catch (err) {
                // 忽略
              }

              await remove(filePath)
              console.log(`  已删除: ${file}`)
              deletedCount++
              totalDeleted++
            }
          }

          if (deletedCount === 0) {
            console.log('  没有需要删除的语言包')
          }
        } else {
          console.log(`  目录不存在: ${resourcesPath}`)
        }
      } catch (err) {
        console.error(`  清理目录出错 ${resourcesPath}:`, err)
      }
    }

    console.log(`\nmacOS 总计: 删除 ${totalDeleted} 个语言包`)
    console.log(`节省空间约: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
  }

  // Windows 平台
  if (context.electronPlatformName === 'win32') {
    const localesPath = path.join(context.appOutDir, 'locales')
    const keepLocalesPak = ['en-US.pak', 'zh-CN.pak']

    try {
      if (await pathExists(localesPath)) {
        const files = await fs.readdir(localesPath)
        let deletedCount = 0

        for (const file of files) {
          if (file.endsWith('.pak') && !keepLocalesPak.includes(file)) {
            const filePath = path.join(localesPath, file)
            await remove(filePath)
            console.log(`已删除: ${file}`)
            deletedCount++
          }
        }

        console.log(`Windows: 共删除 ${deletedCount} 个语言包`)
      }
    } catch (err) {
      console.error('删除 Windows 语言包时出错:', err)
    }
  }

  // Linux 平台
  if (context.electronPlatformName === 'linux') {
    const localesPath = path.join(context.appOutDir, 'locales')
    const keepLocalesPak = ['en-US.pak', 'zh-CN.pak']

    try {
      if (await pathExists(localesPath)) {
        const files = await fs.readdir(localesPath)
        let deletedCount = 0

        for (const file of files) {
          if (file.endsWith('.pak') && !keepLocalesPak.includes(file)) {
            const filePath = path.join(localesPath, file)
            await remove(filePath)
            console.log(`已删除: ${file}`)
            deletedCount++
          }
        }

        console.log(`Linux: 共删除 ${deletedCount} 个语言包`)
      }
    } catch (err) {
      console.error('删除 Linux 语言包时出错:', err)
    }
  }

  // 写入完整安装标记，供标准更新器隔离 legacy ASAR 安装。
  console.log('\n开始写入完整安装标记...')
  try {
    await writeFullInstallInfo(context)
  } catch (err) {
    console.error('写入完整安装标记失败:', err)
    throw err
  }

  // 复制内置插件
  console.log('\n开始复制内置插件...')
  const internalPluginsDir = path.resolve(__dirname, '../internal-plugins')
  const pluginNames = ['setting', 'system'] // 内置插件列表

  try {
    let resourcesPath = ''
    if (context.electronPlatformName === 'darwin') {
      const appName = context.packager.appInfo.productFilename
      const appPath = path.join(context.appOutDir, `${appName}.app`)
      resourcesPath = path.join(appPath, 'Contents', 'Resources')
    } else {
      resourcesPath = path.join(context.appOutDir, 'resources')
    }

    const destInternalPluginsDir = path.join(resourcesPath, 'app.asar.unpacked', 'internal-plugins')

    for (const pluginName of pluginNames) {
      console.log(`\n正在复制插件: ${pluginName}`)
      const pluginSrcDir = path.join(internalPluginsDir, pluginName)
      const pluginDestDir = path.join(destInternalPluginsDir, pluginName)

      // 确保目标目录存在
      await ensureDir(pluginDestDir)

      // 优先复制 dist 目录（需要编译的插件，如 setting）
      const distSrc = path.join(pluginSrcDir, 'dist')
      if (await pathExists(distSrc)) {
        const files = await fs.readdir(distSrc)
        for (const file of files) {
          const src = path.join(distSrc, file)
          const dest = path.join(pluginDestDir, file)
          await copy(src, dest)
        }
        console.log(`  已复制 dist/ 目录内容到: ${pluginDestDir}`)
      } else {
        // 如果没有 dist 目录，复制 public 目录（无界面插件，如 system）
        const publicSrc = path.join(pluginSrcDir, 'public')
        if (await pathExists(publicSrc)) {
          const files = await fs.readdir(publicSrc)
          for (const file of files) {
            const src = path.join(publicSrc, file)
            const dest = path.join(pluginDestDir, file)
            await copy(src, dest)
          }
          console.log(`  已复制 public/ 目录内容到: ${pluginDestDir}`)
        } else {
          console.error(`  ⚠️  未找到 dist 或 public 目录: ${pluginSrcDir}`)
          console.error(`  请确认插件 ${pluginName} 的目录结构`)
          throw new Error(`插件 ${pluginName} 缺少必要的文件`)
        }
      }

      console.log(`  ✅ 插件 ${pluginName} 复制完成`)
    }

    console.log('\n内置插件复制完成!')
  } catch (err) {
    console.error('复制内置插件失败:', err)
    throw err // 抛出错误，阻止打包继续
  }

  console.log('\n国际化文件清理完成!')

  // 保留 legacy ASAR 更新包，供尚未完整迁移的旧客户端使用。
  try {
    console.log('\n开始打包更新文件...')
    const AdmZip = require('adm-zip')

    // 确定 app.asar 路径
    let asarPath = ''
    let unpackedPath = ''

    if (context.electronPlatformName === 'darwin') {
      const appName = context.packager.appInfo.productFilename
      const appPath = path.join(context.appOutDir, `${appName}.app`)
      asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar')
      unpackedPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
    } else {
      asarPath = path.join(context.appOutDir, 'resources', 'app.asar')
      unpackedPath = path.join(context.appOutDir, 'resources', 'app.asar.unpacked')
    }

    if (await pathExists(asarPath)) {
      // 输出路径
      const version = context.packager.appInfo.version
      const archName = context.arch === 3 || context.arch === 'arm64' ? 'arm64' : 'x64'
      const platform = context.electronPlatformName

      const outDir = path.dirname(context.appOutDir)
      const zipName = `update-${platform}-${archName}-${version}.zip`
      const zipPath = path.join(outDir, zipName)

      console.log('正在创建 zip...')
      const zip = new AdmZip()

      // 添加 app.asar 并重命名为 app.asar.tmp
      zip.addLocalFile(asarPath, '', 'app.asar.tmp')
      console.log(`已添加 app.asar (重命名为 app.asar.tmp)`)

      if (await pathExists(unpackedPath)) {
        zip.addLocalFolder(unpackedPath, 'app.asar.unpacked')
        console.log(`已添加 app.asar.unpacked`)
      }

      zip.writeZip(zipPath)

      const stats = await fs.stat(zipPath)
      console.log(`更新包已生成: ${zipPath}`)
      console.log(`Total size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
    } else {
      console.error(`未找到 app.asar: ${asarPath}`)
    }
  } catch (err) {
    console.error('打包更新文件失败:', err)
  }
}

// 计算文件夹大小
async function getFolderSize(folderPath) {
  let totalSize = 0

  try {
    const files = await fs.readdir(folderPath)

    for (const file of files) {
      const filePath = path.join(folderPath, file)
      const stats = await fs.stat(filePath)

      if (stats.isDirectory()) {
        totalSize += await getFolderSize(filePath)
      } else {
        totalSize += stats.size
      }
    }
  } catch (err) {
    // 忽略错误
  }

  return totalSize
}
