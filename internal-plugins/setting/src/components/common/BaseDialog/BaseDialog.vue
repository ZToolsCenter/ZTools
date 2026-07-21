<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
        <section
          class="dialog-container"
          :class="{ 'dialog-container-compact': compact }"
          :style="{ maxWidth }"
          role="dialog"
          aria-modal="true"
          @click.stop
        >
          <header v-if="showHeader" class="dialog-header">
            <slot name="icon" />
            <div class="dialog-heading">
              <h3 class="dialog-title">{{ title }}</h3>
              <p v-if="subtitle" class="dialog-subtitle">{{ subtitle }}</p>
            </div>
          </header>

          <div class="dialog-content">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="dialog-footer">
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
interface Props {
  visible: boolean
  title?: string
  maxWidth?: string
  closeOnOverlay?: boolean
  showHeader?: boolean
  compact?: boolean
  subtitle?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  maxWidth: '420px',
  closeOnOverlay: true,
  showHeader: true,
  compact: false,
  subtitle: ''
})

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

const close = (): void => {
  emit('close')
  emit('update:visible', false)
}

const handleOverlayClick = (): void => {
  if (!props.closeOnOverlay) return
  close()
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 30000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.24);
  isolation: isolate;
}

.dialog-container {
  position: relative;
  z-index: 1;
  width: min(100%, var(--dialog-width, 420px));
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.86), rgba(224, 244, 246, 0.72)),
    var(--dialog-bg, var(--bg-primary, #ffffff));
  color: var(--text-color, var(--text-primary, #222222));
  box-shadow:
    0 26px 80px rgba(37, 68, 82, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(22px) saturate(1.16);
  -webkit-backdrop-filter: blur(22px) saturate(1.16);
  transform-origin: calc(100% - 28px) 28px;
  will-change: opacity, transform;
}

.dialog-container-compact {
  --dialog-width: 380px;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--divider-color);
}

.dialog-container .dialog-header {
  padding: 18px 22px 16px;
  border-bottom-color: rgba(126, 157, 164, 0.24);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(218, 243, 244, 0.44));
}

.dialog-heading {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.dialog-title {
  margin: 0;
  color: var(--text-color, var(--text-primary, #222222));
  font-size: 16px;
  font-weight: 600;
}

.dialog-container .dialog-title {
  color: rgba(41, 50, 53, 0.96);
  font-size: 17px;
  letter-spacing: 0;
}

.dialog-subtitle {
  margin: 0;
  color: rgba(82, 97, 101, 0.78);
  font-size: 12px;
  line-height: 1.45;
}

.dialog-content {
  padding: 16px 20px;
}

.dialog-container .dialog-content {
  padding: 18px 22px 20px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--divider-color);
}

.dialog-container .dialog-footer {
  gap: 12px;
  padding: 16px 22px 20px;
  border-top-color: rgba(126, 157, 164, 0.2);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(241, 249, 248, 0.54));
}

@media (prefers-color-scheme: dark) {
  .dialog-overlay {
    background: rgba(0, 0, 0, 0.38);
  }

  .dialog-container {
    border-color: rgba(255, 255, 255, 0.16);
    background:
      linear-gradient(145deg, rgba(46, 58, 63, 0.88), rgba(24, 37, 43, 0.78)),
      var(--dialog-bg, #303133);
    box-shadow:
      0 28px 80px rgba(0, 0, 0, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.11);
  }

  .dialog-container .dialog-header,
  .dialog-container .dialog-footer {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(31, 52, 58, 0.34));
  }

  .dialog-container .dialog-title {
    color: rgba(245, 248, 249, 0.94);
  }

  .dialog-subtitle {
    color: rgba(214, 225, 227, 0.72);
  }
}

.dialog-enter-active,
.dialog-leave-active {
  pointer-events: none;
}

.dialog-enter-active {
  animation: dialog-overlay-fade-in 0.25s ease-out forwards;
}

.dialog-leave-active {
  animation: dialog-overlay-fade-out 0.35s ease-in forwards;
}

.dialog-enter-active .dialog-container {
  animation: dialog-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.dialog-leave-active .dialog-container {
  animation: dialog-collapse-to-close 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes dialog-overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes dialog-overlay-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes dialog-scale-in {
  from {
    opacity: 0;
    transform: scale(0.85) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes dialog-collapse-to-close {
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
