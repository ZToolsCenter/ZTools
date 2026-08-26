<template>
  <div class="update-window" tabindex="0" @keydown="handleKeydown">
    <!-- 头部 -->
    <div class="header window-drag-region">
      <img :src="logo" class="header-icon" draggable="false" />
      <div class="header-info">
        <div class="title">发现新版本 {{ version }}</div>
        <div class="subtitle">ZTools</div>
      </div>
      <button
        type="button"
        class="window-control minimize-button"
        aria-label="最小化更新窗口"
        title="最小化"
        @click="minimizeWindow"
      >
        <span aria-hidden="true"></span>
      </button>
    </div>

    <!-- 更新内容 -->
    <div class="content">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="changelog" v-html="parsedChangelog"></div>
    </div>

    <!-- 底部按钮 -->
    <div class="footer">
      <div v-if="status !== 'available'" class="update-status" :class="status">
        <div class="status-row">
          <span>{{ statusText }}</span>
          <span v-if="status === 'downloading'">{{ progressText }}</span>
        </div>
        <div v-if="status === 'downloading'" class="progress-track">
          <div
            class="progress-bar"
            :class="{ indeterminate: !hasKnownProgress }"
            :style="hasKnownProgress ? { width: `${downloadProgress}%` } : undefined"
          ></div>
        </div>
      </div>
      <div class="footer-main">
        <div class="source-area">
          <div v-if="showSourceSelector" class="source-selector">
            <label class="source-label" for="update-source">下载渠道</label>
            <div class="source-select-control">
              <select
                id="update-source"
                v-model.number="selectedSourceID"
                :class="{ 'has-help': selectedSource?.platformName.includes('夸克') }"
                :disabled="sourceSelectionDisabled"
                @keydown.stop
              >
                <option v-for="source in availableSources" :key="source.id" :value="source.id">
                  {{ source.platformName }}
                </option>
              </select>
              <button
                v-if="selectedSource?.platformName.includes('夸克')"
                type="button"
                class="source-help"
                aria-label="查看夸克网盘下载说明"
                aria-describedby="quark-source-tooltip"
                @keydown.stop
              >
                <span aria-hidden="true">?</span>
                <span id="quark-source-tooltip" class="source-tooltip" role="tooltip">
                  通过夸克网盘下载并转存时，ZTools
                  可能获得少量渠道收益，用于分担服务器和持续维护成本。感谢你的支持。
                </span>
              </button>
            </div>
          </div>
        </div>
        <div class="footer-actions">
          <button
            class="btn cancel"
            :disabled="status === 'installing' || isCancelling"
            @click="handleSecondaryAction"
          >
            {{ secondaryButtonText }}
          </button>
          <button class="btn confirm" :disabled="isBusy || !selectedSource" @click="startUpdate">
            {{ primaryButtonText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { marked } from 'marked'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'
import { getDefaultUpdateSourceID, isInAppUpdateSource } from '@shared/updateSource'

interface UpdateInfo {
  version: string
  changelog: string
  releaseNotes?: string
  downloadUrl?: string
  manualDownloadRequired?: boolean
  releaseUrl?: string
  sources?: UpdateDownloadSource[]
}

interface UpdateDownloadSource {
  id: number
  platformName: string
  downloadUrl: string
  isDirect: boolean
  feedUrl?: string
}

interface DownloadProgress {
  percent?: number
  transferred?: number
  total?: number
}

const version = ref('')
const changelog = ref('')
const updateInfo = ref<UpdateInfo | null>(null)
const status = ref<'available' | 'downloading' | 'downloaded' | 'installing' | 'error'>('available')
const downloadProgress = ref(0)
const transferredBytes = ref(0)
const totalBytes = ref(0)
const updateError = ref('')
const isCancelling = ref(false)
const selectedSourceID = ref<number | null>(null)
const acrylicLightOpacity = ref(78)
const acrylicDarkOpacity = ref(50)
const stopUpdateListeners: Array<() => void> = []

// 解析 Markdown
const parsedChangelog = computed(() => {
  return marked.parse(changelog.value)
})

const isBusy = computed(() => status.value === 'downloading' || status.value === 'installing')
const hasKnownProgress = computed(() => totalBytes.value > 0)
const progressText = computed(() => {
  if (hasKnownProgress.value) return `${Math.round(downloadProgress.value)}%`
  return formatBytes(transferredBytes.value)
})
const statusText = computed(() => {
  if (status.value === 'downloading') return '正在下载更新...'
  if (status.value === 'downloaded') return '更新已下载，准备安装'
  if (status.value === 'installing') return '正在安装更新...'
  return updateError.value || '更新下载失败，请重试'
})
const availableSources = computed(() => updateInfo.value?.sources ?? [])
const selectedSource = computed(
  () =>
    availableSources.value.find((source) => source.id === selectedSourceID.value) ??
    availableSources.value[0]
)
const showSourceSelector = computed(() => availableSources.value.length > 1)
const sourceSelectionDisabled = computed(
  () => status.value !== 'available' && status.value !== 'error'
)
const primaryButtonText = computed(() => {
  if (status.value === 'downloading') return `下载中 ${progressText.value}`
  if (status.value === 'downloaded') return '立即安装'
  if (status.value === 'installing') return '正在安装...'
  if (selectedSource.value && !isInAppUpdateSource(selectedSource.value)) {
    return '去下载'
  }
  if (status.value === 'error') return '重试下载'
  return '下载并安装'
})
const secondaryButtonText = computed(() => {
  if (isCancelling.value) return '正在取消...'
  return status.value === 'downloading' ? '取消下载' : '稍后更新'
})
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 使用当前选中的下载渠道执行更新，人工渠道成功打开后关闭更新窗口。
 * @returns 操作处理完成后结束的 Promise。
 */
const startUpdate = async (): Promise<void> => {
  if (isBusy.value || !updateInfo.value || !selectedSource.value) return

  updateError.value = ''
  try {
    // 人工渠道只打开浏览器，不进入应用内下载状态。
    if (!isInAppUpdateSource(selectedSource.value)) {
      const result = await window.ztools.updater.startUpdate(selectedSource.value.id)
      if (!result.success) {
        updateError.value = result.error || '打开下载页面失败'
        status.value = 'error'
      } else {
        closeWindow()
      }
      return
    }

    if (status.value === 'downloaded') {
      status.value = 'installing'
      const result = await window.ztools.updater.installDownloadedUpdate()
      if (!result.success) {
        updateError.value = result.error || '安装更新失败'
        status.value = 'error'
      }
      return
    }

    status.value = 'downloading'
    downloadProgress.value = 0
    transferredBytes.value = 0
    totalBytes.value = 0
    const result = await window.ztools.updater.startUpdate(selectedSource.value.id)
    if (result.cancelled) return
    if (!result.success) {
      updateError.value = result.error || '下载更新失败'
      status.value = 'error'
    } else {
      status.value = 'installing'
    }
  } catch (error) {
    updateError.value = error instanceof Error ? error.message : '更新失败，请重试'
    status.value = 'error'
  }
}

/**
 * 取消当前下载，并将窗口恢复为可重新下载的状态。
 * @returns 取消操作完成后结束的 Promise。
 */
const cancelDownload = async (): Promise<void> => {
  if (status.value !== 'downloading' || isCancelling.value) return

  isCancelling.value = true
  try {
    const result = await window.ztools.updater.cancelUpdate()
    if (!result.success) {
      // 下载可能恰好完成，只有仍处于下载态时才展示取消失败。
      if (status.value === 'downloading') {
        updateError.value = result.error || '取消下载失败'
        status.value = 'error'
      }
      return
    }

    // 取消后保留版本信息和下载源，方便用户重新发起下载。
    downloadProgress.value = 0
    transferredBytes.value = 0
    totalBytes.value = 0
    updateError.value = ''
    status.value = 'available'
  } catch (error) {
    updateError.value = error instanceof Error ? error.message : '取消下载失败'
    status.value = 'error'
  } finally {
    isCancelling.value = false
  }
}

/**
 * 根据当前下载状态执行取消下载或关闭窗口。
 * @returns 操作完成后结束的 Promise。
 */
const handleSecondaryAction = async (): Promise<void> => {
  if (status.value === 'downloading') {
    await cancelDownload()
    return
  }
  closeWindow()
}

/**
 * 在非下载和非安装阶段关闭更新窗口。
 * @returns 无返回值。
 */
const closeWindow = (): void => {
  if (isBusy.value) return
  // 发送 closeWindow 事件给主进程
  window.electron?.ipcRenderer.send('updater:close-window')
}

/**
 * 请求主进程最小化更新窗口，同时保留当前更新状态。
 * @returns 无返回值。
 */
const minimizeWindow = (): void => {
  window.electron?.ipcRenderer.send('updater:minimize-window')
}

/**
 * 处理更新窗口键盘操作，下载期间按 Escape 时取消下载。
 * @param e 键盘事件。
 * @returns 无返回值。
 */
const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && status.value !== 'installing') {
    void handleSecondaryAction()
  } else if (e.key === 'Enter' && !isBusy.value) {
    void startUpdate()
  }
}

function applyAcrylicOverlay(): void {
  const existingStyle = document.getElementById('acrylic-overlay-style')
  if (existingStyle) {
    existingStyle.remove()
  }

  if (!document.documentElement.classList.contains('os-windows')) return

  const material = document.documentElement.getAttribute('data-material')

  if (material === 'acrylic') {
    const style = document.createElement('style')
    style.id = 'acrylic-overlay-style'
    style.textContent = `
      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: -1;
      }

      /* 明亮模式 */
      @media (prefers-color-scheme: light) {
        body::after {
          background: rgb(255 255 255 / ${acrylicLightOpacity.value}%);
        }
      }

      /* 暗黑模式 */
      @media (prefers-color-scheme: dark) {
        body::after {
          background: rgb(0 0 0 / ${acrylicDarkOpacity.value}%);
        }
      }
    `
    document.head.appendChild(style)
  }
}

onMounted(() => {
  // 聚焦窗口以接收键盘事件
  const el = document.querySelector('.update-window') as HTMLElement
  if (el) el.focus()

  // 监听主进程发送的更新信息
  stopUpdateListeners.push(
    window.electron.ipcRenderer.on(
      'update-info',
      (info: UpdateInfo & { downloadStatus?: { status?: string } }) => {
        updateInfo.value = info
        version.value = info.version
        changelog.value = info.changelog
        if (!info.sources?.some((source) => source.id === selectedSourceID.value)) {
          selectedSourceID.value = getDefaultUpdateSourceID(info.sources ?? [])
        }
        if (info.downloadStatus?.status === 'downloaded') status.value = 'downloaded'
        else if (info.downloadStatus?.status === 'downloading') status.value = 'downloading'
      }
    ),
    window.electron.ipcRenderer.on('update-download-start', () => {
      status.value = 'downloading'
      updateError.value = ''
    }),
    window.electron.ipcRenderer.on('update-download-progress', (progress: DownloadProgress) => {
      status.value = 'downloading'
      transferredBytes.value = progress.transferred ?? 0
      totalBytes.value = progress.total ?? 0
      downloadProgress.value = Math.max(0, Math.min(100, progress.percent ?? 0))
    }),
    window.electron.ipcRenderer.on('update-downloaded', () => {
      downloadProgress.value = 100
      status.value = 'downloaded'
    }),
    window.electron.ipcRenderer.on('update-download-cancelled', () => {
      downloadProgress.value = 0
      transferredBytes.value = 0
      totalBytes.value = 0
      updateError.value = ''
      status.value = 'available'
    }),
    window.electron.ipcRenderer.on('update-download-failed', (data: { error?: string }) => {
      updateError.value = data.error || '更新下载失败，请重试'
      status.value = 'error'
    })
  )

  // 请求更新信息
  window.electron?.ipcRenderer.send('updater:window-ready')

  // 初始化窗口材质
  if (window.ztools?.getWindowMaterial) {
    window.ztools
      .getWindowMaterial()
      .then((material) => {
        document.documentElement.setAttribute('data-material', material)
        applyAcrylicOverlay()
      })
      .catch((err) => {
        console.error('获取窗口材质失败:', err)
      })
  }

  // 监听窗口材质更新
  if (window.ztools?.onUpdateWindowMaterial) {
    window.ztools.onUpdateWindowMaterial((material) => {
      document.documentElement.setAttribute('data-material', material)
      applyAcrylicOverlay()
    })
  }

  // 监听亚克力透明度更新
  if (window.ztools?.onUpdateAcrylicOpacity) {
    window.ztools.onUpdateAcrylicOpacity((data) => {
      acrylicLightOpacity.value = data.lightOpacity
      acrylicDarkOpacity.value = data.darkOpacity
      applyAcrylicOverlay()
    })
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyAcrylicOverlay()
  })
})

onBeforeUnmount(() => {
  stopUpdateListeners.forEach((stop) => stop())
})
</script>

<style>
/* 全局样式覆盖 */
html,
body,
#updater-app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
</style>

<style scoped>
.update-window {
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
  outline: none;
}

@media (prefers-color-scheme: dark) {
  .update-window {
    background: var(--bg-color);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e5e5e5;
  }
}

/* 头部 */
.header {
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.5);
  -webkit-app-region: drag;
  user-select: none;
}

@media (prefers-color-scheme: dark) {
  .header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(30, 30, 30, 0.5);
  }
}

.header-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  /* background: linear-gradient(135deg, #3b82f6, #06b6d4); */
  display: flex;
  align-items: center;
  justify-content: center;
  /* color: white; */
  /* box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); */
  object-fit: contain;
}

.header-info {
  flex: 1;
  min-width: 0;
}

.window-control {
  flex: none;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  color: #666;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.window-control:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #222;
}

.window-control:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.55);
  outline-offset: 1px;
}

.minimize-button span {
  width: 12px;
  height: 1.5px;
  border-radius: 1px;
  background: currentColor;
}

@media (prefers-color-scheme: dark) {
  .window-control {
    color: #aaa;
  }

  .window-control:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
}

.title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}

.subtitle {
  font-size: 13px;
  color: #666;
}

@media (prefers-color-scheme: dark) {
  .subtitle {
    color: #999;
  }
}

/* 内容区域 */
.content {
  flex: 1;
  padding: 2px 0; /* 给滚动条留点位置 */
  overflow-y: auto;
  position: relative;
}

.changelog {
  padding: 20px 24px;
  font-size: 14px;
  line-height: 1.6;
}

.changelog :deep(a) {
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

@media (prefers-color-scheme: dark) {
  .changelog :deep(a),
  .changelog :deep(a:visited) {
    color: #9ec5ff;
    text-decoration-color: rgba(158, 197, 255, 0.72);
  }

  .changelog :deep(a:hover) {
    color: #c2d9ff;
    text-decoration-color: currentColor;
  }

  .changelog :deep(a:focus-visible) {
    border-radius: 2px;
    outline: 2px solid rgba(158, 197, 255, 0.78);
    outline-offset: 2px;
  }
}

/* Markdown样式适配 */
:deep(h1),
:deep(h2),
:deep(h3) {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  color: #333;
}

@media (prefers-color-scheme: dark) {
  :deep(h1),
  :deep(h2),
  :deep(h3) {
    color: #e5e5e5;
  }
}

:deep(h1):first-child,
:deep(h2):first-child {
  margin-top: 0;
}

:deep(ul),
:deep(ol) {
  padding-left: 20px;
  margin: 0.5em 0;
}

:deep(li) {
  margin-bottom: 4px;
  color: #444;
}

@media (prefers-color-scheme: dark) {
  :deep(li) {
    color: #ccc;
  }
}

:deep(code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.9em;
}

@media (prefers-color-scheme: dark) {
  :deep(code) {
    background: rgba(255, 255, 255, 0.1);
  }
}

/* 底部按钮 */
.footer {
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.5);
}

.footer-actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.footer-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.source-area {
  min-width: 0;
  flex: 1;
}

.source-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-select-control {
  position: relative;
  flex: none;
}

.source-label {
  flex: none;
  color: #555;
  font-size: 12px;
}

.source-selector select {
  box-sizing: border-box;
  min-width: 112px;
  height: 32px;
  padding: 0 28px 0 10px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.7);
  color: #333;
  font-size: 12px;
  outline: none;
  cursor: pointer;
}

.source-selector select.has-help {
  padding-right: 48px;
}

.source-selector select:focus {
  border-color: #3b82f6;
}

.source-selector select:disabled {
  cursor: default;
  opacity: 0.65;
}

.source-help {
  position: absolute;
  top: 50%;
  right: 27px;
  z-index: 1;
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(0, 0, 0, 0.28);
  border-radius: 50%;
  padding: 0;
  appearance: none;
  background: transparent;
  color: #666;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: help;
  transform: translateY(-50%);
}

.source-help:focus-visible {
  outline: 2px solid rgba(59, 130, 246, 0.45);
  outline-offset: 2px;
}

.source-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  box-sizing: border-box;
  width: 250px;
  padding: 9px 11px;
  border-radius: 6px;
  background: rgba(34, 34, 34, 0.96);
  color: #fff;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.5;
  opacity: 0;
  pointer-events: none;
  transform: translate(-40%, 4px);
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.source-tooltip::after {
  content: '';
  position: absolute;
  left: 40%;
  top: 100%;
  border: 5px solid transparent;
  border-top-color: rgba(34, 34, 34, 0.96);
  transform: translateX(-50%);
}

.source-help:hover .source-tooltip,
.source-help:focus .source-tooltip {
  opacity: 1;
  transform: translate(-40%, 0);
}

.update-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #555;
  font-size: 12px;
}

.update-status.error {
  color: #dc2626;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.progress-track {
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.09);
}

.progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #3b82f6;
  transition: width 0.2s ease;
}

.progress-bar.indeterminate {
  width: 35%;
  animation: update-progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes update-progress-indeterminate {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(300%);
  }
}

@media (prefers-color-scheme: dark) {
  .footer {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(30, 30, 30, 0.5);
  }

  .source-label {
    color: #bbb;
  }

  .source-selector select {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(30, 30, 30, 0.72);
    color: #e5e5e5;
  }

  .source-help {
    border-color: rgba(255, 255, 255, 0.32);
    color: #bbb;
  }
}

.btn {
  min-width: 92px;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  outline: none;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.btn:disabled {
  cursor: default;
  opacity: 0.65;
}

.cancel {
  background: transparent;
  color: #666;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.cancel:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #333;
}

@media (prefers-color-scheme: dark) {
  .cancel {
    color: #999;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .cancel:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
}

.confirm {
  min-width: 118px;
  background: #3b82f6;
  color: white;
}

.confirm:hover:not(:disabled) {
  background: #2563eb;
}

.confirm:active:not(:disabled) {
  background: #1d4ed8;
}

@media (prefers-color-scheme: dark) {
  .update-status {
    color: #bbb;
  }

  .update-status.error {
    color: #f87171;
  }

  .progress-track {
    background: rgba(255, 255, 255, 0.12);
  }
}
</style>
