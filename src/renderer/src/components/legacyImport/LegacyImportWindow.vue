<template>
  <div class="startup-dialog-window" tabindex="0" @keydown="handleKeydown">
    <div class="header window-drag-region">
      <img :src="logo" class="header-icon" draggable="false" />
      <div class="header-info">
        <div class="title">检测到旧版本 ZTools 数据</div>
        <div class="subtitle">ZTools 3.0 数据初始化</div>
      </div>
    </div>

    <main class="content">
      <div class="message">
        <p>选择要从 ZTools 2.x 迁移的数据范围。</p>
      </div>

      <div class="mode-options" role="radiogroup" aria-label="迁移模式">
        <label class="mode-option" :class="{ selected: mode === 'full' }">
          <input v-model="mode" type="radio" value="full" :disabled="isImporting" />
          <span class="mode-copy">
            <span class="mode-title">完整迁移 <span class="recommended">推荐</span></span>
            <span class="mode-description"
              >迁移设置、插件数据、快捷键、固定项、历史和插件行为配置。</span
            >
          </span>
        </label>

        <label class="mode-option" :class="{ selected: mode === 'compact' }">
          <input v-model="mode" type="radio" value="compact" :disabled="isImporting" />
          <span class="mode-copy">
            <span class="mode-title">精简迁移</span>
            <span class="mode-description">只迁移通用设置、插件安装与私有数据、AI 模型。</span>
          </span>
        </label>

        <label class="mode-option" :class="{ selected: mode === 'fresh' }">
          <input v-model="mode" type="radio" value="fresh" :disabled="isImporting" />
          <span class="mode-copy">
            <span class="mode-title">全新开始</span>
            <span class="mode-description">不迁移旧版本数据，使用全新的 ZTools 3.0 数据。</span>
          </span>
        </label>
      </div>

      <div class="migration-details">
        <div class="details-title">
          {{ mode === 'full' ? '完整迁移内容' : mode === 'compact' ? '精简迁移内容' : '全新开始' }}
        </div>
        <ul v-if="mode === 'full'">
          <li>通用设置、插件安装状态、插件文件与私有数据、AI 模型</li>
          <li>固定指令、超级面板布局、本地启动项、快捷键和指令别名</li>
          <li>使用历史、推荐排序、搜索偏好和上次匹配状态</li>
          <li>插件自动启动、自动分离、退出关闭、mainPush 和窗口尺寸</li>
          <li>开发插件项目注册表和 MCP 插件权限</li>
        </ul>
        <ul v-else-if="mode === 'compact'">
          <li>通用设置与界面偏好</li>
          <li>插件安装清单、禁用状态、插件文件、私有数据和附件</li>
          <li>AI 模型配置</li>
        </ul>
        <ul v-else>
          <li>不迁移任何设置、插件、私有数据、快捷键和使用记录</li>
          <li>旧版本数据继续保留，可在需要时手动处理</li>
        </ul>
        <p v-if="mode !== 'fresh'" class="excluded">
          不迁移同步账号、服务密钥、可重建缓存和浏览器会话。旧数据不会被删除。
        </p>
      </div>
    </main>

    <footer class="footer">
      <button class="btn confirm" :disabled="isImporting" @click="confirmChoice">
        <span v-if="isImporting" class="loading-spinner"></span>
        <span>确定</span>
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import logo from '../../assets/logo.png'

const isImporting = ref(false)
const mode = ref<'full' | 'compact' | 'fresh'>('full')

/**
 * 等待浏览器完成两帧渲染，使提交状态在执行迁移前可见。
 * @returns 两帧渲染完成后结束的 Promise
 */
function waitNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

/**
 * 根据当前选项确认导入旧数据或全新开始。
 * @returns 选择提交完成后结束的 Promise
 */
async function confirmChoice(): Promise<void> {
  if (isImporting.value) return

  // 先锁定选项和确认按钮，避免重复提交迁移决定。
  isImporting.value = true
  await waitNextFrame()

  // 全新开始沿用主进程已有的 fresh 分支，其余选项提交对应迁移模式。
  if (mode.value === 'fresh') {
    window.electron?.ipcRenderer.send('legacy-import:choose', { action: 'fresh' })
    return
  }
  window.electron?.ipcRenderer.send('legacy-import:choose', {
    action: 'import',
    mode: mode.value
  })
}

/**
 * 支持按 Enter 确认当前选择。
 * @param event 当前键盘事件
 * @returns 无返回值
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    void confirmChoice()
  }
}

onMounted(() => {
  document.querySelector<HTMLElement>('.startup-dialog-window')?.focus()
})
</script>

<style src="../startupDialog.css"></style>
<style scoped>
.content {
  overflow-y: auto;
}

.mode-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.mode-option {
  min-height: 94px;
  padding: 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  cursor: pointer;
  box-sizing: border-box;
}

.mode-option.selected {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.07);
}

.mode-option input {
  margin: 3px 0 0;
}

.mode-copy,
.mode-title,
.mode-description {
  display: block;
}

.mode-title {
  font-size: 14px;
  font-weight: 600;
}

.recommended {
  margin-left: 4px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 500;
}

.mode-description {
  margin-top: 6px;
  color: #666;
  font-size: 12px;
  line-height: 1.5;
}

.migration-details {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  font-size: 12px;
  line-height: 1.55;
}

.details-title {
  font-weight: 600;
}

.migration-details ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

.migration-details li + li {
  margin-top: 3px;
}

.excluded {
  margin: 10px 0 0;
  color: #777;
}

@media (prefers-color-scheme: dark) {
  .mode-option {
    border-color: rgba(255, 255, 255, 0.14);
  }

  .mode-option.selected {
    border-color: #60a5fa;
    background: rgba(96, 165, 250, 0.1);
  }

  .recommended {
    color: #60a5fa;
  }

  .mode-description,
  .excluded {
    color: #aaa;
  }

  .migration-details {
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}
</style>
