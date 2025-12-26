<script setup lang="ts">
import { onMounted } from 'vue'
import Toast from './components/common/Toast.vue'
import ConfirmDialog from './components/common/ConfirmDialog.vue'
import Settings from './components/settings/Settings.vue'
import { useToast } from './composables/useToast'

const { toastState, confirmState, handleConfirm, handleCancel } = useToast()

onMounted(() => {
  // 插件进入时直接显示设置页面
  window.ztools.onPluginEnter((action) => {
    console.log('设置插件启动:', action)
  })

  window.ztools.onPluginOut(() => {
    console.log('设置插件退出')
  })
})
</script>

<template>
  <Settings />
  <!-- 全局Toast组件 -->
  <Toast
    v-model:visible="toastState.visible"
    :message="toastState.message"
    :type="toastState.type"
    :duration="toastState.duration"
  />
  <!-- 全局确认对话框 -->
  <ConfirmDialog
    v-model:visible="confirmState.visible"
    :title="confirmState.title"
    :message="confirmState.message"
    :type="confirmState.type"
    :confirm-text="confirmState.confirmText"
    :cancel-text="confirmState.cancelText"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  />
</template>
