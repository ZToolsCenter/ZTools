import { defineConfig } from 'vitest/config'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { Plugin } from 'vite'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

/**
 * 让 vitest 支持 electron-vite 的 `?asset` 导入语法。
 *
 * electron-vite 构建主进程时通过 `vite:node-asset` 插件把 `?asset` 导入转换为
 * 构建产物的路径字符串；vitest 没有加载该插件，二进制资源（如 .node 原生模块）
 * 会被默认加载器当作 JS 解析而直接报错。这里在测试环境里镜像相同的语义：
 * 默认导出改为资源源文件的绝对路径字符串，供 `require()` / 路径拼接使用。
 *
 * @returns 处理 `?asset` 导入的 Vite 插件
 */
function nodeAssetPlugin(): Plugin {
  return {
    name: 'vitest:node-asset',
    enforce: 'pre',
    load(id) {
      // 仅接管带 `?asset` 查询的模块，其余模块交给默认加载器。
      if (!id.includes('?asset')) {
        return
      }
      const filePath = id.split('?')[0]
      return `export default ${JSON.stringify(filePath)}`
    }
  }
}

export default defineConfig({
  define: {
    __ZTOOLS_TARGET_ELECTRON_VERSION__: JSON.stringify(packageJson.devDependencies.electron)
  },
  plugins: [nodeAssetPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  }
})
