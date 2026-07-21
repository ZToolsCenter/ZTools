# Provider（提供商）开发指南

ZTools 把「翻译」「OCR」等能力抽象为 **Provider（提供商）**。主程序不再硬编码这些能力的实现，而是由插件按统一契约提供，主程序负责聚合、展示与调用。

> AI 模型不纳入 provider 抽象，仍走独立的 AI 模型配置。

---

## 支持的 Provider 类型

| type          | 说明         | 入参                   | 返回                             |
| ------------- | ------------ | ---------------------- | -------------------------------- |
| `translation` | 文本翻译     | `{ text, from?, to? }` | `{ text, detectedFrom? }`        |
| `ocr`         | 图片文字识别 | `{ image, lang? }`     | `{ text, blocks?, confidence? }` |

- `translation.image` / `ocr.image` 可为：本地路径 / `data:` URI / `http(s)` URL（具体支持取决于实现）。
- 完整契约定义见主程序源码 `src/shared/providerShared.ts`。

---

## 第一步：在 plugin.json 声明 providers

在插件的 `plugin.json` 中新增 `providers` 字段，声明本插件提供哪些 provider。`providers` 的 **key 为插件内唯一标识**（任意字符串，不必等于 type），value 才是 `{ type, label?, description? }`。

```json
{
  "name": "my-cloud-ocr",
  "title": "云 OCR",
  "providers": {
    "ocr": {
      "type": "ocr",
      "label": "云 OCR",
      "description": "基于云端 API 的图片文字识别"
    }
  }
}
```

- `providers` 的 key 即「声明 key」，后续 `ztools.registerProvider(key, handler)` 的首参必须与之一致。
- 一个插件可同时声明多个 type（如同时提供 `translation` 和 `ocr`）。
- **同一 type 可声明多条**，只要 key 不同即可（见下方「同一 type 多条」示例）。
- `label` / `description` 会展示在「设置 → 提供商」对应 tab 中。

声明后，安装该插件即在「设置 → 提供商 → OCR/翻译」tab 列出该 provider，用户可启用并设为默认。

### 同一 type 多条

当一个插件想提供多个同类渠道（如百度、谷歌两个翻译），可用不同 key 声明同一 type：

```json
{
  "providers": {
    "baidu": { "type": "translation", "label": "百度翻译" },
    "google": { "type": "translation", "label": "谷歌翻译" }
  }
}
```

```js
// preload.js
ztools.registerProvider('baidu', async (input) => {
  /* 调用百度 */
})
ztools.registerProvider('google', async (input) => {
  /* 调用谷歌 */
})
```

两条都会出现在「设置 → 提供商 → 翻译」，用户可分别启用并选其中一个为默认。

---

## 第二步：在 preload 注册 handler

在插件 preload 脚本中调用 `ztools.registerProvider(key, handler)`，**首参为声明 key**（与 plugin.json 的 providers key 一致），handler 签名必须匹配该声明的 type 对应契约：

```js
// 插件 preload
ztools.registerProvider('ocr', async (input) => {
  const { image, lang } = input
  // 调用你的 OCR 服务
  const res = await fetch('https://your-ocr-api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, lang })
  })
  const data = await res.json()
  return {
    text: data.text,
    blocks: data.blocks,
    confidence: data.confidence
  }
})
```

注意事项：

- `registerProvider` 首参必须是 plugin.json `providers` 中已声明的 key，否则注册会被拒绝。
- handler 是 `async` 函数，返回值需符合该 key 声明 type 的契约；入参缺失字段请自行兜底。
- 一个插件对同一 key 只能注册一次；不同 key 各自对应独立 handler。

---

## 翻译 provider 示例

```js
ztools.registerProvider('translation', async (input) => {
  const { text, from, to } = input
  const res = await fetch('https://your-translate-api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from: from || 'auto', to: to || 'zh' })
  })
  const data = await res.json()
  return {
    text: data.translated,
    detectedFrom: data.detectedSource
  }
})
```

---

## 内置 provider

主程序内置了 **Bergamot 离线翻译引擎**（type `translation`，id `builtin-bergamot`），仅支持英译中。它与插件 provider 并列展示、可设为默认，用户可随时切换。

OCR 暂无内置实现，完全由插件提供。

---

## 作为消费方调用 provider 能力

任何插件（不仅是 provider 的提供方）都可以**主动发起一次翻译 / OCR**，复用用户已启用的 provider。这是 Provider 抽象的核心价值之一：能力可被跨插件复用。

### 通用入口：`ztools.providers`

```js
// 查询某个 type 下的全部渠道，每个渠道带 isDefault 标记
const list = await ztools.providers.getProviders('translation')
// → [{ id, type, label, description, source, isDefault }, ...]

// 单独查询默认渠道（无可用时返回 null）
const def = await ztools.providers.getDefaultProvider('translation')
// → { id, type, label, ..., isDefault: true } | null

// 统一调用入口：providerId 可选，缺省走该 type 的默认渠道
const out = await ztools.providers.invokeProvider('translation', { text: 'hello', to: 'zh' })
// → { text: '你好', detectedFrom?: 'en' }
```

`invokeProvider` 失败会抛错（如没有可用 provider、provider 加载超时等），调用方需 `try/catch`。

### 便捷封装：`ztools.translate` / `ztools.ocr`

为最常用的两种调用提供语法糖，签名更贴近直觉：

```js
// 翻译：options: { from?, to?, providerId? }
const result = await ztools.translate('hello', { from: 'en', to: 'zh' })
console.log(result.text) // 翻译结果
console.log(result.detectedFrom) // 实际识别到的源语言（可选）

// OCR：options: { lang?, providerId? }，image 为本地路径 / data URI / URL
const ocrResult = await ztools.ocr('/path/to/image.png', { lang: 'eng' })
console.log(ocrResult.text)
```

- `providerId` 缺省时使用用户在该 type 下设置的默认渠道；显式传入则调用指定渠道。
- `image` / `text` 的具体能力边界取决于所选 provider 的实现。

### 默认渠道选择规则

调用时若未显式指定 `providerId`，主进程按以下优先级选择：

1. 用户在「设置 → 提供商」设为默认的 provider；
2. 该 type 下第一个启用的 provider；
3. 该 type 下第一个可用 provider（兜底）。

均无可用项时抛出「没有可用的 xxx 提供商」错误。

---

## 调用链路

1. 用户在「设置 → 提供商」启用 / 设为默认某个 provider。
2. 消费方调用 `providerManager.invoke(type, input)`：
   - 主程序内（如超级面板选中翻译）直接调用主进程方法；
   - 插件通过 `ztools.providers.invokeProvider` / `ztools.translate` / `ztools.ocr` 发起，经统一分发器转发到同一个 `providerManager.invoke`。
3. 主进程按默认 / 启用项选择 provider：
   - 内置 provider：直接在主进程调用本地实现。
   - 插件 provider：按需预加载插件，等待 `registerProvider` 完成后回调 handler。
4. handler 返回结果按契约透传给消费方。

---

## 调试

- provider 注册失败会在插件控制台抛错（如未声明该 type）。
- 「设置 → 提供商」tab 可确认你的 provider 是否被识别、是否启用 / 默认。
- 翻译可在超级面板选中文本时触发验证；插件内可直接 `await ztools.translate('hello')` / `await ztools.ocr(imagePath)` 验证。

## 完整 plugin.json 示例

```json
{
  "name": "cloud-providers",
  "title": "云翻译与 OCR",
  "description": "提供云端翻译与 OCR 能力",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload.js",
  "features": [
    {
      "code": "translate",
      "explain": "翻译",
      "cmds": ["翻译"]
    }
  ],
  "providers": {
    "translation": {
      "type": "translation",
      "label": "云翻译",
      "description": "多语言云翻译"
    },
    "ocr": {
      "type": "ocr",
      "label": "云 OCR",
      "description": "高精度图片文字识别"
    }
  }
}
```
