# 3.2.0-beta.2

## 新功能 (Feat)

- 插件市场添加排行榜
- 通用设置新增「紧凑顶部栏」，缩小主搜索框和插件顶部栏以显示更多内容
- 通用设置新增「插件内 ESC 直接隐藏」，在插件中按 ESC 可直接隐藏主窗口，并在下次唤出时返回搜索
- 更新窗口支持最小化，并保留当前更新状态（PR [#627](../../pull/627)，感谢 [@Hillindigo](https://github.com/Hillindigo) 的贡献 🎉）
- 账号设置支持修改密码，修改成功后会退出当前登录并要求使用新密码重新登录
- AI 供应商支持 OpenAI Chat Completions、Anthropic Messages 和 OpenAI Responses 接口协议（PR [#635](../../pull/635)，感谢 [@Particaly](https://github.com/Particaly) 的贡献 🎉）
- AI 模型配置支持设置上下文、图片输入能力、推理协议、默认思考深度及供应商协议值
- 使用全局快捷键或超级面板启动声明了 `mainHide` 的插件指令时，不再短暂唤出主窗口
- 内置截图支持通过 `autoConfirm=false` 进入编辑态，并返回截图图像和区域信息（PR [#631](../../pull/631)，感谢 [@Particaly](https://github.com/Particaly) 的贡献 🎉）
- 新增 `ztools.startDrag` 插件 API，支持将单个或多个文件拖动到外部应用（PR [#649](../../pull/649)，感谢 [@guopenghui](https://github.com/guopenghui) 的贡献 🎉）
- 新增 `ztools.getPath('pluginData')` 插件 API，为每个插件提供自动创建的专属数据目录；清空插件数据或卸载时可一并清理（PR [#650](../../pull/650)，感谢 [@Particaly](https://github.com/Particaly) 的贡献 🎉）

## 修复 (Fix)

- 修复 Windows 上部分系统 EXE 无法通过本地启动项打开的问题（PR [#653](../../pull/653)，感谢 [@guopenghui](https://github.com/guopenghui) 的贡献 🎉）
- 修改登录用户昵称和头像后其他电脑进入未刷新
- 更新窗口链接暗色显示问题、链接跳转问题
- uwp应用图标失
- win 应用扫描超时

## 优化 (Optimize)

无

## 重构 (Refactor)

- 清理旧版 AI 调用实现，统一多协议适配、流式传输与请求状态处理

## 其他 (Chore)

- 修复 README 中 Star 历史图表的链接并切换至新域名（PR [#638](../../pull/638)，感谢 [@Dessalines39394](https://github.com/Dessalines39394) 的贡献 🎉）
- 开发模式开启主进程调试端口和 Source Map，便于调试主进程（PR [#652](../../pull/652)，感谢 [@guopenghui](https://github.com/guopenghui) 的贡献 🎉）
- 补充 AI 多协议、紧凑顶部栏、插件 ESC 隐藏、插件专属数据目录和更新窗口最小化等自动化测试覆盖

---
