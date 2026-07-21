<script setup lang="ts">
import { ref } from 'vue'
import { useToast } from '@/components'
import { useJumpFunction } from '@/composables'
import { PluginInstallerJumpFunction } from '@/views/PluginInstaller/PluginInstaller'
import { useRouter } from 'vue-router'

const router = useRouter()

interface PluginInfo {
  name: string
  title: string
  version: string
  description: string
  author: string
  logo: string
  features: Array<{ code: string; explain?: string }>
  isInstalled: boolean
}

const emit = defineEmits<{
  (e: 'installed', pluginName: string): void
}>()

const { success, error: showError } = useToast()

const loading = ref(true)
const errorMsg = ref('')
const pluginInfo = ref<PluginInfo | null>(null)
const installing = ref(false)
const installed = ref(false)
const installedPlugin = ref<any | null>(null)
const showSecurityDialog = ref(false)
const installFilePath = ref<string>()

async function loadPluginInfo(filePath?: string): Promise<void> {
  if (!filePath) {
    errorMsg.value = '未提供插件文件路径'
    loading.value = false
    return
  }

  try {
    const result = await window.ztools.internal.readPluginInfoFromZpx(filePath)
    if (result.success && result.pluginInfo) {
      pluginInfo.value = result.pluginInfo
      installFilePath.value = filePath
    } else {
      errorMsg.value = result.error || '读取插件信息失败'
    }
  } catch (err: unknown) {
    errorMsg.value = err instanceof Error ? err.message : '读取插件信息失败'
  } finally {
    loading.value = false
  }
}

function handleInstallClick(): void {
  showSecurityDialog.value = true
}

async function confirmInstall(): Promise<void> {
  showSecurityDialog.value = false
  if (!installFilePath.value) {
    return
  }

  installing.value = true

  try {
    const result = await window.ztools.internal.installPluginFromPath(installFilePath.value)
    if (result.success) {
      const wasInstalled = pluginInfo.value?.isInstalled
      const actionText = wasInstalled ? '覆盖安装' : '安装'
      success(`插件${actionText}成功`)
      installed.value = true
      installedPlugin.value = result.plugin || null
      if (pluginInfo.value) {
        emit('installed', pluginInfo.value.name)
      }
    } else {
      showError(result.error || '安装失败')
    }
  } catch (err: unknown) {
    showError(err instanceof Error ? err.message : '安装失败')
  } finally {
    installing.value = false
  }
}

async function resolveInstalledPlugin(): Promise<any | null> {
  if (installedPlugin.value?.path) {
    return installedPlugin.value
  }
  if (!pluginInfo.value?.name) {
    return null
  }

  try {
    const plugins = await window.ztools.internal.getAllPlugins()
    const plugin = plugins.find((item: any) => item.name === pluginInfo.value?.name) || null
    installedPlugin.value = plugin
    return plugin
  } catch (err) {
    console.error('查找已安装插件失败:', err)
    return null
  }
}

async function openInstalledPlugin(): Promise<void> {
  const plugin = await resolveInstalledPlugin()
  if (!plugin?.path) {
    showError('无法打开插件: 路径未知')
    return
  }

  try {
    const result = await window.ztools.internal.launch({
      path: plugin.path,
      type: 'plugin',
      name: plugin.title || plugin.name,
      param: {}
    })

    if (result && !result.success) {
      showError(`无法打开插件: ${result.error || '未知错误'}`)
    }
  } catch (err: unknown) {
    console.error('打开插件失败:', err)
    showError(`打开插件失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }
}

function outPlugin(): void {
  router.replace({ name: 'GeneralSetting' })
  window.ztools.outPlugin()
}

useJumpFunction<PluginInstallerJumpFunction>((state) => {
  if (state.installFilePath) {
    console.log(state.installFilePath)
    loadPluginInfo(state.installFilePath)
  }
})
</script>
<template>
  <div class="installer-container">
    <!-- 加载状态 -->
    <div v-if="loading" class="installer-loading">
      <div class="spinner"></div>
      <p>正在读取插件信息...</p>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="errorMsg" class="installer-error">
      <div class="error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
            fill="currentColor"
          />
        </svg>
      </div>
      <p class="error-text">{{ errorMsg }}</p>
    </div>

    <!-- 插件信息 -->
    <div v-else-if="pluginInfo" class="installer-content">
      <div class="plugin-header">
        <img
          v-if="pluginInfo.logo"
          :src="pluginInfo.logo"
          class="plugin-logo"
          alt="插件图标"
          draggable="false"
        />
        <div v-else class="plugin-logo placeholder">
          <div class="i-z-plugin font-size-32px" />
        </div>
        <div class="plugin-meta">
          <h2 class="plugin-name">{{ pluginInfo.title || pluginInfo.name }}</h2>
          <p class="plugin-desc">{{ pluginInfo.description || '暂无描述' }}</p>
        </div>
      </div>

      <div class="plugin-details">
        <div class="detail-row">
          <span class="detail-label">插件名称</span>
          <span class="detail-value">{{ pluginInfo.name }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">版本号</span>
          <span class="detail-value">v{{ pluginInfo.version }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">开发者</span>
          <span class="detail-value">{{ pluginInfo.author }}</span>
        </div>
        <div v-if="pluginInfo.features?.length" class="detail-row features-row">
          <span class="detail-label">功能列表</span>
          <div class="features-list">
            <span v-for="feature in pluginInfo.features" :key="feature.code" class="feature-tag">
              {{ feature.explain || feature.code }}
            </span>
          </div>
        </div>
      </div>

      <!-- 已安装提示 -->
      <div v-if="pluginInfo.isInstalled" class="installed-warning">
        <div class="warning-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor" />
          </svg>
        </div>
        <div class="warning-content">
          <div class="warning-title">该插件已安装</div>
          <div class="warning-desc">继续安装将覆盖已有版本，插件数据会保留</div>
        </div>
      </div>

      <!-- 安装按钮 -->
      <div class="installer-actions">
        <template v-if="installed">
          <button class="btn btn-lg btn-secondary action-btn" @click="outPlugin">完成</button>
          <button class="btn btn-lg btn-solid action-btn" @click="openInstalledPlugin">
            <div class="i-z-play font-size-16px" />
            <span>打开</span>
          </button>
        </template>
        <button
          v-else
          class="btn btn-lg btn-solid install-btn action-btn"
          :disabled="installing"
          @click="handleInstallClick"
        >
          <div v-if="installing" class="btn-loading">
            <div class="spinner-small"></div>
            <span>安装中...</span>
          </div>
          <span v-else-if="pluginInfo.isInstalled">覆盖安装</span>
          <span v-else>安装插件</span>
        </button>
      </div>
    </div>

    <!-- 安全提示弹窗 -->
    <Transition name="dialog">
      <div v-if="showSecurityDialog" class="dialog-overlay" @click="showSecurityDialog = false">
        <div class="dialog-container" @click.stop>
          <div class="dialog-header">
            <div class="dialog-icon dialog-icon-warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="currentColor" />
              </svg>
            </div>
            <h3 class="dialog-title">安全提示</h3>
          </div>
          <div class="dialog-content">
            <p class="dialog-message">
              即将{{ pluginInfo?.isInstalled ? '覆盖安装' : '安装' }}第三方插件「{{
                pluginInfo?.title || pluginInfo?.name
              }}」。
            </p>
            <p v-if="pluginInfo?.isInstalled" class="dialog-message dialog-info-text">
              覆盖安装会替换插件文件，但会保留插件数据。
            </p>
            <p class="dialog-message dialog-warning-text">
              第三方插件可能包含恶意代码，存在隐私泄露、数据损坏等安全风险。请仅安装来自可信来源的插件。
            </p>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-secondary" @click="showSecurityDialog = false">取消</button>
            <button class="btn btn-danger-solid" @click="confirmInstall">已知风险，继续安装</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.installer-container {
  height: 100%;
  overflow-y: auto;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 加载状态 */
.installer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding-top: 100px;
  color: var(--text-secondary);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--control-border);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 错误状态 */
.installer-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 100px;
}

.error-icon {
  color: var(--danger-color);
}

.error-text {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

/* 插件信息 */
.installer-content {
  width: 100%;
  max-width: 480px;
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.plugin-logo {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
}

.plugin-logo.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
}

.plugin-meta {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 详情列表 */
.plugin-details {
  background: var(--card-bg);
  border: 1px solid var(--control-border);
  border-radius: 10px;
  padding: 4px 0;
  margin-bottom: 16px;
}

.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
}

.detail-row:not(:last-child) {
  border-bottom: 1px solid var(--divider-color);
}

.detail-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-value {
  font-size: 13px;
  color: var(--text-color);
  font-weight: 500;
  text-align: right;
}

.features-row {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.features-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}

.feature-tag {
  display: inline-block;
  padding: 3px 10px;
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 已安装提示 */
.installed-warning {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: var(--warning-light-bg);
  border: 1px solid color-mix(in srgb, var(--warning-color), transparent 70%);
  border-radius: 10px;
  margin-bottom: 16px;
}

.warning-icon {
  flex-shrink: 0;
  color: var(--warning-color);
  margin-top: 2px;
}

.warning-content {
  flex: 1;
}

.warning-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--warning-color);
  margin-bottom: 4px;
}

.warning-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* 安装按钮 */
.installer-actions {
  margin-top: 8px;
  display: flex;
  gap: 10px;
}

.action-btn {
  flex: 1;
  min-width: 0;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.install-btn {
  width: 100%;
  border: none;
  background: var(--primary-color);
  color: var(--text-on-primary);
}

.action-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* 安全提示弹窗 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
}

.dialog-container {
  background: var(--dialog-bg);
  border: 2px solid var(--control-border);
  border-radius: 6px;
  width: 90%;
  max-width: 420px;
  overflow: hidden;
  user-select: none;
  transform-origin: calc(100% - 28px) 28px;
  will-change: opacity, transform;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
}

.dialog-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid;
}

.dialog-icon-warning {
  background: var(--warning-light-bg);
  color: var(--warning-color);
  border-color: color-mix(in srgb, var(--warning-color), black 15%);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0;
}

.dialog-content {
  padding: 16px 20px;
}

.dialog-message {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
}

.dialog-message:last-child {
  margin-bottom: 0;
}

.dialog-warning-text {
  color: var(--danger-color);
  font-weight: 500;
}

.dialog-info-text {
  color: var(--text-color);
  background: var(--control-bg);
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--control-border);
}

.dialog-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
}

.btn {
  flex: 1;
  padding: 8px 16px;
  border: 2px solid;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  outline: none;
}

.btn-secondary {
  background: var(--control-bg);
  color: var(--text-color);
  border-color: var(--control-border);
}

.btn-secondary:hover {
  background: var(--hover-bg);
  border-color: var(--control-border);
}

.btn-danger-solid {
  background: var(--danger-color);
  color: #fff;
  border-color: color-mix(in srgb, var(--danger-color), black 15%);
}

.btn-danger-solid:hover {
  background: color-mix(in srgb, var(--danger-color), black 10%);
  border-color: color-mix(in srgb, var(--danger-color), black 25%);
}

/* 动画效果 */
.dialog-enter-active,
.dialog-leave-active {
  pointer-events: none;
}

.dialog-enter-active {
  animation: security-dialog-overlay-fade-in 0.25s ease-out forwards;
}

.dialog-leave-active {
  animation: security-dialog-overlay-fade-out 0.35s ease-in forwards;
}

.dialog-enter-active .dialog-container {
  animation: security-dialog-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.dialog-leave-active .dialog-container {
  animation: security-dialog-collapse-to-close 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes security-dialog-overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes security-dialog-overlay-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes security-dialog-scale-in {
  from {
    opacity: 0;
    transform: scale(0.85) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes security-dialog-collapse-to-close {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0);
  }
}
</style>
