# 贡献指南

感谢你对 ZTools 的关注！我们欢迎所有形式的贡献。

## 📋 贡献方式

### 报告 Bug

如果你发现了 Bug，请在 [Issues](https://github.com/ZToolsCenter/ZTools/issues) 中创建一个新的 Issue，并提供以下信息：

- 操作系统版本（macOS/Windows 版本号）
- ZTools 版本号
- 详细的复现步骤
- 预期行为和实际行为
- 错误日志（如果有）
- 截图（如果适用）

### 提出新功能

如果你有新功能的想法：

1. 先在 Issues 中搜索，确保没有重复的建议
2. 创建一个新的 Feature Request Issue
3. 详细描述功能需求和使用场景
4. 如果可能，提供设计草图或示例

### 提交代码

我们欢迎 Pull Request！请遵循以下流程：

## 🔧 开发流程

### 1. Fork 和克隆

```bash
# Fork 本仓库到你的账号，然后克隆（含子模块）
git clone https://github.com/your-username/ZTools.git --recurse-submodules
cd ZTools

# 添加上游仓库
git remote add upstream https://github.com/ZToolsCenter/ZTools.git
```

> 项目已内置 `.npmrc` 配置（Electron 国内镜像 + 原生模块构建白名单），`pnpm install` 即可完成所有依赖安装，无需额外操作。

### 2. 创建分支

```bash
# 从 main 分支创建新分支
git checkout -b feature/my-feature
# 或
git checkout -b fix/my-bugfix
```

分支命名规范：

- `feature/` - 新功能
- `fix/` - Bug 修复
- `docs/` - 文档更新
- `refactor/` - 代码重构
- `perf/` - 性能优化
- `test/` - 测试相关

### 3. 开发

```bash
# 安装依赖（首次或依赖变更后执行，原生模块自动编译）
pnpm install

# 启动开发模式
pnpm dev

# 类型检查
pnpm typecheck

# 代码格式化
pnpm format

# ESLint 检查
pnpm lint
```

### 4. 提交

提交信息格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型（type）：

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 代码重构
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建/工具相关

示例：

```bash
git commit -m "feat(plugin): add clipboard history plugin"
git commit -m "fix(search): fix pinyin search issue"
git commit -m "docs: update plugin development guide"
```

### 5. 推送和创建 PR

```bash
# 推送到你的 fork
git push origin feature/my-feature

# 在 GitHub 上创建 Pull Request
```

PR 标题格式：

- 使用清晰简洁的标题
- 参考 commit 信息格式
- 如 `feat: add xxx feature` 或 `fix: resolve xxx issue`

PR 描述应包含：

- **变更内容**：详细说明做了什么改动
- **动机**：为什么要做这个改动
- **测试**：如何测试这些改动
- **截图**：如果涉及 UI 改动，提供截图
- **相关 Issue**：如 `Closes #123`

## 📝 代码规范

### TypeScript

- 使用 TypeScript 编写所有代码
- 为所有函数添加类型注解
- 避免使用 `any`，优先使用具体类型或泛型
- 遵循项目的 ESLint 规则

### 命名规范

- 文件名：使用 camelCase（如 `pluginManager.ts`）
- 组件名：使用 PascalCase（如 `SearchResults.vue`）
- 变量/函数名：使用 camelCase（如 `getUserInfo`）
- 常量：使用 UPPER_SNAKE_CASE（如 `MAX_HISTORY_SIZE`）
- 接口/类型：使用 PascalCase（如 `PluginConfig`）

### Vue 组件

- 使用 Composition API
- 使用 `<script setup>` 语法
- 组件按以下顺序组织：
  1. imports
  2. props/emits
  3. composables/stores
  4. reactive state
  5. computed
  6. methods
  7. lifecycle hooks

### 注释

- 为复杂逻辑添加注释
- 使用 JSDoc 为公共 API 添加文档
- 注释应该解释"为什么"而不是"做什么"

```typescript
/**
 * 搜索应用和插件
 * @param query - 搜索关键词
 * @returns 搜索结果对象，包含模糊匹配和正则匹配结果
 */
function search(query: string): SearchResult {
  // ...
}
```

## 🧪 测试

目前项目还没有完整的测试覆盖，但我们鼓励：

- 手动测试所有改动
- 在 macOS 和 Windows 上都进行测试（如果可能）
- 测试边界情况和错误处理

## 📚 文档

如果你的改动涉及：

- 新功能：更新 README.md 和 CLAUDE.md
- API 变更：更新 CLAUDE.md 中的 API 文档
- 配置变更：更新相关文档
- Bug 修复：可选择更新文档

## ❓ 问题？

如果你有任何问题，可以：

- 在 Issues 中提问
- 查看 [CLAUDE.md](./CLAUDE.md) 技术文档
- 查看现有的 Pull Requests

## 📜 行为准则

我们期望所有贡献者：

- 友好、尊重他人
- 接受建设性批评
- 专注于对项目最有利的事情
- 对社区表现出同理心

## 🎉 感谢

感谢你的贡献！每一个 PR、Issue、建议都会让 ZTools 变得更好。
