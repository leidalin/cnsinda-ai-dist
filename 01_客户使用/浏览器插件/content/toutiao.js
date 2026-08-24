"use strict";
(() => {
  // src/shared/account.ts
  function accountStateKey(platform) {
    return `accountRuntimeState:${platform}`;
  }
  var ACCOUNT_LOG_KEY = "accountDetectionLogs";
  function clean(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  async function appendAccountLog(platform, level, message) {
    try {
      const data = await chrome.storage.local.get(ACCOUNT_LOG_KEY);
      const existing = Array.isArray(data[ACCOUNT_LOG_KEY]) ? data[ACCOUNT_LOG_KEY] : [];
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time: (/* @__PURE__ */ new Date()).toISOString(),
        platform,
        level,
        message,
        url: window.location.href
      };
      await chrome.storage.local.set({
        [ACCOUNT_LOG_KEY]: [entry, ...existing].slice(0, 100)
      });
    } catch (error) {
      console.error("[DL\u8BC4\u8BBA\u52A9\u624B] \u5199\u5165\u8D26\u53F7\u68C0\u6D4B\u65E5\u5FD7\u5931\u8D25:", error);
    }
  }
  async function resolvePlatformUsername(platform, detected, detectedAliases = []) {
    const data = await chrome.storage.sync.get("usernames");
    const configured = clean(data.usernames?.[platform]);
    const detectedName = clean(detected);
    const aliases = [detectedName, ...detectedAliases.map(clean)].filter(Boolean);
    const saveState = async (status) => {
      const state = {
        platform,
        status,
        configured,
        detected: detectedName || aliases[0] || "",
        time: (/* @__PURE__ */ new Date()).toISOString(),
        url: window.location.href
      };
      await chrome.storage.local.set({ [accountStateKey(platform)]: state });
    };
    if (configured) {
      if (aliases.length > 0 && !aliases.includes(configured)) {
        const message = `\u624B\u52A8\u8D26\u53F7\u201C${configured}\u201D\u4E0E\u81EA\u52A8\u8BC6\u522B\u201C${detectedName || aliases[0]}\u201D\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u6309\u624B\u52A8\u8D26\u53F7\u7EDF\u8BA1\u3002`;
        console.warn(`[DL\u8BC4\u8BBA\u52A9\u624B-${platform}]`, message);
        await appendAccountLog(platform, "warning", message);
        await saveState("account_mismatch");
      } else if (aliases.length > 0) {
        await saveState("logged_in");
      } else {
        await saveState("unknown");
      }
      return configured;
    }
    await saveState(detectedName ? "logged_in" : "auth_required");
    return detectedName || null;
  }

  // src/content/toutiao.ts
  var PLATFORM = "toutiao";
  var DEBUG = true;
  var COMMENT_PAGE_SIZE = 20;
  var MAX_COMMENT_PAGES = 100;
  function log(...args) {
    if (DEBUG) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u5934\u6761]", ...args);
  }
  function cleanText(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  async function getCurrentUsername() {
    const selectors = [
      'header a[aria-label][href*="/c/user/token/"]',
      '[role="banner"] a[aria-label][href*="/c/user/token/"]',
      'header a[aria-label][href*="/c/user/"]'
    ];
    let detected = null;
    for (const selector of selectors) {
      for (const link of document.querySelectorAll(selector)) {
        const name = cleanText(link.getAttribute("aria-label"));
        if (name && name.length <= 60 && !/个人主页|作者头像/.test(name)) {
          log("\u4ECE\u9876\u90E8\u8D26\u53F7\u5165\u53E3\u8BC6\u522B\u7528\u6237\u540D:", name);
          detected = name;
          break;
        }
      }
      if (detected) break;
    }
    return resolvePlatformUsername(PLATFORM, detected);
  }
  function getArticleId() {
    return window.location.pathname.match(/^\/(?:article|item)\/(\d+)/)?.[1] || null;
  }
  function getPageTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText(ogTitle)) return cleanText(ogTitle);
    const h1 = document.querySelector("main h1, h1");
    return cleanText(h1?.textContent) || document.title.replace(/\s*[-–]\s*今日头条\s*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  function addComment(comment, username, seenCommentIds) {
    if (!comment) return 0;
    let matchedCount = 0;
    const commentId = cleanText(comment.id_str || String(comment.id ?? ""));
    if (!commentId || !seenCommentIds.has(commentId)) {
      if (commentId) seenCommentIds.add(commentId);
      if (cleanText(comment.user_name) === username) matchedCount++;
    }
    for (const reply of comment.reply_list || []) {
      matchedCount += addComment(reply, username, seenCommentIds);
    }
    for (const reply of comment.new_reply_list || []) {
      matchedCount += addComment(reply, username, seenCommentIds);
    }
    return matchedCount;
  }
  async function fetchCommentPage(articleId, offset) {
    const url = new URL("/article/v4/tab_comments/", "https://www.toutiao.com");
    url.searchParams.set("aid", "24");
    url.searchParams.set("app_name", "toutiao_web");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("count", String(COMMENT_PAGE_SIZE));
    url.searchParams.set("group_id", articleId);
    url.searchParams.set("item_id", articleId);
    const response = await fetch(url.toString(), {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.err_no !== 0 || payload.message !== "success") {
      throw new Error(payload.message || `\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE err_no=${String(payload.err_no)}`);
    }
    return payload;
  }
  async function countApiComments(articleId, username) {
    const seenOffsets = /* @__PURE__ */ new Set();
    const seenCommentIds = /* @__PURE__ */ new Set();
    let offset = 0;
    let matchedCount = 0;
    for (let page = 0; page < MAX_COMMENT_PAGES && !seenOffsets.has(offset); page++) {
      seenOffsets.add(offset);
      const payload = await fetchCommentPage(articleId, offset);
      for (const entry of payload.data || []) {
        matchedCount += addComment(entry.comment, username, seenCommentIds);
      }
      log(`\u8BC4\u8BBA\u5206\u9875 ${page + 1}: offset=${offset}, \u8FD4\u56DE ${payload.data?.length || 0} \u6761`);
      if (!payload.has_more) break;
      const nextOffset = Number(payload.offset);
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new Error("\u8BC4\u8BBA\u63A5\u53E3\u672A\u8FD4\u56DE\u6709\u6548\u7684\u4E0B\u4E00\u9875 offset");
      }
      offset = nextOffset;
    }
    return matchedCount;
  }
  async function scanToutiaoPage() {
    log("===== \u5F00\u59CB\u626B\u63CF\u4ECA\u65E5\u5934\u6761 =====");
    const username = await getCurrentUsername();
    const articleId = getArticleId();
    if (!username || !articleId) {
      log("\u672A\u8BC6\u522B\u5230\u5F53\u524D\u767B\u5F55\u8D26\u53F7\u6216\u6587\u7AE0 ID");
      return null;
    }
    try {
      const commentCount = await countApiComments(articleId, username);
      const title = getPageTitle();
      log(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
      return { platform: PLATFORM, title, commentCount, username };
    } catch (error) {
      log("\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5931\u8D25:", error);
      return null;
    }
  }
})();
