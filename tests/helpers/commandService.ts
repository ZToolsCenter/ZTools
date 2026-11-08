import { vi } from 'vitest'
import { CommandService } from '../../src/main/core/commands/service'
import { CommandSearchEngine } from '../../src/main/core/commands/engine'
import { buildCommandCatalog } from '../../src/main/core/commands/catalog'
import type { CommandCatalogInput } from '../../src/shared/commandService'
import type { CommandServiceDependencies } from '../../src/main/core/commands/service'

export interface CommandServiceFixture {
  service: CommandService
  input: CommandCatalogInput
  storage: Map<string, any>
  launch: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  queryMainPush: ReturnType<typeof vi.fn>
  selectMainPush: ReturnType<typeof vi.fn>
  worker: CommandServiceDependencies['worker']
  sources: ReturnType<typeof vi.fn<CommandServiceDependencies['sources']>>
}

/**
 * 创建无 Electron 副作用的真实业务服务夹具。
 * @param overrides 目录来源覆盖
 * @param documents 用户数据初始值
 * @returns 服务、输入与运行时观察器
 */
export function commandServiceFixture(
  overrides: Partial<CommandCatalogInput> = {},
  documents: Record<string, any> = {}
): CommandServiceFixture {
  const input: CommandCatalogInput = {
    apps: [],
    plugins: [],
    settings: [],
    localShortcuts: [],
    aliases: {},
    disabledPlugins: [],
    disabledCommands: [],
    enabledMainPushPlugins: [],
    ...overrides
  }
  const storage = new Map(Object.entries(structuredClone(documents)))
  const launch = vi.fn().mockResolvedValue({ success: true })
  const queryMainPush = vi.fn().mockResolvedValue([])
  const selectMainPush = vi.fn().mockResolvedValue(true)
  const write = vi.fn((key: string, value: any) => {
    storage.set(key, structuredClone(value))
  })
  let engine: CommandSearchEngine
  const sources = vi.fn(async () => structuredClone(input))
  const worker: CommandServiceDependencies['worker'] = {
    publish: vi.fn(async (data) => {
      engine = new CommandSearchEngine(buildCommandCatalog(data))
      return engine.catalog
    }),
    query: vi.fn(async (request, state) => engine.query(request, state)),
    validateCommand: vi.fn(async (ruleId, context) => engine.validateCommand(ruleId, context))
  }
  const service = new CommandService({
    sources,
    worker,
    read: (key) => structuredClone(storage.get(key)),
    write,
    launch,
    queryMainPush,
    selectMainPush,
    stateChanged: vi.fn()
  })
  return { service, input, storage, launch, write, queryMainPush, selectMainPush, worker, sources }
}
