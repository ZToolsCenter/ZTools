<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useToast, Select, BaseDialog, AdaptiveIcon } from '@/components'
import type { SelectModelValue, SelectOption } from '@/components'

const { success, error, confirm } = useToast()

/** 待审申请条目（含界面勾选状态） */
interface PendingRequestView {
  pluginName: string
  apis: string[]
  reason?: string
  requestedAt: number
  selected: string[]
}

/** 已授权插件条目（合并按通道授权与手动完全授权两类来源） */
interface AuthorizedPluginView {
  pluginName: string
  apis: string[]
  /** 完全授权（全部高级 API）插件 */
  fullAccess: boolean
  /** 授权被整体停用（挂起，配置保留） */
  disabled: boolean
  /** 已安装插件元信息中的图标地址 */
  logo?: string
}

/** 当前激活的列表页签 */
const activeTab = ref<'pending' | 'granted'>('pending')
/** 按申请时间倒序的待审申请列表 */
const pendingRequests = ref<PendingRequestView[]>([])
/** 「插件名 -> 已授权通道列表」映射 */
const permissionsMap = ref<Record<string, string[]>>({})
/** 手动录入的完全授权插件名单（展示为「完全授权」并可逐通道调整） */
const fullAccessPluginNames = ref<string[]>([])
/** 硬编码可信插件名单（内置 + 开发者工具），始终完全授权且不在此页展示 */
const trustedPluginNames = ref<string[]>([])
/** 被整体停用授权的插件名单 */
const disabledPluginNames = ref<string[]>([])
/** 主进程登记的全部可用 internal 通道 */
const availableChannels = ref<string[]>([])
/** 已安装插件元信息（name -> title/logo），用于列表展示图标 */
const pluginMetaMap = ref<Record<string, { title?: string; logo?: string }>>({})
/** 各授权卡片独立的「追加通道」选择值 */
const addApiSelections = ref<Record<string, SelectModelValue>>({})
/** 当前展开细节的已授权插件名（同 MCP 列表，一次只展开一个） */
const expandedPluginName = ref('')
/** 正在切换授权启停状态的插件名 */
const togglingPluginName = ref('')
/** 数据加载中标记 */
const loading = ref(false)

/** 手动授权弹窗显隐 */
const showManualDialog = ref(false)
/** 手动授权：插件名 */
const manualPluginName = ref('')
/** 手动授权：选中的通道 */
const manualSelectedApis = ref<SelectModelValue>([])
/** 手动授权：是否授予全部高级 API（完全授权） */
const manualFullAccess = ref(false)

/** 手动授权时可选的通道（全部已注册通道） */
const manualApiOptions = computed<SelectOption[]>(() =>
  availableChannels.value.map((channel) => ({ label: channel, value: channel }))
)

/** 已授权插件合并视图：按通道授权 + 手动完全授权，未停用的排在前面 */
const authorizedPlugins = computed<AuthorizedPluginView[]>(() => {
  const merged = new Map<string, AuthorizedPluginView>()

  // 按通道授权条目先入表，保留 apis 明细。
  for (const [pluginName, apis] of Object.entries(permissionsMap.value)) {
    if (isTrustedPlugin(pluginName)) continue
    merged.set(pluginName, {
      pluginName,
      apis: apis ?? [],
      fullAccess: false,
      disabled: disabledPluginNames.value.includes(pluginName),
      logo: pluginMetaMap.value[pluginName]?.logo
    })
  }

  // 手动完全授权条目补充进表：apis 展示为全部已注册通道，与按通道插件一样可增删。
  for (const pluginName of fullAccessPluginNames.value) {
    if (isTrustedPlugin(pluginName)) continue
    const existing = merged.get(pluginName)
    if (existing) {
      existing.fullAccess = true
      existing.apis = [...availableChannels.value]
      continue
    }
    merged.set(pluginName, {
      pluginName,
      apis: [...availableChannels.value],
      fullAccess: true,
      disabled: disabledPluginNames.value.includes(pluginName),
      logo: pluginMetaMap.value[pluginName]?.logo
    })
  }

  // 未停用的插件排在前面，同组内按插件名排序。
  return [...merged.values()].sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
    return a.pluginName.localeCompare(b.pluginName)
  })
})

/**
 * 判断插件是否属于硬编码可信名单（含 __dev 运行名变体）。
 * 可信插件始终完全授权，不参与本页授权管理。
 * @param pluginName 插件名
 * @returns 是否为可信插件
 */
function isTrustedPlugin(pluginName: string): boolean {
  const names = trustedPluginNames.value
  return names.includes(pluginName) || names.includes(pluginName.replace(/__dev$/, ''))
}

/** 是否已根据首屏数据决定默认页签（仅执行一次） */
let initialTabResolved = false

/**
 * 取插件名用于头像展示的首字符。
 * @param pluginName 插件名
 * @returns 首字符（统一大写）
 */
function avatarChar(pluginName: string): string {
  return pluginName.charAt(0).toUpperCase() || '?'
}

/**
 * 已授权插件卡片追加通道时可选的通道（排除已授权项；完全授权插件已持有全部通道）。
 * @param pluginName 插件名
 * @returns 可选项列表
 */
function availableOptionsFor(pluginName: string): SelectOption[] {
  if (fullAccessPluginNames.value.includes(pluginName)) return []
  const granted = permissionsMap.value[pluginName] ?? []
  return availableChannels.value
    .filter((channel) => !granted.includes(channel))
    .map((channel) => ({ label: channel, value: channel }))
}

/**
 * 拼接已授权插件的副标题文案。
 * @param grant 已授权插件条目
 * @returns 副标题文本
 */
function grantMetaText(grant: AuthorizedPluginView): string {
  const scope = grant.fullAccess
    ? `全部 ${grant.apis.length} 个 API`
    : `${grant.apis.length} 个 API`
  return grant.disabled ? `已停用 · ${scope}` : scope
}

/**
 * 从主进程加载待审申请、授权名单、完全授权 / 停用名单与插件元信息。
 * @returns 加载完成后结束的 Promise
 */
async function loadPermissions(): Promise<void> {
  try {
    loading.value = true
    const result = await window.ztools.internal.getInternalApiGrants()
    pendingRequests.value = Object.entries(result.requests ?? {})
      .map(([pluginName, entry]) => ({
        pluginName,
        apis: entry.apis ?? [],
        reason: entry.reason,
        requestedAt: entry.requestedAt ?? 0,
        // 默认勾选全部申请项，允许用户按需取消以做部分批准
        selected: [...(entry.apis ?? [])]
      }))
      .sort((a, b) => b.requestedAt - a.requestedAt)
    permissionsMap.value = result.permissions ?? {}
    availableChannels.value = result.channels ?? []
    fullAccessPluginNames.value = result.fullAccessPluginNames ?? []
    trustedPluginNames.value = result.trustedPluginNames ?? []
    disabledPluginNames.value = result.disabledPluginNames ?? []

    // 首次加载后决定默认页签：有待审申请停留在「待处理」，否则落在「已授权」。
    if (!initialTabResolved) {
      initialTabResolved = true
      if (pendingRequests.value.length === 0) activeTab.value = 'granted'
    }

    // 拉取已安装插件元信息，为授权列表补充图标与标题。
    await loadPluginMeta()
  } catch (err: any) {
    console.error('加载高级 API 权限数据失败:', err)
    error(`加载权限数据失败: ${err?.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

/**
 * 加载已安装插件元信息并按插件名（含 __dev 变体）建立索引。
 * @returns 加载完成后结束的 Promise
 */
async function loadPluginMeta(): Promise<void> {
  try {
    const plugins = await window.ztools.internal.getPlugins()
    const meta: Record<string, { title?: string; logo?: string }> = {}
    for (const plugin of plugins ?? []) {
      if (!plugin?.name) continue
      // 开发插件运行名带 __dev 后缀，授权键既可能是原名也可能是运行名，两者都登记。
      meta[plugin.name] = { title: plugin.title, logo: plugin.logo }
      meta[plugin.name.replace(/__dev$/, '')] ??= { title: plugin.title, logo: plugin.logo }
    }
    pluginMetaMap.value = meta
  } catch (err: unknown) {
    // 元信息仅用于展示，失败时回退到首字符头像，不影响权限功能。
    console.warn('加载插件元信息失败:', err)
  }
}

/**
 * 审批当前申请中勾选的通道；弹风险确认后写入授权并移除申请。
 * @param request 待处理的申请条目
 * @returns 审批流程结束后结束的 Promise
 */
async function handleApproveRequest(request: PendingRequestView): Promise<void> {
  const selectedApis = [...request.selected]
  if (selectedApis.length === 0) {
    error('请至少勾选一个要授权的 API')
    return
  }

  const confirmed = await confirm({
    title: '授权高级 API 风险提示',
    message: `即将允许插件 "${request.pluginName}" 调用以下 ${selectedApis.length} 个高级 API：\n${selectedApis.join('\n')}\n\n高级 API 可读写 ZTools 设置、管理插件或执行其他高权限操作，请仅授权你信任的插件。授权后立即生效，可随时在本页移除。`,
    type: 'danger',
    confirmText: '已知风险，批准',
    cancelText: '取消'
  })
  if (!confirmed) return

  const result = await window.ztools.internal.resolveInternalApiRequest(
    request.pluginName,
    selectedApis
  )
  if (result?.success) {
    success(`已批准 ${request.pluginName} 的授权申请`)
    await loadPermissions()
  } else {
    error(`审批失败: ${result?.error || '未知错误'}`)
  }
}

/**
 * 驳回申请：仅移除待审条目，不改动既有授权。
 * @param request 待驳回的申请条目
 * @returns 驳回流程结束后结束的 Promise
 */
async function handleRejectRequest(request: PendingRequestView): Promise<void> {
  const result = await window.ztools.internal.resolveInternalApiRequest(request.pluginName, null)
  if (result?.success) {
    success(`已拒绝 ${request.pluginName} 的申请`)
    await loadPermissions()
  } else {
    error(`拒绝失败: ${result?.error || '未知错误'}`)
  }
}

/**
 * 切换插件整体授权启停：停用仅挂起配置，重新开启后原授权恢复。
 * @param grant 已授权插件条目
 * @param event 触发变更的原生事件
 * @returns 切换流程结束后结束的 Promise
 */
async function handleToggleGrantAuthorization(
  grant: AuthorizedPluginView,
  event: Event
): Promise<void> {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const nextDisabled = !target.checked

  togglingPluginName.value = grant.pluginName
  try {
    const result = await window.ztools.internal.setPluginInternalApiDisabled(
      grant.pluginName,
      nextDisabled
    )
    if (result?.success) {
      success(
        nextDisabled ? `已停用 ${grant.pluginName} 的授权` : `已开启 ${grant.pluginName} 的授权`
      )
    } else {
      error(`更新授权状态失败: ${result?.error || '未知错误'}`)
    }
  } finally {
    // 无论成败都按主进程数据重绘，保证开关状态与服务端一致。
    togglingPluginName.value = ''
    await loadPermissions()
  }
}

/**
 * 展开 / 收起已授权插件的授权细节。
 * @param pluginName 插件名
 * @returns 无返回值
 */
function toggleExpand(pluginName: string): void {
  expandedPluginName.value = expandedPluginName.value === pluginName ? '' : pluginName
}

/**
 * 移除某插件的个别授权通道。
 * 完全授权插件移除任一通道即降级为按通道授权（保留其余全部通道）。
 * @param pluginName 插件名
 * @param api 要移除的通道名
 * @returns 移除完成后结束的 Promise
 */
async function handleRemoveGrantedApi(pluginName: string, api: string): Promise<void> {
  if (fullAccessPluginNames.value.includes(pluginName)) {
    const downgrade = await downgradeFullAccess(pluginName)
    if (!downgrade) return
    await savePluginGrants(
      pluginName,
      availableChannels.value.filter((item) => item !== api)
    )
    return
  }
  const entry = permissionsMap.value[pluginName] ?? []
  const nextApis = entry.filter((item) => item !== api)
  await savePluginGrants(pluginName, nextApis)
}

/**
 * 移除某插件的全部授权（完全授权插件同时撤销其完全授权状态）。
 * @param pluginName 插件名
 * @returns 移除完成后结束的 Promise
 */
async function handleRemoveAllGrants(pluginName: string): Promise<void> {
  const confirmed = await confirm({
    title: '移除插件授权',
    message: `确定移除插件 "${pluginName}" 的全部高级 API 授权吗？插件依赖这些权限的功能将立即不可用。`,
    type: 'warning',
    confirmText: '移除',
    cancelText: '取消'
  })
  if (!confirmed) return
  if (fullAccessPluginNames.value.includes(pluginName)) {
    const downgrade = await downgradeFullAccess(pluginName)
    if (!downgrade) return
  }
  await savePluginGrants(pluginName, [])
}

/**
 * 将插件从完全授权名单降级为按通道授权（通道明细随后由调用方写入）。
 * @param pluginName 插件名
 * @returns 是否降级成功
 */
async function downgradeFullAccess(pluginName: string): Promise<boolean> {
  const result = await window.ztools.internal.setPluginInternalApiFullAccess(pluginName, false)
  if (result?.success) return true
  error(`更新完全授权状态失败: ${result?.error || '未知错误'}`)
  return false
}

/**
 * 为已授权插件追加通道。
 * @param pluginName 插件名
 * @returns 追加完成后结束的 Promise
 */
async function handleAddGrantedApi(pluginName: string): Promise<void> {
  const selection = addApiSelections.value[pluginName]
  const apisToAdd = Array.isArray(selection) ? selection.map(String) : []
  if (apisToAdd.length === 0) {
    error('请先选择要追加的 API')
    return
  }
  const entry = permissionsMap.value[pluginName] ?? []
  const nextApis = Array.from(new Set([...entry, ...apisToAdd]))
  await savePluginGrants(pluginName, nextApis)
  addApiSelections.value[pluginName] = []
}

/**
 * 打开手动授权弹窗并重置表单。
 * @returns 无返回值
 */
function openManualDialog(): void {
  manualPluginName.value = ''
  manualSelectedApis.value = []
  manualFullAccess.value = false
  showManualDialog.value = true
}

/**
 * 关闭手动授权弹窗。
 * @returns 无返回值
 */
function closeManualDialog(): void {
  showManualDialog.value = false
}

/**
 * 手动为插件添加授权（不经过申请流程）：按通道授权，或授予全部高级 API。
 * @returns 添加完成后结束的 Promise
 */
async function handleManualAddGrant(): Promise<void> {
  const pluginName = manualPluginName.value.trim()
  if (!pluginName) {
    error('请输入插件名称')
    return
  }

  // 完全授权：不限制通道，授予全部高级 API。
  if (manualFullAccess.value) {
    const confirmed = await confirm({
      title: '授权高级 API 风险提示',
      message: `即将允许插件 "${pluginName}" 调用全部高级 API（${availableChannels.value.length} 个）。\n\n高级 API 可读写 ZTools 设置、管理插件或执行其他高权限操作，请仅授权你完全信任的插件。`,
      type: 'danger',
      confirmText: '已知风险，继续授权',
      cancelText: '取消'
    })
    if (!confirmed) return

    const result = await window.ztools.internal.setPluginInternalApiFullAccess(pluginName, true)
    if (!result?.success) {
      error(`授予完全授权失败: ${result?.error || '未知错误'}`)
      return
    }
    success(`已授予 ${pluginName} 全部高级 API 权限`)
    await resumeIfSuspended(pluginName)
    // 与其它授权操作一致：按主进程最新数据重绘列表（广播亦会触发一次刷新）。
    await loadPermissions()
    closeManualDialog()
    return
  }

  const apis = Array.isArray(manualSelectedApis.value) ? manualSelectedApis.value.map(String) : []
  if (apis.length === 0) {
    error('请选择要授权的 API')
    return
  }

  const confirmed = await confirm({
    title: '授权高级 API 风险提示',
    message: `即将允许插件 "${pluginName}" 调用以下 ${apis.length} 个高级 API：\n${apis.join('\n')}\n\n请仅授权你完全信任的插件。`,
    type: 'danger',
    confirmText: '已知风险，继续授权',
    cancelText: '取消'
  })
  if (!confirmed) return

  // 与已有授权合并，避免覆盖此前批准的通道。
  const existing = permissionsMap.value[pluginName] ?? []
  const nextApis = Array.from(new Set([...existing, ...apis]))
  const saveResult = await savePluginGrants(pluginName, nextApis)
  if (!saveResult) return

  await resumeIfSuspended(pluginName)
  closeManualDialog()
}

/**
 * 授权视为明确的授权意图：解除插件可能存在的整体停用并刷新数据。
 * @param pluginName 插件名
 * @returns 处理完成后结束的 Promise
 */
async function resumeIfSuspended(pluginName: string): Promise<void> {
  if (disabledPluginNames.value.includes(pluginName)) {
    await window.ztools.internal.setPluginInternalApiDisabled(pluginName, false)
    await loadPermissions()
  }
}

/**
 * 保存某插件的授权通道列表（空数组等价移除全部授权）。
 * @param pluginName 插件名
 * @param apis 目标通道列表
 * @returns 是否保存成功
 */
async function savePluginGrants(pluginName: string, apis: string[]): Promise<boolean> {
  const result = await window.ztools.internal.setPluginInternalApiGrants(pluginName, apis)
  if (result?.success) {
    success(apis.length === 0 ? `已移除 ${pluginName} 的授权` : `已更新 ${pluginName} 的授权`)
    await loadPermissions()
    return true
  }
  error(`保存授权失败: ${result?.error || '未知错误'}`)
  return false
}

/**
 * 将申请提交时间格式化为相对时间描述。
 * @param timestamp 毫秒时间戳
 * @returns 相对时间文本
 */
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(timestamp).toLocaleDateString()
}

/**
 * 将申请提交时间格式化为完整本地时间（用于悬浮提示）。
 * @param timestamp 毫秒时间戳
 * @returns 完整时间文本
 */
function formatFullTime(timestamp: number): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString()
}

let permissionsChangedHandler: (() => void) | null = null

onMounted(() => {
  void loadPermissions()
  // 申请提交 / 审批 / 名单变更时主进程会广播，实时刷新本页数据。
  permissionsChangedHandler = () => void loadPermissions()
  window.ztools.internal.onInternalApiPermissionsChanged(permissionsChangedHandler)
})

onUnmounted(() => {
  permissionsChangedHandler = null
})
</script>

<template>
  <div class="content-panel">
    <!-- ==================== 页头（与其他设置页一致的标题 + 描述） ==================== -->
    <h2 class="section-title">高级 API 权限</h2>
    <p class="section-desc">
      插件调用宿主高级 API（internal）需先获得授权。插件提交申请时会立即弹出授权窗口；
      未当场处理的申请与已发放的授权都在本页集中管理。
    </p>

    <!-- ==================== 页签 + 手动授权入口（同已安装插件页） ==================== -->
    <div class="panel-header">
      <div class="tab-group">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'pending' }"
          data-testid="permission-tab-pending"
          @click="activeTab = 'pending'"
        >
          待处理
          <span class="tab-count" :class="{ 'tab-count-danger': pendingRequests.length > 0 }">
            {{ pendingRequests.length }}
          </span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'granted' }"
          data-testid="permission-tab-granted"
          @click="activeTab = 'granted'"
        >
          已授权
          <span class="tab-count">{{ authorizedPlugins.length }}</span>
        </button>
      </div>
      <button
        class="btn btn-sm btn-solid"
        data-testid="manual-grant-open"
        @click="openManualDialog"
      >
        手动授权
      </button>
    </div>

    <!-- ==================== 待处理申请页签 ==================== -->
    <section v-show="activeTab === 'pending'" class="section-group">
      <div v-if="loading" class="empty-state">加载中…</div>

      <div v-else-if="pendingRequests.length === 0" class="empty-state">
        <p class="empty-main">暂无待处理的权限申请</p>
        <p class="empty-hint">插件调用 ztools.requestInternalApiPermissions 后会出现在这里</p>
      </div>

      <transition-group v-else name="card" tag="div" class="plugin-list">
        <article
          v-for="request in pendingRequests"
          :key="request.pluginName"
          class="plugin-item request-item"
          data-testid="permission-request-card"
        >
          <div class="plugin-head">
            <div class="plugin-left">
              <div class="plugin-logo plugin-logo-fallback">
                {{ avatarChar(request.pluginName) }}
              </div>
              <div class="plugin-info">
                <span class="plugin-name">{{ request.pluginName }}</span>
                <span class="plugin-meta" :title="formatFullTime(request.requestedAt)">
                  {{ request.apis.length }} 个 API · {{ formatRelativeTime(request.requestedAt) }}
                </span>
              </div>
            </div>
            <div class="head-actions">
              <button
                class="btn btn-sm"
                data-testid="reject-request"
                @click="handleRejectRequest(request)"
              >
                拒绝
              </button>
              <button
                class="btn btn-sm btn-solid"
                data-testid="approve-request"
                :disabled="request.selected.length === 0"
                @click="handleApproveRequest(request)"
              >
                批准所选
              </button>
            </div>
          </div>

          <p v-if="request.reason" class="request-reason">{{ request.reason }}</p>

          <div class="api-pill-list">
            <label
              v-for="api in request.apis"
              :key="api"
              class="api-pill"
              :class="{ 'is-selected': request.selected.includes(api) }"
            >
              <input v-model="request.selected" type="checkbox" :value="api" />
              <span class="api-pill-check">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <span class="api-pill-name">{{ api }}</span>
            </label>
          </div>

          <p class="selected-count">
            已选 {{ request.selected.length }} / {{ request.apis.length }}
          </p>
        </article>
      </transition-group>
    </section>

    <!-- ==================== 已授权插件页签（同 MCP 服务页的插件列表） ==================== -->
    <section v-show="activeTab === 'granted'" class="section-group">
      <div v-if="loading" class="empty-state">加载中…</div>

      <div v-else-if="authorizedPlugins.length === 0" class="empty-state">
        <p class="empty-main">暂无已授权插件</p>
        <p class="empty-hint">插件申请获批或手动授权后会出现在这里</p>
      </div>

      <div v-else class="plugin-list">
        <article
          v-for="grant in authorizedPlugins"
          :key="grant.pluginName"
          class="plugin-item grant-item"
          :class="{ 'is-disabled': grant.disabled }"
          data-testid="permission-grant-card"
        >
          <button class="plugin-head" type="button" @click="toggleExpand(grant.pluginName)">
            <div class="plugin-left">
              <svg
                class="expand-icon"
                :class="{ expanded: expandedPluginName === grant.pluginName }"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M4.5 2.5L8 6L4.5 9.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <AdaptiveIcon
                v-if="grant.logo"
                :src="grant.logo"
                class="plugin-logo"
                :alt="grant.pluginName"
              />
              <div v-else class="plugin-logo plugin-logo-fallback">
                {{ avatarChar(grant.pluginName) }}
              </div>
              <div class="plugin-info">
                <span class="plugin-name">
                  {{ grant.pluginName }}
                  <span v-if="grant.fullAccess" class="grant-badge is-full">完全授权</span>
                </span>
                <span class="plugin-meta">{{ grantMetaText(grant) }}</span>
              </div>
            </div>
            <label
              class="toggle"
              :title="
                grant.disabled ? '开启整个插件的高级 API 授权' : '停用整个插件的高级 API 授权'
              "
              @click.stop
            >
              <input
                :checked="!grant.disabled"
                :disabled="togglingPluginName === grant.pluginName"
                type="checkbox"
                data-testid="grant-toggle"
                @change="handleToggleGrantAuthorization(grant, $event)"
              />
              <span class="toggle-slider"></span>
            </label>
          </button>

          <!-- 展开区：高度受限 + 内部滚动，避免 API 过多撑高页面 -->
          <div class="plugin-body" :class="{ open: expandedPluginName === grant.pluginName }">
            <div class="plugin-body-clip">
              <div class="plugin-body-scroll">
                <!-- 完全授权插件：已持有全部通道，移除任一即转为按通道授权 -->
                <p v-if="grant.fullAccess" class="grant-note">
                  已授予全部高级 API；移除任一权限后将转为按通道授权。
                </p>

                <div class="api-tag-list">
                  <span v-for="api in grant.apis" :key="api" class="api-tag">
                    <span class="api-tag-dot"></span>
                    {{ api }}
                    <button
                      class="api-tag-remove"
                      title="移除该 API 授权"
                      @click="handleRemoveGrantedApi(grant.pluginName, api)"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                        stroke-linecap="round"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                </div>

                <div class="grant-add-row">
                  <!-- 完全授权插件已持有全部通道，无可补录项，仅保留移除入口 -->
                  <template v-if="availableOptionsFor(grant.pluginName).length > 0">
                    <Select
                      v-model="addApiSelections[grant.pluginName]"
                      :options="availableOptionsFor(grant.pluginName)"
                      multiple
                      size="small"
                      placeholder="选择要追加的 API"
                      class="grant-add-select"
                    />
                    <button class="btn btn-sm" @click="handleAddGrantedApi(grant.pluginName)">
                      追加
                    </button>
                  </template>
                  <button
                    class="btn btn-sm btn-danger"
                    :class="{ 'is-alone': availableOptionsFor(grant.pluginName).length === 0 }"
                    data-testid="grant-remove-all"
                    @click="handleRemoveAllGrants(grant.pluginName)"
                  >
                    移除全部
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <!-- ==================== 手动授权弹窗 ==================== -->
    <BaseDialog
      v-model:visible="showManualDialog"
      title="手动授权"
      subtitle="绕过申请流程，直接为指定插件授予通道级高级 API 权限"
      max-width="460px"
      @close="closeManualDialog"
    >
      <div class="manual-form">
        <label class="manual-field">
          <span class="manual-label">插件 name</span>
          <input
            v-model="manualPluginName"
            type="text"
            class="input manual-plugin-input"
            placeholder="输入插件 name"
            data-testid="manual-plugin-name"
          />
        </label>
        <label class="manual-field">
          <span class="manual-label">授权 API</span>
          <Select
            v-model="manualSelectedApis"
            :options="manualApiOptions"
            multiple
            size="medium"
            :max-tag-count="1"
            :disabled="manualFullAccess"
            placeholder="选择要授权的 API"
            class="manual-api-select"
          />
        </label>
        <div class="manual-full-row">
          <span class="manual-full-title">授予全部高级 API</span>
          <label class="toggle">
            <input v-model="manualFullAccess" type="checkbox" data-testid="manual-full-access" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="closeManualDialog">取消</button>
        <button class="btn btn-solid" data-testid="manual-add-grant" @click="handleManualAddGrant">
          添加授权
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
/* ==================== 页面容器（与通用设置等页面一致：占满高度 + 内边距 + 纵向滚动） ==================== */
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* ==================== 页头（标题 + 描述，同 MCP 服务页） ==================== */
.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.6;
}

/* ==================== 页签行（同已安装插件页 panel-header / tab-group） ==================== */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.tab-count {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--control-bg);
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

.tab-btn.active .tab-count {
  background: var(--primary-light-bg);
  color: var(--primary-color);
}

/* 待审数量使用危险色徽章，提示需要处理 */
.tab-count.tab-count-danger,
.tab-btn.active .tab-count.tab-count-danger {
  background: var(--danger-color, #ef4444);
  color: #fff;
}

/* ==================== 区块分组（上边框 + 留白分隔） ==================== */
.section-group {
  margin-top: 20px;
}

/* ==================== 卡片列表（同 MCP 服务页 plugin-list / plugin-item） ==================== */
.plugin-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-item {
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--card-bg);
  overflow: hidden;
}

/* 停用授权的插件整体弱化 */
.plugin-item.is-disabled {
  opacity: 0.72;
}

/* 内置插件开关锁定态：降透明并去掉手型，与可交互开关形成视觉区分 */
.toggle input:disabled + .toggle-slider {
  opacity: 0.45;
  cursor: not-allowed;
}

.plugin-head {
  width: 100%;
  padding: 12px 14px;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  text-align: left;
}

.request-item .plugin-head {
  cursor: default;
}

.plugin-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.expand-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.plugin-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.plugin-logo-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hover-bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  user-select: none;
}

.plugin-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.plugin-name {
  color: var(--text-color);
  font-size: 14px;
  font-weight: 500;
  word-break: break-all;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.plugin-meta {
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 授权类型徽章 */
.grant-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.5;
  flex-shrink: 0;
}

.grant-badge.is-full {
  color: var(--warning-color);
  background: color-mix(in srgb, var(--warning-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning-color) 30%, transparent);
}

/* ==================== 展开区（grid 动画 + 高度受限内部滚动） ==================== */
.plugin-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}

.plugin-body.open {
  grid-template-rows: 1fr;
}

.plugin-body-clip {
  overflow: hidden;
  min-height: 0;
}

.plugin-body-scroll {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--divider-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grant-note {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* 申请理由：弱化展示在灰底块中 */
.request-reason {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--hover-bg);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.request-item {
  padding-bottom: 12px;
}

.request-item .plugin-head {
  padding-bottom: 0;
}

.request-item .api-pill-list,
.request-item .selected-count {
  margin-right: 14px;
  margin-left: 14px;
}

.request-reason {
  margin-right: 14px;
  margin-left: 14px;
}

/* 卡片进出场：离场脱离文档流并配合 move 过渡，实现列表平滑重排 */
.card-enter-active,
.card-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.card-leave-active {
  position: absolute;
  inset-inline: 0;
  pointer-events: none;
}

.card-move {
  transition: transform 0.3s ease;
}

.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ==================== 申请 API 胶囊（可勾选通道） ==================== */
.api-pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.api-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--hover-bg);
  cursor: pointer;
  user-select: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.api-pill:hover {
  border-color: var(--divider-color);
}

/* 原生 checkbox 视觉隐藏但保留可编程点击（v-model 正常工作） */
.api-pill input[type='checkbox'] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

/* 键盘聚焦胶囊时的可视焦点环 */
.api-pill:has(input:focus-visible) {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light-bg);
}

.api-pill-check {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1.5px solid var(--control-border, rgba(0, 0, 0, 0.25));
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  flex-shrink: 0;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.api-pill-name {
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  word-break: break-all;
}

.api-pill.is-selected {
  background: var(--active-bg);
  border-color: color-mix(in srgb, var(--primary-color), transparent 40%);
}

.api-pill.is-selected .api-pill-check {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: var(--text-on-primary, #fff);
}

.selected-count {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ==================== 已授权通道标签 ==================== */
/* 标签列表自身滚动：通道过多时在列表内滚动，底部追加 / 移除按钮始终可见 */
.api-tag-list {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 7px;
  max-height: 240px;
  overflow-y: auto;
}

.api-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--success-border, #a7f3d0);
  background: var(--success-light-bg, #ecfdf5);
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 12px;
  transition: border-color 0.15s ease;
}

.api-tag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-color);
  flex-shrink: 0;
}

.api-tag-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  margin-left: 2px;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.api-tag-remove:hover {
  background: var(--danger-color);
  color: #fff;
}

.grant-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 完全授权插件无可补录项时，「移除全部」单独靠右对齐 */
.grant-add-row .is-alone {
  margin-left: auto;
}

.grant-add-select {
  flex: 1;
  min-width: 0;
}

/* ==================== 手动授权弹窗表单 ==================== */
.manual-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.manual-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.manual-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* 与 medium Select（min-height 34px）保持一致的输入高度 */
.manual-plugin-input {
  height: 34px;
  box-sizing: border-box;
  padding: 0 12px;
}

.manual-api-select {
  width: 100%;
}

/* 完全授权开关行：左侧标题，右侧开关（同设置页 setting-item 布局） */
.manual-full-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: var(--hover-bg);
  border-radius: 6px;
}

.manual-full-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
}

/* ==================== 空状态（同 MCP 服务页） ==================== */
.empty-state {
  padding: 20px;
  border-radius: 8px;
  background: var(--hover-bg);
  color: var(--text-secondary);
  text-align: center;
  font-size: 13px;
}

.empty-state .empty-main {
  margin: 0;
}

.empty-state .empty-hint {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: 0.75;
}

/* 弱化动效偏好：关闭列表过渡动画 */
@media (prefers-reduced-motion: reduce) {
  .card-enter-active,
  .card-leave-active,
  .card-move,
  .plugin-body {
    transition: none;
  }
}
</style>
