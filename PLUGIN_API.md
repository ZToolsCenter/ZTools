# 插件 API 文档

zTools 为插件提供了一套丰富的 API，通过全局对象 `window.ztools` 暴露。

## 基础 API

### `window.ztools.onPluginEnter(callback)`

监听插件进入事件。当用户打开插件时触发。

- **callback**: `(param: LaunchParam) => void` - 回调函数，接收启动参数。

#### LaunchParam 结构

- `payload`: `any` - 传递的数据（例如搜索框内容）
- `type`: `'text' | 'regex' | 'over'` - 命令类型
  - `'text'`: 文本匹配
  - `'regex'`: 正则表达式匹配
  - `'over'`: 任意文本匹配
- `code`: `string` - 插件 Feature Code (如果是由 Feature 触发)

### `window.ztools.setExpendHeight(height)`

设置插件视图的高度。

- **height**: `number` - 期望的高度（像素）。

### `window.ztools.showNotification(body)`

显示系统通知。

- **body**: `string` - 通知内容。

### `window.ztools.sendInputEvent(event)`

发送模拟输入事件。

- **event**: `MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent` - 输入事件对象。

#### 事件对象结构

**KeyboardInputEvent (键盘事件)**

- `type`: `'keyDown'` | `'keyUp'` | `'char'`
- `keyCode`: `string` - 键盘代码
- `modifiers`: `string[]` - 修饰键数组 (例如 `['shift', 'control']`)

**MouseInputEvent (鼠标事件)**

- `type`: `'mouseDown'` | `'mouseUp'` | `'mouseEnter'` | `'mouseLeave'` | `'contextMenu'` | `'mouseMove'`
- `x`: `number` - X 坐标
- `y`: `number` - Y 坐标
- `button`: `'left'` | `'middle'` | `'right'` - 按钮类型
- `clickCount`: `number` - 点击次数

**MouseWheelInputEvent (滚轮事件)**

- `type`: `'mouseWheel'`
- `deltaX`: `number`
- `deltaY`: `number`
- `wheelTicksX`: `number`
- `wheelTicksY`: `number`
- `accelerationRatioX`: `number`
- `accelerationRatioY`: `number`
- `hasPreciseScrollingDeltas`: `boolean`
- `canScroll`: `boolean`

## 搜索框 API

### `window.ztools.setSubInput(onChange, placeholder)`

设置主窗口搜索框的行为（当插件处于活动状态时）。

- **onChange**: `(text: string) => void` - 当用户在搜索框输入时触发的回调函数。
- **placeholder**: `string` - 搜索框的占位符文本。

## 数据库 API

插件拥有独立的数据库存储空间（Bucket），以插件名称隔离。

### `window.ztools.db.put(key, data)`

保存数据。

- **key**: `string` - 键名。
- **data**: `any` - 要保存的数据。

### `window.ztools.db.get(key)`

获取数据。

- **key**: `string` - 键名。
- **返回**: `Promise<any>` - 数据内容。

### `window.ztools.db.remove(doc)`

删除数据。

- **doc**: `object` - 要删除的文档对象（通常包含 `_id` 和 `_rev`）。

## 剪贴板 API

### `window.ztools.clipboard.getHistory(page, pageSize, filter)`

获取剪贴板历史记录。

- **page**: `number` - 页码（从 1 开始）。
- **pageSize**: `number` - 每页数量。
- **filter**: `object` (可选) - 过滤条件 `{ type?: 'text' | 'image' | 'file', keyword?: string }`。

### `window.ztools.clipboard.search(keyword)`

搜索剪贴板历史。

- **keyword**: `string` - 搜索关键词。

### `window.ztools.clipboard.delete(id)`

删除单条历史记录。

- **id**: `string` - 记录 ID。

### `window.ztools.clipboard.clear(type)`

清空历史记录。

- **type**: `string` (可选) - 要清空的类型。如果不传，清空所有。

### `window.ztools.clipboard.getStatus()`

获取剪贴板状态。

- **返回**: `Promise<{ isRunning: boolean, itemCount: number, imageCount: number, imageStorageSize: number }>`

### `window.ztools.clipboard.write(id)`

将历史记录写回系统剪贴板。

- **id**: `string` - 记录 ID。

### `window.ztools.clipboard.updateConfig(config)`

更新剪贴板配置。

- **config**: `object` - 配置对象。

### `window.ztools.clipboard.onChange(callback)`

监听剪贴板变化事件。

- **callback**: `(item: object) => void` - 回调函数，接收新的剪贴板条目。
