<template>
  <div class="content-panel">
    <h2 class="section-title">WebDAV 同步</h2>
    <p class="section-desc">通过 WebDAV 实现多设备数据同步</p>

    <!-- 启用同步开关 -->
    <div class="setting-item">
      <div class="setting-label">
        <span>启用同步</span>
        <span class="setting-desc">开启后将自动同步设置、固定列表和插件数据</span>
      </div>
      <label class="toggle">
        <input v-model="syncEnabled" type="checkbox" @change="handleSyncToggle" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <!-- 同步配置 -->
    <div v-if="syncEnabled" class="sync-config">
      <!-- 服务器地址 -->
      <div class="setting-item">
        <label class="setting-label">服务器地址</label>
        <input
          v-model="config.serverUrl"
          type="text"
          class="input"
          placeholder="https://dav.example.com"
        />
      </div>

      <!-- 用户名 -->
      <div class="setting-item">
        <label class="setting-label">用户名</label>
        <input v-model="config.username" type="text" class="input" placeholder="用户名" />
      </div>

      <!-- 密码 -->
      <div class="setting-item">
        <label class="setting-label">密码</label>
        <input v-model="config.password" type="password" class="input" placeholder="密码" />
      </div>

      <!-- 同步间隔 -->
      <div class="setting-item">
        <label class="setting-label">同步间隔</label>
        <select v-model.number="config.syncInterval" class="select">
          <option :value="300">5 分钟</option>
          <option :value="600">10 分钟</option>
          <option :value="1800">30 分钟</option>
          <option :value="3600">1 小时</option>
        </select>
      </div>

      <!-- 操作按钮 -->
      <div class="action-buttons">
        <button class="btn btn-primary" :disabled="testing" @click="testConnection">
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button class="btn btn-primary btn-solid" :disabled="saving" @click="saveConfig">
          {{ saving ? '保存中...' : '保存配置' }}
        </button>
        <button class="btn btn-primary" :disabled="syncing" @click="syncNow">
          {{ syncing ? '同步中...' : '立即同步' }}
        </button>
        <button class="btn btn-warning" :disabled="forceSyncing" @click="forceDownloadFromCloud">
          {{ forceSyncing ? '强制同步中...' : '强制从云端同步' }}
        </button>
      </div>

      <!-- 同步状态 -->
      <div v-if="syncStatus" class="sync-status">
        <div class="status-item">
          <span class="status-label">最后同步:</span>
          <span class="status-value">{{ lastSyncTime }}</span>
        </div>
        <div class="status-item">
          <span class="status-label">待同步文档:</span>
          <span class="status-value">{{ unsyncedCount }} 个</span>
        </div>
        <div v-if="lastSyncResult" class="status-item">
          <span class="status-label">上次同步:</span>
          <span class="status-value">
            上传 {{ lastSyncResult.uploaded }} / 下载 {{ lastSyncResult.downloaded }}
            <span v-if="lastSyncResult.errors > 0" class="error-text">
              / 错误 {{ lastSyncResult.errors }}
            </span>
          </span>
        </div>
      </div>

      <!-- 提示信息 -->
      <div class="sync-tips">
        <p class="tip-title">💡 提示</p>
        <ul class="tip-list">
          <li>推荐使用坚果云等支持 WebDAV 的云存储服务</li>
          <li>服务器地址必须使用 HTTPS 协议</li>
          <li>同步数据包括：固定列表、通用设置、插件配置</li>
          <li>应用使用历史不会同步（每个设备独立）</li>
          <li>
            <strong>强制从云端同步</strong
            >：将云端所有数据强制覆盖到本地，适用于新设备初始化或本地数据损坏的情况
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '../../composables/useToast'

const { success, error, warning, confirm } = useToast()

// 同步配置
const syncEnabled = ref(false)
const config = ref({
  serverUrl: '',
  username: '',
  password: '',
  syncInterval: 600,
  lastSyncTime: 0
})

// 状态
const testing = ref(false)
const saving = ref(false)
const syncing = ref(false)
const forceSyncing = ref(false)
const syncStatus = ref(false)
const unsyncedCount = ref(0)
const lastSyncResult = ref<any>(null)

// 计算最后同步时间
const lastSyncTime = computed(() => {
  if (!config.value.lastSyncTime) return '从未同步'
  const date = new Date(config.value.lastSyncTime)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
})

// 加载配置
async function loadConfig(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetConfig()
    if (result.success && result.config) {
      syncEnabled.value = result.config.enabled
      config.value = {
        serverUrl: result.config.serverUrl || '',
        username: result.config.username || '',
        password: result.config.password || '',
        syncInterval: result.config.syncInterval || 600,
        lastSyncTime: result.config.lastSyncTime || 0
      }
      syncStatus.value = true

      // 加载未同步数量
      loadUnsyncedCount()
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

// 加载未同步数量
async function loadUnsyncedCount(): Promise<void> {
  try {
    const result = await window.ztools.internal.syncGetUnsyncedCount()
    if (result.success) {
      unsyncedCount.value = result.count || 0
    }
  } catch (error) {
    console.error('加载未同步数量失败:', error)
  }
}

// 同步开关切换
async function handleSyncToggle(): Promise<void> {
  if (!syncEnabled.value) {
    // 关闭同步
    try {
      await window.ztools.internal.syncStopAutoSync()
      syncStatus.value = false
    } catch (error) {
      console.error('停止同步失败:', error)
    }
  }
}

// 测试连接
async function testConnection(): Promise<void> {
  if (!config.value.serverUrl || !config.value.username || !config.value.password) {
    warning('请填写完整的服务器地址、用户名和密码')
    return
  }

  testing.value = true
  try {
    const result = await window.ztools.internal.syncTestConnection({
      serverUrl: config.value.serverUrl,
      username: config.value.username,
      password: config.value.password
    })

    if (result.success) {
      success('连接成功！')
    } else {
      error(`连接失败：${result.error}`)
    }
  } catch (err: any) {
    error(`连接失败：${err.message}`)
  } finally {
    testing.value = false
  }
}

// 保存配置
async function saveConfig(): Promise<void> {
  if (!config.value.serverUrl || !config.value.username || !config.value.password) {
    warning('请填写完整的服务器地址、用户名和密码')
    return
  }

  saving.value = true
  try {
    const result = await window.ztools.internal.syncSaveConfig({
      enabled: syncEnabled.value,
      serverUrl: config.value.serverUrl,
      username: config.value.username,
      password: config.value.password,
      syncInterval: config.value.syncInterval
    })

    if (result.success) {
      success('配置保存成功！')
      syncStatus.value = syncEnabled.value
      if (syncEnabled.value) {
        loadUnsyncedCount()
      }
    } else {
      error(`保存失败：${result.error}`)
    }
  } catch (err: any) {
    error(`保存失败：${err.message}`)
  } finally {
    saving.value = false
  }
}

// 立即同步
async function syncNow(): Promise<void> {
  syncing.value = true
  try {
    const result = await window.ztools.internal.syncPerformSync()

    if (result.success && result.result) {
      lastSyncResult.value = result.result
      config.value.lastSyncTime = Date.now()
      loadUnsyncedCount()
      success(
        `同步完成！上传 ${result.result.uploaded} 项，下载 ${result.result.downloaded} 项，错误 ${result.result.errors} 项`,
        4000
      )
    } else {
      error(`同步失败：${result.error}`)
    }
  } catch (err: any) {
    error(`同步失败：${err.message}`)
  } finally {
    syncing.value = false
  }
}

// 强制从云端同步到本地
async function forceDownloadFromCloud(): Promise<void> {
  // 使用自定义确认对话框
  const confirmed = await confirm({
    title: '强制同步警告',
    message: '此操作将强制用云端数据覆盖本地数据，本地未同步的修改将丢失！\n\n确定要继续吗？',
    type: 'danger',
    confirmText: '确定覆盖',
    cancelText: '取消'
  })

  if (!confirmed) return

  forceSyncing.value = true
  try {
    const result = await window.ztools.internal.syncForceDownloadFromCloud()

    if (result.success && result.result) {
      lastSyncResult.value = result.result
      config.value.lastSyncTime = Date.now()
      loadUnsyncedCount()
      success(
        `强制同步完成！下载 ${result.result.downloaded} 项，错误 ${result.result.errors} 项。本地数据已被云端数据覆盖`,
        5000
      )
    } else {
      error(`强制同步失败：${result.error}`)
    }
  } catch (err: any) {
    error(`强制同步失败：${err.message}`)
  } finally {
    forceSyncing.value = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped>
.content-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 24px 0;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.setting-label {
  font-size: 14px;
  color: var(--text-color);
  font-weight: 500;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 400;
}

.sync-config {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--divider-color);
}

.sync-config .setting-item {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.sync-config .setting-label {
  margin-bottom: 0;
}

.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.sync-status {
  margin-top: 24px;
  padding: 16px;
  background: var(--hover-bg);
  border-radius: 8px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}

.status-item:last-child {
  margin-bottom: 0;
}

.status-label {
  color: var(--text-secondary);
}

.status-value {
  color: var(--text-color);
  font-weight: 500;
}

.error-text {
  color: var(--danger-color);
}

.sync-tips {
  margin-top: 24px;
  padding: 16px;
  background: var(--primary-light-bg);
  border-radius: 8px;
  border: 1px solid var(--primary-color);
}

.tip-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 12px 0;
}

.tip-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.tip-list li {
  margin-bottom: 6px;
}

.tip-list li:last-child {
  margin-bottom: 0;
}
</style>
