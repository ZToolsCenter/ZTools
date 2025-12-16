<template>
  <div class="content-panel">
    <!-- 可滚动内容区 -->
    <Transition name="list-slide">
      <div v-show="!isDetailVisible" class="scrollable-content">
        <div class="panel-header">
          <div class="button-group">
            <button class="btn btn-purple" :disabled="isImportingDev" @click="importDevPlugin">
              {{ isImportingDev ? '添加中...' : '添加开发中插件' }}
            </button>
            <button class="btn" :disabled="isImporting" @click="importPlugin">
              {{ isImporting ? '导入中...' : '导入本地插件' }}
            </button>
          </div>
        </div>

        <!-- 插件列表 -->
        <div class="plugin-list">
          <div
            v-for="plugin in plugins"
            :key="plugin.path"
            class="card plugin-item"
            :title="plugin.description"
            @click="openPluginDetail(plugin)"
          >
            <img
              v-if="plugin.logo"
              :src="plugin.logo"
              class="plugin-icon"
              alt="插件图标"
              draggable="false"
            />
            <div v-else class="plugin-icon-placeholder">🧩</div>

            <div class="plugin-info">
              <div class="plugin-name">
                {{ plugin.name }}
                <span class="plugin-version">v{{ plugin.version }}</span>
                <span v-if="plugin.isDevelopment" class="dev-badge">开发中</span>
              </div>
              <div class="plugin-desc">{{ plugin.description || '暂无描述' }}</div>
              <div v-if="isPluginRunning(plugin.path)" class="plugin-status running">
                <span class="status-dot"></span>
                运行中
              </div>
            </div>

            <div class="plugin-meta">
              <button
                class="icon-btn open-btn"
                title="打开插件"
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
              <button
                v-if="isPluginRunning(plugin.path)"
                class="icon-btn kill-btn"
                title="终止运行"
                :disabled="isKilling"
                @click.stop="handleKillPlugin(plugin)"
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
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
              </button>
              <button
                class="icon-btn folder-btn"
                title="打开插件目录"
                @click.stop="handleOpenFolder(plugin)"
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
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                  ></path>
                </svg>
              </button>
              <button
                class="icon-btn reload-btn"
                :disabled="isReloading"
                title="重新加载 plugin.json 配置文件"
                @click.stop="handleReloadPlugin(plugin)"
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
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path
                    d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                  ></path>
                </svg>
              </button>
              <button
                class="icon-btn delete-btn"
                title="删除插件"
                :disabled="isDeleting"
                @click.stop="handleDeletePlugin(plugin)"
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
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  ></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="!isLoading && plugins.length === 0" class="empty-state">
            <Icon name="plugin" :size="64" class="empty-icon" />
            <div class="empty-text">暂无插件</div>
            <div class="empty-hint">点击"导入本地插件"来安装你的第一个插件</div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 插件详情覆盖面板组件 -->
    <Transition name="slide">
      <PluginDetail
        v-if="isDetailVisible && selectedPlugin"
        :plugin="selectedPlugin"
        @back="closePluginDetail"
        @open="handleOpenPlugin(selectedPlugin)"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useCommandDataStore } from '../../stores/commandDataStore'
import Icon from '../common/Icon.vue'
import PluginDetail from './PluginDetail.vue'

const commandDataStore = useCommandDataStore()

// 插件相关状态
const plugins = ref<any[]>([])
const runningPlugins = ref<string[]>([])
const isLoading = ref(true)
const isImporting = ref(false)
const isImportingDev = ref(false)
const isDeleting = ref(false)
const isKilling = ref(false)
const isReloading = ref(false)

// 详情弹窗状态
const isDetailVisible = ref(false)
const selectedPlugin = ref<any | null>(null)

// 加载插件列表
async function loadPlugins(): Promise<void> {
  isLoading.value = true
  try {
    const result = await window.ztools.getPlugins()
    // 插件中心的插件都是已安装的，标记 installed 为 true
    plugins.value = (result || []).map((plugin: any) => ({
      ...plugin,
      installed: true,
      localVersion: plugin.version
    }))
    // 同时加载运行中的插件
    await loadRunningPlugins()
  } catch (error) {
    console.error('加载插件列表失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 加载运行中的插件
async function loadRunningPlugins(): Promise<void> {
  try {
    const result = await window.ztools.getRunningPlugins()
    runningPlugins.value = result || []
  } catch (error) {
    console.error('加载运行中插件失败:', error)
  }
}

// 检查插件是否运行中
function isPluginRunning(pluginPath: string): boolean {
  return runningPlugins.value.includes(pluginPath)
}

// 导入本地插件
async function importPlugin(): Promise<void> {
  if (isImporting.value) return

  isImporting.value = true
  try {
    const result = await window.ztools.importPlugin()
    if (result.success) {
      // 重新加载插件列表
      await loadPlugins()
      alert('插件导入成功!')
    } else {
      alert(`插件导入失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('导入插件失败:', error)
    alert(`导入插件失败: ${error.message || '未知错误'}`)
  } finally {
    isImporting.value = false
  }
}

// 添加开发中插件
async function importDevPlugin(): Promise<void> {
  if (isImportingDev.value) return

  isImportingDev.value = true
  try {
    const result = await window.ztools.importDevPlugin()
    if (result.success) {
      // 重新加载插件列表
      await loadPlugins()
      alert('开发中插件添加成功!')
    } else {
      alert(`添加开发中插件失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('添加开发中插件失败:', error)
    alert(`添加开发中插件失败: ${error.message || '未知错误'}`)
  } finally {
    isImportingDev.value = false
  }
}

// 删除插件
async function handleDeletePlugin(plugin: any): Promise<void> {
  if (isDeleting.value) return

  // 确认删除
  if (!confirm(`确定要删除插件"${plugin.name}"吗？\n\n此操作将删除插件文件，无法恢复。`)) {
    return
  }

  isDeleting.value = true
  try {
    const result = await window.ztools.deletePlugin(plugin.path)
    if (result.success) {
      // 重新加载插件列表
      await loadPlugins()
    } else {
      alert(`插件删除失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('删除插件失败:', error)
    alert(`删除插件失败: ${error.message || '未知错误'}`)
  } finally {
    isDeleting.value = false
  }
}

// 终止插件
async function handleKillPlugin(plugin: any): Promise<void> {
  if (isKilling.value) return

  isKilling.value = true
  try {
    const result = await window.ztools.killPlugin(plugin.path)
    if (result.success) {
      // 重新加载运行状态
      await loadRunningPlugins()
    } else {
      alert(`终止插件失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('终止插件失败:', error)
    alert(`终止插件失败: ${error.message || '未知错误'}`)
  } finally {
    isKilling.value = false
  }
}

// 打开插件
async function handleOpenPlugin(plugin: any): Promise<void> {
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

// 打开插件目录
async function handleOpenFolder(plugin: any): Promise<void> {
  try {
    await window.ztools.revealInFinder(plugin.path)
  } catch (error: any) {
    console.error('打开目录失败:', error)
    alert(`打开目录失败: ${error.message || '未知错误'}`)
  }
}

// 重载插件
async function handleReloadPlugin(plugin: any): Promise<void> {
  if (isReloading.value) return

  isReloading.value = true
  try {
    const result = await window.ztools.reloadPlugin(plugin.path)
    if (result.success) {
      // 重新加载插件列表
      await loadPlugins()
      // 刷新搜索数据（重新加载指令列表）
      await commandDataStore.loadCommands()
      alert('插件重载成功!')
    } else {
      alert(`插件重载失败: ${result.error}`)
    }
  } catch (error: any) {
    console.error('重载插件失败:', error)
    alert(`重载插件失败: ${error.message || '未知错误'}`)
  } finally {
    isReloading.value = false
  }
}

// 初始化时加载插件列表
onMounted(() => {
  loadPlugins()
})

// 打开插件详情
function openPluginDetail(plugin: any): void {
  selectedPlugin.value = plugin
  isDetailVisible.value = true
}

// 关闭插件详情
function closePluginDetail(): void {
  isDetailVisible.value = false
  selectedPlugin.value = null
}
</script>

<style scoped>
.content-panel {
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

/* 插件中心样式 */
.panel-header {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-bottom: 20px;
}

.button-group {
  display: flex;
  gap: 10px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.plugin-item:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon,
.plugin-icon-placeholder {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  margin-right: 12px;
  flex-shrink: 0;
}

.plugin-icon {
  object-fit: cover;
}

.plugin-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 24px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-version {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--active-bg);
  border-radius: 4px;
}

.dev-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 500;
  color: var(--purple-color);
  background: var(--purple-light-bg);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--purple-border);
}

.plugin-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 500;
}

.plugin-status.running {
  color: var(--success-color);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-color);
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.plugin-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 图标按钮颜色样式 */
.open-btn {
  color: var(--primary-color);
}

.open-btn:hover {
  background: var(--primary-light-bg);
}

.kill-btn {
  color: var(--warning-color);
}

.kill-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.folder-btn {
  color: var(--primary-color);
}

.folder-btn:hover {
  background: var(--primary-light-bg);
}

.reload-btn {
  color: var(--primary-color);
}

.reload-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.delete-btn {
  color: var(--danger-color);
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
  opacity: 0.3;
  color: var(--text-secondary);
}

.empty-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 14px;
  color: var(--text-secondary);
}
.empty-feature {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
