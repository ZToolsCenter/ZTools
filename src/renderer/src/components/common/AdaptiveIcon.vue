<template>
  <img
    :src="src"
    :class="['adaptive-icon', adaptiveClass]"
    :style="adaptiveStyle"
    v-bind="$attrs"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useColorScheme } from '../../composables/useColorScheme'

const props = defineProps<{
  src: string
  alt?: string
  forceAdaptive?: boolean // 强制启用自适应（跳过检测）
}>()

const emit = defineEmits<{
  (e: 'error', event: Event): void
}>()

const { isDark } = useColorScheme()
const analysisResult = ref<{
  isSimpleIcon: boolean
  mainColor: string | null
  isDark: boolean
  needsAdaptation: boolean
} | null>(null)

const isAnalyzing = ref(false)

// 分析图片
async function analyzeImage(): Promise<void> {
  if (isAnalyzing.value || !props.src) return

  isAnalyzing.value = true
  try {
    const result = await window.ztools.analyzeImage(props.src)
    analysisResult.value = result
  } catch (error) {
    console.error('[AdaptiveIcon] 图片分析失败:', error)
    analysisResult.value = null
  } finally {
    isAnalyzing.value = false
  }
}

// 计算自适应类名
const adaptiveClass = computed(() => {
  if (props.forceAdaptive) {
    return 'force-adaptive'
  }

  if (!analysisResult.value?.needsAdaptation) {
    return ''
  }

  // 自适应反色规则：图标颜色和背景颜色相同时反色
  // - 深色图标 + 深色模式 → 反色（黑色变白色）
  // - 浅色图标 + 浅色模式 → 反色（白色变黑色）
  const shouldInvert = analysisResult.value.isDark === isDark.value

  if (shouldInvert) {
    return 'adaptive-invert'
  }

  return ''
})

// 计算自适应样式
const adaptiveStyle = computed(() => {
  if (props.forceAdaptive || !analysisResult.value?.needsAdaptation) {
    return {}
  }

  // 可以在这里添加更复杂的颜色映射逻辑
  return {}
})

// 错误处理
function onError(event: Event): void {
  emit('error', event)
}

// 监听 src 变化，重新分析
watch(
  () => props.src,
  () => {
    analysisResult.value = null
    analyzeImage()
  },
  { immediate: true }
)

onMounted(() => {
  if (props.src) {
    analyzeImage()
  }
})
</script>

<script lang="ts">
export default {
  name: 'AdaptiveIcon',
  inheritAttrs: false
}
</script>

<style scoped>
.adaptive-icon {
  background: transparent;
  display: block;
}

/* 深色模式下反色 */
.adaptive-icon.adaptive-invert {
  filter: invert(1) brightness(1.1);
}

/* 强制自适应模式 - 仅在深色模式下应用 */
@media (prefers-color-scheme: dark) {
  .adaptive-icon.force-adaptive {
    filter: invert(1) brightness(1.1);
  }
}
</style>
