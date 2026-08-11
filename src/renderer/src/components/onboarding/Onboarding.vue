<script setup lang="ts">
import { ref } from 'vue'

/**
 * 画像向导：首次启动时采集用户身份、使用场景与偏好，
 * 用于插件市场推荐侧重与首页预排。三步可跳过，直接"开始使用"走默认画像。
 */

const emit = defineEmits<{ completed: [] }>()

type IdentityKey =
  | 'student'
  | 'teacher'
  | 'office'
  | 'government'
  | 'developer'
  | 'lawyer'
  | 'designer'
  | 'boss'
  | 'other'
type ScenarioKey =
  | 'productivity'
  | 'development'
  | 'media'
  | 'learning'
  | 'entertainment'
  | 'system'
  | 'network'
  | 'text'

/** 线性图标（feather 风格，stroke 跟随当前色）。 */
interface IconOption<K extends string> {
  key: K
  label: string
  path: string
}

const identityOptions: IconOption<IdentityKey>[] = [
  {
    key: 'student',
    label: '学生',
    path: 'M22 10L12 5 2 10l10 5 10-5z M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5'
  },
  {
    key: 'teacher',
    label: '教师',
    path: 'M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z'
  },
  {
    key: 'office',
    label: '上班族',
    path: 'M16 20V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v16M3 7h18v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7z'
  },
  {
    key: 'government',
    label: '政务工作者',
    path: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M14 9h1M14 13h1'
  },
  {
    key: 'developer',
    label: '开发者',
    path: 'M16 18l6-6-6-6M8 6l-6 6 6 6'
  },
  {
    key: 'lawyer',
    label: '律师',
    path: 'M12 3v18M5 21h14M7 7l-2 4a3 3 0 006 0L9 7M17 7l-2 4a3 3 0 006 0l-2-4'
  },
  {
    key: 'designer',
    label: '设计师',
    path: 'M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z'
  },
  {
    key: 'boss',
    label: '老板',
    path: 'M2 17h20M3 17l3-8 4 4 2-6 2 6 4-4 3 8H3z'
  },
  {
    key: 'other',
    label: '其他',
    path: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z'
  }
]

/**
 * 各身份默认倾向的使用场景，选择身份时自动预填（可在下一步调整）。
 */
const IDENTITY_DEFAULT_SCENARIOS: Record<IdentityKey, ScenarioKey[]> = {
  student: ['learning', 'productivity'],
  teacher: ['learning', 'productivity', 'text'],
  office: ['productivity', 'text'],
  government: ['productivity', 'text', 'system'],
  developer: ['development', 'network', 'text'],
  lawyer: ['text', 'learning'],
  designer: ['media', 'productivity'],
  boss: ['productivity', 'entertainment'],
  other: []
}

const scenarioOptions: IconOption<ScenarioKey>[] = [
  {
    key: 'productivity',
    label: '效率办公',
    path: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'
  },
  {
    key: 'development',
    label: '开发编程',
    path: 'M16 18l6-6-6-6M8 6l-6 6 6 6'
  },
  {
    key: 'media',
    label: '媒体处理',
    path: 'M3 5h18v14H3zM3 10l6-4 6 6 4-3'
  },
  {
    key: 'learning',
    label: '学习翻译',
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20V2H6.5A2.5 2.5 0 004 4.5v15zM4 19.5A2.5 2.5 0 016.5 17H20'
  },
  {
    key: 'entertainment',
    label: '娱乐影音',
    path: 'M5 3l14 9-14 9V3z'
  },
  {
    key: 'system',
    label: '系统工具',
    path: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'
  },
  {
    key: 'network',
    label: '网络下载',
    path: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18'
  },
  {
    key: 'text',
    label: '文本处理',
    path: 'M4 7V4h16v3M9 20h6M12 4v16'
  }
]

const step = ref(0)
const selectedIdentity = ref<IdentityKey | null>(null)
const selectedScenarios = ref<ScenarioKey[]>([])
const windowBehavior = ref<'standard' | 'launcher'>('standard')
const themePreference = ref<'light' | 'dark' | 'system'>('system')

function toggleScenario(key: ScenarioKey): void {
  const idx = selectedScenarios.value.indexOf(key)
  if (idx >= 0) {
    selectedScenarios.value.splice(idx, 1)
  } else {
    selectedScenarios.value.push(key)
  }
}

/**
 * 选择身份时预填该身份默认倾向的场景，方便小白一步到位（后续可调整）。
 * @param key 选中的身份
 */
function selectIdentity(key: IdentityKey): void {
  selectedIdentity.value = key
  selectedScenarios.value = [...IDENTITY_DEFAULT_SCENARIOS[key]]
}

async function saveAndFinish(): Promise<void> {
  // ref 的 value（如 selectedScenarios）是 Vue 响应式代理，直接经 IPC 结构化克隆会报
  // "An object could not be cloned"；先深拷贝为普通可克隆对象再写入。
  const profile = JSON.parse(
    JSON.stringify({
      version: 1,
      completed: true,
      identity: selectedIdentity.value ?? 'other',
      scenarios: selectedScenarios.value,
      windowBehavior: windowBehavior.value,
      theme: themePreference.value,
      onboardedAt: Date.now(),
      updatedAt: Date.now()
    })
  )
  await window.ztools.dbPut('user-profile', profile)
  emit('completed')
}
</script>

<template>
  <div class="onboarding">
    <div class="onboarding__inner">
      <!-- 步骤指示 -->
      <div class="onboarding__progress">
        <span
          v-for="i in 3"
          :key="i"
          class="onboarding__dot"
          :class="{ 'onboarding__dot--active': i - 1 === step }"
        ></span>
      </div>

      <template v-if="step === 0">
        <h2 class="onboarding__title">欢迎使用 ZTools</h2>
        <p class="onboarding__desc">先了解你的身份，帮你推荐更合适的插件。</p>
        <div class="onboarding__options">
          <button
            v-for="opt in identityOptions"
            :key="opt.key"
            class="onboarding__option"
            :class="{ 'onboarding__option--selected': selectedIdentity === opt.key }"
            @click="selectIdentity(opt.key)"
          >
            <svg
              class="onboarding__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="opt.path" />
            </svg>
            <span class="onboarding__option-label">{{ opt.label }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="step === 1">
        <h2 class="onboarding__title">你常用这些场景吗？</h2>
        <p class="onboarding__desc">可多选，用于插件市场推荐侧重，之后随时可改。</p>
        <div class="onboarding__options">
          <button
            v-for="opt in scenarioOptions"
            :key="opt.key"
            class="onboarding__option"
            :class="{ 'onboarding__option--selected': selectedScenarios.includes(opt.key) }"
            @click="toggleScenario(opt.key)"
          >
            <svg
              class="onboarding__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="opt.path" />
            </svg>
            <span class="onboarding__option-label">{{ opt.label }}</span>
          </button>
        </div>
      </template>

      <template v-else>
        <h2 class="onboarding__title">最后，选个喜欢的方式</h2>
        <p class="onboarding__desc">这些偏好也会用于推荐与默认布局。</p>
        <div class="onboarding__pref">
          <div class="onboarding__pref-row">
            <span class="onboarding__pref-label">窗口形态</span>
            <div class="onboarding__seg">
              <button
                class="onboarding__seg-btn"
                :class="{ 'onboarding__seg-btn--active': windowBehavior === 'standard' }"
                @click="windowBehavior = 'standard'"
              >
                普通窗口
              </button>
              <button
                class="onboarding__seg-btn"
                :class="{ 'onboarding__seg-btn--active': windowBehavior === 'launcher' }"
                @click="windowBehavior = 'launcher'"
              >
                快捷启动器
              </button>
            </div>
          </div>
          <div class="onboarding__pref-row">
            <span class="onboarding__pref-label">外观主题</span>
            <div class="onboarding__seg">
              <button
                v-for="t in [
                  { key: 'light', label: '浅色' },
                  { key: 'dark', label: '深色' },
                  { key: 'system', label: '跟随系统' }
                ] as const"
                :key="t.key"
                class="onboarding__seg-btn"
                :class="{ 'onboarding__seg-btn--active': themePreference === t.key }"
                @click="themePreference = t.key"
              >
                {{ t.label }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <div class="onboarding__footer">
        <button v-if="step > 0" class="onboarding__back" @click="step -= 1">上一步</button>
        <button v-else class="onboarding__skip" @click="saveAndFinish">跳过</button>
        <button
          class="onboarding__next"
          :class="{ 'onboarding__next--finish': step === 2 }"
          @click="step < 2 ? (step += 1) : saveAndFinish()"
        >
          {{ step === 2 ? '开始使用' : '下一步' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  height: 560px; /* 与 App.vue 进入向导时的 resizeWindow(560) 保持一致 */
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 560px;
  padding: 24px 28px 20px;
}

.onboarding__progress {
  display: flex;
  gap: 8px;
}

.onboarding__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--divider-color, rgba(128, 128, 128, 0.4));
  transition: background 0.2s;
}

.onboarding__dot--active {
  background: var(--primary-color, #4a90d9);
}

.onboarding__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #eee);
  text-align: center;
}

.onboarding__desc {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  text-align: center;
}

.onboarding__options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

.onboarding__option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 104px;
  padding: 18px 0 14px;
  border: 1px solid var(--divider-color, rgba(128, 128, 128, 0.35));
  border-radius: 12px;
  background: transparent;
  color: var(--text-primary, #eee);
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    transform 0.1s;
}

.onboarding__option:hover {
  border-color: var(--primary-color, #4a90d9);
  transform: translateY(-1px);
}

.onboarding__option--selected {
  border-color: var(--primary-color, #4a90d9);
  background: color-mix(in srgb, var(--primary-color, #4a90d9) 14%, transparent);
}

.onboarding__icon {
  width: 26px;
  height: 26px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
}

.onboarding__option--selected .onboarding__icon {
  color: var(--primary-color, #4a90d9);
}

.onboarding__option-label {
  font-size: 14px;
}

.onboarding__pref {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 420px;
}

.onboarding__pref-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.onboarding__pref-label {
  font-size: 14px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  flex-shrink: 0;
}

.onboarding__seg {
  display: flex;
  gap: 8px;
}

.onboarding__seg-btn {
  padding: 9px 18px;
  border: 1px solid var(--divider-color, rgba(128, 128, 128, 0.35));
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #eee);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.onboarding__seg-btn--active {
  border-color: var(--primary-color, #4a90d9);
  background: color-mix(in srgb, var(--primary-color, #4a90d9) 14%, transparent);
  color: var(--primary-color, #4a90d9);
}

.onboarding__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 420px;
  margin-top: 8px;
}

.onboarding__skip,
.onboarding__back {
  border: none;
  background: transparent;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  font-size: 14px;
  cursor: pointer;
  padding: 8px 12px;
}

.onboarding__skip:hover,
.onboarding__back:hover {
  color: var(--text-primary, #eee);
}

.onboarding__next {
  padding: 10px 30px;
  border: none;
  border-radius: 9px;
  background: var(--primary-color, #4a90d9);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.onboarding__next:hover {
  opacity: 0.9;
}
</style>
