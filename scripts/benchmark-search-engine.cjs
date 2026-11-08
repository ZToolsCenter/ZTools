/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Standalone CommonJS benchmark loads TypeScript source without building the app. */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { performance } = require('node:perf_hooks')
const ts = require('typescript')

const projectRoot = path.resolve(__dirname, '..')
const commandRoot = path.join(projectRoot, 'src/main/core/commands')

/**
 * 编译本地 TypeScript 源文件，用于无打包的引擎基准。
 * @param source 源码
 * @returns CommonJS 代码
 */
function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
}

require.extensions['.ts'] = (module, filename) =>
  module._compile(compile(fs.readFileSync(filename, 'utf8')), filename)

/**
 * 按原目录解析基线源码依赖，不修改当前运行引擎。
 * @param directory 基线源码目录
 * @param filename 基线文件名
 * @returns 基线模块导出
 */
function loadBaseline(directory, filename) {
  const original = path.join(commandRoot, filename)
  const module = new Module(original)
  module.filename = original
  // 基线可在独立目录保留 Fuse 依赖，当前项目不需要重新安装旧引擎。
  module.paths = [...Module._nodeModulePaths(directory), ...Module._nodeModulePaths(commandRoot)]
  module._compile(compile(fs.readFileSync(path.join(directory, filename), 'utf8')), original)
  return module.exports
}

/**
 * 创建含中英文、多音字和独立启动目标的稳定测试语料。
 * @param count 名称数量
 * @returns 目录来源
 */
function input(count) {
  const labels = [
    '微信',
    '微信 OCR',
    '重庆天气',
    '银行助手',
    '音乐播放器',
    'Visual Studio Code',
    'HTTPServer',
    '女娲工具',
    '长截图',
    '重行长乐重行长乐'
  ]
  return {
    apps: Array.from({ length: count }, (_, i) => ({
      name: labels[i % labels.length] + String(i).padStart(5, '0'),
      path: '/fixture/' + i
    })),
    plugins: [],
    settings: [],
    localShortcuts: [],
    aliases: {},
    disabledPlugins: [],
    disabledCommands: [],
    enabledMainPushPlugins: []
  }
}

/**
 * 提取排序后的百分位延迟。
 * @param samples 耗时样本
 * @param percentile 百分位比例
 * @returns 毫秒，保留两位小数
 */
function percentile(samples, percentile) {
  return Number(
    [...samples]
      .sort((a, b) => a - b)
      [Math.min(samples.length - 1, Math.floor(samples.length * percentile))].toFixed(2)
  )
}

/**
 * 测量完整目录构建与各类查询，记录备用读音降级情况。
 * @param version 引擎名称
 * @param builder 目录构造器
 * @param Engine 引擎类
 * @param count 名称数量
 * @returns 单组基准报告
 */
function measure(version, builder, Engine, count) {
  const sources = input(count)
  global.gc?.()
  const memory = process.memoryUsage().heapUsed
  const buffers = process.memoryUsage().arrayBuffers
  const started = performance.now()
  const engine = new Engine(builder(sources))
  const buildMs = performance.now() - started
  global.gc?.()
  const heapMB = (process.memoryUsage().heapUsed - memory) / 1024 / 1024
  const arrayBufferMB = (process.memoryUsage().arrayBuffers - buffers) / 1024 / 1024
  const state = {
    recommendationPins: [],
    usage: [],
    preference: {}
  }
  const queries = {
    chinese: '微信',
    full: 'weixin',
    initials: 'wx',
    english: 'vsc',
    alternative: 'zhongqing',
    alternativeInitials: 'zq',
    mixed: 'wei信',
    missing: 'notfoundanything',
    denseMissing: 'chongxingzhangle'.repeat(4),
    long: '查询'.repeat(70)
  }
  const results = {}
  for (const [kind, searchQuery] of Object.entries(queries)) {
    const samples = []
    let hits = 0
    let degraded = 0
    let maxStates = 0
    for (let i = 0; i < 25; i++) {
      const start = performance.now()
      const request = {
        context: { searchQuery, pastedImage: false, pastedFiles: null, pastedText: null }
      }
      // 历史基线仍接受旧签名，当前引擎只接收匹配输入和排名状态。
      const result =
        version === 'fuse-baseline'
          ? engine.query({ ...request, sessionId: 'benchmark', requestId: i }, state, 1)
          : engine.query(request, state)
      if (i >= 5) samples.push(performance.now() - start)
      hits = result.bestSearchResults.length
      degraded = engine.nameDiagnostics?.degraded || 0
      maxStates = Math.max(maxStates, engine.nameDiagnostics?.visited || 0)
    }
    results[kind] = {
      hits,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      degraded,
      maxStates
    }
  }
  return {
    version,
    count,
    buildMs: Number(buildMs.toFixed(2)),
    heapMB: Number(heapMB.toFixed(2)),
    arrayBufferMB: Number(arrayBufferMB.toFixed(2)),
    results
  }
}

const { buildCommandCatalog } = require('../src/main/core/commands/catalog.ts')
const { CommandSearchEngine } = require('../src/main/core/commands/engine.ts')
const baselineDir = process.argv[2]
const versions = []
if (baselineDir)
  versions.push({
    version: 'fuse-baseline',
    builder: loadBaseline(baselineDir, 'catalog.ts').buildCommandCatalog,
    Engine: loadBaseline(baselineDir, 'engine.ts').CommandSearchEngine
  })
versions.push({ version: 'matchers', builder: buildCommandCatalog, Engine: CommandSearchEngine })
for (const count of [1000, 5000, 10000]) {
  for (const { version, builder, Engine } of versions)
    console.log(JSON.stringify(measure(version, builder, Engine, count)))
}
