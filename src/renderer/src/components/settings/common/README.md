# Settings 通用组件

这个文件夹包含设置页面中可复用的通用组件。

## 组件列表

### 1. CommandCard.vue

**用途**: 用于显示单个系统应用或系统设置的指令卡片

**Props**:

- `command` (Object): 指令对象
  - `name` (string): 指令名称
  - `icon` (string, 可选): 图标路径或 emoji
  - `path` (string, 可选): 路径
  - `subType` (string, 可选): 子类型 ('app' | 'system-setting')
  - `category` (string, 可选): 分类
  - `settingUri` (string, 可选): 设置 URI
  - `needsIconFilter` (boolean, 可选): 是否需要图标滤镜

**Slots**:

- `meta`: 自定义元信息显示

**示例**:

```vue
<CommandCard :command="command" />

<!-- 自定义元信息 -->
<CommandCard :command="command">
  <template #meta>
    <span>自定义元信息</span>
  </template>
</CommandCard>
```

---

### 2. FeatureCard.vue

**用途**: 用于显示插件的 feature 分组卡片

**Props**:

- `feature` (Object): Feature 对象
  - `name` (string, 可选): Feature 名称
  - `code` (string, 可选): Feature 代码
  - `explain` (string, 可选): Feature 说明
  - `icon` (string, 可选): 图标路径或 emoji

**Slots**:

- 默认插槽: 用于放置 CommandTag 组件

**示例**:

```vue
<FeatureCard :feature="feature">
  <CommandTag>指令文本</CommandTag>
  <CommandTag type="regex">
    <span>正则表达式</span>
    <span class="tag-badge">正则</span>
  </CommandTag>
</FeatureCard>
```

---

### 3. CommandTag.vue

**用途**: 用于显示指令标签（功能指令、匹配指令）

**Props**:

- `type` (string, 可选): 标签类型 ('text' | 'regex' | 'over')
  - 不传或传 'text': 蓝色功能指令样式
  - 'regex': 紫色正则匹配样式
  - 'over': 绿色任意文本样式

**Slots**:

- 默认插槽: 标签内容
  - 可以使用 `<span class="tag-badge">` 添加徽章

**示例**:

```vue
<!-- 功能指令 -->
<CommandTag>打开设置</CommandTag>

<!-- 正则匹配指令 -->
<CommandTag type="regex">
  <span>^\\d+$</span>
  <span class="tag-badge">正则</span>
</CommandTag>

<!-- 任意文本指令 -->
<CommandTag type="over">
  <span>搜索</span>
  <span class="tag-badge">长度 1-100</span>
</CommandTag>
```

---

## 使用场景

### 在 AllCommands.vue 中

```vue
<!-- 系统应用/设置 -->
<CommandCard v-for="(cmd, index) in systemCommands" :key="index" :command="cmd" />

<!-- 插件 Feature -->
<FeatureCard v-for="feature in pluginFeatures" :key="feature.code" :feature="feature">
  <CommandTag
    v-for="cmd in feature.textCmds"
    :key="cmd.text"
  >
    {{ cmd.text }}
  </CommandTag>
  <CommandTag
    v-for="cmd in feature.matchCmds"
    :key="cmd.match"
    :type="cmd.type"
  >
    <span>{{ cmd.match }}</span>
    <span class="tag-badge">{{ cmd.type === 'regex' ? '正则' : '任意文本' }}</span>
  </CommandTag>
</FeatureCard>
```

### 在 PluginDetail.vue 中

```vue
<FeatureCard v-for="feature in plugin.features" :key="feature.code" :feature="feature">
  <CommandTag
    v-for="cmd in feature.cmds"
    :key="cmd.id"
    :type="cmd.type"
  >
    <span>{{ cmd.label }}</span>
    <span v-if="cmd.badge" class="tag-badge">{{ cmd.badge }}</span>
  </CommandTag>
</FeatureCard>
```

---

## 样式说明

所有组件都使用全局 CSS 变量 (`style.css` 中定义)，自动支持亮色/暗色主题切换：

- `--text-color`: 文本颜色
- `--text-secondary`: 次要文本颜色
- `--bg-color`: 背景颜色
- `--hover-bg`: hover 背景颜色
- `--card-bg`: 卡片背景颜色
- `--control-bg`: 控制器背景颜色
- `--border-color`: 边框颜色
- `--primary-color`: 主题色

CommandTag 组件有内置的三种颜色主题（蓝/紫/绿），并自动适配暗色模式。
