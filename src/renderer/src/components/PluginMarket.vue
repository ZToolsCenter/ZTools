<template>
  <div class="plugin-market">
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>
    <div v-else class="market-grid">
      <div v-for="plugin in plugins" :key="plugin.name" class="plugin-card">
        <div class="plugin-icon">
          <img :src="plugin.logo" class="plugin-logo-img" alt="icon" />
        </div>
        <div class="plugin-info">
          <div class="plugin-name" @click="openPluginDetail(plugin)">{{ plugin.name }}</div>
          <div class="plugin-description" :title="plugin.description">{{ plugin.description }}</div>
        </div>
        <div class="plugin-action">
          <template v-if="plugin.installed">
            <button
              v-if="canUpgrade(plugin)"
              class="action-btn upgrade"
              :disabled="installingPlugin === plugin.name"
              @click="handleUpgradePlugin(plugin)"
            >
              <span v-if="installingPlugin === plugin.name">...</span>
              <span v-else>升级</span>
            </button>
            <button v-else class="action-btn installed" @click="handleOpenPlugin(plugin)">
              打开
            </button>
          </template>
          <button
            v-else
            class="action-btn download"
            :disabled="installingPlugin === plugin.name"
            @click="downloadPlugin(plugin)"
          >
            <span v-if="installingPlugin === plugin.name">...</span>
            <svg
              v-else
              width="16"
              height="16"
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

    <!-- 插件详情覆盖面板组件 -->
    <PluginDetail
      v-if="isDetailVisible && selectedPlugin"
      :plugin="selectedPlugin"
      @back="closePluginDetail"
      @open="handleOpenPlugin(selectedPlugin)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
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
    // 并行获取市场列表和已安装插件列表
    const [marketResult, installedPlugins] = await Promise.all([
      window.ztools.fetchPluginMarket(),
      window.ztools.getPlugins()
    ])

    if (marketResult.success && marketResult.data) {
      const marketPlugins = marketResult.data

      // 标记已安装的插件
      plugins.value = marketPlugins.map((p: any) => {
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
    console.error('无法打开插件: 路径未知')
    return
  }
  try {
    await window.ztools.launch({
      path: plugin.path,
      type: 'plugin',
      param: {}
    })
  } catch (error) {
    console.error('打开插件失败:', error)
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
      // 更新状态
      plugin.installed = true
      plugin.localVersion = plugin.version
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
  /* padding: 20px; */
  position: relative;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.plugin-card {
  display: flex;
  align-items: center;
  padding: 10px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  transition: all 0.2s;
  cursor: pointer;
  min-width: 0;
}

.plugin-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.plugin-icon {
  flex-shrink: 0;
  margin-right: 16px;
}

.plugin-logo-img {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  object-fit: cover;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  cursor: pointer;
}

.plugin-name:hover {
  color: var(--primary-color);
}

.plugin-description {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-action {
  flex-shrink: 0;
  margin-left: 12px;
}

.action-btn {
  border: none;
  background: none;
  cursor: pointer;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s;
}

.action-btn.installed {
  padding: 4px 12px;
  border: 1px solid var(--primary-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.installed:hover {
  background: var(--primary-color);
  color: var(--text-on-primary);
}

.action-btn.upgrade {
  padding: 4px 12px;
  border: 1px solid #e6a23c;
  border-radius: 4px;
  background: var(--bg-color);
  color: #e6a23c;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn.upgrade:hover {
  background: #e6a23c;
  color: white;
}

.action-btn.download {
  color: var(--text-secondary);
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn.download:hover {
  color: var(--primary-color);
  background: var(--hover-bg);
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
</style>
