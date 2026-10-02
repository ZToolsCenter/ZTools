# ZTools 本地增强（ZT-Enhance）

本目录是官方开源仓库（https://github.com/ZToolsCenter/ZTools.git）+ 本地增强改动。
所有改动均以 `// [ZT-Enhance]` 或 `<!-- [ZT-Enhance] -->` 注释标记，全局搜索该标记即可定位全部改动点。

## 功能清单

### 1. AutoPin 自动固定

- 新安装的插件在写入注册表的同一时刻自动固定到「双击 Alt 搜索面板」与「鼠标超级面板」，
  早于面板刷新事件，装完即可见（无需重启）。
- 插件更新后自动修复固定列表里的旧 asar 路径（asar 文件名含版本+哈希，更新必变）。
- 手动取消固定的插件不会被自动加回（以覆盖前的注册表为准判断"新插件"）。
- 搜索面板条目包含 pinyin-pro 拼音字段（pinyin / pinyinAbbr），与原生固定格式一致。

### 2. 插件批量管理（设置 → 通用设置 → 插件批量管理）

三个全局开关，存储于宿主库 `batch-plugin-manage` 文档，主进程实时读取，优先级高于单个插件的同名配置：

| 开关                       | 默认                               | 生效           |
| -------------------------- | ---------------------------------- | -------------- |
| 跟随启动 autoStartAll      | 关                                 | 重启 ZTools 后 |
| 关闭后自动销毁 outKillAll  | 关                                 | 实时           |
| 自动分离窗口 autoDetachAll | **开**（点击插件直接独立窗口打开） | 实时           |

## 改动点索引

| 文件                                                                   | 内容                                          |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| `src/main/enhance/pluginEnhance.ts`                                    | **核心实现**：批量配置读取 + AutoPin 全部逻辑 |
| `src/shared/storageKeys.ts`                                            | 新增 `batchPluginManage` 键                   |
| `src/main/api/renderer/plugins.ts`                                     | `writeInstalledPlugins` 调用 AutoPin          |
| `src/main/api/renderer/commands.ts`                                    | 启动插件时的自动分离决策接入批量开关          |
| `src/main/managers/pluginManager.ts`                                   | 插件退出销毁决策接入批量开关                  |
| `src/main/appMain.ts`                                                  | 启动预加载接入批量开关                        |
| `internal-plugins/setting/src/views/GeneralSetting/GeneralSetting.vue` | 批量管理设置卡片（原生 Vue）                  |
| `pnpm-workspace.yaml`                                                  | allowBuilds 配置（详见文件内注释）            |

## 修改后如何生效

```bash
# 1. 类型检查（可选但建议）
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json --composite false
cd internal-plugins/setting && pnpm exec vue-tsc --noEmit && pnpm exec vite build && cd ../..

# 2. 构建主进程（输出 out/）
pnpm exec electron-vite build

# 3. 组装并替换运行中的 ZTools（用最近一次官方 app.asar 的树 + 新 out/）
#    见 ENHANCEMENTS.md「修改后如何生效」与 scripts/deploy-build.js
```

更省事的方式：改完源码后直接运行

```
scripts/deploy-build.js
```

它会自动完成：构建设置插件 → 构建主进程 → 解包当前 app.asar → 换入新 out/ → 重打包 →
一致性校验 → 备份 → 替换 → 重启 ZTools。

## 注意事项

- ZTools 自动升级会整体覆盖 `resources/`（app.asar 与内置插件目录），
  升级后需要重新部署（跑一次上面的脚本即可）；若新版源码有变化，先 `git pull` 同步。
- 本仓库当前版本 3.2.0 与已安装版本一致；依赖无本地新增。
- 首次安装依赖：`pnpm install`（需先 `git init`，postinstall 会配置 git hooks）。
- `pnpm-workspace.yaml` 中 electron 等构建脚本设为 false（跳过下载 Electron 二进制）；
  将来要用 electron-builder 打完整安装包（`pnpm build:win`）时把 `electron` 改为 `true`。
