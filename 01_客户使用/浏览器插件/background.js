"use strict";
(() => {
  // src/shared/types.ts
  var COMMENT_ARCHIVE_RUNS_KEY = "commentScreenshotArchiveRuns";
  var COMMENT_ARCHIVE_RUN_HISTORY_KEY = "commentScreenshotArchiveRunHistory";

  // src/shared/platform.ts
  function detectPlatform(url) {
    if (url.includes("csdn.net")) return "csdn";
    if (url.includes("zhihu.com")) return "zhihu";
    if (url.includes("toutiao.com")) return "toutiao";
    if (url.includes("baijiahao.baidu.com")) return "baijiahao";
    if (url.includes("163.com") || url.includes("netease.com")) return "netease";
    if (url.includes("sohu.com")) return "sohu";
    return null;
  }
  function normalizeArticleUrl(rawUrl, platform) {
    try {
      const url = new URL(rawUrl);
      const detectedPlatform = platform || detectPlatform(rawUrl);
      url.hash = "";
      if (detectedPlatform === "baijiahao") {
        const contentId = url.searchParams.get("id");
        url.search = "";
        if (contentId) url.searchParams.set("id", contentId);
      } else {
        url.search = "";
      }
      url.hostname = url.hostname.toLowerCase();
      if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString();
    } catch {
      return rawUrl.split("#")[0];
    }
  }
  function classifyArticleUrls(rawUrls) {
    const valid = [];
    const invalid = [];
    const thirdParty = [];
    const seen = /* @__PURE__ */ new Set();
    const byPlatform = {};
    let duplicateCount = 0;
    for (const raw of rawUrls) {
      const value = raw.trim().replace(/[),，。；;]+$/, "");
      if (!value) continue;
      let parsed;
      try {
        parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
      } catch {
        invalid.push(value);
        continue;
      }
      const platform = detectPlatform(value);
      if (!platform) {
        const normalized = normalizeArticleUrl(value);
        if (seen.has(`third-party:${normalized}`)) duplicateCount++;
        else {
          seen.add(`third-party:${normalized}`);
          thirdParty.push(normalized);
        }
        continue;
      }
      if (!isArticlePage(value)) {
        invalid.push(value);
        continue;
      }
      const url = normalizeArticleUrl(value, platform);
      const key = `${platform}:${url}`;
      if (seen.has(key)) {
        duplicateCount++;
        continue;
      }
      seen.add(key);
      valid.push({ url, platform });
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    }
    return { valid, invalid, thirdParty, duplicateCount, byPlatform };
  }
  function isArticlePage(url) {
    if (url.includes("csdn.net") && url.includes("/article/details/")) return true;
    if (url.includes("zhihu.com") && (url.includes("/p/") || url.includes("/answer/"))) return true;
    if (url.includes("toutiao.com") && (/\/article\/\d+/.test(url) || /\/item\/\d+/.test(url))) return true;
    if (url.includes("baijiahao.baidu.com")) return true;
    if (url.includes("163.com") && url.includes("/article/")) return true;
    if (url.includes("sohu.com") && /\/a\/\d+_\d+/.test(url)) return true;
    return false;
  }

  // src/db/index.ts
  var DB_NAME = "AICommentCounter";
  var DB_VERSION = 3;
  var STORE_NAME = "comments";
  var EVIDENCE_STORE_NAME = "commentEvidence";
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const oldVersion = event.oldVersion;
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true
          });
          store.createIndex("url", "url", { unique: false });
          store.createIndex("platform", "platform", { unique: false });
          store.createIndex("checkTime", "checkTime", { unique: false });
          store.createIndex("url_platform", ["url", "platform"], { unique: true });
        }
        if (!db.objectStoreNames.contains(EVIDENCE_STORE_NAME)) {
          const evidenceStore = db.createObjectStore(EVIDENCE_STORE_NAME, { keyPath: "id" });
          evidenceStore.createIndex("createdAt", "createdAt", { unique: false });
          evidenceStore.createIndex("url", "url", { unique: false });
        }
        if (request.transaction && oldVersion < 3 && db.objectStoreNames.contains(STORE_NAME)) {
          const store = request.transaction.objectStore(STORE_NAME);
          store.openCursor().onsuccess = (event2) => {
            const cursor = event2.target.result;
            if (!cursor) return;
            const record = cursor.value;
            if (record.platform === "sohu" && detectPlatform(record.url) !== "sohu") {
              cursor.update({ ...record, platform: "third_party" });
            }
            cursor.continue();
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function waitForTransaction(tx, fallbackMessage) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(fallbackMessage));
      tx.onabort = () => reject(tx.error || new Error(fallbackMessage));
    });
  }
  async function saveCommentEvidence(snapshot) {
    const db = await openDB();
    const tx = db.transaction(EVIDENCE_STORE_NAME, "readwrite");
    tx.objectStore(EVIDENCE_STORE_NAME).put(snapshot);
    await waitForTransaction(tx, "\u4FDD\u5B58\u8BC4\u8BBA\u533A\u5B58\u6863\u5931\u8D25");
  }
  async function getCommentEvidence(id) {
    const db = await openDB();
    const tx = db.transaction(EVIDENCE_STORE_NAME, "readonly");
    const request = tx.objectStore(EVIDENCE_STORE_NAME).get(id);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function getAllCommentEvidence() {
    const db = await openDB();
    const tx = db.transaction(EVIDENCE_STORE_NAME, "readonly");
    const request = tx.objectStore(EVIDENCE_STORE_NAME).getAll();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function pruneCommentEvidence(keepIds) {
    const keep = new Set(keepIds.filter(Boolean));
    const db = await openDB();
    const tx = db.transaction(EVIDENCE_STORE_NAME, "readwrite");
    const store = tx.objectStore(EVIDENCE_STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const snapshot = cursor.value;
        if (snapshot.archiveFormat !== "image" && snapshot.source !== "manual_scan" && !keep.has(snapshot.id)) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    await waitForTransaction(tx, "\u6E05\u7406\u8FC7\u671F\u8BC4\u8BBA\u533A\u5B58\u6863\u5931\u8D25");
  }
  async function saveRecord(record) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const definedRecord = Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== void 0)
    );
    const normalizedRecord = {
      ...definedRecord,
      url: normalizeArticleUrl(record.url, record.platform)
    };
    const records = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const matches = records.filter((item) => item.platform === normalizedRecord.platform && normalizeArticleUrl(item.url, item.platform) === normalizedRecord.url).sort((a, b) => b.checkTime.localeCompare(a.checkTime));
    const existing = matches[0];
    for (const duplicate of matches.slice(1)) {
      if (duplicate.id != null) store.delete(duplicate.id);
    }
    if (existing) {
      store.put({ ...existing, ...normalizedRecord });
    } else {
      store.add(normalizedRecord);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // src/background/local-client.ts
  var AI_CONFIG_KEY = "localAiConfigV1";
  var OPERATION_LOG_KEY = "localOperationLogsV1";
  var ERROR_LOG_KEY = "localErrorLogsV1";
  var TASK_STATE_KEY = "localTaskStateV1";
  var GENERATED_HISTORY_KEY = "localGeneratedCommentHistoryV1";
  var PRESET_AI_PROVIDERS = {
    deepseek: { apiType: "chat", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
    openai: { apiType: "chat", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-5-mini" },
    qwen: { apiType: "chat", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus" },
    kimi: { apiType: "chat", endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
    zhipu: { apiType: "chat", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
    anthropic: { apiType: "messages", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-5" },
    gemini: { apiType: "gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", model: "gemini-2.5-flash" },
    siliconflow: { apiType: "chat", endpoint: "https://api.siliconflow.cn/v1/chat/completions", model: "deepseek-ai/DeepSeek-V3" }
  };
  var sessionApiKey = "";
  var AiHttpError = class extends Error {
    constructor(message, status, responseBody) {
      super(message);
      this.status = status;
      this.responseBody = responseBody;
      this.name = "AiHttpError";
    }
  };
  var SYSTEM_PROMPT = [
    "\u4F60\u662F\u4E00\u540D\u8BA4\u771F\u8BFB\u5B8C\u6587\u7AE0\u3001\u613F\u610F\u8FDB\u884C\u53CB\u5584\u4EA4\u6D41\u7684\u771F\u5B9E\u8BFB\u8005\u3002",
    "\u6839\u636E\u6587\u7AE0\u6B63\u6587\u5199\u51FA 1 \u6761\u81EA\u7136\u3001\u6B63\u9762\u7684\u4E2D\u6587\u8BC4\u8BBA\uFF1A",
    "1. \u5FC5\u987B\u7ED3\u5408\u6587\u7AE0\u4E2D\u7684\u5177\u4F53\u89C2\u70B9\u3001\u6280\u672F\u3001\u6848\u4F8B\u6216\u7ED3\u8BBA\uFF0C\u4E0D\u80FD\u5199\u4E07\u80FD\u5957\u8BDD\uFF1B",
    "2. \u53EF\u4EE5\u8868\u8FBE\u8BA4\u53EF\u3001\u8865\u5145\u4E00\u4E2A\u6709\u4EF7\u503C\u7684\u770B\u6CD5\uFF0C\u6216\u63D0\u51FA\u4E00\u4E2A\u53CB\u5584\u4E14\u5177\u4F53\u7684\u95EE\u9898\uFF1B",
    "3. \u4E0D\u5938\u5F20\u5439\u6367\uFF0C\u4E0D\u865A\u6784\u4EB2\u8EAB\u7ECF\u5386\uFF0C\u4E0D\u7167\u6284\u6807\u9898\u548C\u6B63\u6587\uFF1B",
    "4. \u8BED\u6C14\u81EA\u7136\u53E3\u8BED\u5316\uFF0C25\u523070\u5B57\uFF0C\u5E76\u5C3D\u91CF\u4E0E\u540C\u4E00\u6587\u7AE0\u7684\u5386\u53F2\u8BC4\u8BBA\u4E0D\u540C\uFF1B",
    "5. \u53EA\u8F93\u51FA\u8BC4\u8BBA\u672C\u8EAB\uFF0C\u4E0D\u8981\u5F15\u53F7\u3001\u7F16\u53F7\u6216\u989D\u5916\u8BF4\u660E\u3002"
  ].join("\n");
  async function loadConfig() {
    const stored = await chrome.storage.local.get(AI_CONFIG_KEY);
    const value = stored[AI_CONFIG_KEY] && typeof stored[AI_CONFIG_KEY] === "object" ? stored[AI_CONFIG_KEY] : {};
    const provider = String(value.provider || "deepseek");
    const preset = PRESET_AI_PROVIDERS[provider];
    return {
      provider,
      apiType: ["chat", "responses", "messages", "gemini"].includes(String(value.apiType)) ? value.apiType : preset?.apiType || "chat",
      endpoint: String(value.endpoint || preset?.endpoint || ""),
      model: String(value.model || preset?.model || ""),
      rememberKey: value.rememberKey !== false,
      apiKey: String(value.apiKey || "") || sessionApiKey
    };
  }
  function inferApiType(provider, endpoint) {
    const preset = PRESET_AI_PROVIDERS[provider];
    if (preset) return preset.apiType;
    const normalizedEndpoint = endpoint.toLowerCase();
    if (/generativelanguage\.googleapis\.com\/.+:generatecontent/.test(normalizedEndpoint)) return "gemini";
    if (/\/messages(?:\?|$)/.test(normalizedEndpoint)) return "messages";
    if (/\/responses(?:\?|$)/.test(normalizedEndpoint)) return "responses";
    return "chat";
  }
  function publicConfig(config) {
    return {
      provider: config.provider,
      apiType: config.apiType,
      endpoint: config.endpoint,
      model: config.model,
      rememberKey: config.rememberKey,
      hasApiKey: Boolean(config.apiKey)
    };
  }
  async function saveConfig(input) {
    const previous = await loadConfig();
    const provider = String(input.provider || previous.provider || "deepseek").trim();
    const providerChanged = provider !== previous.provider;
    const preset = PRESET_AI_PROVIDERS[provider];
    const endpoint = String(input.endpoint || preset?.endpoint || previous.endpoint || "").trim();
    const config = {
      provider,
      apiType: inferApiType(provider, endpoint),
      endpoint,
      model: String(input.model || preset?.model || previous.model || "").trim(),
      apiKey: String(input.apiKey || "").trim() || (providerChanged ? "" : previous.apiKey),
      rememberKey: input.rememberKey !== false
    };
    if (!config.apiKey) throw new Error("\u8BF7\u586B\u5199 API Key");
    if (!config.endpoint || !config.model) throw new Error("\u81EA\u5B9A\u4E49\u63A5\u53E3\u9700\u8981\u586B\u5199\u63A5\u53E3\u5730\u5740\u548C\u6A21\u578B\u540D\u79F0");
    const parsedEndpoint = new URL(config.endpoint);
    if (!["http:", "https:"].includes(parsedEndpoint.protocol)) throw new Error("\u63A5\u53E3\u5730\u5740\u5FC5\u987B\u4F7F\u7528 http \u6216 https");
    sessionApiKey = config.rememberKey ? "" : config.apiKey;
    await chrome.storage.local.set({
      [AI_CONFIG_KEY]: {
        ...config,
        apiKey: config.rememberKey ? config.apiKey : "",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    return publicConfig(config);
  }
  function redactApiError(value) {
    return value.slice(0, 1e3).replace(/\b(sk-[A-Za-z0-9_-]{5})[A-Za-z0-9_-]+/g, "$1****").replace(/("?(?:api[_-]?key|authorization)"?\s*[:=]\s*"?)[^"\s,;}]+/ig, "$1****");
  }
  function extractApiErrorMessage(body) {
    const safeBody = redactApiError(body).trim();
    if (!safeBody) return "";
    try {
      const parsed = JSON.parse(safeBody);
      const message = parsed?.error?.message || parsed?.error?.detail || parsed?.message || parsed?.detail;
      if (message) return redactApiError(String(message)).slice(0, 500);
    } catch {
    }
    return safeBody.replace(/\s+/g, " ").slice(0, 500);
  }
  function httpErrorMessage(status, statusText, body) {
    const detail = extractApiErrorMessage(body);
    const suffix = detail ? `\uFF1A${detail}` : "";
    if (status === 400) return `\u63A5\u53E3\u62D2\u7EDD\u4E86\u8BF7\u6C42\u53C2\u6570\uFF0C\u8BF7\u68C0\u67E5\u6A21\u578B\u540D\u79F0\u548C\u63A5\u53E3\u7C7B\u578B${suffix}`;
    if (status === 401) return `API Key \u9274\u6743\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 Key \u5C5E\u4E8E\u5F53\u524D\u670D\u52A1\u5546\u4E14\u4ECD\u7136\u6709\u6548${suffix}`;
    if (status === 403) return `\u5F53\u524D Key \u6CA1\u6709\u8BE5\u6A21\u578B\u6216\u63A5\u53E3\u7684\u8BBF\u95EE\u6743\u9650${suffix}`;
    if (status === 404) return `\u63A5\u53E3\u5730\u5740\u6216\u6A21\u578B\u4E0D\u5B58\u5728\uFF1B\u81EA\u5B9A\u4E49\u63A5\u53E3\u9700\u8981\u586B\u5199\u5B8C\u6574\u8BF7\u6C42\u5730\u5740${suffix}`;
    if (status === 408) return `AI \u63A5\u53E3\u54CD\u5E94\u8D85\u65F6${suffix}`;
    if (status === 429) return `\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\u3001\u989D\u5EA6\u4E0D\u8DB3\u6216\u5E76\u53D1\u5DF2\u8FBE\u4E0A\u9650${suffix}`;
    if (status >= 500) return `\u5927\u6A21\u578B\u670D\u52A1\u6682\u65F6\u5F02\u5E38\uFF08HTTP ${status}\uFF09${suffix}`;
    return `AI \u63A5\u53E3\u8FD4\u56DE HTTP ${status} ${statusText}${suffix}`;
  }
  async function fetchJson(endpoint, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6e4);
    try {
      const response = await fetch(endpoint, { ...options, signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AiHttpError(
          httpErrorMessage(response.status, response.statusText, body),
          response.status,
          redactApiError(body)
        );
      }
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AI \u63A5\u53E3\u8BF7\u6C42\u8D85\u65F6\uFF0860 \u79D2\uFF09");
      if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
        throw new Error("\u65E0\u6CD5\u8FDE\u63A5\u5927\u6A21\u578B\u63A5\u53E3\uFF0C\u8BF7\u68C0\u67E5\u63A5\u53E3\u5730\u5740\u3001\u7F51\u7EDC\u3001HTTPS \u8BC1\u4E66\u6216\u670D\u52A1\u662F\u5426\u5DF2\u7ECF\u542F\u52A8");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  function cleanComment(value) {
    return String(value || "").trim().replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^(评论|回答)[:：]\s*/i, "").replace(/^["'「『]+|["'」』]+$/g, "").trim();
  }
  function prefersModernChatParameters(model) {
    return /^(?:gpt-5|o[1-9](?:-|$))/i.test(model.trim());
  }
  function chatMessageText(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map((item) => {
      if (typeof item === "string") return item;
      return item?.text?.value || item?.text || item?.content || "";
    }).join("");
  }
  function chatOutput(data) {
    return chatMessageText(data?.choices?.[0]?.message?.content) || String(data?.choices?.[0]?.text || data?.output_text || "");
  }
  function isChatParameterCompatibilityError(error) {
    if (!(error instanceof AiHttpError) || error.status !== 400) return false;
    return /max[_ ]?(?:completion[_ ]?)?tokens?|temperature|unsupported|unknown parameter|unrecognized|not supported/i.test(`${error.message} ${error.responseBody}`);
  }
  async function requestChatCompletion(config, userPrompt, maxTokens, modernParameters) {
    const body = {
      model: config.model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }]
    };
    if (modernParameters) body.max_completion_tokens = maxTokens;
    else {
      body.max_tokens = maxTokens;
      body.temperature = 0.8;
    }
    return fetchJson(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body)
    });
  }
  async function callChatCompletion(config, userPrompt, maxTokens) {
    const preferredModern = prefersModernChatParameters(config.model);
    try {
      return await requestChatCompletion(config, userPrompt, maxTokens, preferredModern);
    } catch (error) {
      if (!isChatParameterCompatibilityError(error)) throw error;
      return await requestChatCompletion(config, userPrompt, maxTokens, !preferredModern);
    }
  }
  async function callAi(articleText, config) {
    const content = String(articleText || "").slice(0, 5e3).trim();
    if (!content) throw new Error("\u6587\u7AE0\u6B63\u6587\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u751F\u6210\u8BC4\u8BBA");
    const userPrompt = `\u6587\u7AE0\u6B63\u6587\u5982\u4E0B\uFF1A
"""
${content}
"""

\u8BF7\u6309\u8981\u6C42\u5199 1 \u6761\u81EA\u7136\u3001\u6B63\u9762\u4E14\u4E0E\u6B63\u6587\u6709\u5173\u7684\u8BC4\u8BBA\u3002`;
    let data;
    let output = "";
    if (config.apiType === "gemini") {
      const endpoint = config.endpoint.replace("{model}", encodeURIComponent(config.model));
      data = await fetchJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM_PROMPT}

${userPrompt}` }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.8 }
        })
      });
      output = data.candidates?.[0]?.content?.parts?.map((item) => item?.text || "").join("") || "";
    } else if (config.apiType === "messages") {
      data = await fetchJson(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: config.model, max_tokens: 400, system: SYSTEM_PROMPT, messages: [{ role: "user", content: userPrompt }] })
      });
      output = Array.isArray(data.content) ? data.content.filter((item) => item?.type === "text").map((item) => item.text).join("") : "";
    } else if (config.apiType === "responses") {
      data = await fetchJson(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, instructions: SYSTEM_PROMPT, input: userPrompt, max_output_tokens: 500 })
      });
      output = data.output_text || (Array.isArray(data.output) ? data.output.flatMap((item) => item.content || []).map((item) => item.text?.value || item.text || "").join("") : "") || data.choices?.[0]?.message?.content || "";
    } else {
      data = await callChatCompletion(config, userPrompt, 800);
      output = chatOutput(data);
      if (!cleanComment(output) && data.choices?.[0]?.message?.reasoning_content) {
        data = await callChatCompletion(config, userPrompt, 1400);
        output = chatOutput(data);
      }
    }
    const comment = cleanComment(output);
    if (!comment) throw new Error("\u63A5\u53E3\u6CA1\u6709\u8FD4\u56DE\u6700\u7EC8\u8BC4\u8BBA\u6B63\u6587\uFF0C\u8BF7\u66F4\u6362\u975E\u7EAF\u63A8\u7406\u6A21\u578B\u6216\u63D0\u9AD8\u6A21\u578B\u8F93\u51FA\u4E0A\u9650");
    return comment;
  }
  async function generateComment(payload) {
    const config = await loadConfig();
    if (!config.endpoint || !config.model || !config.apiKey) throw new Error("AI \u914D\u7F6E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u5148\u5728\u63D2\u4EF6\u201C\u667A\u80FD\u8865\u9F50\u201D\u9875\u9762\u4FDD\u5B58");
    const url = String(payload.url || "");
    const stored = await chrome.storage.local.get(GENERATED_HISTORY_KEY);
    const history = stored[GENERATED_HISTORY_KEY] && typeof stored[GENERATED_HISTORY_KEY] === "object" ? stored[GENERATED_HISTORY_KEY] : {};
    const recent = Array.isArray(history[url]) ? history[url].slice(-10) : [];
    const hint = recent.length ? `

\u4EE5\u4E0B\u8BC4\u8BBA\u5DF2\u751F\u6210\u8FC7\uFF0C\u4E0D\u80FD\u91CD\u590D\u6216\u8FD1\u4F3C\uFF1A
${recent.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
    const comment = await callAi(`${String(payload.articleText || "")}${hint}`, config);
    if (recent.includes(comment)) throw new Error("AI \u751F\u6210\u4E86\u91CD\u590D\u8BC4\u8BBA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    if (url) {
      history[url] = [...recent, comment].slice(-20);
      await chrome.storage.local.set({ [GENERATED_HISTORY_KEY]: history });
    }
    return comment;
  }
  function cleanLogValue(value, key = "") {
    if (/api.?key|authorization|cookie|password|backup.?content/i.test(key)) return "****";
    if (/article.?text/i.test(key)) return "[\u6587\u7AE0\u6B63\u6587\u5DF2\u7701\u7565]";
    if (typeof value === "string") {
      return value.slice(0, 1200).replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1****").replace(/(authorization|x-api-key)\s*[:=]\s*[^\s,;]+/ig, "$1: ****");
    }
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => cleanLogValue(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, cleanLogValue(item, name)]));
    }
    return value;
  }
  async function appendLog(channel, rawEntry) {
    const key = channel === "error" ? ERROR_LOG_KEY : OPERATION_LOG_KEY;
    const stored = await chrome.storage.local.get(key);
    const logs = Array.isArray(stored[key]) ? stored[key] : [];
    const entry = cleanLogValue({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: (/* @__PURE__ */ new Date()).toISOString(),
      channel,
      ...rawEntry
    });
    await chrome.storage.local.set({ [key]: [...logs.slice(-1999), entry] });
    return entry;
  }
  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  async function deriveBackupKey(password, salt, iterations, usage) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      usage
    );
  }
  function requireBackupPassword(value) {
    const password = String(value || "");
    if (password.length < 8) throw new Error("\u5907\u4EFD\u5BC6\u7801\u81F3\u5C11\u9700\u8981 8 \u4F4D");
    return password;
  }
  async function exportBackup(payload) {
    const password = requireBackupPassword(payload.password);
    const config = await loadConfig();
    const plain = new TextEncoder().encode(JSON.stringify({
      format: "DL_COMMENT_ASSISTANT_CONFIG",
      version: 1,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      aiConfig: config,
      extensionSettings: payload.extensionSettings && typeof payload.extensionSettings === "object" ? payload.extensionSettings : {}
    }));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 21e4;
    const key = await deriveBackupKey(password, salt, iterations, ["encrypt"]);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    const tag = encrypted.slice(-16);
    const data = encrypted.slice(0, -16);
    return {
      content: JSON.stringify({
        format: "DL_CONFIG_BACKUP",
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations,
        cipher: "AES-256-GCM",
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        tag: bytesToBase64(tag),
        data: bytesToBase64(data)
      }),
      fileName: `DL\u8BC4\u8BBA\u52A9\u624B\u914D\u7F6E_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.dlconfig`
    };
  }
  async function importBackup(payload) {
    const password = requireBackupPassword(payload.password);
    let envelope;
    try {
      envelope = JSON.parse(String(payload.content || ""));
    } catch {
      throw new Error("\u5907\u4EFD\u6587\u4EF6\u683C\u5F0F\u65E0\u6548");
    }
    if (envelope.format !== "DL_CONFIG_BACKUP" || envelope.version !== 1) throw new Error("\u4E0D\u662F\u53D7\u652F\u6301\u7684 DL\u8BC4\u8BBA\u52A9\u624B\u914D\u7F6E\u5907\u4EFD");
    try {
      const salt = base64ToBytes(envelope.salt);
      const iv = base64ToBytes(envelope.iv);
      const data = base64ToBytes(envelope.data);
      const tag = base64ToBytes(envelope.tag);
      const encrypted = new Uint8Array(data.length + tag.length);
      encrypted.set(data);
      encrypted.set(tag, data.length);
      const key = await deriveBackupKey(password, salt, Number(envelope.iterations) || 21e4, ["decrypt"]);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encrypted
      );
      const restored = JSON.parse(new TextDecoder().decode(plain));
      if (restored.format !== "DL_COMMENT_ASSISTANT_CONFIG" || restored.version !== 1) throw new Error("\u5907\u4EFD\u5185\u5BB9\u7248\u672C\u4E0D\u53D7\u652F\u6301");
      const config = restored.aiConfig?.apiKey ? await saveConfig({ ...restored.aiConfig, rememberKey: true }) : publicConfig(await loadConfig());
      return { config, extensionSettings: restored.extensionSettings || {} };
    } catch (error) {
      if (/版本不受支持/.test(String(error?.message || error))) throw error;
      throw new Error("\u5907\u4EFD\u5BC6\u7801\u9519\u8BEF\uFF0C\u6216\u5907\u4EFD\u6587\u4EF6\u5DF2\u635F\u574F");
    }
  }
  async function handleLocalCommand(command, payload) {
    const input = payload && typeof payload === "object" ? payload : {};
    switch (command) {
      case "HELLO":
        return { hostName: "dl-comment-assistant-extension", hostVersion: "2.1.0", protocolVersion: 2, mode: "extension", logDir: "" };
      case "GET_AI_CONFIG":
        return publicConfig(await loadConfig());
      case "SAVE_AI_CONFIG":
        return saveConfig(input);
      case "TEST_AI_CONNECTION": {
        if (input.endpoint || input.apiKey || input.model) await saveConfig(input);
        const config = await loadConfig();
        const sample = await callAi("\u8FD9\u662F\u4E00\u7BC7\u7528\u4E8E\u6D4B\u8BD5\u63A5\u53E3\u8FDE\u63A5\u7684\u793A\u4F8B\u6587\u7AE0\uFF0C\u4ECB\u7ECD\u5982\u4F55\u5B89\u5168\u7BA1\u7406\u8DE8\u5E73\u53F0\u5185\u5BB9\u4EFB\u52A1\u3002", config);
        await appendLog("operation", {
          stage: "ai-config",
          action: "ai-connection-test",
          provider: config.provider,
          model: config.model,
          endpointOrigin: new URL(config.endpoint).origin,
          message: "AI \u63A5\u53E3\u771F\u5B9E\u6D4B\u8BD5\u6210\u529F"
        });
        return { message: "AI \u63A5\u53E3\u8FDE\u63A5\u6210\u529F", sample };
      }
      case "GENERATE_COMMENT":
        return { comment: await generateComment(input) };
      case "EXPORT_CONFIG_BACKUP":
        return exportBackup(input);
      case "IMPORT_CONFIG_BACKUP":
        return importBackup(input);
      case "APPEND_LOG":
        return appendLog(input.channel === "error" ? "error" : "operation", input.entry || {});
      case "LIST_LOGS": {
        const key = input.channel === "error" ? ERROR_LOG_KEY : OPERATION_LOG_KEY;
        const stored = await chrome.storage.local.get(key);
        const logs = Array.isArray(stored[key]) ? stored[key] : [];
        return { logs: logs.slice(-Math.min(2e3, Math.max(1, Number(input.limit) || 300))).reverse() };
      }
      case "CLEAR_LOGS":
        await chrome.storage.local.remove(input.channel === "error" ? ERROR_LOG_KEY : input.channel === "operation" ? OPERATION_LOG_KEY : [OPERATION_LOG_KEY, ERROR_LOG_KEY]);
        return { message: "\u65E5\u5FD7\u5DF2\u6E05\u7A7A" };
      case "OPEN_LOG_DIR":
        throw new Error("\u7EAF\u63D2\u4EF6\u6A21\u5F0F\u6CA1\u6709\u672C\u5730\u65E5\u5FD7\u76EE\u5F55\uFF0C\u8BF7\u4F7F\u7528\u5BFC\u51FA\u65E5\u5FD7");
      case "EXPORT_LOGS": {
        const stored = await chrome.storage.local.get([OPERATION_LOG_KEY, ERROR_LOG_KEY]);
        return {
          content: JSON.stringify({
            exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
            operations: stored[OPERATION_LOG_KEY] || [],
            errors: stored[ERROR_LOG_KEY] || []
          }, null, 2),
          fileName: `DL\u8BC4\u8BBA\u52A9\u624B\u65E5\u5FD7_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`
        };
      }
      case "SAVE_TASK_STATE":
        await chrome.storage.local.set({ [TASK_STATE_KEY]: cleanLogValue(input) });
        return { saved: true };
      case "GET_TASK_STATE":
        return { state: (await chrome.storage.local.get(TASK_STATE_KEY))[TASK_STATE_KEY] || null };
      default:
        throw new Error(`\u4E0D\u652F\u6301\u7684\u63D2\u4EF6\u547D\u4EE4\uFF1A${command || "(\u7A7A)"}`);
    }
  }
  async function localClientCommand(command, payload = {}) {
    try {
      return { success: true, data: await handleLocalCommand(command, payload) };
    } catch (error) {
      const message = String(error?.message || error);
      if (command === "SAVE_AI_CONFIG" || command === "TEST_AI_CONNECTION" || command === "GENERATE_COMMENT") {
        await appendLog("error", {
          stage: "ai-config",
          action: command,
          code: "AI_COMMAND_FAILED",
          message
        }).catch(() => {
        });
      }
      return { success: false, error: message, code: "LOCAL_COMMAND_FAILED" };
    }
  }

  // src/background/index.ts
  var CLIENT_COMMANDS = /* @__PURE__ */ new Set([
    "HELLO",
    "GET_AI_CONFIG",
    "SAVE_AI_CONFIG",
    "TEST_AI_CONNECTION",
    "EXPORT_CONFIG_BACKUP",
    "IMPORT_CONFIG_BACKUP",
    "LIST_LOGS",
    "CLEAR_LOGS",
    "OPEN_LOG_DIR",
    "EXPORT_LOGS",
    "GET_TASK_STATE",
    "SAVE_TASK_STATE",
    "APPEND_LOG"
  ]);
  var nativeCommand = localClientCommand;
  function writeClientLog(channel, entry) {
    return nativeCommand("APPEND_LOG", { channel, entry }).then(() => void 0).catch(() => void 0);
  }
  function notifyAttention(title, message) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message
    }).catch(() => {
    });
  }
  function updateBadge(count, tabId) {
    const text = count > 0 ? String(count) : "";
    const action = chrome.action;
    if (tabId) {
      action.setBadgeText({ text, tabId });
      action.setBadgeBackgroundColor({ color: "#409EFF", tabId });
    } else {
      action.setBadgeText({ text });
      action.setBadgeBackgroundColor({ color: "#409EFF" });
    }
  }
  async function withTimeout(promise, timeoutMs) {
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`\u626B\u63CF\u8D85\u65F6\uFF08${timeoutMs / 1e3} \u79D2\uFF09`)), timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
  }
  function isMissingContentScriptError(error) {
    const message = String(error?.message || error);
    return /Receiving end does not exist|Could not establish connection/i.test(message);
  }
  async function sendContentScriptMessage(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingContentScriptError(error)) throw error;
      const tab = await chrome.tabs.get(tabId);
      const platform = detectPlatform(tab.url || "");
      if (!platform || !tab.url || !/^https?:/i.test(tab.url)) throw error;
      await writeClientLog("error", {
        stage: "comment-evidence",
        action: "content-script-missing",
        platform,
        url: normalizeArticleUrl(tab.url, platform),
        code: "CONTENT_SCRIPT_MISSING",
        message: "\u6587\u7AE0\u540E\u53F0\u9875\u672A\u8FDE\u63A5\u5185\u5BB9\u811A\u672C\uFF0C\u6B63\u5728\u81EA\u52A8\u6CE8\u5165\u5E76\u91CD\u8BD5"
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/index.js"]
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const response = await chrome.tabs.sendMessage(tabId, message);
      await writeClientLog("operation", {
        stage: "comment-evidence",
        action: "content-script-recovered",
        platform,
        url: normalizeArticleUrl(tab.url, platform),
        message: "\u6587\u7AE0\u540E\u53F0\u9875\u5185\u5BB9\u811A\u672C\u5DF2\u6062\u590D"
      });
      return response;
    }
  }
  function neteaseCommentThreadUrl(articleUrl) {
    const url = new URL(articleUrl);
    if (url.hostname === "comment.tie.163.com") return url.toString();
    const threadId = url.pathname.match(/\/article\/([A-Za-z0-9_-]+)\.html(?:$|\/)/i)?.[1];
    if (!threadId) throw new Error("\u65E0\u6CD5\u4ECE\u7F51\u6613\u6587\u7AE0\u94FE\u63A5\u8BC6\u522B\u8DDF\u8D34\u7F16\u53F7");
    return `https://comment.tie.163.com/${encodeURIComponent(threadId)}.html`;
  }
  async function navigateTabAndWait(tabId, url) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve();
      };
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          setTimeout(() => finish(), 2500);
        }
      };
      const timeoutId = setTimeout(() => finish(), 2e4);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url, active: false }).catch(finish);
    });
  }
  var BatchCancelledError = class extends Error {
    constructor() {
      super("\u6279\u91CF\u68C0\u6D4B\u5DF2\u505C\u6B62");
      this.name = "BatchCancelledError";
    }
  };
  function cancelBatchScan(controller) {
    if (controller.cancelled) return;
    controller.cancelled = true;
    for (const cancel of [...controller.cancelHandlers]) cancel();
    for (const tabId of [...controller.activeTabIds]) {
      chrome.tabs.remove(tabId).catch(() => {
      });
    }
  }
  function withBatchCancellation(promise, controller) {
    if (controller.cancelled) return Promise.reject(new BatchCancelledError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        controller.cancelHandlers.delete(cancel);
        callback();
      };
      const cancel = () => finish(() => reject(new BatchCancelledError()));
      controller.cancelHandlers.add(cancel);
      promise.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      );
    });
  }
  function cancellableDelay(delayMs, controller) {
    if (delayMs <= 0) {
      return controller.cancelled ? Promise.reject(new BatchCancelledError()) : Promise.resolve();
    }
    return withBatchCancellation(new Promise((resolve) => setTimeout(resolve, delayMs)), controller);
  }
  function safePost(port, message) {
    try {
      port.postMessage(message);
    } catch {
    }
  }
  async function scanUrlInTab(url, controller) {
    const platform = detectPlatform(url);
    if (!platform) {
      return { platform: "csdn", url, commentCount: 0, title: "", error: "\u65E0\u6CD5\u8BC6\u522B\u7684\u5E73\u53F0" };
    }
    const normalizedUrl = normalizeArticleUrl(url, platform);
    let tabId;
    try {
      if (controller.cancelled) throw new BatchCancelledError();
      const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
      tabId = tab?.id;
      if (tabId == null) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u540E\u53F0\u6807\u7B7E\u9875");
      controller.activeTabIds.add(tabId);
      if (controller.cancelled) throw new BatchCancelledError();
      await withBatchCancellation(new Promise((resolve) => {
        const listener = (tabId2, changeInfo) => {
          if (tabId2 === tab.id && changeInfo.status === "complete") {
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 1500);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 15e3);
      }), controller);
      const result = await withBatchCancellation(
        withTimeout(
          chrome.tabs.sendMessage(tabId, {
            type: "SCAN_PAGE",
            platform,
            url: normalizedUrl
          }),
          6e4
        ),
        controller
      );
      if (result?.type === "SCAN_RESULT") {
        return {
          platform: result.platform,
          url: normalizeArticleUrl(result.url, result.platform),
          commentCount: result.commentCount,
          title: result.title,
          linkStatus: result.linkStatus || "active",
          username: result.username,
          accountStatus: result.accountStatus,
          liked: result.liked,
          collected: result.collected
        };
      }
      return { platform, url: normalizedUrl, commentCount: 0, title: "", error: "\u672A\u83B7\u53D6\u5230\u6570\u636E" };
    } catch (err) {
      if (err instanceof BatchCancelledError) return null;
      return { platform, url: normalizedUrl, commentCount: 0, title: "", error: String(err) };
    } finally {
      if (tabId != null) {
        controller.activeTabIds.delete(tabId);
        try {
          await chrome.tabs.remove(tabId);
        } catch {
        }
      }
    }
  }
  async function verifyCommentOnline(request) {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    const detectedPlatform = detectPlatform(request.url);
    if (!detectedPlatform || detectedPlatform !== request.platform || request.platform === "third_party") {
      return {
        success: false,
        presence: "unknown",
        checkedAt,
        reason: "\u5728\u7EBF\u6838\u9A8C\u672A\u5B8C\u6210",
        error: "\u8BE5\u94FE\u63A5\u4E0D\u662F\u5F53\u524D\u652F\u6301\u7684\u5E73\u53F0\u6587\u7AE0\u9875"
      };
    }
    const normalizedUrl = normalizeArticleUrl(request.url, request.platform);
    let tabId;
    try {
      const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
      tabId = tab.id;
      if (tabId == null) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u5728\u7EBF\u6838\u9A8C\u9875\u9762");
      await new Promise((resolve) => {
        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 1250);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 2e4);
      });
      return await withTimeout(chrome.tabs.sendMessage(tabId, {
        type: "VERIFY_COMMENT_EVIDENCE",
        platform: request.platform,
        url: normalizedUrl,
        comment: request.comment,
        archivedAfterCommentCount: request.archivedAfterCommentCount
      }), 15e4);
    } catch (error) {
      return {
        success: false,
        presence: "unknown",
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reason: "\u5728\u7EBF\u6838\u9A8C\u672A\u5B8C\u6210",
        error: String(error?.message || error)
      };
    } finally {
      if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {
      });
    }
  }
  async function captureUrlArchive(request) {
    const detectedPlatform = detectPlatform(request.url);
    if (!detectedPlatform || detectedPlatform !== request.platform || request.platform === "third_party") {
      return { success: false, error: "\u8BE5\u94FE\u63A5\u5C5E\u4E8E\u7B2C\u4E09\u65B9\u5E73\u53F0\uFF0C\u5F53\u524D\u7248\u672C\u53EA\u8BB0\u5F55\u94FE\u63A5\uFF0C\u6682\u4E0D\u751F\u6210\u8BC4\u8BBA\u533A\u5FEB\u7167" };
    }
    const normalizedUrl = normalizeArticleUrl(request.url, request.platform);
    let tabId;
    let windowId;
    try {
      const operationWindow = await chrome.windows.create({
        url: normalizedUrl,
        type: "popup",
        focused: false,
        width: 760,
        height: 860
      });
      if (!operationWindow) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u5FEB\u7167\u64CD\u4F5C\u7A97\u53E3");
      windowId = operationWindow.id;
      const tab = operationWindow.tabs?.[0] || (windowId != null ? (await chrome.tabs.query({ windowId }))[0] : void 0);
      tabId = tab?.id;
      if (tabId == null) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u5FEB\u7167\u626B\u63CF\u9875\u9762");
      await new Promise((resolve) => {
        const listener = (updatedTabId, changeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 2500);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 2e4);
      });
      const scan = await withTimeout(sendContentScriptMessage(tabId, {
        type: request.platform === "zhihu" ? "SCAN_ARCHIVE_METADATA" : "SCAN_PAGE",
        platform: request.platform,
        url: normalizedUrl
      }), 15e4);
      if (!scan || scan.type !== "SCAN_RESULT") throw new Error("\u9875\u9762\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u626B\u63CF\u7ED3\u679C");
      if (scan.linkStatus === "invalid") throw new Error("\u6587\u7AE0\u94FE\u63A5\u5DF2\u7ECF\u5931\u6548\uFF0C\u672A\u751F\u6210\u5FEB\u7167");
      if (request.platform === "netease") {
        const threadUrl = neteaseCommentThreadUrl(normalizedUrl);
        await writeClientLog("operation", {
          stage: "comment-evidence",
          action: "netease-thread-page-opening",
          platform: request.platform,
          url: normalizedUrl,
          message: "\u6587\u7AE0\u4FE1\u606F\u5DF2\u8BFB\u53D6\uFF0C\u6B63\u5728\u8FDB\u5165\u7F51\u6613\u5B8C\u6574\u8DDF\u8D34\u9875\u5E76\u51C6\u5907\u5206\u9875\u622A\u56FE"
        });
        await navigateTabAndWait(tabId, threadUrl);
      }
      const capture = await captureAccountCommentImagesInTab(tabId, {
        platform: request.platform,
        url: normalizedUrl,
        title: scan.title || "",
        username: scan.username || "",
        beforeCommentCount: Number(scan.commentCount) || 0,
        afterCommentCount: Number(scan.commentCount) || 0,
        expectedComment: String(request.expectedComment || "").trim().slice(0, 2e3),
        source: "manual_scan",
        updateArchiveRun: true
      });
      await saveRecord({
        platform: request.platform,
        url: normalizedUrl,
        title: scan.title || "",
        commentCount: Math.max(Number(scan.commentCount) || 0, capture.detectedCommentCount || 0),
        checkTime: (/* @__PURE__ */ new Date()).toISOString(),
        username: scan.username || "",
        linkStatus: scan.linkStatus || "active",
        liked: scan.liked,
        collected: scan.collected
      });
      writeClientLog("operation", {
        stage: "comment-evidence",
        action: "manual-comment-screenshots-finished",
        platform: request.platform,
        url: normalizedUrl,
        detectedCommentCount: capture.detectedCommentCount,
        capturedCommentCount: capture.capturedCommentCount,
        missingCount: capture.missingCount,
        status: capture.status,
        error: capture.error,
        message: "\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\u622A\u56FE\u4EFB\u52A1\u5DF2\u5B8C\u6210"
      });
      return capture;
    } catch (error) {
      const message = String(error?.message || error);
      writeClientLog("error", {
        stage: "comment-evidence",
        action: "manual-archive-failed",
        platform: request.platform,
        url: normalizedUrl,
        code: "MANUAL_ARCHIVE_FAILED",
        message
      });
      return { success: false, error: message };
    } finally {
      if (windowId != null) await chrome.windows.remove(windowId).catch(() => {
      });
      else if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {
      });
    }
  }
  var COMMENT_SCREENSHOT_FORMAT_VERSION = "viewport-v2";
  function archiveArticleId(value) {
    try {
      const url = new URL(value);
      return url.pathname.match(/(?:article|item|p|answer|detail)[/_-]?(\d{5,})/i)?.[1] || url.pathname.match(/(\d{5,})(?:\/|\.html)?$/)?.[1] || url.pathname.replace(/^\/+|\/+$/g, "") || url.hostname;
    } catch {
      return "";
    }
  }
  async function saveArchiveRunSummary(summary) {
    const stored = await chrome.storage.local.get([COMMENT_ARCHIVE_RUNS_KEY, COMMENT_ARCHIVE_RUN_HISTORY_KEY]);
    const current = stored[COMMENT_ARCHIVE_RUNS_KEY] && typeof stored[COMMENT_ARCHIVE_RUNS_KEY] === "object" ? stored[COMMENT_ARCHIVE_RUNS_KEY] : {};
    const key = `${summary.platform}:${normalizeArticleUrl(summary.url, summary.platform)}`;
    const next = { ...current, [key]: summary };
    const entries = Object.entries(next).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1e3);
    const history = Array.isArray(stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY]) ? stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY] : [];
    const nextHistory = [...history.filter((run) => run.id !== summary.id), summary].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3e3);
    await chrome.storage.local.set({
      [COMMENT_ARCHIVE_RUNS_KEY]: Object.fromEntries(entries),
      [COMMENT_ARCHIVE_RUN_HISTORY_KEY]: nextHistory
    });
  }
  async function attachScreenshotDebugger(tabId) {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Page.enable");
    await enableTrustedPageInteraction({ tabId });
  }
  async function captureCommentNodeImage(tabId) {
    const response = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
      format: "webp",
      quality: 88,
      fromSurface: true,
      captureBeyondViewport: false
    });
    if (!response?.data) throw new Error("Chrome \u6CA1\u6709\u8FD4\u56DE\u8BC4\u8BBA\u622A\u56FE\u6570\u636E");
    return `data:image/webp;base64,${response.data}`;
  }
  async function settlePageForCommentScreenshot(tabId) {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: `new Promise((resolve) => {
      let style = document.getElementById('dl-comment-screenshot-stability');
      if (!style) {
        style = document.createElement('style');
        style.id = 'dl-comment-screenshot-stability';
        style.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}';
        (document.head || document.documentElement).appendChild(style);
      }
      setTimeout(resolve, 650);
    })`,
      awaitPromise: true,
      returnByValue: true
    }).catch(() => new Promise((resolve) => setTimeout(resolve, 800)));
  }
  async function captureAccountCommentImagesInTab(tabId, options) {
    const capturedAt = (/* @__PURE__ */ new Date()).toISOString();
    const archiveRunId = `${options.platform}:run:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
    const normalizedUrl = normalizeArticleUrl(options.url, options.platform);
    await writeClientLog("operation", {
      stage: "comment-evidence",
      action: "capture-session-start",
      platform: options.platform,
      url: normalizedUrl,
      expectedCount: options.afterCommentCount,
      exactCommentMode: Boolean(options.expectedComment),
      message: "\u5F00\u59CB\u5B9A\u4F4D\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\u5E76\u751F\u6210\u622A\u56FE"
    });
    const start = await withTimeout(sendContentScriptMessage(tabId, {
      type: "START_ACCOUNT_COMMENT_CAPTURE",
      platform: options.platform,
      username: options.username,
      expectedComment: options.expectedComment || ""
    }), 2e4);
    if (!start?.success) throw new Error(start?.error || "\u9875\u9762\u672A\u80FD\u5F00\u59CB\u8BC4\u8BBA\u622A\u56FE");
    await writeClientLog("operation", {
      stage: "comment-evidence",
      action: "capture-session-ready",
      platform: options.platform,
      url: normalizedUrl,
      rootFound: start.rootFound,
      modalFound: start.modalFound,
      candidateCount: start.candidateCount,
      matchingCount: start.matchingCount,
      scrollContainerFound: start.scrollContainerFound,
      message: "\u8BC4\u8BBA\u622A\u56FE\u9875\u9762\u51C6\u5907\u5B8C\u6210"
    });
    const existing = (await getAllCommentEvidence()).filter((snapshot) => snapshot.archiveFormat === "image" && snapshot.platform === options.platform && normalizeArticleUrl(snapshot.url, snapshot.platform) === normalizedUrl && Boolean(snapshot.imageDataUrl));
    const existingByKey = new Map(existing.filter((snapshot) => snapshot.commentKey).map((snapshot) => [snapshot.commentKey, snapshot]));
    const evidenceIds = [];
    let locatedCommentCount = 0;
    let capturedNewCount = 0;
    let reusedCount = 0;
    let failedCount = 0;
    const captureFailureReasons = [];
    let debuggerAttached = false;
    let debuggerUnavailable = "";
    const maxTargets = options.expectedComment ? 1 : 1e3;
    try {
      for (let index = 0; index < maxTargets; index++) {
        const next = await withTimeout(sendContentScriptMessage(tabId, {
          type: "NEXT_ACCOUNT_COMMENT_CAPTURE"
        }), 15e3);
        if (!next?.success) throw new Error(next?.error || "\u9875\u9762\u8BC4\u8BBA\u5B9A\u4F4D\u5931\u8D25");
        if (next.done) {
          await writeClientLog("operation", {
            stage: "comment-evidence",
            action: "comment-locate-finished",
            platform: options.platform,
            url: normalizedUrl,
            candidateCount: next.candidateCount,
            matchingCount: next.matchingCount,
            advanceAttempts: next.advanceAttempts,
            locatedCommentCount,
            message: "\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\u5B9A\u4F4D\u7ED3\u675F"
          });
          break;
        }
        if (!next.target) continue;
        locatedCommentCount++;
        const commentKey = `${COMMENT_SCREENSHOT_FORMAT_VERSION}:${options.platform}:${next.target.commentKey}`;
        const previous = existingByKey.get(commentKey);
        if (previous?.imageDataUrl) {
          evidenceIds.push(previous.id);
          reusedCount++;
          await writeClientLog("operation", {
            stage: "comment-evidence",
            action: "comment-screenshot-reused",
            platform: options.platform,
            url: normalizedUrl,
            targetIndex: locatedCommentCount,
            hasCommentId: Boolean(next.target.commentId),
            message: "\u5DF2\u590D\u7528\u5F53\u524D\u8BC4\u8BBA\u7684\u5386\u53F2\u622A\u56FE"
          });
          continue;
        }
        if (!debuggerAttached) {
          try {
            await attachScreenshotDebugger(tabId);
            debuggerAttached = true;
            await writeClientLog("operation", {
              stage: "comment-evidence",
              action: "screenshot-debugger-attached",
              platform: options.platform,
              url: normalizedUrl,
              message: "\u9875\u9762\u622A\u56FE\u901A\u9053\u5DF2\u5EFA\u7ACB"
            });
          } catch (error2) {
            debuggerUnavailable = `\u65E0\u6CD5\u542F\u52A8\u9875\u9762\u622A\u56FE\uFF1A${String(error2?.message || error2)}`;
            failedCount++;
            await writeClientLog("error", {
              stage: "comment-evidence",
              action: "screenshot-debugger-failed",
              platform: options.platform,
              url: normalizedUrl,
              code: "SCREENSHOT_DEBUGGER_FAILED",
              message: debuggerUnavailable
            });
            break;
          }
        }
        try {
          await settlePageForCommentScreenshot(tabId);
          const imageDataUrl = await captureCommentNodeImage(tabId);
          const evidenceId = `${options.platform}:image:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
          const sha256 = await sha256Hex(imageDataUrl);
          const snapshot = {
            id: evidenceId,
            createdAt: capturedAt,
            platform: options.platform,
            url: normalizedUrl,
            articleId: archiveArticleId(normalizedUrl),
            title: options.title,
            username: options.username,
            comment: next.target.commentText,
            commentId: next.target.commentId,
            platformDisplayedTime: next.target.platformDisplayedTime,
            beforeCommentCount: options.beforeCommentCount,
            afterCommentCount: options.afterCommentCount,
            capturedItemCount: 1,
            targetFoundInDom: true,
            verificationBasis: "page_dom",
            source: options.source,
            archiveFormat: "image",
            imageDataUrl,
            imageMimeType: "image/webp",
            commentKey,
            archiveRunId,
            sha256
          };
          await saveCommentEvidence(snapshot);
          existingByKey.set(commentKey, snapshot);
          evidenceIds.push(evidenceId);
          capturedNewCount++;
          await writeClientLog("operation", {
            stage: "comment-evidence",
            action: "comment-screenshot-saved",
            platform: options.platform,
            url: normalizedUrl,
            targetIndex: locatedCommentCount,
            hasCommentId: Boolean(next.target.commentId),
            imageBytes: Math.round(imageDataUrl.length * 0.75),
            message: "\u5F53\u524D\u8BC4\u8BBA\u622A\u56FE\u5DF2\u751F\u6210\u5E76\u5199\u5165\u5B58\u6863"
          });
        } catch (error2) {
          failedCount++;
          const failureMessage = String(error2?.message || error2).slice(0, 300);
          if (captureFailureReasons.length < 3) {
            captureFailureReasons.push(failureMessage);
          }
          await writeClientLog("error", {
            stage: "comment-evidence",
            action: "comment-screenshot-save-failed",
            platform: options.platform,
            url: normalizedUrl,
            targetIndex: locatedCommentCount,
            code: "COMMENT_SCREENSHOT_SAVE_FAILED",
            message: failureMessage
          });
        }
      }
    } finally {
      await sendContentScriptMessage(tabId, { type: "END_ACCOUNT_COMMENT_CAPTURE" }).catch(() => {
      });
      if (debuggerAttached) await chrome.debugger.detach({ tabId }).catch(() => {
      });
    }
    const uniqueEvidenceIds = [...new Set(evidenceIds)];
    const detectedCommentCount = Math.max(0, options.afterCommentCount, locatedCommentCount);
    const capturedCommentCount = uniqueEvidenceIds.length;
    const missingCount = Math.max(0, detectedCommentCount - capturedCommentCount);
    const noLocatedComment = locatedCommentCount === 0;
    const status = debuggerUnavailable && capturedCommentCount === 0 ? "failed" : !noLocatedComment && missingCount === 0 && failedCount === 0 ? "complete" : "incomplete";
    const failureDetail = captureFailureReasons.length ? `\uFF1B\u622A\u56FE\u9519\u8BEF\uFF1A${captureFailureReasons.join("\uFF1B")}` : "";
    const error = debuggerUnavailable || (noLocatedComment ? `\u68C0\u6D4B\u5230 ${detectedCommentCount} \u6761\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\uFF0C\u4F46\u8BC4\u8BBA\u9762\u677F\u4E2D\u6CA1\u6709\u5B9A\u4F4D\u5230\u5339\u914D\u8282\u70B9\u3002\u8BF7\u68C0\u67E5\u8BE5\u5E73\u53F0\u8D26\u53F7\u8BBE\u7F6E\u662F\u5426\u4E0E\u9875\u9762\u6635\u79F0\u4E00\u81F4\uFF0C\u7136\u540E\u91CD\u65B0\u5B58\u6863\u3002` : status === "incomplete" ? `\u68C0\u6D4B\u5230 ${detectedCommentCount} \u6761\uFF0C\u5DF2\u4FDD\u5B58 ${capturedCommentCount} \u6761\u622A\u56FE\uFF0C\u4ECD\u7F3A\u5C11 ${missingCount} \u6761${failureDetail}` : void 0);
    if (options.updateArchiveRun) {
      await saveArchiveRunSummary({
        id: archiveRunId,
        createdAt: capturedAt,
        platform: options.platform,
        url: normalizedUrl,
        title: options.title,
        username: options.username,
        detectedCommentCount,
        locatedCommentCount,
        capturedCommentCount,
        capturedNewCount,
        reusedCount,
        failedCount,
        missingCount,
        evidenceIds: uniqueEvidenceIds,
        status,
        error
      });
    }
    await writeClientLog(status === "complete" ? "operation" : "error", {
      stage: "comment-evidence",
      action: "capture-session-finished",
      platform: options.platform,
      url: normalizedUrl,
      detectedCommentCount,
      locatedCommentCount,
      capturedCommentCount,
      capturedNewCount,
      reusedCount,
      failedCount,
      missingCount,
      status,
      code: status === "complete" ? void 0 : "COMMENT_SCREENSHOT_INCOMPLETE",
      message: error || "\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\u622A\u56FE\u4EFB\u52A1\u5B8C\u6210"
    });
    return {
      success: true,
      evidenceId: uniqueEvidenceIds[0],
      evidenceIds: uniqueEvidenceIds,
      capturedAt,
      commentCount: detectedCommentCount,
      targetFoundInDom: locatedCommentCount > 0,
      detectedCommentCount,
      locatedCommentCount,
      capturedCommentCount,
      capturedNewCount,
      reusedCount,
      failedCount,
      missingCount,
      status,
      error
    };
  }
  async function handleBatchScan(urls, port, controller) {
    const prepared = classifyArticleUrls(urls);
    const total = prepared.valid.length;
    const resultSlots = new Array(total);
    let nextIndex = 0;
    let completed = 0;
    let nextStartAt = Date.now();
    const concurrency = Math.min(2, total);
    const startIntervalMs = 2500;
    safePost(port, {
      type: "BATCH_PREPARED",
      total,
      duplicateCount: prepared.duplicateCount,
      invalid: prepared.invalid,
      byPlatform: prepared.byPlatform
    });
    async function worker() {
      while (!controller.cancelled) {
        const index = nextIndex++;
        if (index >= total) return;
        const item = prepared.valid[index];
        const now = Date.now();
        const delayMs = Math.max(0, nextStartAt - now);
        nextStartAt = Math.max(now, nextStartAt) + startIntervalMs;
        try {
          await cancellableDelay(delayMs, controller);
        } catch (error) {
          if (error instanceof BatchCancelledError) return;
          throw error;
        }
        if (controller.cancelled) return;
        safePost(port, {
          type: "BATCH_PROGRESS",
          current: index + 1,
          completed,
          total,
          url: item.url,
          platform: item.platform
        });
        const result = await scanUrlInTab(item.url, controller);
        if (!result) return;
        resultSlots[index] = result;
        completed += 1;
        safePost(port, {
          type: "BATCH_ITEM_COMPLETE",
          current: index + 1,
          completed,
          total,
          url: item.url,
          result
        });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const results = resultSlots.filter((item) => item != null);
    safePost(port, controller.cancelled ? { type: "BATCH_CANCELLED", results } : { type: "BATCH_COMPLETE", results });
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "batch-scan") {
      const controller = {
        cancelled: false,
        activeTabIds: /* @__PURE__ */ new Set(),
        cancelHandlers: /* @__PURE__ */ new Set()
      };
      let running = false;
      port.onMessage.addListener(async (msg) => {
        if (msg.type === "BATCH_CANCEL") {
          writeClientLog("operation", { stage: "user-action", action: "batch-scan-cancel", message: "\u7528\u6237\u505C\u6B62\u6279\u91CF\u626B\u63CF" });
          cancelBatchScan(controller);
        } else if (msg.type === "BATCH_SCAN" && !running) {
          writeClientLog("operation", { stage: "user-action", action: "batch-scan-start", count: msg.urls?.length || 0, message: "\u7528\u6237\u5F00\u59CB\u6279\u91CF\u626B\u63CF" });
          running = true;
          await handleBatchScan(msg.urls, port, controller);
          running = false;
          writeClientLog("operation", { stage: "user-action", action: "batch-scan-finish", message: "\u6279\u91CF\u626B\u63CF\u6D41\u7A0B\u7ED3\u675F" });
        }
      });
      port.onDisconnect.addListener(() => cancelBatchScan(controller));
    }
    if (port.name === "supplement-tasks") {
      const controller = {
        cancelled: false,
        activeTabIds: /* @__PURE__ */ new Set(),
        cancelHandlers: /* @__PURE__ */ new Set()
      };
      let running = false;
      port.onMessage.addListener(async (msg) => {
        if (msg.type === "SUPPLEMENT_CANCEL") {
          writeClientLog("operation", { stage: "user-action", action: "supplement-cancel", message: "\u7528\u6237\u505C\u6B62\u667A\u80FD\u8865\u9F50" });
          cancelBatchScan(controller);
          await nativeCommand("SAVE_TASK_STATE", { status: "cancelled", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        } else if (msg.type === "SUPPLEMENT_START" && !running) {
          writeClientLog("operation", { stage: "user-action", action: "supplement-start", count: msg.items?.length || 0, message: "\u7528\u6237\u5F00\u59CB\u667A\u80FD\u8865\u9F50" });
          running = true;
          await handleSupplementTasks(msg.items || [], port, controller);
          running = false;
          writeClientLog("operation", { stage: "user-action", action: "supplement-finish", message: "\u667A\u80FD\u8865\u9F50\u6D41\u7A0B\u7ED3\u675F" });
        }
      });
      port.onDisconnect.addListener(() => cancelBatchScan(controller));
    }
  });
  var COMMENT_HISTORY_KEY = "commentPublishHistory";
  var COMMENT_TEMPLATES_KEY = "manualCommentTemplates";
  var COMMENT_TEMPLATE_INDEX_KEY = "manualCommentTemplateIndex";
  var COMMENT_TEMPLATE_LAST_INDEX_KEY = "manualCommentTemplateLastIndex";
  var COMMENT_MODE_KEY = "commentGenerationMode";
  var COMMENT_TEMPLATE_SELECTION_KEY = "manualTemplateSelection";
  var commentHistoryWriteQueue = Promise.resolve();
  async function nextManualCommentTemplate(selection) {
    const stored = await chrome.storage.local.get([
      COMMENT_TEMPLATES_KEY,
      COMMENT_TEMPLATE_INDEX_KEY,
      COMMENT_TEMPLATE_LAST_INDEX_KEY
    ]);
    const templates = Array.isArray(stored[COMMENT_TEMPLATES_KEY]) ? stored[COMMENT_TEMPLATES_KEY].map((value) => String(value || "").trim()).filter(Boolean).slice(0, 500) : [];
    if (!templates.length) return "";
    let index = 0;
    if (selection === "random") {
      const lastIndex = Number(stored[COMMENT_TEMPLATE_LAST_INDEX_KEY]);
      if (templates.length === 1) index = 0;
      else {
        const safeLastIndex = Number.isInteger(lastIndex) && lastIndex >= 0 && lastIndex < templates.length ? lastIndex : -1;
        const randomOffset = Math.floor(Math.random() * (templates.length - 1)) + 1;
        index = safeLastIndex < 0 ? Math.floor(Math.random() * templates.length) : (safeLastIndex + randomOffset) % templates.length;
      }
      await chrome.storage.local.set({ [COMMENT_TEMPLATE_LAST_INDEX_KEY]: index });
    } else {
      index = Math.max(0, Number(stored[COMMENT_TEMPLATE_INDEX_KEY]) || 0) % templates.length;
      await chrome.storage.local.set({ [COMMENT_TEMPLATE_INDEX_KEY]: (index + 1) % templates.length });
    }
    return templates[index];
  }
  async function generateComment2(message) {
    const preferences = await chrome.storage.local.get([COMMENT_MODE_KEY, COMMENT_TEMPLATE_SELECTION_KEY]);
    const configuredMode = preferences[COMMENT_MODE_KEY];
    const selection = preferences[COMMENT_TEMPLATE_SELECTION_KEY] === "random" ? "random" : "sequential";
    if (configuredMode === "template") {
      const template2 = await nextManualCommentTemplate(selection);
      if (template2) return { success: true, data: { comment: template2, source: "manual-template", selection } };
      return {
        success: false,
        error: "\u5F53\u524D\u9009\u62E9\u7684\u662F\u65E0 Key \u6A21\u677F\u6A21\u5F0F\uFF0C\u8BF7\u5148\u586B\u5199\u5E76\u4FDD\u5B58\u8BC4\u8BBA\u6A21\u677F",
        code: "COMMENT_SOURCE_REQUIRED"
      };
    }
    const config = await nativeCommand("GET_AI_CONFIG");
    const mode = configuredMode === "ai" ? "ai" : config.success && config.data?.hasApiKey ? "ai" : "template";
    if (mode === "ai") {
      if (!config.success || !config.data?.hasApiKey) {
        return { success: false, error: "\u5F53\u524D\u9009\u62E9\u7684\u662F AI \u8BC4\u8BBA\u6A21\u5F0F\uFF0C\u8BF7\u5148\u914D\u7F6E\u5E76\u4FDD\u5B58 API Key", code: "AI_KEY_REQUIRED" };
      }
      const generated = await nativeCommand("GENERATE_COMMENT", {
        platform: message.platform,
        url: normalizeArticleUrl(message.url, message.platform),
        articleText: message.articleText
      });
      if (!generated.success) return generated;
      return { ...generated, data: { ...generated.data, source: "ai" } };
    }
    const template = await nextManualCommentTemplate(selection);
    if (template) return { success: true, data: { comment: template, source: "manual-template", selection } };
    return {
      success: false,
      error: "\u5F53\u524D\u9009\u62E9\u7684\u662F\u65E0 Key \u6A21\u677F\u6A21\u5F0F\uFF0C\u8BF7\u5148\u586B\u5199\u5E76\u4FDD\u5B58\u8BC4\u8BBA\u6A21\u677F",
      code: "COMMENT_SOURCE_REQUIRED"
    };
  }
  function appendCommentHistory(result, actions) {
    if (actions?.comment === false) return Promise.resolve();
    const write = async () => {
      const data = await chrome.storage.local.get(COMMENT_HISTORY_KEY);
      const existing = Array.isArray(data[COMMENT_HISTORY_KEY]) ? data[COMMENT_HISTORY_KEY] : [];
      const time = (/* @__PURE__ */ new Date()).toISOString();
      const verificationStatus = result.commentPosted ? result.afterCommentCount > result.beforeCommentCount ? "verified" : "pending" : result.status === "satisfied" || result.afterCommentCount >= result.targetCommentCount ? "verified" : "failed";
      const historyItem = {
        id: `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${time}:${crypto.randomUUID()}`,
        time,
        platform: result.platform,
        url: normalizeArticleUrl(result.url, result.platform),
        title: result.title,
        username: result.username,
        comment: result.commentText || "",
        verificationStatus,
        failureReason: verificationStatus === "failed" ? result.error || "\u672C\u8F6E\u672A\u80FD\u53D1\u5E03\u8BC4\u8BBA" : void 0,
        errorCode: result.errorCode,
        evidenceId: result.evidenceId,
        evidenceSha256: result.evidenceSha256,
        evidenceCapturedAt: result.evidenceCapturedAt,
        evidenceTargetFound: result.evidenceTargetFound,
        evidenceError: result.evidenceError,
        currentPresence: verificationStatus === "verified" && result.commentPosted ? "present" : void 0,
        lastVerifiedAt: verificationStatus === "verified" && result.commentPosted ? time : void 0,
        lastConfirmedPresentAt: verificationStatus === "verified" && result.commentPosted ? time : void 0,
        lastKnownCommentCount: result.afterCommentCount
      };
      const nextHistory = [historyItem, ...existing.filter((item) => item.id !== historyItem.id)].slice(0, 500);
      await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: nextHistory });
      const confirmed = await chrome.storage.local.get(COMMENT_HISTORY_KEY);
      const confirmedEntries = Array.isArray(confirmed[COMMENT_HISTORY_KEY]) ? confirmed[COMMENT_HISTORY_KEY] : [];
      if (!confirmedEntries.some((item) => item.id === historyItem.id)) {
        await chrome.storage.local.set({
          [COMMENT_HISTORY_KEY]: [historyItem, ...confirmedEntries].slice(0, 500)
        });
      }
      await writeClientLog("operation", {
        stage: "comment-history",
        action: "comment-history-saved",
        platform: result.platform,
        url: result.url,
        historyId: historyItem.id,
        commentPosted: result.commentPosted,
        total: Math.min(500, confirmedEntries.length + (confirmedEntries.some((item) => item.id === historyItem.id) ? 0 : 1)),
        message: "\u672C\u6B21\u8BC4\u8BBA\u4EFB\u52A1\u5DF2\u5199\u5165\u8BC4\u8BBA\u5386\u53F2"
      });
      await pruneCommentEvidence(nextHistory.map((item) => item.evidenceId || "")).catch(() => {
      });
    };
    const pending = commentHistoryWriteQueue.catch(() => {
    }).then(write);
    commentHistoryWriteQueue = pending.catch(() => {
    });
    return pending;
  }
  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function captureAndSaveCommentEvidence(tabId, result) {
    if (result.platform === "netease") {
      await navigateTabAndWait(tabId, neteaseCommentThreadUrl(result.url));
    }
    const capture = await captureAccountCommentImagesInTab(tabId, {
      platform: result.platform,
      url: result.url,
      title: result.title,
      username: result.username,
      beforeCommentCount: result.beforeCommentCount,
      afterCommentCount: result.afterCommentCount,
      expectedComment: result.commentText || "",
      source: "automatic_comment",
      updateArchiveRun: false
    });
    if (!capture.evidenceId) throw new Error(capture.error || "\u672A\u80FD\u5B9A\u4F4D\u5E76\u622A\u53D6\u65B0\u8BC4\u8BBA");
    const snapshot = await getCommentEvidence(capture.evidenceId);
    if (!snapshot) throw new Error("\u65B0\u8BC4\u8BBA\u622A\u56FE\u4FDD\u5B58\u540E\u65E0\u6CD5\u8BFB\u53D6");
    result.evidenceId = snapshot.id;
    result.evidenceSha256 = snapshot.sha256;
    result.evidenceCapturedAt = snapshot.createdAt;
    result.evidenceTargetFound = true;
  }
  function randomDelay(minMs, maxMs) {
    return Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs));
  }
  async function waitForOperationTabLoad(tabId, controller, settleDelay = 1250) {
    const current = await chrome.tabs.get(tabId);
    if (current.status === "complete") {
      await cancellableDelay(settleDelay, controller);
      return;
    }
    await withBatchCancellation(new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);
        resolve();
      };
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") setTimeout(finish, settleDelay);
      };
      const timeoutId = setTimeout(finish, 2e4);
      chrome.tabs.onUpdated.addListener(listener);
    }), controller);
  }
  async function ensureSupplementOperationSurface(surface, url, controller) {
    if (surface.tabId == null || surface.windowId == null) {
      const created = await chrome.windows.create({
        url,
        type: "popup",
        focused: false,
        width: 760,
        height: 860
      });
      if (!created) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u72EC\u7ACB\u64CD\u4F5C\u7A97\u53E3");
      const tab2 = created.tabs?.[0] || (created.id != null ? (await chrome.tabs.query({ windowId: created.id }))[0] : void 0);
      if (created.id == null || tab2?.id == null) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u72EC\u7ACB\u64CD\u4F5C\u7A97\u53E3");
      surface.windowId = created.id;
      surface.tabId = tab2.id;
      surface.currentUrl = url;
      controller.activeTabIds.add(tab2.id);
      await chrome.tabs.update(tab2.id, { active: true, autoDiscardable: false });
      await waitForOperationTabLoad(tab2.id, controller);
      await writeClientLog("operation", {
        stage: "page-action",
        action: "operation-window-created",
        url,
        message: "\u5DF2\u521B\u5EFA\u4E0D\u62A2\u7126\u70B9\u7684\u72EC\u7ACB\u64CD\u4F5C\u7A97\u53E3\uFF0C\u4EFB\u52A1\u9875\u9762\u5C06\u5728\u5176\u4E2D\u6301\u7EED\u8FD0\u884C"
      });
      return { tabId: tab2.id, reused: false };
    }
    const windowState = await chrome.windows.get(surface.windowId).catch(() => null);
    if (!windowState) {
      controller.activeTabIds.delete(surface.tabId);
      surface.windowId = void 0;
      surface.tabId = void 0;
      surface.currentUrl = void 0;
      return ensureSupplementOperationSurface(surface, url, controller);
    }
    if (windowState.state === "minimized") {
      await chrome.windows.update(surface.windowId, { state: "normal", focused: false }).catch(() => {
      });
      await writeClientLog("operation", {
        stage: "page-action",
        action: "operation-window-restored",
        url,
        message: "\u68C0\u6D4B\u5230\u64CD\u4F5C\u7A97\u53E3\u5DF2\u6700\u5C0F\u5316\uFF0C\u5DF2\u6062\u590D\u7A97\u53E3\u4EE5\u7EE7\u7EED\u9875\u9762\u6E32\u67D3"
      });
    }
    const tab = await chrome.tabs.get(surface.tabId).catch(() => null);
    if (!tab) {
      controller.activeTabIds.delete(surface.tabId);
      surface.windowId = void 0;
      surface.tabId = void 0;
      surface.currentUrl = void 0;
      return ensureSupplementOperationSurface(surface, url, controller);
    }
    await chrome.tabs.update(surface.tabId, { active: true, autoDiscardable: false });
    if (surface.currentUrl === url && !tab.discarded) {
      return { tabId: surface.tabId, reused: true };
    }
    surface.currentUrl = url;
    await chrome.tabs.update(surface.tabId, { url, active: true, autoDiscardable: false });
    await waitForOperationTabLoad(surface.tabId, controller);
    return { tabId: surface.tabId, reused: false };
  }
  async function closeSupplementOperationSurface(surface, controller) {
    if (surface.tabId != null) controller.activeTabIds.delete(surface.tabId);
    if (surface.windowId != null) await chrome.windows.remove(surface.windowId).catch(() => {
    });
    else if (surface.tabId != null) await chrome.tabs.remove(surface.tabId).catch(() => {
    });
    surface.windowId = void 0;
    surface.tabId = void 0;
    surface.currentUrl = void 0;
  }
  async function supplementUrlInTab(item, controller, surface, reportProgress) {
    const platform = item.platform || detectPlatform(item.url);
    if (!platform) return null;
    const url = normalizeArticleUrl(item.url, platform);
    let tabId;
    try {
      if (controller.cancelled) throw new BatchCancelledError();
      reportProgress?.("\u6B63\u5728\u51C6\u5907\u72EC\u7ACB\u64CD\u4F5C\u7A97\u53E3", 8, 25);
      const operationPage = await ensureSupplementOperationSurface(surface, url, controller);
      tabId = operationPage.tabId;
      reportProgress?.(
        operationPage.reused ? "\u6B63\u5728\u590D\u7528\u5F53\u524D\u6587\u7AE0\u9875\u9762\uFF0C\u65E0\u9700\u91CD\u65B0\u52A0\u8F7D" : "\u6587\u7AE0\u9875\u5DF2\u6253\u5F00\uFF0C\u7B49\u5F85\u9875\u9762\u63A7\u4EF6\u52A0\u8F7D",
        18,
        operationPage.reused ? 3 : 18
      );
      await cancellableDelay(operationPage.reused ? 150 : platform === "zhihu" ? 600 : 300, controller);
      const actionStatus = item.actions?.comment !== false ? "\u6B63\u5728\u9884\u68C0\u8D26\u53F7\u5E76\u751F\u6210\u8BC4\u8BBA\uFF0C\u968F\u540E\u5C06\u5B8C\u6210\u53D1\u5E03\u9A8C\u8BC1" : item.actions?.like !== false && item.actions?.collect !== false ? "\u6B63\u5728\u68C0\u6D4B\u5E76\u6267\u884C\u70B9\u8D5E\u3001\u6536\u85CF" : item.actions?.like !== false ? "\u6B63\u5728\u68C0\u6D4B\u5E76\u6267\u884C\u70B9\u8D5E" : "\u6B63\u5728\u68C0\u6D4B\u5E76\u6267\u884C\u6536\u85CF";
      reportProgress?.(actionStatus, 42, item.actions?.comment !== false ? 38 : 18);
      const result = await withBatchCancellation(withTimeout(
        chrome.tabs.sendMessage(tabId, {
          type: "SUPPLEMENT_PAGE",
          platform,
          url,
          targetCommentCount: Math.max(0, Math.min(10, Math.floor(item.targetCommentCount))),
          actions: item.actions
        }),
        15e4
      ), controller);
      if (result?.type === "SUPPLEMENT_RESULT" && item.actions?.comment !== false && result.commentPosted && result.afterCommentCount > result.beforeCommentCount && result.commentText) {
        reportProgress?.("\u8BC4\u8BBA\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u65B0\u8BC4\u8BBA\u622A\u56FE", 97, 2);
        try {
          await captureAndSaveCommentEvidence(tabId, result);
          writeClientLog("operation", {
            stage: "comment-evidence",
            action: "evidence-saved",
            platform,
            url,
            evidenceId: result.evidenceId,
            sha256: result.evidenceSha256,
            targetFoundInDom: result.evidenceTargetFound,
            message: "\u65B0\u8BC4\u8BBA\u622A\u56FE\u5DF2\u4FDD\u5B58"
          });
        } catch (error) {
          result.evidenceError = String(error?.message || error);
          writeClientLog("error", {
            stage: "comment-evidence",
            action: "evidence-save-failed",
            platform,
            url,
            code: "COMMENT_EVIDENCE_FAILED",
            message: result.evidenceError
          });
        }
      }
      reportProgress?.("\u9875\u9762\u64CD\u4F5C\u5DF2\u7ED3\u675F\uFF0C\u6B63\u5728\u4FDD\u5B58\u5E76\u66F4\u65B0\u626B\u63CF\u8BB0\u5F55", 99, 1);
      return result?.type === "SUPPLEMENT_RESULT" ? result : null;
    } catch (error) {
      if (error instanceof BatchCancelledError) return null;
      return {
        type: "SUPPLEMENT_RESULT",
        platform,
        url,
        title: "",
        username: "",
        targetCommentCount: item.targetCommentCount,
        beforeCommentCount: 0,
        afterCommentCount: 0,
        commentPosted: false,
        liked: null,
        collected: null,
        accountStatus: "unknown",
        status: "failed",
        error: String(error?.message || error),
        errorCode: "TAB_TASK_FAILED"
      };
    } finally {
    }
  }
  async function handleSupplementTasks(rawItems, port, controller) {
    await nativeCommand("HELLO");
    const normalizedItems = rawItems.map((item) => ({
      ...item,
      platform: item.platform || detectPlatform(item.url) || void 0,
      url: normalizeArticleUrl(item.url, item.platform || detectPlatform(item.url)),
      targetCommentCount: Math.max(0, Math.min(10, Math.floor(Number(item.targetCommentCount) || 0))),
      currentCommentCount: Math.max(0, Math.floor(Number(item.currentCommentCount) || 0)),
      actions: {
        comment: item.actions?.comment !== false,
        like: item.actions?.like !== false,
        collect: item.actions?.collect !== false
      },
      attempt: 0
    })).filter((item) => item.platform);
    const uniqueItems = [...new Map(normalizedItems.map((item) => [`${item.platform}:${item.url}`, item])).values()];
    const queue = uniqueItems.flatMap((item) => {
      if (item.actions.comment === false) return [item];
      const remaining = Math.max(0, item.targetCommentCount - item.currentCommentCount);
      return Array.from({ length: remaining }, (_, attempt) => ({ ...item, attempt: attempt + 1 }));
    });
    const results = [];
    let total = queue.length;
    let completedActions = 0;
    const lastPlatformActionAt = /* @__PURE__ */ new Map();
    let lastGlobalActionAt = 0;
    let riskPaused = false;
    const operationSurface = {};
    await nativeCommand("SAVE_TASK_STATE", {
      status: "running",
      items: queue,
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedActions: 0
    });
    safePost(port, { type: "SUPPLEMENT_PREPARED", total });
    while (queue.length && !controller.cancelled) {
      const item = queue.shift();
      const key = `${item.platform}:${item.url}`;
      const platform = item.platform;
      const isCommentTask = item.actions?.comment !== false;
      const current = completedActions + 1;
      const reportProgress = (status, stagePercent, etaSeconds) => {
        const normalizedStage = Math.max(0, Math.min(99, Math.round(stagePercent)));
        const percent = total > 0 ? Math.min(99, Math.round((completedActions + normalizedStage / 100) / total * 100)) : 0;
        const progress = {
          type: "SUPPLEMENT_PROGRESS",
          completed: completedActions,
          pending: queue.length + 1,
          current,
          total,
          percent,
          stagePercent: normalizedStage,
          etaSeconds,
          url: item.url,
          platform,
          status
        };
        safePost(port, progress);
        return progress;
      };
      const now = Date.now();
      const commentGap = randomDelay(1500, 4001);
      const platformGap = isCommentTask ? commentGap : randomDelay(12e3, 22e3);
      const globalGap = isCommentTask ? commentGap : randomDelay(7e3, 13e3);
      const cooldownDelay = Math.max(
        0,
        (lastPlatformActionAt.get(platform) || 0) + platformGap - now,
        lastGlobalActionAt + globalGap - now
      );
      if (cooldownDelay > 0) {
        const cooldownEndsAt = Date.now() + cooldownDelay;
        while (!controller.cancelled) {
          const remaining = cooldownEndsAt - Date.now();
          if (remaining <= 0) break;
          const progress = reportProgress(isCommentTask ? "\u968F\u673A\u95F4\u9694\u4E2D\uFF0C\u53EF\u968F\u65F6\u505C\u6B62" : "\u5B89\u5168\u51B7\u5374\u4E2D\uFF0C\u4EFB\u52A1\u4ECD\u5728\u8FD0\u884C", 0, Math.ceil(remaining / 1e3));
          await nativeCommand("SAVE_TASK_STATE", {
            status: "running",
            progress,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            completedActions
          });
          await cancellableDelay(Math.min(5e3, remaining), controller).catch(() => {
          });
        }
      }
      if (controller.cancelled) break;
      reportProgress("\u6B63\u5728\u6253\u5F00\u6587\u7AE0\u5E76\u6267\u884C\u5B89\u5168\u9884\u68C0", 5, isCommentTask ? 45 : 22);
      const result = await supplementUrlInTab(item, controller, operationSurface, reportProgress);
      if (!result) break;
      const finishedAt = Date.now();
      lastPlatformActionAt.set(platform, finishedAt);
      lastGlobalActionAt = finishedAt;
      results.push(result);
      completedActions++;
      result.requestedActions = item.actions;
      const storedResults = await chrome.storage.local.get("lastSupplementResults");
      const previousResults = Array.isArray(storedResults.lastSupplementResults) ? storedResults.lastSupplementResults : [];
      const resultKey = `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${item.actions.comment ? "comment" : item.actions.like ? "like" : "collect"}`;
      const nextResults = previousResults.filter((previous) => {
        const previousKey = `${previous.platform}:${normalizeArticleUrl(previous.url, previous.platform)}:${previous.requestedActions?.comment ? "comment" : previous.requestedActions?.like ? "like" : "collect"}`;
        return previousKey !== resultKey;
      });
      nextResults.push(result);
      await chrome.storage.local.set({ lastSupplementResults: nextResults.slice(-200) });
      await appendCommentHistory(result, item.actions);
      const updatedRecord = {
        platform: result.platform,
        url: result.url,
        title: result.title,
        commentCount: result.afterCommentCount,
        checkTime: (/* @__PURE__ */ new Date()).toISOString(),
        username: result.username,
        linkStatus: result.errorCode === "PAGE_INVALID" ? "invalid" : "active",
        targetCommentCount: result.targetCommentCount,
        actionStatus: result.status,
        lastActionTime: (/* @__PURE__ */ new Date()).toISOString(),
        lastErrorCode: result.errorCode
      };
      if (typeof result.liked === "boolean") updatedRecord.liked = result.liked;
      if (typeof result.collected === "boolean") updatedRecord.collected = result.collected;
      await saveRecord(updatedRecord);
      const logEntry = {
        taskId: key,
        platform: result.platform,
        url: result.url,
        username: result.username,
        stage: "supplement",
        targetCommentCount: result.targetCommentCount,
        beforeCommentCount: result.beforeCommentCount,
        afterCommentCount: result.afterCommentCount,
        commentPosted: result.commentPosted,
        likePerformed: result.likePerformed,
        collectPerformed: result.collectPerformed,
        liked: result.liked,
        collected: result.collected,
        status: result.status,
        code: result.errorCode,
        message: result.error || "\u672C\u8F6E\u64CD\u4F5C\u5B8C\u6210"
      };
      writeClientLog(result.error ? "error" : "operation", logEntry);
      if (result.errorCode === "AUTH_REQUIRED" || result.errorCode === "ACCOUNT_MISMATCH") {
        notifyAttention("\u667A\u80FD\u8865\u9F50\u5DF2\u6682\u505C", `${PlatformLabelSafe(result.platform)}\uFF1A${result.error}`);
      }
      if (result.errorCode === "RISK_CONTROL_BLOCKED") {
        riskPaused = true;
        queue.splice(0);
        notifyAttention("\u68C0\u6D4B\u5230\u5E73\u53F0\u98CE\u63A7\uFF0C\u4EFB\u52A1\u5DF2\u6682\u505C", `${PlatformLabelSafe(result.platform)}\uFF1A${result.error}`);
        safePost(port, { type: "SUPPLEMENT_RISK_PAUSED", result });
      }
      if (isCommentTask && !riskPaused) {
        const commentConfirmed = result.commentPosted && result.afterCommentCount > result.beforeCommentCount && !result.errorCode;
        const targetReached = result.afterCommentCount >= item.targetCommentCount;
        if (!commentConfirmed || targetReached) {
          const queueLengthBefore = queue.length;
          for (let index = queue.length - 1; index >= 0; index--) {
            const queued = queue[index];
            if (queued.platform === item.platform && queued.url === item.url && queued.actions?.comment !== false) {
              queue.splice(index, 1);
            }
          }
          total -= queueLengthBefore - queue.length;
        }
      }
      safePost(port, {
        type: "SUPPLEMENT_ITEM_COMPLETE",
        completed: completedActions,
        current: completedActions,
        total,
        percent: total > 0 ? Math.round(completedActions / total * 100) : 100,
        result
      });
      await nativeCommand("SAVE_TASK_STATE", {
        status: "running",
        pending: queue,
        latestResult: result,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        completedActions
      });
      if (riskPaused) break;
    }
    const finalStatus = controller.cancelled ? "cancelled" : riskPaused ? "attention_required" : "complete";
    await closeSupplementOperationSurface(operationSurface, controller);
    await nativeCommand("SAVE_TASK_STATE", {
      status: finalStatus,
      results,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      completedActions
    });
    safePost(port, { type: controller.cancelled ? "SUPPLEMENT_CANCELLED" : "SUPPLEMENT_COMPLETE", results });
  }
  function PlatformLabelSafe(platform) {
    const labels = {
      csdn: "CSDN",
      zhihu: "\u77E5\u4E4E",
      toutiao: "\u4ECA\u65E5\u5934\u6761",
      baijiahao: "\u767E\u5BB6\u53F7",
      netease: "\u7F51\u6613",
      sohu: "\u641C\u72D0",
      third_party: "\u7B2C\u4E09\u65B9\u5E73\u53F0"
    };
    return labels[platform];
  }
  function validViewportPoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y) && point.x >= 0 && point.y >= 0 && point.x <= 1e4 && point.y <= 1e4;
  }
  async function sendDebuggerCommand(target, method, params) {
    return await chrome.debugger.sendCommand(target, method, params);
  }
  async function enableTrustedPageInteraction(target) {
    await sendDebuggerCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {
    });
    await sendDebuggerCommand(target, "Page.setWebLifecycleState", { state: "active" }).catch(() => {
    });
  }
  function pointInsideToutiaoViewport(point, snapshot) {
    return Boolean(point && validViewportPoint(point) && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight);
  }
  async function readToutiaoControls(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="\u8BC4\u8BBA"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttonRoot = mainInput || root;
      const buttons = Array.from(buttonRoot.querySelectorAll('button.submit-btn, button')).filter(isVisible);
      const button = buttons.find(item => /^(\u8BC4\u8BBA|\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').trim())) || buttons[0];
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      const buttonClass = button instanceof HTMLElement ? String(button.className || '') : '';
      return {
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorLength: editor ? (editor.textContent || '').trim().length : 0,
        buttonDisabled: button instanceof HTMLButtonElement
          ? button.disabled || /(^|\\s)disable(?:d)?(\\s|$)/i.test(buttonClass) || button.getAttribute('aria-disabled') === 'true'
          : true,
        buttonClass,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u8BFB\u53D6\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u63A7\u4EF6\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value || {
      editorLength: 0,
      buttonDisabled: true,
      buttonClass: "",
      viewportWidth: 0,
      viewportHeight: 0
    };
  }
  async function prepareToutiaoEditor(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      // 与 Playwright locator.fill() 对 contenteditable 的准备步骤一致：先 focus，
      // 再选中编辑器全部内容，随后由浏览器 Input.insertText 写入。
      expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="\u8BC4\u8BBA"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      if (!(editor instanceof HTMLElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      const selection = editor.ownerDocument.defaultView.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return editor.ownerDocument.activeElement === editor;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u51C6\u5907\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function scrollToutiaoSubmitButtonIntoView(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="\u8BC4\u8BBA"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttons = mainInput ? Array.from(mainInput.querySelectorAll('button.submit-btn, button')).filter(isVisible) : [];
      const button = buttons.find(item => /^(\u8BC4\u8BBA|\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').trim())) || buttons[0];
      if (!(button instanceof HTMLButtonElement)) return false;
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return true;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u6EDA\u52A8\u5230\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function typeTrustedCommentByKey(target, comment) {
    for (const character of Array.from(comment)) {
      await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: character,
        text: character,
        unmodifiedText: character
      });
      await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: character
      });
      await new Promise((resolve) => setTimeout(resolve, 24 + Math.floor(Math.random() * 28)));
    }
  }
  async function nudgeControlledInput(target) {
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
      unmodifiedText: "a",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65
    });
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8
    });
    await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8
    });
  }
  async function operateToutiaoSubmitButton(target, operation) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="\u8BC4\u8BBA"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttons = mainInput ? Array.from(mainInput.querySelectorAll('button.submit-btn, button')).filter(isVisible) : [];
      const button = buttons.find(item => /^(\u8BC4\u8BBA|\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').trim())) || buttons[0];
      if (!(button instanceof HTMLButtonElement)) return false;
      ${operation === "click" ? "button.click();" : "button.focus();"}
      return true;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u64CD\u4F5C\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function dispatchTrustedClick(target, point) {
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y
    });
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    await sendDebuggerCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
  }
  async function trustedToutiaoComment(tabId, text) {
    const comment = String(text || "").trim();
    if (!comment || comment.length > 500) return { success: false, error: "\u8BC4\u8BBA\u5185\u5BB9\u4E3A\u7A7A\u6216\u8D85\u8FC7 500 \u5B57" };
    const tab = await chrome.tabs.get(tabId);
    let pageUrl;
    try {
      pageUrl = new URL(tab.url || "");
    } catch {
      return { success: false, error: "\u65E0\u6CD5\u786E\u8BA4\u4ECA\u65E5\u5934\u6761\u9875\u9762\u5730\u5740" };
    }
    if (!/(^|\.)toutiao\.com$/i.test(pageUrl.hostname) || !/\/(?:article|item)\//.test(pageUrl.pathname)) {
      return { success: false, error: "\u53D7\u4FE1\u4EFB\u8F93\u5165\u53EA\u5141\u8BB8\u7528\u4E8E\u4ECA\u65E5\u5934\u6761\u6587\u7AE0\u9875" };
    }
    const target = { tabId };
    try {
      await chrome.debugger.attach(target, "1.3");
      await enableTrustedPageInteraction(target);
      let initial;
      for (let attempt = 0; attempt < 40; attempt++) {
        await prepareToutiaoEditor(target);
        await new Promise((resolve) => setTimeout(resolve, attempt < 4 ? 180 : 300));
        initial = await readToutiaoControls(target);
        if (pointInsideToutiaoViewport(initial.editorPoint, initial)) break;
      }
      if (!initial || !pointInsideToutiaoViewport(initial.editorPoint, initial)) {
        await writeClientLog("error", {
          stage: "page-action",
          action: "toutiao-editor-not-found",
          platform: "toutiao",
          url: pageUrl.toString(),
          code: "TOUTIAO_EDITOR_NOT_FOUND",
          viewportWidth: initial?.viewportWidth,
          viewportHeight: initial?.viewportHeight,
          message: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846\u672A\u8FDB\u5165\u5F53\u524D\u64CD\u4F5C\u89C6\u53E3"
        });
        return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846\u672A\u8FDB\u5165\u5F53\u524D\u64CD\u4F5C\u89C6\u53E3" };
      }
      await dispatchTrustedClick(target, initial.editorPoint);
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!await prepareToutiaoEditor(target)) {
        return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846\u65E0\u6CD5\u83B7\u5F97\u7126\u70B9" };
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      await sendDebuggerCommand(target, "Input.insertText", { text: comment });
      await new Promise((resolve) => setTimeout(resolve, 800));
      let ready = await readToutiaoControls(target);
      if (ready.editorLength === 0) {
        if (!await prepareToutiaoEditor(target)) {
          return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846\u5728\u91CD\u8BD5\u65F6\u5931\u53BB\u7126\u70B9" };
        }
        await typeTrustedCommentByKey(target, comment);
        await new Promise((resolve) => setTimeout(resolve, 650));
        ready = await readToutiaoControls(target);
        if (ready.editorLength === 0) {
          return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u672A\u63A5\u6536\u5230\u8BC4\u8BBA\u6587\u5B57\uFF08\u5DF2\u5C1D\u8BD5 Playwright fill \u8F93\u5165\u94FE\u8DEF\uFF09" };
        }
      }
      if (ready.buttonDisabled) {
        const lengthBeforeNudge = ready.editorLength;
        await nudgeControlledInput(target);
        await new Promise((resolve) => setTimeout(resolve, 350));
        ready = await readToutiaoControls(target);
        if (ready.editorLength !== lengthBeforeNudge) {
          return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u8F93\u5165\u72B6\u6001\u540C\u6B65\u540E\u8BC4\u8BBA\u5185\u5BB9\u957F\u5EA6\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u53D1\u5E03" };
        }
      }
      if (ready.buttonDisabled) {
        return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u5DF2\u663E\u793A\u8BC4\u8BBA\u6587\u5B57\uFF0C\u4F46\u8BC4\u8BBA\u6309\u94AE\u4ECD\u672A\u542F\u7528" };
      }
      if (!await scrollToutiaoSubmitButtonIntoView(target)) {
        return { success: false, error: "\u627E\u4E0D\u5230\u5F53\u524D\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE" };
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      ready = await readToutiaoControls(target);
      if (!pointInsideToutiaoViewport(ready.buttonPoint, ready)) {
        return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE\u4ECD\u5728\u5F53\u524D\u89C6\u53E3\u4E4B\u5916\uFF0C\u5DF2\u505C\u6B62\u53D1\u5E03" };
      }
      await writeClientLog("operation", {
        stage: "page-action",
        action: "toutiao-comment-ready",
        platform: "toutiao",
        url: pageUrl.toString(),
        commentLength: comment.length,
        message: "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6587\u5B57\u5DF2\u8F93\u5165\uFF0C\u8BC4\u8BBA\u6309\u94AE\u5DF2\u542F\u7528"
      });
      await dispatchTrustedClick(target, ready.buttonPoint);
      await writeClientLog("operation", {
        stage: "page-action",
        action: "toutiao-submit-clicked",
        platform: "toutiao",
        url: pageUrl.toString(),
        message: "\u5DF2\u70B9\u51FB\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE\uFF0C\u7B49\u5F85\u9875\u9762\u786E\u8BA4"
      });
      let afterClick = ready;
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        afterClick = await readToutiaoControls(target);
        if (afterClick.editorLength === 0) {
          await writeClientLog("operation", {
            stage: "page-action",
            action: "toutiao-submit-confirmed",
            platform: "toutiao",
            url: pageUrl.toString(),
            message: "\u4ECA\u65E5\u5934\u6761\u9875\u9762\u5DF2\u6E05\u7A7A\u8F93\u5165\u6846\uFF0C\u63D0\u4EA4\u52A8\u4F5C\u5DF2\u786E\u8BA4"
          });
          return { success: true };
        }
      }
      if (afterClick.buttonDisabled) {
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if ((await readToutiaoControls(target)).editorLength === 0) return { success: true };
        }
        return { success: false, error: "\u4ECA\u65E5\u5934\u6761\u5DF2\u8FDB\u5165\u63D0\u4EA4\u72B6\u6001\uFF0C\u4F46\u9875\u9762\u957F\u65F6\u95F4\u672A\u8FD4\u56DE\u7ED3\u679C" };
      }
      await writeClientLog("operation", {
        stage: "page-action",
        action: "toutiao-submit-native-fallback",
        platform: "toutiao",
        url: pageUrl.toString(),
        message: "\u9F20\u6807\u70B9\u51FB\u672A\u89E6\u53D1\u63D0\u4EA4\uFF0C\u6539\u7528\u5F53\u524D\u8BC4\u8BBA\u6309\u94AE\u5904\u7406\u5668"
      });
      if (await operateToutiaoSubmitButton(target, "click")) {
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          afterClick = await readToutiaoControls(target);
          if (afterClick.editorLength === 0) return { success: true };
        }
      }
      if (!afterClick.buttonDisabled && await operateToutiaoSubmitButton(target, "focus")) {
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if ((await readToutiaoControls(target)).editorLength === 0) return { success: true };
        }
      }
      return { success: false, error: "\u5DF2\u70B9\u51FB\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE\uFF0C\u4F46\u9875\u9762\u672A\u786E\u8BA4\u63D0\u4EA4\uFF08\u8F93\u5165\u6846\u672A\u6E05\u7A7A\uFF09" };
    } catch (error) {
      return { success: false, error: `\u4ECA\u65E5\u5934\u6761\u53D7\u4FE1\u4EFB\u8F93\u5165\u5931\u8D25\uFF1A${String(error?.message || error)}` };
    } finally {
      await chrome.debugger.detach(target).catch(() => {
      });
    }
  }
  function pointInsideZhihuViewport(point, snapshot) {
    return Boolean(point && validViewportPoint(point) && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight);
  }
  async function readZhihuCommentOpener(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const candidates = Array.from(document.querySelectorAll('button.BottomActions-CommentBtn, [data-za-detail-view-element_name="Comment"], button[aria-label*="\u8BC4\u8BBA"], button')).filter(rendered);
      const opener = candidates.find(item => /\u8BC4\u8BBA/.test((item.textContent || item.getAttribute('aria-label') || '').trim())) || candidates[0];
      if (!(opener instanceof HTMLElement)) {
        return { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      }
      opener.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = opener.getBoundingClientRect();
      return {
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u8BFB\u53D6\u77E5\u4E4E\u8BC4\u8BBA\u5165\u53E3\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value || { viewportWidth: 0, viewportHeight: 0 };
  }
  async function readZhihuEditor(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const inViewport = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0
          && rect.left < window.innerWidth && rect.top < window.innerHeight;
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      const visibleEditors = editors.filter(inViewport);
      const editor = (visibleEditors.length ? visibleEditors : editors).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return Math.abs(leftRect.top + leftRect.height / 2 - window.innerHeight / 2)
          - Math.abs(rightRect.top + rightRect.height / 2 - window.innerHeight / 2);
      })[0];
      if (editor && !inViewport(editor)) {
        editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const rect = editor?.getBoundingClientRect();
      return {
        point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
        renderedCount: editors.length,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u8BFB\u53D6\u77E5\u4E4E\u8BC4\u8BBA\u8F93\u5165\u6846\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value || {
      renderedCount: 0,
      viewportWidth: 0,
      viewportHeight: 0
    };
  }
  async function readZhihuControls(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const findContext = () => {
        const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
        for (const editor of editors) {
          let scope = editor.parentElement;
          for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
            const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
            if (button) return { editor, button };
          }
        }
        return {};
      };
      const { editor, button } = findContext();
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorLength: editor ? (editor.textContent || '').trim().length : 0,
        buttonDisabled: button instanceof HTMLButtonElement
          ? button.disabled || button.getAttribute('aria-disabled') === 'true'
          : true,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u8BFB\u53D6\u77E5\u4E4E\u8BC4\u8BBA\u63A7\u4EF6\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value || {
      editorLength: 0,
      buttonDisabled: true,
      viewportWidth: 0,
      viewportHeight: 0
    };
  }
  async function prepareZhihuEditor(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      let editor;
      for (const candidate of editors) {
        let scope = candidate.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button) { editor = candidate; break; }
        }
        if (editor) break;
      }
      if (!(editor instanceof HTMLElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      const selection = editor.ownerDocument.defaultView.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return editor.ownerDocument.activeElement === editor;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u51C6\u5907\u77E5\u4E4E\u8BC4\u8BBA\u8F93\u5165\u6846\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function scrollZhihuSubmitButtonIntoView(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      for (const editor of editors) {
        let scope = editor.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button instanceof HTMLButtonElement) {
            button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            return true;
          }
        }
      }
      return false;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u6EDA\u52A8\u5230\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function operateZhihuSubmitButton(target, operation) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      for (const editor of editors) {
        let scope = editor.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(\u53D1\u5E03|\u53D1\u8868|\u53D1\u9001)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button instanceof HTMLButtonElement) {
            ${operation === "click" ? "button.click();" : "button.focus();"}
            return true;
          }
        }
      }
      return false;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u64CD\u4F5C\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function hasZhihuPublishedComment(target, comment) {
    const expected = JSON.stringify(comment.trim());
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => Array.from(document.querySelectorAll('.CommentContent'))
      .some(element => (element.textContent || '').replace(/\\s+/g, ' ').trim() === ${expected}))()`,
      returnByValue: true
    });
    if (response.exceptionDetails) return false;
    return response.result?.value === true;
  }
  async function trustedZhihuComment(tabId, text) {
    const comment = String(text || "").trim();
    if (!comment || comment.length > 1e3) return { success: false, error: "\u8BC4\u8BBA\u5185\u5BB9\u4E3A\u7A7A\u6216\u8D85\u8FC7 1000 \u5B57" };
    const tab = await chrome.tabs.get(tabId);
    let pageUrl;
    try {
      pageUrl = new URL(tab.url || "");
    } catch {
      return { success: false, error: "\u65E0\u6CD5\u786E\u8BA4\u77E5\u4E4E\u9875\u9762\u5730\u5740" };
    }
    const supportedHost = /(^|\.)zhihu\.com$/i.test(pageUrl.hostname);
    const supportedPath = /\/p\/\d+/.test(pageUrl.pathname) || /\/answer\/\d+/.test(pageUrl.pathname);
    if (!supportedHost || !supportedPath) {
      return { success: false, error: "\u53D7\u4FE1\u4EFB\u8F93\u5165\u53EA\u5141\u8BB8\u7528\u4E8E\u77E5\u4E4E\u6587\u7AE0\u6216\u56DE\u7B54\u9875\u9762" };
    }
    const target = { tabId };
    try {
      await chrome.debugger.attach(target, "1.3");
      await enableTrustedPageInteraction(target);
      let editorReady = await prepareZhihuEditor(target);
      if (!editorReady) {
        let editorSnapshot = {
          renderedCount: 0,
          viewportWidth: 0,
          viewportHeight: 0
        };
        for (let attempt = 0; attempt < 20; attempt++) {
          editorSnapshot = await readZhihuEditor(target);
          if (pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) {
          let opener = { viewportWidth: 0, viewportHeight: 0 };
          for (let attempt = 0; attempt < 32; attempt++) {
            opener = await readZhihuCommentOpener(target);
            if (pointInsideZhihuViewport(opener.point, opener)) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!pointInsideZhihuViewport(opener.point, opener)) {
            await writeClientLog("error", {
              stage: "page-action",
              action: "zhihu-comment-controls-not-found",
              platform: "zhihu",
              url: pageUrl.toString(),
              code: "ZHIHU_COMMENT_CONTROLS_NOT_FOUND",
              renderedEditorCount: editorSnapshot.renderedCount,
              message: "\u77E5\u4E4E\u9875\u9762\u65E2\u672A\u627E\u5230\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846\uFF0C\u4E5F\u672A\u627E\u5230\u8BC4\u8BBA\u5165\u53E3"
            });
            return { success: false, error: "\u77E5\u4E4E\u9875\u9762\u672A\u627E\u5230\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846\u6216\u8BC4\u8BBA\u5165\u53E3" };
          }
          await dispatchTrustedClick(target, opener.point);
          await writeClientLog("operation", {
            stage: "page-action",
            action: "zhihu-comment-opened",
            platform: "zhihu",
            url: pageUrl.toString(),
            message: "\u5DF2\u70B9\u51FB\u77E5\u4E4E\u8BC4\u8BBA\u5165\u53E3\uFF0C\u7B49\u5F85 Draft.js \u7F16\u8F91\u5668\u6302\u8F7D"
          });
          for (let attempt = 0; attempt < 24; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            editorSnapshot = await readZhihuEditor(target);
            if (pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) break;
          }
        }
        if (!pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) {
          return {
            success: false,
            error: editorSnapshot.renderedCount > 0 ? "\u77E5\u4E4E\u8BC4\u8BBA\u8F93\u5165\u6846\u5DF2\u51FA\u73B0\uFF0C\u4F46\u4E0D\u5728\u5F53\u524D\u53EF\u64CD\u4F5C\u89C6\u53E3\u5185" : "\u70B9\u51FB\u77E5\u4E4E\u8BC4\u8BBA\u5165\u53E3\u540E\uFF0C\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846\u672A\u6302\u8F7D"
          };
        }
        await dispatchTrustedClick(target, editorSnapshot.point);
        await writeClientLog("operation", {
          stage: "page-action",
          action: "zhihu-editor-clicked",
          platform: "zhihu",
          url: pageUrl.toString(),
          message: "\u5DF2\u70B9\u51FB\u77E5\u4E4E\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846\uFF0C\u7B49\u5F85\u53D1\u5E03\u6309\u94AE\u6302\u8F7D"
        });
        for (let attempt = 0; attempt < 24; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          editorReady = await prepareZhihuEditor(target);
          if (editorReady) break;
        }
      }
      if (!editorReady) {
        return { success: false, error: "\u70B9\u51FB\u77E5\u4E4E\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846\u540E\uFF0C\u53D1\u5E03\u6309\u94AE\u4ECD\u672A\u6302\u8F7D" };
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      let initial = await readZhihuControls(target);
      if (!pointInsideZhihuViewport(initial.editorPoint, initial)) {
        return { success: false, error: "\u627E\u4E0D\u5230\u5F53\u524D\u77E5\u4E4E\u4E3B\u8BC4\u8BBA\u8F93\u5165\u6846" };
      }
      await dispatchTrustedClick(target, initial.editorPoint);
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!await prepareZhihuEditor(target)) {
        return { success: false, error: "\u77E5\u4E4E\u8BC4\u8BBA\u8F93\u5165\u6846\u65E0\u6CD5\u83B7\u5F97\u7126\u70B9" };
      }
      await sendDebuggerCommand(target, "Input.insertText", { text: comment });
      await new Promise((resolve) => setTimeout(resolve, 700));
      let ready = await readZhihuControls(target);
      if (ready.editorLength === 0) {
        if (!await prepareZhihuEditor(target)) {
          return { success: false, error: "\u77E5\u4E4E\u8BC4\u8BBA\u8F93\u5165\u6846\u5728\u91CD\u8BD5\u65F6\u5931\u53BB\u7126\u70B9" };
        }
        await typeTrustedCommentByKey(target, comment);
        await new Promise((resolve) => setTimeout(resolve, 600));
        ready = await readZhihuControls(target);
      }
      if (ready.editorLength === 0) {
        return { success: false, error: "\u77E5\u4E4E Draft.js \u7F16\u8F91\u5668\u672A\u63A5\u6536\u5230\u8BC4\u8BBA\u6587\u5B57" };
      }
      if (ready.buttonDisabled) {
        const lengthBeforeNudge = ready.editorLength;
        await nudgeControlledInput(target);
        await new Promise((resolve) => setTimeout(resolve, 350));
        ready = await readZhihuControls(target);
        if (ready.editorLength !== lengthBeforeNudge) {
          return { success: false, error: "\u77E5\u4E4E\u8F93\u5165\u72B6\u6001\u540C\u6B65\u540E\u8BC4\u8BBA\u5185\u5BB9\u957F\u5EA6\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u53D1\u5E03" };
        }
      }
      if (ready.buttonDisabled) {
        return { success: false, error: "\u77E5\u4E4E\u5DF2\u663E\u793A\u8BC4\u8BBA\u6587\u5B57\uFF0C\u4F46\u53D1\u5E03\u6309\u94AE\u4ECD\u672A\u542F\u7528" };
      }
      if (!await scrollZhihuSubmitButtonIntoView(target)) {
        return { success: false, error: "\u627E\u4E0D\u5230\u5F53\u524D\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE" };
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
      ready = await readZhihuControls(target);
      if (!pointInsideZhihuViewport(ready.buttonPoint, ready)) {
        return { success: false, error: "\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE\u4ECD\u5728\u5F53\u524D\u89C6\u53E3\u4E4B\u5916\uFF0C\u5DF2\u505C\u6B62\u53D1\u5E03" };
      }
      await writeClientLog("operation", {
        stage: "page-action",
        action: "zhihu-comment-ready",
        platform: "zhihu",
        url: pageUrl.toString(),
        commentLength: comment.length,
        message: "\u77E5\u4E4E\u8BC4\u8BBA\u6587\u5B57\u5DF2\u8F93\u5165\uFF0C\u53D1\u5E03\u6309\u94AE\u5DF2\u542F\u7528"
      });
      await dispatchTrustedClick(target, ready.buttonPoint);
      await writeClientLog("operation", {
        stage: "page-action",
        action: "zhihu-submit-clicked",
        platform: "zhihu",
        url: pageUrl.toString(),
        message: "\u5DF2\u70B9\u51FB\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE\uFF0C\u7B49\u5F85\u9875\u9762\u786E\u8BA4"
      });
      let afterClick = ready;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        afterClick = await readZhihuControls(target);
        if (afterClick.editorLength === 0 || await hasZhihuPublishedComment(target, comment)) {
          await writeClientLog("operation", {
            stage: "page-action",
            action: "zhihu-submit-confirmed",
            platform: "zhihu",
            url: pageUrl.toString(),
            message: "\u77E5\u4E4E\u9875\u9762\u5DF2\u786E\u8BA4\u65B0\u8BC4\u8BBA"
          });
          return { success: true };
        }
      }
      if (!afterClick.buttonDisabled && await operateZhihuSubmitButton(target, "click")) {
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          afterClick = await readZhihuControls(target);
          if (afterClick.editorLength === 0 || await hasZhihuPublishedComment(target, comment)) return { success: true };
        }
      }
      if (!afterClick.buttonDisabled && await operateZhihuSubmitButton(target, "focus")) {
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 13
        });
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if ((await readZhihuControls(target)).editorLength === 0 || await hasZhihuPublishedComment(target, comment)) return { success: true };
        }
      }
      return { success: false, error: "\u5DF2\u70B9\u51FB\u77E5\u4E4E\u53D1\u5E03\u6309\u94AE\uFF0C\u4F46\u9875\u9762\u672A\u786E\u8BA4\u65B0\u8BC4\u8BBA" };
    } catch (error) {
      return { success: false, error: `\u77E5\u4E4E\u53D7\u4FE1\u4EFB\u8F93\u5165\u5931\u8D25\uFF1A${String(error?.message || error)}` };
    } finally {
      await chrome.debugger.detach(target).catch(() => {
      });
    }
  }
  function normalizeTrustedInputValue(value) {
    return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\r\n/g, "\n").trim();
  }
  function pointInsideBaijiahaoViewport(point, snapshot) {
    return Boolean(point && validViewportPoint(point) && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight);
  }
  async function readBaijiahaoControls(target, scrollTarget = "none") {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const opener = Array.from(document.querySelectorAll('[data-testid="comment-btn"]')).find(rendered);
      const editor = Array.from(document.querySelectorAll('textarea[placeholder="\u53D1\u8868\u795E\u8BC4\u5999\u8BBA"], textarea.text-area')).find(rendered);
      if (${JSON.stringify(scrollTarget)} === 'opener' && opener) {
        opener.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      if (${JSON.stringify(scrollTarget)} === 'editor' && editor) {
        editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const scope = editor?.closest('.x-interact-publish, .x-interact-publish-content, .xcp-publish-main') || document;
      const button = Array.from(scope.querySelectorAll('span.send')).find(rendered)
        || Array.from(document.querySelectorAll('span.send')).find(rendered);
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      const buttonClass = button instanceof HTMLElement ? String(button.className || '') : '';
      const buttonStyle = button instanceof HTMLElement ? getComputedStyle(button) : undefined;
      return {
        openerPoint: point(opener),
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorValue: editor instanceof HTMLTextAreaElement ? editor.value : '',
        buttonDisabled: !(button instanceof HTMLElement)
          || /(^|\\s)disabled?(\\s|$)/i.test(buttonClass)
          || Number(buttonStyle?.opacity || 1) < 0.5
          || button.getAttribute('aria-disabled') === 'true',
        buttonClass,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u8BFB\u53D6\u767E\u5BB6\u53F7\u8BC4\u8BBA\u63A7\u4EF6\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value || {
      editorValue: "",
      buttonDisabled: true,
      buttonClass: "",
      viewportWidth: 0,
      viewportHeight: 0
    };
  }
  async function hasBaijiahaoPublishedComment(target, comment) {
    const expected = JSON.stringify(comment.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, "").trim());
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => Array.from(document.querySelectorAll('.xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text'))
      .some(element => (element.textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, '').trim() === ${expected}))()`,
      returnByValue: true
    });
    if (response.exceptionDetails) return false;
    return response.result?.value === true;
  }
  async function prepareBaijiahaoEditor(target) {
    const response = await sendDebuggerCommand(target, "Runtime.evaluate", {
      expression: `(() => {
      const editor = Array.from(document.querySelectorAll('textarea[placeholder="\u53D1\u8868\u795E\u8BC4\u5999\u8BBA"], textarea.text-area'))
        .find(element => {
          if (!(element instanceof HTMLTextAreaElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
      if (!(editor instanceof HTMLTextAreaElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      editor.setSelectionRange(0, editor.value.length);
      return editor.ownerDocument.activeElement === editor;
    })()`,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(`\u51C6\u5907\u767E\u5BB6\u53F7\u8BC4\u8BBA\u8F93\u5165\u6846\u5931\u8D25\uFF1A${response.exceptionDetails.text || "\u9875\u9762\u811A\u672C\u5F02\u5E38"}`);
    }
    return response.result?.value === true;
  }
  async function trustedBaijiahaoComment(tabId, text) {
    const comment = String(text || "").trim();
    if (!comment || comment.length > 1e3) return { success: false, error: "\u8BC4\u8BBA\u5185\u5BB9\u4E3A\u7A7A\u6216\u8D85\u8FC7 1000 \u5B57" };
    const tab = await chrome.tabs.get(tabId);
    let pageUrl;
    try {
      pageUrl = new URL(tab.url || "");
    } catch {
      return { success: false, error: "\u65E0\u6CD5\u786E\u8BA4\u767E\u5BB6\u53F7\u9875\u9762\u5730\u5740" };
    }
    if (!/(^|\.)baijiahao\.baidu\.com$/i.test(pageUrl.hostname) || pageUrl.pathname !== "/s") {
      return { success: false, error: "\u53D7\u4FE1\u4EFB\u8F93\u5165\u53EA\u5141\u8BB8\u7528\u4E8E\u767E\u5BB6\u53F7\u6587\u7AE0\u9875\u9762" };
    }
    const target = { tabId };
    try {
      await chrome.debugger.attach(target, "1.3");
      await enableTrustedPageInteraction(target);
      let controls = await readBaijiahaoControls(target, "editor");
      for (let attempt = 0; attempt < 32 && !pointInsideBaijiahaoViewport(controls.editorPoint, controls); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        controls = await readBaijiahaoControls(target, "editor");
      }
      if (!pointInsideBaijiahaoViewport(controls.editorPoint, controls)) {
        for (let attempt = 0; attempt < 32; attempt++) {
          controls = await readBaijiahaoControls(target, "opener");
          if (pointInsideBaijiahaoViewport(controls.openerPoint, controls)) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!pointInsideBaijiahaoViewport(controls.openerPoint, controls)) {
          await writeClientLog("error", {
            stage: "page-action",
            action: "baijiahao-comment-controls-not-found",
            platform: "baijiahao",
            url: pageUrl.toString(),
            code: "BAIJIAHAO_COMMENT_CONTROLS_NOT_FOUND",
            message: "\u767E\u5BB6\u53F7\u9875\u9762\u65E2\u672A\u627E\u5230\u8BC4\u8BBA\u8F93\u5165\u6846\uFF0C\u4E5F\u672A\u627E\u5230\u65E7\u7248\u8BC4\u8BBA\u5165\u53E3"
          });
          return { success: false, error: "\u767E\u5BB6\u53F7\u9875\u9762\u672A\u627E\u5230\u8BC4\u8BBA\u8F93\u5165\u6846\u6216\u8BC4\u8BBA\u5165\u53E3" };
        }
        await dispatchTrustedClick(target, controls.openerPoint);
        await writeClientLog("operation", {
          stage: "page-action",
          action: "baijiahao-comment-opened",
          platform: "baijiahao",
          url: pageUrl.toString(),
          message: "\u5DF2\u70B9\u51FB\u767E\u5BB6\u53F7\u8BC4\u8BBA\u5165\u53E3\uFF0C\u7B49\u5F85\u8BC4\u8BBA\u8F93\u5165\u6846"
        });
      }
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        controls = await readBaijiahaoControls(target, "editor");
        if (pointInsideBaijiahaoViewport(controls.editorPoint, controls) && pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) break;
      }
      if (!pointInsideBaijiahaoViewport(controls.editorPoint, controls)) {
        return { success: false, error: '\u627E\u4E0D\u5230\u767E\u5BB6\u53F7\u8BC4\u8BBA\u8F93\u5165\u6846 textarea[placeholder="\u53D1\u8868\u795E\u8BC4\u5999\u8BBA"]' };
      }
      if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
        return { success: false, error: "\u627E\u4E0D\u5230\u767E\u5BB6\u53F7\u53D1\u8868\u6309\u94AE span.send" };
      }
      await dispatchTrustedClick(target, controls.editorPoint);
      await new Promise((resolve) => setTimeout(resolve, 160));
      if (!await prepareBaijiahaoEditor(target)) {
        return { success: false, error: "\u767E\u5BB6\u53F7\u8BC4\u8BBA\u8F93\u5165\u6846\u65E0\u6CD5\u83B7\u5F97\u7126\u70B9" };
      }
      await sendDebuggerCommand(target, "Input.insertText", { text: comment });
      await new Promise((resolve) => setTimeout(resolve, 500));
      controls = await readBaijiahaoControls(target, "none");
      if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
        if (!await prepareBaijiahaoEditor(target)) {
          return { success: false, error: "\u767E\u5BB6\u53F7\u8BC4\u8BBA\u8F93\u5165\u6846\u5728\u91CD\u8BD5\u65F6\u5931\u53BB\u7126\u70B9" };
        }
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
          nativeVirtualKeyCode: 8
        });
        await sendDebuggerCommand(target, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Backspace",
          code: "Backspace",
          windowsVirtualKeyCode: 8,
          nativeVirtualKeyCode: 8
        });
        await typeTrustedCommentByKey(target, comment);
        await new Promise((resolve) => setTimeout(resolve, 650));
        controls = await readBaijiahaoControls(target, "none");
      }
      if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
        return {
          success: false,
          error: `\u767E\u5BB6\u53F7\u8BC4\u8BBA\u8F93\u5165\u6846\u672A\u63A5\u6536\u5230\u5B8C\u6574\u6587\u5B57\uFF08\u671F\u671B ${comment.length} \u5B57\uFF0C\u5B9E\u9645 ${controls.editorValue.length} \u5B57\uFF09`
        };
      }
      if (controls.buttonDisabled) {
        const valueBeforeNudge = controls.editorValue;
        await nudgeControlledInput(target);
        await new Promise((resolve) => setTimeout(resolve, 350));
        controls = await readBaijiahaoControls(target, "none");
        if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(valueBeforeNudge)) {
          return { success: false, error: "\u767E\u5BB6\u53F7\u8F93\u5165\u72B6\u6001\u540C\u6B65\u540E\u8BC4\u8BBA\u5185\u5BB9\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u53D1\u8868" };
        }
      }
      if (controls.buttonDisabled) {
        return { success: false, error: "\u767E\u5BB6\u53F7\u5DF2\u663E\u793A\u8BC4\u8BBA\u6587\u5B57\uFF0C\u4F46\u53D1\u8868\u6309\u94AE\u4ECD\u672A\u542F\u7528" };
      }
      if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
        controls = await readBaijiahaoControls(target, "editor");
      }
      if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
        return { success: false, error: "\u767E\u5BB6\u53F7\u53D1\u8868\u6309\u94AE\u4E0D\u5728\u5F53\u524D\u89C6\u53E3\u5185" };
      }
      await writeClientLog("operation", {
        stage: "page-action",
        action: "baijiahao-comment-ready",
        platform: "baijiahao",
        url: pageUrl.toString(),
        commentLength: comment.length,
        message: "\u767E\u5BB6\u53F7\u8BC4\u8BBA\u6587\u5B57\u5DF2\u8F93\u5165\uFF0C\u53D1\u8868\u6309\u94AE\u5DF2\u542F\u7528"
      });
      await dispatchTrustedClick(target, controls.buttonPoint);
      await writeClientLog("operation", {
        stage: "page-action",
        action: "baijiahao-submit-clicked",
        platform: "baijiahao",
        url: pageUrl.toString(),
        message: "\u5DF2\u70B9\u51FB\u767E\u5BB6\u53F7\u53D1\u8868\u6309\u94AE\uFF0C\u7B49\u5F85\u9875\u9762\u786E\u8BA4"
      });
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const afterClick = await readBaijiahaoControls(target, "none");
        if (!afterClick.editorValue || await hasBaijiahaoPublishedComment(target, comment)) {
          await writeClientLog("operation", {
            stage: "page-action",
            action: "baijiahao-submit-confirmed",
            platform: "baijiahao",
            url: pageUrl.toString(),
            message: "\u767E\u5BB6\u53F7\u9875\u9762\u5DF2\u786E\u8BA4\u65B0\u8BC4\u8BBA"
          });
          return { success: true };
        }
      }
      return { success: false, error: "\u5DF2\u70B9\u51FB\u767E\u5BB6\u53F7\u53D1\u8868\u6309\u94AE\uFF0C\u4F46\u9875\u9762\u672A\u786E\u8BA4\u65B0\u8BC4\u8BBA" };
    } catch (error) {
      return { success: false, error: `\u767E\u5BB6\u53F7\u53D7\u4FE1\u4EFB\u8F93\u5165\u5931\u8D25\uFF1A${String(error?.message || error)}` };
    } finally {
      await chrome.debugger.detach(target).catch(() => {
      });
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "UPDATE_BADGE") {
      const auditMessage = message;
      writeClientLog("operation", {
        stage: "extension-message",
        action: message.type,
        command: auditMessage.command,
        platform: auditMessage.platform,
        url: auditMessage.url,
        tabId: sender.tab?.id,
        message: `\u63D2\u4EF6\u64CD\u4F5C\uFF1A${message.type}`
      });
    }
    switch (message.type) {
      case "UPDATE_BADGE":
        updateBadge(message.count, sender.tab?.id);
        sendResponse({ success: true });
        break;
      case "SAVE_SCAN_RESULT": {
        const normalizedUrl = normalizeArticleUrl(message.url, message.platform);
        saveRecord({
          platform: message.platform,
          url: normalizedUrl,
          title: message.title,
          commentCount: message.commentCount,
          checkTime: (/* @__PURE__ */ new Date()).toISOString(),
          username: message.username,
          linkStatus: message.linkStatus || "active",
          liked: message.liked,
          collected: message.collected
        }).then(async () => {
          updateBadge(message.commentCount, sender.tab?.id);
          writeClientLog("operation", {
            stage: "scan-saved",
            action: "SAVE_SCAN_RESULT",
            platform: message.platform,
            url: normalizedUrl,
            commentCount: message.commentCount,
            liked: message.liked,
            collected: message.collected,
            message: "\u626B\u63CF\u7ED3\u679C\u5DF2\u4FDD\u5B58"
          });
          sendResponse({ success: true, url: normalizedUrl });
        }).catch((e) => {
          console.error("[\u80CC\u666F] \u4FDD\u5B58\u5931\u8D25:", e);
          writeClientLog("error", {
            stage: "scan-save-failed",
            action: "SAVE_SCAN_RESULT",
            platform: message.platform,
            url: normalizedUrl,
            code: "SCAN_SAVE_FAILED",
            message: String(e)
          });
          sendResponse({ success: false, error: String(e) });
        });
        break;
      }
      case "FETCH_NETEASE_COMMENTS": {
        let url;
        try {
          url = new URL(message.url);
          const isAllowed = url.origin === "https://comment.api.163.com" && /\/api\/v1\/products\/[^/]+\/threads\/[^/]+\/comments\/(?:newList|hotList)$/.test(url.pathname);
          if (!isAllowed) throw new Error("\u8BC4\u8BBA\u63A5\u53E3\u5730\u5740\u4E0D\u5728\u5141\u8BB8\u8303\u56F4\u5185");
        } catch (error) {
          sendResponse({ success: false, error: String(error) });
          break;
        }
        fetch(url.toString(), { headers: { Accept: "text/javascript, application/json" } }).then(async (response) => {
          if (!response.ok) throw new Error(`\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
          sendResponse({ success: true, text: await response.text() });
        }).catch((error) => sendResponse({ success: false, error: String(error) }));
        break;
      }
      case "VERIFY_COMMENT_ONLINE":
        verifyCommentOnline(message).then(sendResponse);
        break;
      case "CAPTURE_URL_ARCHIVE":
        captureUrlArchive(message).then(sendResponse);
        break;
      case "GENERATE_AI_COMMENT":
        generateComment2(message).then(sendResponse);
        break;
      case "TRUSTED_TOUTIAO_COMMENT":
        if (sender.tab?.id == null) {
          sendResponse({ success: false, error: "\u65E0\u6CD5\u53D6\u5F97\u4ECA\u65E5\u5934\u6761\u64CD\u4F5C\u6807\u7B7E\u9875" });
        } else {
          trustedToutiaoComment(
            sender.tab.id,
            message.text
          ).then(sendResponse);
        }
        break;
      case "TRUSTED_ZHIHU_COMMENT":
        if (sender.tab?.id == null) {
          sendResponse({ success: false, error: "\u65E0\u6CD5\u53D6\u5F97\u77E5\u4E4E\u64CD\u4F5C\u6807\u7B7E\u9875" });
        } else {
          trustedZhihuComment(sender.tab.id, message.text).then(sendResponse);
        }
        break;
      case "TRUSTED_BAIJIAHAO_COMMENT":
        if (sender.tab?.id == null) {
          sendResponse({ success: false, error: "\u65E0\u6CD5\u53D6\u5F97\u767E\u5BB6\u53F7\u64CD\u4F5C\u6807\u7B7E\u9875" });
        } else {
          trustedBaijiahaoComment(sender.tab.id, message.text).then(sendResponse);
        }
        break;
      case "CLIENT_COMMAND":
        if (!CLIENT_COMMANDS.has(message.command)) {
          sendResponse({ success: false, error: "\u4E0D\u5141\u8BB8\u7684\u63D2\u4EF6\u547D\u4EE4" });
        } else {
          nativeCommand(message.command, message.payload).then(sendResponse);
        }
        break;
    }
    return true;
  });
  chrome.runtime.onInstalled.addListener(() => {
    console.log("DL\u8BC4\u8BBA\u52A9\u624B\u5DF2\u5B89\u88C5");
  });
})();
