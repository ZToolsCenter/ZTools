<script setup lang="ts">
import { onActivated, onMounted, onUnmounted, ref, computed } from 'vue'
import { useToast, DetailPanel } from '@/components'

const { success, error, warning, confirm } = useToast()
const ONLINE_SYNC_SERVER_URL = 'wss://z-tools.top'

// 同步配置
const syncEnabled = ref(false)
const config = ref({
  serverUrl: ONLINE_SYNC_SERVER_URL,
  syncInterval: 30,
  lastSyncTime: 0
})

// 是否已登录（有 token）
const loggedIn = ref(false)
const loggedUser = ref('')

// 状态
const syncState = ref<string>('disconnected')
const unsyncedCount = ref(0)
const conflictCount = ref(0)
const retryStatus = ref<{
  pendingPushBatches: number
  pendingUploads: number
  pendingDownloads: number
  failedPermanent: number
  authRequired: number
  lastError?: string
  nextRetryAt?: number
} | null>(null)
const currentLevel = ref<'main' | 'conflictList' | 'conflictDetail'>('main')
const conflictItems = ref<
  Array<{
    docId: string
    winningRev?: string
    conflictCount: number
    deleted: boolean
    lastModified?: number
  }>
>([])
const selectedConflictDocId = ref('')
const conflictDetail = ref<{
  docId: string
  winningRev?: string
  deleted: boolean
  winner: any
  conflicts: any[]
} | null>(null)
let conflictDiffCache = new WeakMap<object, ConflictDiffView>()

// 内部 token（不暴露给用户）
let currentToken = ''
let currentRefreshToken = ''

// 状态映射
const stateLabels: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中...',
  authenticating: '认证中...',
  pulling: '拉取数据...',
  pushing: '推送数据...',
  live: '实时同步中',
  error: '连接异常'
}

const stateColors: Record<string, string> = {
  disconnected: 'var(--text-secondary)',
  connecting: 'var(--warning-color, #f0a020)',
  authenticating: 'var(--warning-color, #f0a020)',
  pulling: 'var(--primary-color)',
  pushing: 'var(--primary-color)',
  live: 'var(--success-color, #18a058)',
  error: 'var(--danger-color, #d03050)'
}

const stateLabel = computed(() => stateLabels[syncState.value] || syncState.value)
const stateColor = computed(() => stateColors[syncState.value] || 'var(--text-secondary)')
const isConnected = computed(() => syncState.value === 'live')
const retryPendingTotal = computed(() => {
  const status = retryStatus.value
  if (!status) return 0
  return status.pendingPushBatches + status.pendingUploads + status.pendingDownloads
})
const retryNextTime = computed(() => {
  const next = retryStatus.value?.nextRetryAt
  if (!next) return ''
  const diff = Math.max(0, next - Date.now())
  if (diff < 1000) return '即将重试'
  return `${Math.ceil(diff / 1000)} 秒后重试`
})

const lastSyncTime = computed(() => {
  if (!config.value.lastSyncTime) return '从未同步'
  const diff = Date.now() - config.value.lastSyncTime
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
})

function applySyncStatus(status: any): void {
  const nextConfig = status?.config || null
  const isOnlineAccount = nextConfig?.serverUrl === ONLINE_SYNC_SERVER_URL

  syncEnabled.value = Boolean(isOnlineAccount && nextConfig?.enabled)
  config.value.serverUrl = ONLINE_SYNC_SERVER_URL
  config.value.syncInterval = nextConfig?.syncInterval || 30
  config.value.lastSyncTime = status?.lastSyncTime || nextConfig?.lastSyncTime || 0
  syncState.value = status?.state || 'disconnected'
  unsyncedCount.value = status?.unsyncedCount || 0
  conflictCount.value = status?.conflictCount || 0
  retryStatus.value = status?.retryStatus || null

  if (nextConfig?.token && isOnlineAccount) {
    loggedIn.value = true
    loggedUser.value = nextConfig.username || status?.username || '已登录'
    currentToken = nextConfig.token
    currentRefreshToken = nextConfig.refreshToken || ''
  } else {
    loggedIn.value = false
    loggedUser.value = ''
    currentToken = ''
    currentRefreshToken = ''
  }
}

async function refreshSyncStatus(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetStatus()
    if (result.success) {
      applySyncStatus(result.status || {})
      await refreshVisibleConflictPanel()
    }
  } catch (err) {
    console.error('加载同步状态失败:', err)
  }
}

async function refreshVisibleConflictPanel(): Promise<void> {
  if (currentLevel.value === 'conflictList') {
    await loadConflictList()
    return
  }
  if (currentLevel.value === 'conflictDetail' && selectedConflictDocId.value) {
    const result = await window.ztools.internal.syncGetConflictDetail(selectedConflictDocId.value)
    if (result.success) {
      conflictDiffCache = new WeakMap<object, ConflictDiffView>()
      conflictDetail.value = result.detail || null
    }
  }
}

async function loadConflictList(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncListConflicts()
    if (result.success) {
      conflictItems.value = result.items || []
    }
  } catch (err) {
    console.error('加载冲突列表失败:', err)
  }
}

async function openConflictList(): Promise<void> {
  await loadConflictList()
  currentLevel.value = 'conflictList'
}

async function openConflictDetail(docId: string): Promise<void> {
  selectedConflictDocId.value = docId
  try {
    const result = await window.ztools.internal.syncGetConflictDetail(docId)
    if (result.success) {
      conflictDiffCache = new WeakMap<object, ConflictDiffView>()
      conflictDetail.value = result.detail || null
      currentLevel.value = 'conflictDetail'
    }
  } catch (err) {
    console.error('加载冲突详情失败:', err)
  }
}

function closeConflictList(): void {
  currentLevel.value = 'main'
}

function closeConflictDetail(): void {
  currentLevel.value = 'conflictList'
  conflictDetail.value = null
  selectedConflictDocId.value = ''
}

async function handleResolveConflict(
  sourceRev: string,
  mode: 'winner' | 'conflict' = 'conflict'
): Promise<void> {
  if (!selectedConflictDocId.value) return

  const keepWinner = mode === 'winner'
  const confirmed = await confirm({
    title: keepWinner ? '保留当前版本' : '使用冲突版本',
    message: keepWinner
      ? `确定保留当前 winner ${sourceRev} 并解决冲突吗？这会生成一个新的 resolve revision，并清理其他冲突版本。`
      : `确定要将 revision ${sourceRev} 设为当前结果吗？这会生成一个新的 resolve revision 并继续同步到其他设备。`,
    type: 'warning',
    confirmText: keepWinner ? '保留当前版本' : '确认切换',
    cancelText: '取消'
  })
  if (!confirmed) return

  try {
    const result = await window.ztools.internal.syncResolveConflict(
      selectedConflictDocId.value,
      sourceRev
    )
    if (!result.success) {
      error(`解决冲突失败：${result.error || '未知错误'}`)
      return
    }

    success(keepWinner ? '已保留当前版本并解决冲突' : '已生成新的当前版本')
    await refreshSyncStatus()
    await loadConflictList()
    await openConflictDetail(selectedConflictDocId.value)
  } catch (err: any) {
    error(`解决冲突失败：${err.message}`)
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function sortForDisplay(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => sortForDisplay(item))
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, any>>((out, key) => {
        out[key] = sortForDisplay(value[key])
        return out
      }, {})
  }

  return value
}

function stringifyForDiff(value: any): string {
  return JSON.stringify(sortForDisplay(value), null, 2)
}

type DiffLineType = 'equal' | 'changed' | 'added' | 'removed' | 'empty'

interface DiffSideLine {
  lineNo: number | null
  text: string
  type: DiffLineType
}

interface DiffRow {
  left: DiffSideLine
  right: DiffSideLine
}

interface ConflictDiffView {
  rows: DiffRow[]
  changed: number
  added: number
  removed: number
}

function createDiffSideLine(lineNo: number | null, text: string, type: DiffLineType): DiffSideLine {
  return { lineNo, text, type }
}

function splitDiffLines(value: any): string[] {
  return stringifyForDiff(value).split('\n')
}

function alignChangedBlocks(leftBlock: string[], rightBlock: string[], rows: DiffRow[]): void {
  const max = Math.max(leftBlock.length, rightBlock.length)
  for (let index = 0; index < max; index += 1) {
    const leftText = leftBlock[index]
    const rightText = rightBlock[index]
    if (leftText !== undefined && rightText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, leftText, 'changed'),
        right: createDiffSideLine(null, rightText, 'changed')
      })
    } else if (leftText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, leftText, 'removed'),
        right: createDiffSideLine(null, '', 'empty')
      })
    } else if (rightText !== undefined) {
      rows.push({
        left: createDiffSideLine(null, '', 'empty'),
        right: createDiffSideLine(null, rightText, 'added')
      })
    }
  }
}

function numberDiffRows(rows: DiffRow[]): DiffRow[] {
  let leftLineNo = 1
  let rightLineNo = 1
  return rows.map((row) => {
    const left = { ...row.left }
    const right = { ...row.right }
    if (left.type !== 'empty') {
      left.lineNo = leftLineNo
      leftLineNo += 1
    }
    if (right.type !== 'empty') {
      right.lineNo = rightLineNo
      rightLineNo += 1
    }
    return { left, right }
  })
}

function buildJsonSideBySideDiff(winner: any, loser: any): ConflictDiffView {
  const leftLines = splitDiffLines(winner)
  const rightLines = splitDiffLines(loser)
  const leftLength = leftLines.length
  const rightLength = rightLines.length
  const lcs: number[][] = Array.from({ length: leftLength + 1 }, () =>
    Array(rightLength + 1).fill(0)
  )

  for (let i = leftLength - 1; i >= 0; i -= 1) {
    for (let j = rightLength - 1; j >= 0; j -= 1) {
      if (leftLines[i] === rightLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let leftBlock: string[] = []
  let rightBlock: string[] = []

  const flushBlocks = (): void => {
    if (leftBlock.length === 0 && rightBlock.length === 0) return
    alignChangedBlocks(leftBlock, rightBlock, rows)
    leftBlock = []
    rightBlock = []
  }

  while (i < leftLength || j < rightLength) {
    if (i < leftLength && j < rightLength && leftLines[i] === rightLines[j]) {
      flushBlocks()
      rows.push({
        left: createDiffSideLine(null, leftLines[i], 'equal'),
        right: createDiffSideLine(null, rightLines[j], 'equal')
      })
      i += 1
      j += 1
      continue
    }

    if (j >= rightLength || (i < leftLength && lcs[i + 1][j] >= lcs[i][j + 1])) {
      leftBlock.push(leftLines[i])
      i += 1
    } else {
      rightBlock.push(rightLines[j])
      j += 1
    }
  }
  flushBlocks()

  const numberedRows = numberDiffRows(rows)
  return {
    rows: numberedRows,
    changed: numberedRows.filter(
      (row) => row.left.type === 'changed' || row.right.type === 'changed'
    ).length,
    added: numberedRows.filter((row) => row.right.type === 'added').length,
    removed: numberedRows.filter((row) => row.left.type === 'removed').length
  }
}

function getConflictDiffView(conflict: any): ConflictDiffView {
  if (conflict && typeof conflict === 'object') {
    const cached = conflictDiffCache.get(conflict)
    if (cached) return cached
    const next = buildJsonSideBySideDiff(conflictDetail.value?.winner, conflict)
    conflictDiffCache.set(conflict, next)
    return next
  }
  return buildJsonSideBySideDiff(conflictDetail.value?.winner, conflict)
}

function getConflictDiffSummary(conflict: any): {
  changed: number
  added: number
  removed: number
} {
  const diff = getConflictDiffView(conflict)
  return {
    changed: diff.changed,
    added: diff.added,
    removed: diff.removed
  }
}

function shouldEmphasizeText(left: DiffSideLine, right: DiffSideLine): boolean {
  return (
    left.type === 'changed' && right.type === 'changed' && left.text.trim() !== right.text.trim()
  )
}

function splitComparableLine(line: string): { prefix: string; value: string } {
  const separatorIndex = line.indexOf(':')
  if (separatorIndex === -1) {
    return { prefix: '', value: line }
  }
  return {
    prefix: line.slice(0, separatorIndex + 1),
    value: line.slice(separatorIndex + 1)
  }
}

function getInlineParts(
  line: DiffSideLine,
  peer: DiffSideLine
): { prefix: string; value: string; changed: boolean } {
  if (!shouldEmphasizeText(line, peer)) {
    return { prefix: '', value: line.text, changed: false }
  }
  const current = splitComparableLine(line.text)
  const other = splitComparableLine(peer.text)
  if (current.prefix && current.prefix === other.prefix) {
    return { prefix: current.prefix, value: current.value, changed: true }
  }
  return { prefix: '', value: line.text, changed: true }
}

function lineClass(line: DiffSideLine): string {
  return `diff-line diff-line-${line.type}`
}

function sideLabel(type: DiffLineType): string {
  switch (type) {
    case 'added':
      return '+'
    case 'removed':
      return '-'
    case 'changed':
      return '~'
    default:
      return ''
  }
}

function summaryLabel(conflict: any): string {
  const summary = getConflictDiffSummary(conflict)
  return `修改 ${summary.changed} 行 · 新增 ${summary.added} 行 · 删除 ${summary.removed} 行`
}

// 开关切换
async function handleSyncToggle(): Promise<void> {
  try {
    if (!syncEnabled.value) {
      syncState.value = 'disconnected'
      await window.ztools.internal.syncStopAutoSync()
    }

    if (syncEnabled.value && !currentToken) {
      warning('请先通过左下角登录 ZTools 账号')
      syncEnabled.value = false
      return
    }

    if (syncEnabled.value) {
      syncState.value = 'connecting'
    }

    const result = await window.ztools.internal.syncSaveConfig({
      enabled: syncEnabled.value,
      serverUrl: ONLINE_SYNC_SERVER_URL,
      token: currentToken,
      refreshToken: currentRefreshToken,
      syncInterval: config.value.syncInterval,
      username: loggedUser.value
    })
    if (!result.success) {
      error(`保存失败：${result.error}`)
      syncEnabled.value = !syncEnabled.value
      await refreshSyncStatus()
    }
  } catch (err: any) {
    error(`操作失败：${err.message}`)
    syncEnabled.value = !syncEnabled.value
    await refreshSyncStatus()
  }
}

// 立即同步
async function syncNow(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncPerformSync()
    if (result.success) {
      success('已触发重新同步')
      setTimeout(() => {
        void refreshSyncStatus()
      }, 3000)
    } else {
      error(`同步失败：${result.error}`)
    }
  } catch (err: any) {
    error(`同步失败：${err.message}`)
  }
}

async function retryNow(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncRetryNow()
    if (result.success) {
      success('已触发重试')
      await refreshSyncStatus()
    } else {
      error(`重试失败：${result.error}`)
    }
  } catch (err: any) {
    error(`重试失败：${err.message}`)
  }
}

// 强制全量推送
const forcePushing = ref(false)
async function forcePushAll(): Promise<void> {
  forcePushing.value = true
  try {
    const result = await window.ztools.internal.syncForcePushAll()
    if (result.success) {
      success('已触发全量推送，请等待完成')
      setTimeout(() => {
        void refreshSyncStatus()
      }, 5000)
    } else {
      error(`推送失败：${result.error}`)
    }
  } catch (err: any) {
    error(`推送失败：${err.message}`)
  } finally {
    forcePushing.value = false
  }
}

const resettingSyncState = ref(false)
async function resetLocalSyncState(): Promise<void> {
  const confirmed = await confirm({
    title: '重置本机同步状态',
    message:
      '确定要将本机所有同步数据标记为未同步吗？这不会删除本地文档和附件，但会清空本机同步进度；下次同步会重新上传本地数据。',
    type: 'warning',
    confirmText: '标记为未同步',
    cancelText: '取消'
  })
  if (!confirmed) return

  resettingSyncState.value = true
  try {
    const result = await window.ztools.internal.syncResetLocalSyncState()
    if (!result.success) {
      error(`重置失败：${result.error || '未知错误'}`)
      return
    }

    success(`已将 ${result.documentsMarked || 0} 个文档标记为未同步`)
    await refreshSyncStatus()
  } catch (err: any) {
    error(`重置失败：${err.message}`)
  } finally {
    resettingSyncState.value = false
  }
}

// 轮询
let statePoller: ReturnType<typeof setInterval> | null = null
let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
let stopSyncStatusListener: (() => void) | null = null

function scheduleStatusRefresh(delay = 120): void {
  if (statusRefreshTimer) {
    clearTimeout(statusRefreshTimer)
  }
  statusRefreshTimer = setTimeout(() => {
    statusRefreshTimer = null
    void refreshSyncStatus()
  }, delay)
}

function startStatePolling(): void {
  statePoller = setInterval(() => {
    scheduleStatusRefresh(0)
  }, 5000)
}

function bindSyncStatusListener(): void {
  if (typeof window.ztools.internal.onSyncStatusChanged !== 'function') return
  stopSyncStatusListener =
    window.ztools.internal.onSyncStatusChanged((payload = {}) => {
      if ('state' in payload) {
        syncState.value = payload.state || 'disconnected'
      }
      if ('retryStatus' in payload) {
        retryStatus.value = payload.retryStatus || null
      }
      if ('lastSyncTime' in payload) {
        config.value.lastSyncTime = payload.lastSyncTime || 0
      }
      if (payload.refresh !== false) {
        scheduleStatusRefresh()
      }
    }) || null
}

onMounted(() => {
  void refreshSyncStatus()
  bindSyncStatusListener()
  startStatePolling()
})

onActivated(() => {
  scheduleStatusRefresh(0)
})

onUnmounted(() => {
  if (statePoller) clearInterval(statePoller)
  if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
  stopSyncStatusListener?.()
})
</script>

<template>
  <div class="content-panel">
    <div v-show="currentLevel === 'main'" class="main-content">
      <div class="sync-header">
        <div class="header-info">
          <h2 class="section-title">数据同步</h2>
          <p class="section-desc">
            {{ loggedIn ? '自动同步设置和插件数据到所有设备' : '登录后可开启云同步' }}
          </p>
        </div>
        <div class="header-toggle">
          <span class="toggle-label">{{ syncEnabled ? '已启用' : '已禁用' }}</span>
          <label class="toggle">
            <input
              v-model="syncEnabled"
              type="checkbox"
              :disabled="!loggedIn"
              @change="handleSyncToggle"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <!-- ==================== 同步 ==================== -->
      <div class="setting-group">
        <template v-if="syncEnabled">
          <div class="setting-item">
            <div class="setting-label">
              <span>同步状态</span>
              <span class="setting-desc">
                <span class="state-dot" :style="{ background: stateColor }"></span>
                <span :style="{ color: stateColor }">{{ stateLabel }}</span>
                <span v-if="unsyncedCount > 0" class="unsynced-badge"
                  >{{ unsyncedCount }} 待同步</span
                >
                <span v-if="conflictCount > 0" class="unsynced-badge conflict-badge"
                  >{{ conflictCount }} 冲突</span
                >
              </span>
            </div>
            <div class="setting-control">
              <button class="btn btn-primary btn-sm" :disabled="!isConnected" @click="syncNow">
                立即同步
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>最后同步</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ lastSyncTime }}</span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>待同步文档</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ unsyncedCount }} 个</span>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label">
              <span>弱网重试</span>
              <span class="setting-desc">
                文档批次 {{ retryStatus?.pendingPushBatches || 0 }}，上传
                {{ retryStatus?.pendingUploads || 0 }}，下载
                {{ retryStatus?.pendingDownloads || 0 }}
                <template v-if="retryStatus?.authRequired">，需要重新登录</template>
                <template v-if="retryStatus?.failedPermanent"
                  >，{{ retryStatus.failedPermanent }} 个失败</template
                >
                <template v-if="retryNextTime">，{{ retryNextTime }}</template>
                <template v-if="retryStatus?.lastError">，{{ retryStatus.lastError }}</template>
              </span>
            </div>
            <div class="setting-control">
              <button class="btn btn-sm" :disabled="retryPendingTotal === 0" @click="retryNow">
                立即重试
              </button>
            </div>
          </div>

          <div class="setting-item clickable-item" @click="openConflictList">
            <div class="setting-label">
              <span>冲突文档</span>
              <span class="setting-desc">查看当前保留的冲突文档与 revisions</span>
            </div>
            <div class="setting-control">
              <span class="status-value">{{ conflictCount }} 个</span>
            </div>
          </div>

          <div v-if="unsyncedCount > 0" class="setting-item">
            <div class="setting-label">
              <span>全量推送</span>
              <span class="setting-desc"
                >将本地所有数据强制推送到云端（首次同步或数据不一致时使用）</span
              >
            </div>
            <div class="setting-control">
              <button
                class="btn btn-sm"
                :disabled="!isConnected || forcePushing"
                @click="forcePushAll"
              >
                {{ forcePushing ? '推送中...' : '强制推送' }}
              </button>
            </div>
          </div>
        </template>

        <div class="setting-item">
          <div class="setting-label">
            <span>重置同步状态</span>
            <span class="setting-desc"
              >切换服务地址后使用：保留本地数据，清空本机同步进度并重新标记为待上传</span
            >
          </div>
          <div class="setting-control">
            <button
              class="btn btn-sm btn-warning"
              :disabled="!loggedIn || resettingSyncState"
              @click="resetLocalSyncState"
            >
              {{ resettingSyncState ? '重置中...' : '标记为未同步' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <Transition name="slide">
      <DetailPanel
        v-if="currentLevel === 'conflictList'"
        title="冲突文档"
        @back="closeConflictList"
      >
        <div class="conflict-panel-content">
          <div v-if="conflictItems.length === 0" class="empty-state">当前没有冲突文档</div>
          <div v-else class="conflict-list">
            <div
              v-for="item in conflictItems"
              :key="item.docId"
              class="card conflict-card"
              @click="openConflictDetail(item.docId)"
            >
              <div class="conflict-card-main">
                <div class="conflict-doc-id">{{ item.docId }}</div>
                <div class="conflict-meta">
                  <span>当前 winner: {{ item.winningRev || '未知' }}</span>
                  <span>冲突 leaf: {{ item.conflictCount }}</span>
                  <span v-if="item.deleted">已删除</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DetailPanel>
    </Transition>

    <Transition name="slide">
      <DetailPanel
        v-if="currentLevel === 'conflictDetail'"
        :title="selectedConflictDocId || '冲突详情'"
        @back="closeConflictDetail"
      >
        <div class="conflict-panel-content">
          <div v-if="!conflictDetail" class="empty-state">暂无冲突详情</div>
          <template v-else>
            <div class="conflict-detail-block">
              <div class="conflict-detail-title">版本对比</div>
              <div class="conflict-meta single">
                <span>Winner: {{ conflictDetail.winningRev || '未知' }}</span>
                <span v-if="conflictDetail.deleted">当前 winner 为 tombstone</span>
              </div>
              <div class="winner-actions">
                <button
                  class="btn btn-primary btn-sm"
                  :disabled="!conflictDetail.winningRev"
                  @click="handleResolveConflict(conflictDetail.winningRev!, 'winner')"
                >
                  保留当前版本并解决冲突
                </button>
              </div>
              <div v-if="conflictDetail.conflicts.length === 0" class="empty-state">
                暂无 loser leaf
              </div>
              <div v-else class="conflict-revision-list">
                <div
                  v-for="(item, index) in conflictDetail.conflicts"
                  :key="item._rev || index"
                  class="card revision-card"
                >
                  <div class="revision-header">
                    <div>
                      <div class="revision-title">Conflict: {{ item._rev || '未知' }}</div>
                      <div class="conflict-meta single">
                        <span>{{ summaryLabel(item) }}</span>
                        <span v-if="item._deleted">tombstone</span>
                      </div>
                    </div>
                    <div class="revision-actions">
                      <button class="btn btn-sm" @click="handleResolveConflict(item._rev)">
                        使用此版本
                      </button>
                    </div>
                  </div>

                  <div class="side-by-side-diff">
                    <div class="diff-pane-header">
                      <div>Winner</div>
                      <div>Conflict</div>
                    </div>
                    <div class="diff-body">
                      <div
                        v-for="(row, rowIndex) in getConflictDiffView(item).rows"
                        :key="`${item._rev || index}-${rowIndex}`"
                        class="diff-row"
                      >
                        <div :class="lineClass(row.left)">
                          <span class="diff-marker">{{ sideLabel(row.left.type) }}</span>
                          <span class="diff-line-no">{{ row.left.lineNo || '' }}</span>
                          <code>
                            <template v-if="getInlineParts(row.left, row.right).prefix">
                              {{ getInlineParts(row.left, row.right).prefix
                              }}<mark>{{ getInlineParts(row.left, row.right).value }}</mark>
                            </template>
                            <template v-else-if="getInlineParts(row.left, row.right).changed">
                              <mark>{{ getInlineParts(row.left, row.right).value }}</mark>
                            </template>
                            <template v-else>{{ row.left.text }}</template>
                          </code>
                        </div>
                        <div :class="lineClass(row.right)">
                          <span class="diff-marker">{{ sideLabel(row.right.type) }}</span>
                          <span class="diff-line-no">{{ row.right.lineNo || '' }}</span>
                          <code>
                            <template v-if="getInlineParts(row.right, row.left).prefix">
                              {{ getInlineParts(row.right, row.left).prefix
                              }}<mark>{{ getInlineParts(row.right, row.left).value }}</mark>
                            </template>
                            <template v-else-if="getInlineParts(row.right, row.left).changed">
                              <mark>{{ getInlineParts(row.right, row.left).value }}</mark>
                            </template>
                            <template v-else>{{ row.right.text }}</template>
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </DetailPanel>
    </Transition>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.main-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.sync-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 16px;
  flex-shrink: 0;
}

.section-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
}

.section-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.header-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toggle-label {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 设置分组 */
.setting-group {
  margin-bottom: 28px;
}

.setting-group:last-child {
  margin-bottom: 0;
}

.setting-group-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

/* 设置项 */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
  border-bottom: 1px solid var(--divider-color);
}

.setting-group .setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-label > span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.clickable-item {
  cursor: pointer;
}

.clickable-item:hover {
  background: var(--hover-bg);
}

/* 状态指示 */
.state-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.unsynced-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--warning-color, #f0a020);
  color: #fff;
}

.conflict-badge {
  background: var(--danger-color, #d03050);
}

.status-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.conflict-panel-content {
  padding: 16px;
}

.empty-state {
  font-size: 13px;
  color: var(--text-secondary);
}

.conflict-list,
.conflict-revision-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.conflict-card,
.revision-card {
  padding: 12px;
  cursor: pointer;
}

.conflict-card-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-doc-id,
.conflict-detail-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
}

.conflict-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.conflict-meta.single {
  margin-bottom: 8px;
}

.winner-actions {
  display: flex;
  justify-content: flex-start;
  margin: 8px 0 12px;
}

.conflict-detail-block {
  margin-bottom: 20px;
}

.revision-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.revision-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.revision-actions {
  display: flex;
  justify-content: flex-end;
}

.side-by-side-diff {
  --diff-pane-min-width: 520px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
}

.diff-pane-header {
  display: grid;
  grid-template-columns: minmax(var(--diff-pane-min-width), 1fr) minmax(
      var(--diff-pane-min-width),
      1fr
    );
  min-width: calc(var(--diff-pane-min-width) * 2);
  border-bottom: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.diff-pane-header > div {
  padding: 8px 12px;
}

.diff-pane-header > div:first-child {
  border-right: 1px solid var(--border-color);
}

.diff-body {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.55;
}

.diff-row {
  display: grid;
  grid-template-columns: minmax(var(--diff-pane-min-width), 1fr) minmax(
      var(--diff-pane-min-width),
      1fr
    );
  min-width: calc(var(--diff-pane-min-width) * 2);
}

.diff-line {
  display: grid;
  grid-template-columns: 18px 42px minmax(0, 1fr);
  min-height: 22px;
  padding-right: 10px;
  white-space: pre;
}

.diff-line:first-child {
  border-right: 1px solid var(--border-color);
}

.diff-marker,
.diff-line-no {
  user-select: none;
  color: var(--text-secondary);
  text-align: right;
}

.diff-marker {
  padding-right: 4px;
  font-weight: 700;
}

.diff-line-no {
  padding-right: 8px;
  opacity: 0.72;
}

.diff-line code {
  overflow: visible;
  color: var(--text-color);
  font-family: inherit;
}

.diff-line mark {
  border-radius: 3px;
  background: color-mix(in srgb, var(--warning-color, #f0a020), transparent 70%);
  color: inherit;
}

.diff-line-changed {
  background: color-mix(in srgb, var(--warning-color, #f0a020), transparent 86%);
}

.diff-line-added {
  background: color-mix(in srgb, var(--success-color, #10b981), transparent 84%);
}

.diff-line-added .diff-marker {
  color: var(--success-color, #10b981);
}

.diff-line-removed {
  background: color-mix(in srgb, var(--danger-color, #d03050), transparent 86%);
}

.diff-line-removed .diff-marker {
  color: var(--danger-color, #d03050);
}

.diff-line-empty {
  background: color-mix(in srgb, var(--text-secondary), transparent 94%);
}

/* 说明 */
.sync-tips {
  padding: 4px 0;
}

.tip-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.8;
}
</style>
