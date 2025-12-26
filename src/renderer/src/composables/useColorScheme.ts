import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export function useColorScheme(): { isDark: Ref<boolean> } {
  const isDark = ref(false)

  const updateTheme = (): void => {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  let mediaQuery: MediaQueryList | null = null

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    updateTheme()

    // 监听主题变化
    mediaQuery.addEventListener('change', updateTheme)
  })

  onUnmounted(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', updateTheme)
    }
  })

  return { isDark }
}
