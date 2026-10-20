interface LocalClientResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

interface StoredAiConfig {
  provider: string
  apiType: 'chat' | 'responses' | 'messages' | 'gemini'
  endpoint: string
  model: string
  rememberKey: boolean
  apiKey: string
}

interface AiProxySession {
  gateway: string
  apiKey: string
  claudeModels: string[]
  codexModels: string[]
  configName: string
}

const AI_CONFIG_KEY = 'localAiConfigV1'
const OPERATION_LOG_KEY = 'localOperationLogsV1'
const ERROR_LOG_KEY = 'localErrorLogsV1'
const TASK_STATE_KEY = 'localTaskStateV1'
const GENERATED_HISTORY_KEY = 'localGeneratedCommentHistoryV1'
const AIPROXY_SESSION_KEY = 'aiProxyRuntimeSessionV1'
const PRESET_AI_PROVIDERS: Record<string, Pick<StoredAiConfig, 'apiType' | 'endpoint' | 'model'>> = {
  deepseek: { apiType: 'chat', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  openai: { apiType: 'chat', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini' },
  qwen: { apiType: 'chat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  kimi: { apiType: 'chat', endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  zhipu: { apiType: 'chat', endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  anthropic: { apiType: 'messages', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-5' },
  gemini: { apiType: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', model: 'gemini-2.5-flash' },
  siliconflow: { apiType: 'chat', endpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3' },
  aiproxy_claude: { apiType: 'messages', endpoint: '', model: '' },
  aiproxy_codex: { apiType: 'responses', endpoint: '', model: '' },
}
let sessionApiKey = ''

class AiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message)
    this.name = 'AiHttpError'
  }
}

const SYSTEM_PROMPT = [
  '你是一名认真读完文章、愿意进行友善交流的真实读者。',
  '根据文章正文写出 1 条自然、正面的中文评论：',
  '1. 必须结合文章中的具体观点、技术、案例或结论，不能写万能套话；',
  '2. 可以表达认可、补充一个有价值的看法，或提出一个友善且具体的问题；',
  '3. 不夸张吹捧，不虚构亲身经历，不照抄标题和正文；',
  '4. 语气自然口语化，25到70字，并尽量与同一文章的历史评论不同；',
  '5. 只输出评论本身，不要引号、编号或额外说明。',
].join('\n')

async function loadConfig(): Promise<StoredAiConfig> {
  const stored = await chrome.storage.local.get(AI_CONFIG_KEY)
  const value = stored[AI_CONFIG_KEY] && typeof stored[AI_CONFIG_KEY] === 'object'
    ? stored[AI_CONFIG_KEY] as Partial<StoredAiConfig>
    : {}
  const provider = String(value.provider || 'deepseek')
  const preset = PRESET_AI_PROVIDERS[provider]
  const aiProxySession = provider.startsWith('aiproxy_') ? await loadAiProxySession() : null
  return {
    provider,
    apiType: ['chat', 'responses', 'messages', 'gemini'].includes(String(value.apiType))
      ? value.apiType as StoredAiConfig['apiType']
      : preset?.apiType || 'chat',
    endpoint: String(value.endpoint || preset?.endpoint || ''),
    model: String(value.model || preset?.model || ''),
    rememberKey: value.rememberKey !== false,
    apiKey: aiProxySession?.apiKey || String(value.apiKey || '') || sessionApiKey,
  }
}

async function loadAiProxySession(): Promise<AiProxySession | null> {
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get(AIPROXY_SESSION_KEY),
    chrome.storage.local.get(AIPROXY_SESSION_KEY),
  ])
  const value = sessionStored[AIPROXY_SESSION_KEY] || localStored[AIPROXY_SESSION_KEY]
  return value && typeof value === 'object' ? value as AiProxySession : null
}

function stripKnownAiEndpoint(value: string): URL {
  const parsed = new URL(value.trim())
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|messages|responses|embeddings|models)$/i, '')
  return parsed
}

function aiProxyEndpoint(gateway: string, target: 'messages' | 'responses' | 'models'): string {
  const parsed = stripKnownAiEndpoint(gateway)
  const pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = /\/v1$/i.test(pathname) ? `${pathname}/${target}` : `${pathname}/v1/${target}`
  return parsed.toString()
}

function inferApiType(
  provider: string,
  endpoint: string,
): StoredAiConfig['apiType'] {
  const preset = PRESET_AI_PROVIDERS[provider]
  if (preset) return preset.apiType

  const normalizedEndpoint = endpoint.toLowerCase()
  if (/generativelanguage\.googleapis\.com\/.+:generatecontent/.test(normalizedEndpoint)) return 'gemini'
  if (/open\.bigmodel\.cn\/api\/anthropic(?:\/|$)/.test(normalizedEndpoint)) return 'messages'
  if (/\/messages(?:\?|$)/.test(normalizedEndpoint)) return 'messages'
  if (/\/responses(?:\?|$)/.test(normalizedEndpoint)) return 'responses'
  return 'chat'
}

function endpointWithPath(endpoint: string, target: 'models' | 'chat'): string {
  const parsed = new URL(endpoint.trim())
  const pathname = parsed.pathname.replace(/\/+$/, '')
  const knownSuffix = /\/(?:chat\/completions|completions|responses|models)$/i
  const basePath = pathname.replace(knownSuffix, '')
  parsed.pathname = target === 'models'
    ? `${basePath}/models`
    : `${basePath}/chat/completions`
  return parsed.toString()
}

function normalizeRequestEndpoint(provider: string, endpoint: string): string {
  if (provider !== 'custom') return endpoint
  const apiType = inferApiType(provider, endpoint)
  if (apiType === 'messages') {
    const parsed = new URL(endpoint)
    const pathname = parsed.pathname.replace(/\/+$/, '')
      .replace(/\/(?:chat\/completions|completions|responses|models)$/i, '')
    if (/\/messages$/i.test(pathname)) return endpoint
    parsed.pathname = /\/v1$/i.test(pathname) ? `${pathname}/messages` : `${pathname}/v1/messages`
    return parsed.toString()
  }
  if (apiType !== 'chat') return endpoint
  const pathname = new URL(endpoint).pathname.replace(/\/+$/, '')
  if (/\/(?:chat\/completions|completions)$/i.test(pathname)) return endpoint
  return endpointWithPath(endpoint, 'chat')
}

function publicConfig(config: StoredAiConfig) {
  return {
    provider: config.provider,
    apiType: config.apiType,
    endpoint: config.endpoint,
    model: config.model,
    rememberKey: config.rememberKey,
    hasApiKey: Boolean(config.apiKey),
  }
}

async function saveConfig(input: Record<string, unknown>) {
  const previous = await loadConfig()
  const provider = String(input.provider || previous.provider || 'deepseek').trim()
  const providerChanged = provider !== previous.provider
  const preset = PRESET_AI_PROVIDERS[provider]
  const aiProxySession = provider.startsWith('aiproxy_') ? await loadAiProxySession() : null
  const aiProxyTarget = provider === 'aiproxy_claude' ? 'messages' : 'responses'
  const rawEndpoint = provider.startsWith('aiproxy_') && aiProxySession
    ? aiProxyEndpoint(aiProxySession.gateway, aiProxyTarget)
    : String(input.endpoint || preset?.endpoint || previous.endpoint || '').trim()
  if (!rawEndpoint) throw new Error('请填写接口地址')
  const endpoint = normalizeRequestEndpoint(provider, rawEndpoint)
  const config: StoredAiConfig = {
    provider,
    apiType: inferApiType(provider, endpoint),
    endpoint,
    model: String(input.model || preset?.model || previous.model || '').trim(),
    apiKey: aiProxySession?.apiKey || String(input.apiKey || '').trim() || (providerChanged ? '' : previous.apiKey),
    rememberKey: input.rememberKey !== false,
  }
  if (!config.apiKey) throw new Error('请填写 API Key')
  if (!config.model) throw new Error('请先获取并选择模型')
  const parsedEndpoint = new URL(config.endpoint)
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new Error('接口地址必须使用 http 或 https')
  sessionApiKey = config.rememberKey && !provider.startsWith('aiproxy_') ? '' : config.apiKey
  await chrome.storage.local.set({
    [AI_CONFIG_KEY]: {
      ...config,
      apiKey: provider.startsWith('aiproxy_') ? '' : config.rememberKey ? config.apiKey : '',
      updatedAt: new Date().toISOString(),
    },
  })
  return publicConfig(config)
}

function configuredAiProxyModels(value: any, group: 'claude' | 'codex'): string[] {
  const candidates = value?.session?.models?.[group]?.models
  if (!Array.isArray(candidates)) return []
  return Array.from(new Set(candidates.map((item: unknown) => String(item || '').trim()).filter(Boolean)))
}

async function importAiProxyConfig(input: Record<string, unknown>) {
  const fileName = String(input.fileName || '').toLowerCase()
  if (!fileName.endsWith('.json')) throw new Error('请选择 JSON 格式的配置文件（如 config.json）')
  let value: any
  try { value = JSON.parse(String(input.content || '')) } catch { throw new Error('配置文件 JSON 格式无效') }

  // 1. 尝试从 aiproxy config.json 读取 gateway 与 session.api_key
  let gateway = String(value?.gateway?.url || value?.gateway || value?.baseURL || value?.baseUrl || '').trim().replace(/\/+$/, '')
  let apiKey = String(value?.session?.api_key || value?.session?.apiKey || value?.apiKey || value?.api_key || '').trim()

  // 2. 如果 config.json 中的 session.api_key 为空（aiproxy 尚未将 session 写回 config.json 或结构不同），
  // 检查是否有 auth_token / token 等字段
  if (!apiKey) {
    apiKey = String(value?.auth_token || value?.token || value?.OPENAI_API_KEY || '').trim()
  }

  // 3. 如果还是没有 gateway 或 apiKey，尝试检查是否传入的是 codex auth.json 或类似文件
  if (!gateway) {
    // 默认内网网关
    gateway = 'http://192.168.60.2:8084'
  }

  if (!apiKey) throw new Error('配置文件中未找到有效的 API Key 或 session 凭据，请确认 AIProxy 已登录')
  if (!/^https?:\/\//i.test(gateway)) throw new Error('网关地址格式无效（必须以 http:// 或 https:// 开头）')

  const session: AiProxySession = {
    gateway,
    apiKey,
    claudeModels: configuredAiProxyModels(value, 'claude'),
    codexModels: configuredAiProxyModels(value, 'codex'),
    configName: String(input.fileName || 'config.json'),
  }
  // AIProxy 的 gateway/session/model 是用户明确导入的配置，持久保存后扩展重开可直接恢复。
  // 同时写入 session 以兼容当前运行中的旧页面；不保存 config.json 原文。
  await Promise.all([
    chrome.storage.session.set({ [AIPROXY_SESSION_KEY]: session }),
    chrome.storage.local.set({ [AIPROXY_SESSION_KEY]: session }),
  ])
  const provider = input.provider === 'aiproxy_codex' ? 'aiproxy_codex' : 'aiproxy_claude'
  let models = provider === 'aiproxy_codex' ? session.codexModels : session.claudeModels
  if (!models.length || models.includes('*')) {
    const payload = await fetchJson(aiProxyEndpoint(gateway, 'models'), {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey },
    })
    models = extractModelIds(payload)
  }
  models = models.filter(model => model !== '*')
  if (!models.length) throw new Error('AIProxy 配置和网关均未返回可用模型')
  const endpoint = aiProxyEndpoint(gateway, provider === 'aiproxy_claude' ? 'messages' : 'responses')
  const storedConfig = await chrome.storage.local.get(AI_CONFIG_KEY)
  const previousConfig = storedConfig[AI_CONFIG_KEY] && typeof storedConfig[AI_CONFIG_KEY] === 'object'
    ? storedConfig[AI_CONFIG_KEY] as Partial<StoredAiConfig>
    : {}
  const selectedModel = models.includes(String(previousConfig.model || '')) ? String(previousConfig.model) : models[0]
  await chrome.storage.local.set({
    [AI_CONFIG_KEY]: {
      provider,
      apiType: provider === 'aiproxy_claude' ? 'messages' : 'responses',
      endpoint,
      model: selectedModel,
      rememberKey: false,
      apiKey: '',
      updatedAt: new Date().toISOString(),
    },
  })
  return {
    models,
    endpoint,
    apiType: provider === 'aiproxy_claude' ? 'messages' : 'responses',
    hasApiKey: true,
    model: selectedModel,
    configName: session.configName,
  }
}

function extractModelIds(payload: any): string[] {
  const candidates = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : []
  const ids: string[] = candidates.map((item: any) => {
    if (typeof item === 'string') return item
    return item?.id || item?.name || item?.model || ''
  }).map((value: unknown) => String(value || '').replace(/^models\//, '').trim()).filter(Boolean)
  return Array.from(new Set<string>(ids)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
}

async function fetchAvailableModels(input: Record<string, unknown>) {
  const previous = await loadConfig()
  const provider = String(input.provider || previous.provider || 'custom').trim()
  const rawEndpoint = String(input.endpoint || PRESET_AI_PROVIDERS[provider]?.endpoint || previous.endpoint || '').trim()
  const apiKey = String(input.apiKey || '').trim() || (provider === previous.provider ? previous.apiKey : '')
  if (!rawEndpoint) throw new Error('请先填写接口地址')
  if (!apiKey) throw new Error('请先填写 API Key')

  const isAnthropicBase = inferApiType(provider, rawEndpoint) === 'messages'
  const defaultModelsEndpoint = endpointWithPath(rawEndpoint, 'models')
  const anthropicModelsEndpoint = (() => {
    const parsed = new URL(rawEndpoint)
    const pathname = parsed.pathname.replace(/\/+$/, '')
      .replace(/\/(?:v1\/messages|messages|chat\/completions|completions|responses|models)$/i, '')
    parsed.pathname = `${pathname}/v1/models`
    return parsed.toString()
  })()
  const modelEndpoints = Array.from(new Set(isAnthropicBase
    ? [anthropicModelsEndpoint, defaultModelsEndpoint]
    : [defaultModelsEndpoint]))
  let models: string[] = []
  let modelsEndpoint = modelEndpoints[0]
  let lastError: unknown
  for (const candidate of modelEndpoints) {
    try {
      const payload = await fetchJson(candidate, {
        method: 'GET',
        headers: { Accept: 'application/json', 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' },
      })
      const envelopeError = businessEnvelopeError(payload)
      if (envelopeError) throw new Error(envelopeError)
      models = extractModelIds(payload)
      if (models.length) {
        modelsEndpoint = candidate
        break
      }
    } catch (error) {
      lastError = error
    }
  }
  if (!models.length && lastError) throw lastError
  if (!models.length) throw new Error('接口连接成功，但没有返回可用模型；请确认该地址支持 OpenAI 兼容的 /models 接口')
  return {
    models,
    endpoint: normalizeRequestEndpoint(provider, rawEndpoint),
    apiType: inferApiType(provider, rawEndpoint),
    modelsEndpoint,
  }
}

function redactApiError(value: string): string {
  return value.slice(0, 1000)
    .replace(/\b(sk-[A-Za-z0-9_-]{5})[A-Za-z0-9_-]+/g, '$1****')
    .replace(/("?(?:api[_-]?key|authorization)"?\s*[:=]\s*"?)[^"\s,;}]+/ig, '$1****')
}

function extractApiErrorMessage(body: string): string {
  const safeBody = redactApiError(body).trim()
  if (!safeBody) return ''
  try {
    const parsed = JSON.parse(safeBody)
    const message = parsed?.error?.message || parsed?.error?.detail || parsed?.message || parsed?.detail
    if (message) return redactApiError(String(message)).slice(0, 500)
  } catch {}
  return safeBody.replace(/\s+/g, ' ').slice(0, 500)
}

function httpErrorMessage(status: number, statusText: string, body: string): string {
  const detail = extractApiErrorMessage(body)
  const suffix = detail ? `：${detail}` : ''
  if (status === 400) return `接口拒绝了请求参数，请检查模型名称和接口类型${suffix}`
  if (status === 401) return `API Key 鉴权失败，请确认 Key 属于当前服务商且仍然有效${suffix}`
  if (status === 403) return `当前 Key 没有该模型或接口的访问权限${suffix}`
  if (status === 404) return `接口地址或模型不存在；自定义接口需要填写完整请求地址${suffix}`
  if (status === 408) return `AI 接口响应超时${suffix}`
  if (status === 429) return `请求过于频繁、额度不足或并发已达上限${suffix}`
  if (status >= 500) return `大模型服务暂时异常（HTTP ${status}）${suffix}`
  return `AI 接口返回 HTTP ${status} ${statusText}${suffix}`
}

async function fetchJson(endpoint: string, options: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const response = await fetch(endpoint, { ...options, signal: controller.signal })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new AiHttpError(
        httpErrorMessage(response.status, response.statusText, body),
        response.status,
        redactApiError(body),
      )
    }
    return await response.json()
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw new Error('AI 接口请求超时（60 秒）')
    if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
      throw new Error('无法连接大模型接口，请检查接口地址、网络、HTTPS 证书或服务是否已经启动')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function cleanComment(value: unknown): string {
  return String(value || '').trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^(评论|回答)[:：]\s*/i, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim()
}

function prefersModernChatParameters(model: string): boolean {
  return /^(?:gpt-5|o[1-9](?:-|$))/i.test(model.trim())
}

function supportsDisableThinking(config: StoredAiConfig): boolean {
  return /^(?:glm-(?:z1|4[.-][5-9]|5(?:[.-]|$))|kimi-|moonshot-)/i.test(config.model.trim())
}

function chatMessageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, any>
    return chatMessageText(item.text?.value ?? item.text ?? item.value ?? item.content ?? item.output_text ?? item.answer ?? '')
  }
  if (!Array.isArray(value)) return ''
  return value.map((item: any) => {
    if (typeof item === 'string') return item
    return item?.text?.value || item?.text || item?.content || ''
  }).join('')
}

function businessEnvelopeText(payload: any): string {
  if (!payload || typeof payload !== 'object' || payload.success === false) return ''
  const message = chatMessageText(payload.msg ?? payload.message)
  if (!message || /^(?:success|ok|请求成功|操作成功|调用成功|成功)$/i.test(message.trim())) return ''
  return message
}

function businessEnvelopeError(payload: any): string {
  if (!payload || typeof payload !== 'object') return ''
  const code = String(payload.code ?? '').trim()
  const failedCode = code && !['0', '200', 'success', 'ok'].includes(code.toLowerCase())
  if (payload.success !== false && !failedCode) return ''
  return chatMessageText(payload.msg ?? payload.message).trim() || `业务状态码 ${code || '未知'}`
}

function chatOutput(data: any): string {
  const payloads = [data, data?.data, data?.result, data?.response].filter(Boolean)
  for (const payload of payloads) {
    if (typeof payload === 'string' && payload.trim()) return payload.trim()
    const choice = payload?.choices?.[0]
    const output = chatMessageText(choice?.message?.content)
      || chatMessageText(choice?.message?.answer)
      || chatMessageText(choice?.message?.final)
      || chatMessageText(choice?.message?.final_answer)
      || chatMessageText(choice?.message?.output)
      || chatMessageText(choice?.delta?.content)
      || chatMessageText(choice?.text)
      || chatMessageText(payload?.output_text)
      || chatMessageText(payload?.answer)
      || chatMessageText(payload?.content)
      || businessEnvelopeText(payload)
    if (output) return output
  }
  return ''
}

function chatReasoningOutput(data: any): string {
  const payloads = [data, data?.data, data?.result, data?.response].filter(Boolean)
  for (const payload of payloads) {
    const reasoning = chatMessageText(payload?.choices?.[0]?.message?.reasoning_content)
      || chatMessageText(payload?.choices?.[0]?.message?.reasoning)
      || chatMessageText(payload?.choices?.[0]?.message?.reasoning_details)
      || chatMessageText(payload?.choices?.[0]?.message?.analysis)
      || chatMessageText(payload?.reasoning_content)
      || chatMessageText(payload?.reasoning)
      || chatMessageText(payload?.analysis)
    if (reasoning) return reasoning
  }
  return ''
}

function aiResponseShape(data: any): string {
  const payload = data?.data || data?.result || data?.response || data
  const choice = payload?.choices?.[0]
  const message = choice?.message
  const keys = (value: unknown) => value && typeof value === 'object'
    ? Object.keys(value as Record<string, unknown>).slice(0, 20).join(',') || '无'
    : '非对象'
  const contentType = Array.isArray(message?.content) ? 'array' : typeof message?.content
  return `顶层字段[${keys(payload)}]，choice字段[${keys(choice)}]，message字段[${keys(message)}]，content类型=${contentType}，finish_reason=${chatFinishReason(data) || '空'}`
}

function chatFinishReason(data: any): string {
  return String(data?.choices?.[0]?.finish_reason
    || data?.data?.choices?.[0]?.finish_reason
    || data?.result?.choices?.[0]?.finish_reason
    || '')
}

function isChatParameterCompatibilityError(error: unknown): boolean {
  if (!(error instanceof AiHttpError) || ![400, 422].includes(error.status)) return false
  return /max[_ ]?(?:completion[_ ]?)?tokens?|temperature|thinking|reasoning[_ ]?effort|chat[_ ]?template|unsupported|invalid parameter|unknown parameter|unrecognized|not supported|extra inputs/i
    .test(`${error.message} ${error.responseBody}`)
}

async function requestChatCompletion(
  config: StoredAiConfig,
  userPrompt: string,
  maxTokens: number,
  modernParameters: boolean,
  thinkingControl: 'thinking' | 'enable_thinking' | 'reasoning_effort' | 'chat_template' | 'none',
): Promise<any> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
  }
  if (modernParameters) body.max_completion_tokens = maxTokens
  else {
    body.max_tokens = maxTokens
    body.temperature = 0.8
  }
  if (thinkingControl === 'thinking') body.thinking = { type: 'disabled' }
  else if (thinkingControl === 'enable_thinking') body.enable_thinking = false
  else if (thinkingControl === 'reasoning_effort') body.reasoning_effort = 'none'
  else if (thinkingControl === 'chat_template') body.chat_template_kwargs = { enable_thinking: false }
  return fetchJson(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  })
}

async function callChatCompletion(
  config: StoredAiConfig,
  userPrompt: string,
  maxTokens: number,
): Promise<any> {
  const preferredModern = prefersModernChatParameters(config.model)
  const disableThinking = supportsDisableThinking(config)
  const controls: Array<'thinking' | 'enable_thinking' | 'reasoning_effort' | 'chat_template' | 'none'> = disableThinking
    ? ['thinking', 'enable_thinking', 'reasoning_effort', 'chat_template', 'none']
    : ['none']
  const attempts = controls.flatMap(thinkingControl => [
    { modern: preferredModern, thinkingControl },
    { modern: !preferredModern, thinkingControl },
  ]).filter((attempt, index, items) => index === items.findIndex(item =>
    item.modern === attempt.modern && item.thinkingControl === attempt.thinkingControl))

  let lastError: unknown
  let reasoningOnlyResponse: any
  for (const attempt of attempts) {
    try {
      const response = await requestChatCompletion(config, userPrompt, maxTokens, attempt.modern, attempt.thinkingControl)
      const envelopeError = businessEnvelopeError(response)
      if (envelopeError) throw new Error(`大模型接口返回业务失败：${envelopeError}`)
      if (chatOutput(response) || !chatReasoningOutput(response)) return response
      reasoningOnlyResponse = response
    } catch (error) {
      lastError = error
      if (!isChatParameterCompatibilityError(error)) throw error
    }
  }
  if (reasoningOnlyResponse) return reasoningOnlyResponse
  throw lastError
}

async function callAi(articleText: string, config: StoredAiConfig): Promise<string> {
  const content = String(articleText || '').slice(0, 5000).trim()
  if (!content) throw new Error('文章正文为空，无法生成评论')
  const userPrompt = `文章正文如下：\n"""\n${content}\n"""\n\n请按要求写 1 条自然、正面且与正文有关的评论。`
  let data: any
  let output = ''

  if (config.apiType === 'gemini') {
    const endpoint = config.endpoint.replace('{model}', encodeURIComponent(config.model))
    data = await fetchJson(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.8 },
      }),
    })
    output = data.candidates?.[0]?.content?.parts?.map((item: any) => item?.text || '').join('') || ''
  } else if (config.apiType === 'messages') {
    data = await fetchJson(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, Authorization: `Bearer ${config.apiKey}`, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.model, max_tokens: 2048, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        ...(config.provider === 'aiproxy_claude' && /^glm-/i.test(config.model) ? { thinking: { type: 'disabled' } } : {}),
      }),
    })
    output = Array.isArray(data.content)
      ? data.content.filter((item: any) => item?.type === 'text').map((item: any) => item.text).join('')
      : chatMessageText(data.content || data.output_text || data.answer)
    if (['length', 'max_tokens', 'max_output_tokens'].includes(String(data.stop_reason || data.finish_reason || '').toLowerCase())) {
      throw new Error('AIProxy Claude 返回内容被截断，请更换模型或提高输出上限')
    }
  } else if (config.apiType === 'responses') {
    data = await fetchJson(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, instructions: SYSTEM_PROMPT, input: userPrompt, max_output_tokens: 500 }),
    })
    output = data.output_text
      || (Array.isArray(data.output) ? data.output.flatMap((item: any) => item.content || []).map((item: any) => item.text?.value || item.text || '').join('') : '')
      || data.choices?.[0]?.message?.content
      || ''
    if (data.status === 'incomplete' || data.incomplete_details) throw new Error('AIProxy Codex 返回内容不完整，请更换模型或提高输出上限')
  } else {
    data = await callChatCompletion(config, userPrompt, 1000)
    output = chatOutput(data)
    if (!cleanComment(output) && chatReasoningOutput(data)) {
      const finalAnswerPrompt = `${userPrompt}\n\n上一次只返回了思考过程。请停止继续分析，直接输出符合要求的最终评论正文。`
      data = await callChatCompletion(config, finalAnswerPrompt, 8192)
      output = chatOutput(data)
    }
  }

  const comment = cleanComment(output)
  if (!comment) {
    const finishReason = chatFinishReason(data)
    if (finishReason === 'length') throw new Error(`模型 ${config.model} 的推理内容占满了输出上限，请改用同系列的非推理模型`)
    throw new Error(`模型 ${config.model} 没有返回最终评论正文；响应结构：${aiResponseShape(data)}`)
  }
  return comment
}

async function generateComment(payload: Record<string, unknown>) {
  const config = await loadConfig()
  if (!config.endpoint || !config.model || !config.apiKey) throw new Error('AI 配置不完整，请先在插件“智能补齐”页面保存')
  const url = String(payload.url || '')
  const stored = await chrome.storage.local.get(GENERATED_HISTORY_KEY)
  const history = stored[GENERATED_HISTORY_KEY] && typeof stored[GENERATED_HISTORY_KEY] === 'object'
    ? stored[GENERATED_HISTORY_KEY] as Record<string, string[]>
    : {}
  const recent = Array.isArray(history[url]) ? history[url].slice(-10) : []
  const hint = recent.length ? `\n\n以下评论已生成过，不能重复或近似：\n${recent.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : ''
  const comment = await callAi(`${String(payload.articleText || '')}${hint}`, config)
  if (recent.includes(comment)) throw new Error('AI 生成了重复评论，请稍后重试')
  if (url) {
    history[url] = [...recent, comment].slice(-20)
    await chrome.storage.local.set({ [GENERATED_HISTORY_KEY]: history })
  }
  return comment
}

function cleanLogValue(value: unknown, key = ''): unknown {
  if (/api.?key|authorization|cookie|password|backup.?content/i.test(key)) return '****'
  if (/article.?text/i.test(key)) return '[文章正文已省略]'
  if (typeof value === 'string') {
    return value.slice(0, 1200)
      .replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1****')
      .replace(/(authorization|x-api-key)\s*[:=]\s*[^\s,;]+/ig, '$1: ****')
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => cleanLogValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, cleanLogValue(item, name)]))
  }
  return value
}

async function appendLog(channel: 'operation' | 'error', rawEntry: Record<string, unknown>) {
  const key = channel === 'error' ? ERROR_LOG_KEY : OPERATION_LOG_KEY
  const stored = await chrome.storage.local.get(key)
  const logs = Array.isArray(stored[key]) ? stored[key] as unknown[] : []
  const entry = cleanLogValue({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    channel,
    ...rawEntry,
  })
  await chrome.storage.local.set({ [key]: [...logs.slice(-1999), entry] })
  return entry
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function deriveBackupKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  )
}

function requireBackupPassword(value: unknown): string {
  const password = String(value || '')
  if (password.length < 8) throw new Error('备份密码至少需要 8 位')
  return password
}

async function exportBackup(payload: Record<string, unknown>) {
  const password = requireBackupPassword(payload.password)
  const config = await loadConfig()
  const plain = new TextEncoder().encode(JSON.stringify({
    format: 'DL_COMMENT_ASSISTANT_CONFIG',
    version: 1,
    exportedAt: new Date().toISOString(),
    aiConfig: config.provider.startsWith('aiproxy_') ? { ...config, apiKey: '' } : config,
    extensionSettings: payload.extensionSettings && typeof payload.extensionSettings === 'object' ? payload.extensionSettings : {},
  }))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const iterations = 210000
  const key = await deriveBackupKey(password, salt, iterations, ['encrypt'])
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const tag = encrypted.slice(-16)
  const data = encrypted.slice(0, -16)
  return {
    content: JSON.stringify({
      format: 'DL_CONFIG_BACKUP', version: 1, kdf: 'PBKDF2-SHA256', iterations,
      cipher: 'AES-256-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv),
      tag: bytesToBase64(tag), data: bytesToBase64(data),
    }),
    fileName: `DL评论助手配置_${new Date().toISOString().slice(0, 10)}.dlconfig`,
  }
}

async function importBackup(payload: Record<string, unknown>) {
  const password = requireBackupPassword(payload.password)
  let envelope: any
  try { envelope = JSON.parse(String(payload.content || '')) } catch { throw new Error('备份文件格式无效') }
  if (envelope.format !== 'DL_CONFIG_BACKUP' || envelope.version !== 1) throw new Error('不是受支持的 DL评论助手配置备份')
  try {
    const salt = base64ToBytes(envelope.salt)
    const iv = base64ToBytes(envelope.iv)
    const data = base64ToBytes(envelope.data)
    const tag = base64ToBytes(envelope.tag)
    const encrypted = new Uint8Array(data.length + tag.length)
    encrypted.set(data)
    encrypted.set(tag, data.length)
    const key = await deriveBackupKey(password, salt, Number(envelope.iterations) || 210000, ['decrypt'])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encrypted as BufferSource,
    )
    const restored = JSON.parse(new TextDecoder().decode(plain))
    if (restored.format !== 'DL_COMMENT_ASSISTANT_CONFIG' || restored.version !== 1) throw new Error('备份内容版本不受支持')
    let config
    if (restored.aiConfig?.provider?.startsWith?.('aiproxy_')) {
      await chrome.storage.local.set({
        [AI_CONFIG_KEY]: { ...restored.aiConfig, apiKey: '', rememberKey: false, updatedAt: new Date().toISOString() },
      })
      config = publicConfig(await loadConfig())
    } else {
      config = restored.aiConfig?.apiKey
        ? await saveConfig({ ...restored.aiConfig, rememberKey: true })
        : publicConfig(await loadConfig())
    }
    return { config, extensionSettings: restored.extensionSettings || {} }
  } catch (error) {
    if (/版本不受支持/.test(String((error as Error)?.message || error))) throw error
    throw new Error('备份密码错误，或备份文件已损坏')
  }
}

async function handleLocalCommand(command: string, payload: unknown): Promise<any> {
  const input = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  switch (command) {
    case 'HELLO': return { hostName: 'dl-comment-assistant-extension', hostVersion: '2.1.0', protocolVersion: 2, mode: 'extension', logDir: '' }
    case 'GET_AI_CONFIG': return publicConfig(await loadConfig())
    case 'IMPORT_AIPROXY_CONFIG': return importAiProxyConfig(input)
    case 'FETCH_AI_MODELS': return fetchAvailableModels(input)
    case 'SAVE_AI_CONFIG': return saveConfig(input)
    case 'TEST_AI_CONNECTION': {
      if (input.endpoint || input.apiKey || input.model) await saveConfig(input)
      const config = await loadConfig()
      const sample = await callAi('这是一篇用于测试接口连接的示例文章，介绍如何安全管理跨平台内容任务。', config)
      await appendLog('operation', {
        stage: 'ai-config', action: 'ai-connection-test', provider: config.provider,
        model: config.model, endpointOrigin: new URL(config.endpoint).origin,
        message: 'AI 接口真实测试成功',
      })
      return { message: 'AI 接口连接成功', sample }
    }
    case 'GENERATE_COMMENT': return { comment: await generateComment(input) }
    case 'EXPORT_CONFIG_BACKUP': return exportBackup(input)
    case 'IMPORT_CONFIG_BACKUP': return importBackup(input)
    case 'APPEND_LOG': return appendLog(input.channel === 'error' ? 'error' : 'operation', (input.entry || {}) as Record<string, unknown>)
    case 'LIST_LOGS': {
      const key = input.channel === 'error' ? ERROR_LOG_KEY : OPERATION_LOG_KEY
      const stored = await chrome.storage.local.get(key)
      const logs = Array.isArray(stored[key]) ? stored[key] as unknown[] : []
      return { logs: logs.slice(-Math.min(2000, Math.max(1, Number(input.limit) || 300))).reverse() }
    }
    case 'CLEAR_LOGS':
      await chrome.storage.local.remove(input.channel === 'error' ? ERROR_LOG_KEY : input.channel === 'operation' ? OPERATION_LOG_KEY : [OPERATION_LOG_KEY, ERROR_LOG_KEY])
      return { message: '日志已清空' }
    case 'OPEN_LOG_DIR': throw new Error('纯插件模式没有本地日志目录，请使用导出日志')
    case 'EXPORT_LOGS': {
      const stored = await chrome.storage.local.get([OPERATION_LOG_KEY, ERROR_LOG_KEY])
      return {
        content: JSON.stringify({
          exportedAt: new Date().toISOString(),
          operations: stored[OPERATION_LOG_KEY] || [],
          errors: stored[ERROR_LOG_KEY] || [],
        }, null, 2),
        fileName: `DL评论助手日志_${new Date().toISOString().slice(0, 10)}.json`,
      }
    }
    case 'SAVE_TASK_STATE': await chrome.storage.local.set({ [TASK_STATE_KEY]: cleanLogValue(input) }); return { saved: true }
    case 'GET_TASK_STATE': return { state: (await chrome.storage.local.get(TASK_STATE_KEY))[TASK_STATE_KEY] || null }
    default: throw new Error(`不支持的插件命令：${command || '(空)'}`)
  }
}

export async function localClientCommand<T = any>(command: string, payload: unknown = {}): Promise<LocalClientResponse<T>> {
  try {
    return { success: true, data: await handleLocalCommand(command, payload) as T }
  } catch (error) {
    const message = String((error as Error)?.message || error)
    if (command === 'IMPORT_AIPROXY_CONFIG' || command === 'FETCH_AI_MODELS' || command === 'SAVE_AI_CONFIG' || command === 'TEST_AI_CONNECTION' || command === 'GENERATE_COMMENT') {
      await appendLog('error', {
        stage: 'ai-config', action: command, code: 'AI_COMMAND_FAILED', message,
      }).catch(() => {})
    }
    return { success: false, error: message, code: 'LOCAL_COMMAND_FAILED' }
  }
}
