/**
 * Provider 示例插件 preload
 *
 * 演示如何按契约注册 translation / ocr 两个 provider。
 * 这里用 mock 实现演示接入流程；真实插件请替换为对自身服务的调用。
 */

// 翻译 provider：入参 { text, from?, to? }，返回 { text, detectedFrom? }
ztools.registerProvider('translation', async (input) => {
  const { text } = input
  // === mock：真实场景替换为你的翻译 API 调用 ===
  return {
    text: `[示例翻译] ${text}`,
    detectedFrom: 'auto'
  }
})

// OCR provider：入参 { image, lang? }，返回 { text, blocks?, confidence? }
ztools.registerProvider('ocr', async (input) => {
  const { image } = input
  // === mock：真实场景替换为你的 OCR API 调用（image 可为路径/dataURI/URL） ===
  console.log('[provider-example] ocr called with image:', image)
  return {
    text: '[示例 OCR 结果] 此处为识别到的文本',
    blocks: ['[示例 OCR 结果] 此处为识别到的文本'],
    confidence: 0.99
  }
})
