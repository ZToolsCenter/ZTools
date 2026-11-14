import { computed, ref, watch, type Ref } from 'vue'

/**
 * 导航逻辑 Composable
 * 处理键盘导航、选中状态等
 */
export function useNavigation(
  mode: Ref<'aggregate' | 'list'>,
  navigationGrid: Ref<any[]>
): {
  selectedRow: Ref<number>
  selectedCol: Ref<number>
  selectedItem: any
  handleKeydown: (event: KeyboardEvent, onSelect: (item: any) => void) => void
  resetSelection: () => void
} {
  const selectedRow = ref(0)
  const selectedCol = ref(0)

  // 获取当前选中的元素
  const selectedItem = computed(() => {
    const grid = navigationGrid.value
    if (grid.length === 0 || selectedRow.value >= grid.length) {
      return null
    }
    const row = grid[selectedRow.value]
    if (!row || selectedCol.value >= row.items.length) {
      return null
    }
    return row.items[selectedCol.value]
  })

  // 列表模式键盘导航
  function handleListModeKeydown(event: KeyboardEvent, onSelect: (item: any) => void): void {
    const grid = navigationGrid.value
    if (!grid || grid.length === 0) return

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (selectedRow.value < grid.length - 1) {
          selectedRow.value++
        } else {
          selectedRow.value = 0 // 循环到第一项
        }
        selectedCol.value = 0
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (selectedRow.value > 0) {
          selectedRow.value--
        } else {
          selectedRow.value = grid.length - 1 // 循环到最后一项
        }
        selectedCol.value = 0
        break
      }
      case 'Enter': {
        event.preventDefault()
        const item = selectedItem.value
        if (item) {
          onSelect(item)
        }
        break
      }
      case 'Tab': {
        event.preventDefault()
        if (event.shiftKey) {
          if (selectedRow.value > 0) {
            selectedRow.value--
          } else {
            selectedRow.value = grid.length - 1
          }
        } else {
          if (selectedRow.value < grid.length - 1) {
            selectedRow.value++
          } else {
            selectedRow.value = 0
          }
        }
        selectedCol.value = 0
        break
      }
    }
  }

  // 聚合模式键盘导航
  function handleAggregateModeKeydown(event: KeyboardEvent, onSelect: (item: any) => void): void {
    const grid = navigationGrid.value
    if (!grid || grid.length === 0) return

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (selectedRow.value < grid.length - 1) {
          selectedRow.value++
        } else {
          selectedRow.value = 0
        }
        const currentRowItems = grid[selectedRow.value].items
        selectedCol.value = Math.min(selectedCol.value, currentRowItems.length - 1)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (selectedRow.value > 0) {
          selectedRow.value--
        } else {
          selectedRow.value = grid.length - 1
        }
        const upRowItems = grid[selectedRow.value].items
        selectedCol.value = Math.min(selectedCol.value, upRowItems.length - 1)
        break
      }
      // 左右方向键按选中行的形态分流：
      // - 选中行是多卡片横向行（推荐/最佳匹配等）→ 行内左右循环切换卡片，不跨行；
      // - 选中行是单项行（搜索结果列表等）→ 不拦截，交给主搜索框移动光标/编辑文本；
      // - 带修饰键（Cmd/Alt/Shift/Ctrl）一律交给输入框，保证行首行尾/按词/选区编辑始终可用。
      case 'ArrowRight': {
        const rowItems = grid[selectedRow.value]?.items
        if (!rowItems || rowItems.length <= 1) return
        if (event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return
        event.preventDefault()
        selectedCol.value = selectedCol.value < rowItems.length - 1 ? selectedCol.value + 1 : 0
        break
      }
      case 'ArrowLeft': {
        const rowItems = grid[selectedRow.value]?.items
        if (!rowItems || rowItems.length <= 1) return
        if (event.metaKey || event.altKey || event.shiftKey || event.ctrlKey) return
        event.preventDefault()
        selectedCol.value = selectedCol.value > 0 ? selectedCol.value - 1 : rowItems.length - 1
        break
      }
      case 'Enter': {
        event.preventDefault()
        const item = selectedItem.value
        if (item) {
          onSelect(item)
        }
        break
      }
      case 'Tab': {
        event.preventDefault()
        if (event.shiftKey) {
          if (selectedCol.value > 0) {
            selectedCol.value--
          } else if (selectedRow.value > 0) {
            selectedRow.value--
            const prevRowItems = grid[selectedRow.value].items
            selectedCol.value = prevRowItems.length - 1
          } else {
            selectedRow.value = grid.length - 1
            const lastRowItems = grid[selectedRow.value].items
            selectedCol.value = lastRowItems.length - 1
          }
        } else if (grid.length > 0 && selectedRow.value < grid.length) {
          const currentRowItems = grid[selectedRow.value].items
          if (selectedCol.value < currentRowItems.length - 1) {
            selectedCol.value++
          } else if (selectedRow.value < grid.length - 1) {
            selectedRow.value++
            selectedCol.value = 0
          } else {
            selectedRow.value = 0
            selectedCol.value = 0
          }
        }
        break
      }
    }
  }

  // 键盘导航处理
  function handleKeydown(event: KeyboardEvent, onSelect: (item: any) => void): void {
    if (mode.value === 'list') {
      handleListModeKeydown(event, onSelect)
    } else {
      handleAggregateModeKeydown(event, onSelect)
    }
  }

  // 重置选中状态
  function resetSelection(): void {
    selectedRow.value = 0
    selectedCol.value = 0
  }

  // 监听 grid 变化，修正选中位置
  watch(navigationGrid, (newGrid) => {
    if (newGrid.length === 0) {
      return
    }

    if (selectedRow.value >= newGrid.length) {
      selectedRow.value = Math.max(0, newGrid.length - 1)
    }

    const currentRow = newGrid[selectedRow.value]
    if (currentRow && selectedCol.value >= currentRow.items.length) {
      selectedCol.value = Math.max(0, currentRow.items.length - 1)
    }
  })

  return {
    selectedRow,
    selectedCol,
    selectedItem,
    handleKeydown,
    resetSelection
  }
}
