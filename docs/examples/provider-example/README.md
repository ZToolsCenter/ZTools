# Provider 示例插件

这是一个最小可参考的 provider 插件骨架，演示如何通过 `providers` 声明 + `ztools.registerProvider` 接入「翻译」与「OCR」能力。

> 此目录为文档示例，handler 使用 mock 实现，不可作为正式插件直接安装运行。真实接入请参考 `docs/provider-development-guide.md` 替换 handler 逻辑。

## 文件说明

- `plugin.json` —— 声明了 `providers.translation` 与 `providers.ocr`（此处 key 恰好等于 type，作为最简兼容示例；多声明见下方说明）。
- `preload.js` —— 调用 `ztools.registerProvider` 注册两个 provider 的 mock 实现。

## 同一 type 多条声明

当一个插件要提供多个同类渠道（如百度、谷歌两个翻译），用不同 key 声明同一 type 即可：

```json
"providers": {
  "baidu":  { "type": "translation", "label": "百度翻译" },
  "google": { "type": "translation", "label": "谷歌翻译" }
}
```

```js
ztools.registerProvider('baidu', async (input) => {
  /* ... */
})
ztools.registerProvider('google', async (input) => {
  /* ... */
})
```

详见主程序 `docs/provider-development-guide.md`。

## 接入后会怎样

安装声明了 `providers` 的插件后：

1. 「设置 → 提供商」的「翻译」「OCR」tab 会自动列出该 provider。
2. 用户可启用 / 设为默认。
3. 消费方（如超级面板选中翻译）调用 `providerManager.invoke(type, input)` 时会路由到默认 provider。
