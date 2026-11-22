<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AdaptiveIcon, DetailPanel } from '@/components'
import type { MarketInstallRecord } from '@shared/marketInstallHistory'
import type { Plugin } from '@/views/PluginMarketSetting/components/types'
import MarketPluginActionButton from '@/components/common/MarketPluginActionButton.vue'
import { useMarketPluginActions } from '@/composables/useMarketPluginActions'
import { jumpFunctionPluginMarketSetting } from '@/views/PluginMarketSetting/PluginMarketSetting'
import { useAccountProfile } from '@/composables'

defineEmits<{ back: [] }>()
type MarketItem = Omit<Plugin, 'installed'> & { platform?: string | string[] }
type HistoryRow = MarketInstallRecord & { path?: string; market?: MarketItem }

const api = window.ztools.internal
const { state: account } = useAccountProfile()
const { installingPlugin, downloadStates, installPlugin, cancelDownload, openPlugin } =
  useMarketPluginActions()
const rows = ref<HistoryRow[]>([])
const selected = ref<string[]>([])
const loading = ref(true)
const loadError = ref('')
const queueRunning = ref(false)
const busy = computed(() => queueRunning.value || !!installingPlugin.value)
let stopSyncListener: (() => void) | undefined
let disposed = false
let loadVersion = 0
let catalogRequest: ReturnType<typeof api.fetchPluginMarket> | undefined
const failures = ref<Record<string, string>>({})
const downloadable = computed(() => rows.value.filter((row) => !row.path && row.market))
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * 按插件标识进入市场并定位对应详情。
 * @param row 用户点击的安装记录。
 * @returns 无返回值。
 */
function openMarketDetail(row: HistoryRow): void {
  // 历史快照可能仍存在，但下架或当前平台无市场条目时没有可跳转的详情。
  if (row.market) jumpFunctionPluginMarketSetting({ type: 'detail', payload: row.market.name })
}

/**
 * 将账号安装记录与当前设备的插件路径、当前平台的商店目录对应起来。
 * @returns 列表加载完成后结束的 Promise。
 */
async function load(): Promise<void> {
  const version = ++loadVersion
  if (!rows.value.length) loading.value = true
  loadError.value = ''
  try {
    const [history, installed] = await Promise.all([
      api.getMarketInstallHistory(),
      api.getPlugins()
    ])
    if (version !== loadVersion) return
    if (!history.length) {
      rows.value = []
      return
    }
    // 商店目录已按宿主平台查询；离线时仍可打开有兼容性依据的历史插件。
    // 远端历史变更只需重读账号库及本机状态，共用当前页面的市场目录。
    catalogRequest ??= api.fetchPluginMarket()
    const catalog = await catalogRequest
    if (version !== loadVersion) return
    if (!catalog.success) {
      catalogRequest = undefined
      loadError.value = catalog.error || '暂时无法获取插件市场'
    }
    const market = new Map<string, MarketItem>(
      (catalog.data || []).map((item: MarketItem) => [item.name, item])
    )
    const local = new Map(
      installed.filter((item) => !item.isDevelopment).map((item) => [item.name, item])
    )
    const platform = api.getPlatform()
    rows.value = history.flatMap((record) => {
      const item = market.get(record.name)
      const restriction = item ? item.platform : record.platform
      const platforms = typeof restriction === 'string' ? [restriction] : restriction
      if (platforms?.length && !platforms.includes(platform)) return []
      // 若目录没有该项，只展示曾在本平台安装或明确支持本平台的历史快照。
      if (!item && record.installedOn !== platform && !platforms?.includes(platform)) return []
      const plugin = local.get(record.name)
      return [
        {
          ...record,
          title: item?.title || record.title,
          logo: item?.logo || record.logo || plugin?.logo,
          path: plugin?.path,
          market: item
        }
      ]
    })
    selected.value = selected.value.filter((name) =>
      downloadable.value.some((row) => row.name === name)
    )
  } catch (err) {
    if (version !== loadVersion) return
    catalogRequest = undefined
    loadError.value = err instanceof Error ? err.message : '加载安装记录失败'
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

/**
 * 依次安装选中的兼容插件，保留失败项供单独重试。
 * @param names 用户选择的插件名称。
 * @returns 队列内各项处理完成后结束的 Promise。
 */
async function install(names: string[]): Promise<void> {
  if (busy.value) return
  queueRunning.value = true
  // 防止先前发出的云端刷新用旧的本机路径替换正在处理的行。
  loadVersion++
  const owner = account.uid
  const queue = downloadable.value.filter((row) => names.includes(row.name))
  try {
    for (const row of queue) {
      // 用户切换账号后不再为新账号启动旧队列中的下载。
      if (!account.loggedIn || account.uid !== owner) break
      if (!row.market) continue
      delete failures.value[row.name]
      try {
        const result = await installPlugin(row.market)
        if (!result) continue
        row.path = result.plugin.path
        selected.value = selected.value.filter((name) => name !== row.name)
      } catch (err) {
        failures.value[row.name] = err instanceof Error ? err.message : '安装失败'
      }
    }
  } finally {
    queueRunning.value = false
    // 一并应用安装期间收到的云端记录，重新核对本机注册状态。
    if (!disposed) await load()
  }
}

onMounted(() => {
  stopSyncListener = api.onSyncStatusChanged?.((payload) => {
    if (payload.marketInstallHistoryChanged && !queueRunning.value) void load()
  })
  void load()
})

onUnmounted(() => {
  stopSyncListener?.()
  loadVersion++
  disposed = true
})
</script>

<template>
  <DetailPanel title="我的插件" @back="$emit('back')">
    <div class="history">
      <p v-if="loading" class="state">正在读取安装记录…</p>
      <template v-else>
        <p v-if="loadError" role="alert">{{ loadError }} <button @click="load">重试</button></p>
        <p v-if="!rows.length && !loadError" class="state">暂无适用于当前平台的插件安装记录</p>
        <div v-if="downloadable.length" class="toolbar">
          <label>
            <input
              type="checkbox"
              :checked="selected.length === downloadable.length"
              :indeterminate="selected.length > 0 && selected.length < downloadable.length"
              :disabled="busy"
              @change="
                selected =
                  selected.length === downloadable.length ? [] : downloadable.map((row) => row.name)
              "
            />
            全选可下载插件
          </label>
          <button :disabled="!selected.length || busy" @click="install(selected)">
            安装所选{{ selected.length ? '（' + selected.length + '）' : '' }}
          </button>
        </div>
        <ul>
          <li v-for="row in rows" :key="row.name" @click.self="openMarketDetail(row)">
            <input
              v-if="downloadable.length"
              v-model="selected"
              type="checkbox"
              :value="row.name"
              :aria-label="'选择' + row.title"
              :disabled="busy || !!row.path || !row.market"
            />
            <button
              class="history-detail"
              type="button"
              :disabled="!row.market"
              :aria-label="'查看' + row.title + '的市场详情'"
              @click="openMarketDetail(row)"
            >
              <span class="logo" aria-hidden="true">
                <span class="i-z-plugin"></span>
                <AdaptiveIcon
                  v-if="row.logo"
                  :src="row.logo"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).hidden = true"
                />
              </span>
              <span class="info">
                <strong>{{ row.title }}</strong>
                <time :datetime="row.installedAt"
                  >首次安装于 {{ dateFormat.format(new Date(row.installedAt)) }}</time
                >
                <span v-if="failures[row.name]" role="alert">{{ failures[row.name] }}</span>
              </span>
            </button>
            <MarketPluginActionButton
              :installed="!!row.path"
              :unavailable="!row.market"
              :disabled="busy && installingPlugin !== row.name"
              :download-state="downloadStates[row.name]"
              @open="openPlugin(row)"
              @download="
                downloadStates[row.name]?.status === 'downloading'
                  ? cancelDownload(row.name)
                  : install([row.name])
              "
            />
          </li>
        </ul>
      </template>
    </div>
  </DetailPanel>
</template>

<style scoped>
.history {
  padding: 12px 20px;
  color: var(--text-color);
  font-size: 13px;
}
.toolbar,
li,
label {
  display: flex;
  align-items: center;
  gap: 12px;
}
.toolbar {
  justify-content: space-between;
  padding: 4px 0 12px;
  border-bottom: 1px solid var(--divider-color);
}
label {
  gap: 6px;
}
input {
  accent-color: var(--primary-color);
  margin: 0;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  min-height: 64px;
  padding: 8px 0;
  border-bottom: 1px solid var(--divider-color);
}
.history-detail {
  display: flex;
  flex: 1;
  align-self: stretch;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
}
.history-detail:enabled {
  cursor: pointer;
}
.history-detail:enabled:hover strong,
.history-detail:focus-visible strong {
  color: var(--primary-color);
}
.logo {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--control-bg);
  display: grid;
  place-items: center;
}
.logo > * {
  grid-area: 1 / 1;
}
.logo:has(img:not([hidden])) > span {
  visibility: hidden;
}
.logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--bg-color);
}
.info {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 4px;
  overflow-wrap: anywhere;
}
.state,
time {
  color: var(--text-secondary);
}
.state {
  text-align: center;
  margin-top: 48px;
}
time {
  font-size: 12px;
}
.toolbar button,
[role='alert'] button {
  color: var(--primary-color);
  background: var(--control-bg);
  border: 0;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
}
.toolbar button:disabled {
  opacity: 0.55;
  cursor: default;
}
[role='alert'] {
  color: var(--danger-color, #b04444);
}
</style>
