# OrcaRouter provider

ZTools 的 AI 供应商配置支持 [OrcaRouter](https://www.orcarouter.ai) 作为 first-class 具名供应商。

- 推理与模型目录：`https://api.orcarouter.ai/v1`（OpenAI 兼容）
- 认证与授权码兑换：`https://www.orcarouter.ai`（注意与推理 origin 不同）

## 两种认证入口

在「提供商 → AI → OrcaRouter」的编辑面板中，两种入口始终并列可用，最终都只保存**同一把**普通
OrcaRouter API key：

| 入口 | 适用场景 | 凭据来源 |
| --- | --- | --- |
| `OrcaRouter - API` | 已有 `sk-orca-…` 密钥，或环境无法打开浏览器 | 用户手动粘贴 |
| `OrcaRouter - Auth` | 没有现成密钥，希望一键授权 | OAuth 2.0 + PKCE（S256）授权后签发 |

密钥保存在 ZTools 现有的供应商配置中，不会写入日志、错误信息或遥测；界面上只显示脱敏结果。

## 授权流程

默认使用 **Flow A（loopback 重定向）**：主进程先在 `127.0.0.1` 上监听随机端口，再打开
`https://www.orcarouter.ai/auth?callback_url=http://127.0.0.1:<port>/cb&code_challenge=…&code_challenge_method=S256&state=…`。
用户在浏览器同意后，授权码回到本机监听器，由主进程用 verifier 兑换成 API key。

如果无法打开浏览器或无法监听端口，可在面板中切换为 **Flow B（一次性代码）**：授权页会显示一个
短代码，用户复制回面板后由主进程兑换。

- `code_challenge` 为 `base64url(sha256(verifier))`（无 padding），`code_challenge_method` 固定为 `S256`。
- verifier 与 state 每次登录都用加密随机数重新生成，且只存在于主进程内存，不进入 URL、日志或界面。
- 回调必须通过恒定时间比较校验 `state`，不匹配即终止。
- 兑换请求固定发往 `https://www.orcarouter.ai/api/v1/auth/keys`；`https://api.orcarouter.ai/v1/auth/keys`
  是 404，不要使用。
- 响应中的 `scope` 是**实际授予**的范围，不等于请求范围；不满足当前用途时登录会失败并提示。

PKCE 换回的是**持久 API key**，不是 refresh token：不存在刷新端点，被撤销后只能重新登录。

### 凭据生命周期

- 凭据带单调递增的 `generation`。上游返回 `401` 时，只把**发出该请求的确切代次**标记为
  `needsReauth`；迟到的失败不会污染重新登录后的新凭据。
- 重新登录成功前不会静默删除旧密钥，避免把可恢复失败变成不可逆的账号丢失。
- 每个用户 24 小时内最多签发 10 个 PKCE key，因此不会在每次启动时重新授权。

## 模型目录

模型控件是**从真实目录生成的下拉**，不允许自由填写模型字符串。目录事实源为
`GET https://api.orcarouter.ai/v1/models`，由主进程持有密钥请求，浏览器只拿到最小模型元数据。

按入口能力过滤（未声明能力的模型一律 fail closed，不按模型名猜测）：

| 入口 | 过滤规则 |
| --- | --- |
| 文本对话 / Agent | `?capability=chat`，且 `supported_endpoint_types` 至少包含 `openai` / `anthropic` / `gemini` / `openai-response` |
| 多模态理解 | 先满足文本入口，再要求 `architecture.input_modalities` 明确包含实际上传的模态（如 `image`） |
| 向量检索 | `?capability=embedding` 或 `embeddings` endpoint |
| 图片生成 | `?capability=image` 或 `image-generation` endpoint |
| 视频生成 | `openai-video` endpoint |
| 重排序 | `jina-rerank` endpoint |

切换供应商、切换入口能力或增减附件模态时都会重算下拉；不再兼容的已选模型会被清空并提示重新选择。

实时目录成功时其结果就是权威目录；失败时退回一小份**已验证的**冷启动种子并在界面上标注降级状态，
不会退回自由文本输入：

- `openai/gpt-5.5`（推理档位 low / medium / high / xhigh）
- `anthropic/claude-opus-4.8`
- `google/gemini-3.5-flash`
- `deepseek/deepseek-v4-pro`
- `orcarouter/auto`

## Self-hosted / 自定义 origin

显式配置优先，其次是共享 base，最后才是官方默认值：

```bash
ORCA_AUTH_BASE_URL=https://auth.internal.example    # 认证 origin
ORCA_API_BASE_URL=https://relay.internal.example/v1 # 推理 origin
ORCA_BASE_URL=https://one.internal.example          # 共享 base（推理自动追加 /v1）
```

非 loopback 的远程 origin 强制 HTTPS，仅 loopback 允许 HTTP。
