<template>
  <div class="plugin-market">
    <!-- 可滚动内容区 -->
    <Transition name="list-slide">
      <div v-show="!isDetailVisible" class="scrollable-content">
        <div v-if="isLoading" class="loading-state">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else class="market-grid">
          <div
            v-for="plugin in plugins"
            :key="plugin.name"
            class="card plugin-card"
            :title="plugin.description"
            @click="openPluginDetail(plugin)"
          >
            <div class="plugin-icon">
              <img :src="plugin.logo" class="plugin-logo-img" alt="icon" draggable="false" />
            </div>
            <div class="plugin-info">
              <div class="plugin-name">{{ plugin.name }}</div>
              <div class="plugin-description" :title="plugin.description">
                {{ plugin.description }}
              </div>
            </div>
            <div class="plugin-action">
              <template v-if="plugin.installed">
                <button
                  v-if="canUpgrade(plugin)"
                  class="btn btn-md btn-warning"
                  :disabled="installingPlugin === plugin.name"
                  @click.stop="handleUpgradePlugin(plugin)"
                >
                  <div v-if="installingPlugin === plugin.name" class="btn-loading">
                    <div class="spinner"></div>
                  </div>
                  <span v-else>升级</span>
                </button>
                <button
                  v-else
                  class="icon-btn open-btn"
                  title="打开"
                  @click.stop="handleOpenPlugin(plugin)"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </button>
              </template>
              <button
                v-else
                class="icon-btn download-btn"
                title="下载"
                :disabled="installingPlugin === plugin.name"
                @click.stop="downloadPlugin(plugin)"
              >
                <div v-if="installingPlugin === plugin.name" class="spinner"></div>
                <svg
                  v-else
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M7 10L12 15L17 10"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M12 15V3"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 插件详情覆盖面板组件 -->
    <Transition name="slide">
      <PluginDetail
        v-if="isDetailVisible && selectedPlugin"
        :plugin="selectedPlugin"
        :is-loading="installingPlugin === selectedPlugin.name"
        @back="closePluginDetail"
        @open="handleOpenPlugin(selectedPlugin)"
        @download="downloadPlugin(selectedPlugin)"
        @upgrade="handleUpgradePlugin(selectedPlugin)"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PluginDetail from './PluginDetail.vue'

interface Plugin {
  name: string
  description: string
  iconText?: string
  iconColor?: string
  logo?: string
  version: string
  downloadUrl: string
  installed: boolean
  path?: string
  localVersion?: string
}

const plugins = ref<Plugin[]>([])
const isLoading = ref(false)
const installingPlugin = ref<string | null>(null)

// 详情弹窗状态
const isDetailVisible = ref(false)
const selectedPlugin = ref<any | null>(null)

async function fetchPlugins(): Promise<void> {
  isLoading.value = true
  try {
    // 获取当前平台（同步调用）
    const currentPlatform = window.ztools.getPlatform()
    // 并行获取市场列表和已安装插件列表
    const [marketResult, installedPlugins] = await Promise.all([
      window.ztools.fetchPluginMarket(),
      window.ztools.getPlugins()
    ])

    if (marketResult.success && marketResult.data) {
      const marketPlugins = marketResult.data

      // 先过滤掉不适配当前平台的插件，然后标记已安装的插件
      plugins.value = marketPlugins
        .filter((p: any) => {
          // 如果插件没有 platform 字段，默认支持所有平台
          if (!p.platform || !Array.isArray(p.platform)) {
            return true
          }
          // 检查插件的 platform 数组是否包含当前平台
          return p.platform.includes(currentPlatform)
        })
        .map((p: any) => {
          const installedPlugin = installedPlugins.find((ip: any) => ip.name === p.name)
          return {
            ...p,
            installed: !!installedPlugin,
            path: installedPlugin ? installedPlugin.path : undefined,
            localVersion: installedPlugin ? installedPlugin.version : undefined
          }
        })
    } else {
      console.error('获取插件市场列表失败:', marketResult.error)
    }
  } catch (error) {
    console.error('获取插件列表出错:', error)
  } finally {
    isLoading.value = false
  }
}

function openPluginDetail(plugin: Plugin): void {
  selectedPlugin.value = plugin
  isDetailVisible.value = true
}

function closePluginDetail(): void {
  isDetailVisible.value = false
  selectedPlugin.value = null
}

async function handleOpenPlugin(plugin: Plugin): Promise<void> {
  if (!plugin.path) {
    alert('无法打开插件: 路径未知')
    return
  }
  try {
    const result = await window.ztools.launch({
      path: plugin.path,
      type: 'plugin',
      name: plugin.name, // 传递插件名称
      param: {}
    })

    // 检查返回结果
    if (result && !result.success) {
      alert(`无法打开插件: ${result.error || '未知错误'}`)
    }
  } catch (error: any) {
    console.error('打开插件失败:', error)
    alert(`打开插件失败: ${error.message || '未知错误'}`)
  }
}

// 版本比较函数：如果 v1 < v2 返回 -1，v1 > v2 返回 1，相等返回 0
function compareVersions(v1: string, v2: string): number {
  if (!v1 || !v2) return 0
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const len = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < len; i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }
  return 0
}

function canUpgrade(plugin: Plugin): boolean {
  if (!plugin.installed || !plugin.localVersion || !plugin.version) return false
  return compareVersions(plugin.localVersion, plugin.version) < 0
}

async function handleUpgradePlugin(plugin: Plugin): Promise<void> {
  if (installingPlugin.value) return
  if (!plugin.path) {
    alert('无法升级：找不到插件路径')
    return
  }

  const confirmUpgrade = confirm(
    `发现新版本 ${plugin.version}，当前版本 ${plugin.localVersion}，是否升级？\n升级将先卸载旧版本。`
  )
  if (!confirmUpgrade) return

  installingPlugin.value = plugin.name
  try {
    // 1. 卸载旧版本
    console.log('开始卸载旧版本:', plugin.name)
    const deleteResult = await window.ztools.deletePlugin(plugin.path)
    if (!deleteResult.success) {
      throw new Error(`卸载失败: ${deleteResult.error}`)
    }

    // 2. 安装新版本
    console.log('开始安装新版本:', plugin.name)
    const installResult = await window.ztools.installPluginFromMarket(
      JSON.parse(JSON.stringify(plugin))
    )
    if (installResult.success) {
      console.log('插件升级成功:', plugin.name)
      // 更新状态
      plugin.installed = true
      plugin.localVersion = plugin.version
      // 更新 path，这样可以立即打开插件
      if (installResult.plugin && installResult.plugin.path) {
        plugin.path = installResult.plugin.path
      }
      // 重新获取列表以确保状态同步
      await fetchPlugins()
    } else {
      throw new Error(`安装失败: ${installResult.error}`)
    }
  } catch (error: any) {
    console.error('升级出错:', error)
    alert(`升级出错: ${error.message}`)
    // 如果卸载成功但安装失败，可能需要刷新列表让用户重新下载
    await fetchPlugins()
  } finally {
    installingPlugin.value = null
  }
}

async function downloadPlugin(plugin: Plugin): Promise<void> {
  if (installingPlugin.value) return

  installingPlugin.value = plugin.name
  try {
    const result = await window.ztools.installPluginFromMarket(JSON.parse(JSON.stringify(plugin)))
    if (result.success) {
      console.log('插件安装成功:', plugin.name)
      // 更新状态，使用后端返回的插件信息
      plugin.installed = true
      plugin.localVersion = plugin.version
      // 更新 path，这样可以立即打开插件
      if (result.plugin && result.plugin.path) {
        plugin.path = result.plugin.path
      }
      // 重新获取列表以确保状态同步（可选）
      // await fetchPlugins()
    } else {
      console.error('插件安装失败:', result.error)
      alert(`安装失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('安装出错:', error)
    alert(`安装出错: ${error.message}`)
  } finally {
    installingPlugin.value = null
  }
}

onMounted(() => {
  fetchPlugins()
})
</script>

<style scoped>
.plugin-market {
  position: relative; /* 使详情面板能够覆盖该区域 */
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden; /* 防止滑动时出现滚动条 */
}

/* 可滚动内容区 */
.scrollable-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

/* 列表滑动动画 */
.list-slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.list-slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.list-slide-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.list-slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.list-slide-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.plugin-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  flex-shrink: 0;
  margin-right: 12px;
}

.plugin-logo-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-action {
  flex-shrink: 0;
  margin-left: 10px;
}

/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.download-btn {
  color: var(--primary-color);
}

.download-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 按钮 loading 状态 */
.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* 升级按钮中的 spinner */
.btn-warning .spinner {
  border-top-color: var(--text-on-primary);
  border-right-color: var(--text-on-primary);
}
</style>
