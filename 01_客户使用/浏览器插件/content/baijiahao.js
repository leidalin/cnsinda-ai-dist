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

  // src/content/baijiahao.ts
  var PLATFORM = "baijiahao";
  var DEBUG = true;
  var COMMENT_ITEM_SELECTOR = ".xcp-item[data-reply-id]";
  var COMMENT_AUTHOR_SELECTOR = ".user-bar-uname";
  var MAX_LOAD_PAGES = 100;
  function log(...args) {
    if (DEBUG) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u767E\u5BB6\u53F7]", ...args);
  }
  function cleanText(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function detectCurrentUsername() {
    const accountLinks = document.querySelectorAll(
      'a[href="http://i.baidu.com/"], a[href="https://i.baidu.com/"], header a[href*="i.baidu.com"]'
    );
    for (const link of accountLinks) {
      const name = cleanText(link.textContent || link.getAttribute("aria-label") || link.getAttribute("title"));
      if (name && name.length <= 60 && !/^(登录|百度首页|个人中心)$/.test(name)) return name;
    }
    try {
      for (const key of Object.keys(localStorage)) {
        if (!/(user|passport|account|profile)/i.test(key)) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key) || "{}");
          const queue = [data];
          const visited = /* @__PURE__ */ new Set();
          while (queue.length > 0) {
            const value = queue.shift();
            if (!value || typeof value !== "object" || visited.has(value)) continue;
            visited.add(value);
            const name = cleanText(value.nickname || value.displayName || value.userName);
            if (name && name.length <= 60) return name;
            queue.push(...Object.values(value));
          }
        } catch {
        }
      }
    } catch {
    }
    return null;
  }
  async function getCurrentUsername() {
    return resolvePlatformUsername(PLATFORM, detectCurrentUsername());
  }
  function getPageTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText(og)) return cleanText(og);
    const h1 = document.querySelector("h1");
    return cleanText(h1?.textContent) || document.title || "\u672A\u77E5\u6587\u7AE0";
  }
  function getDeclaredCommentCount() {
    for (const heading of document.querySelectorAll("h2")) {
      const match = cleanText(heading.textContent).match(/^评论\s*(\d+)$/);
      if (match) return Number(match[1]);
    }
    return null;
  }
  function getCommentItems() {
    return Array.from(document.querySelectorAll(COMMENT_ITEM_SELECTOR));
  }
  function findLoadMoreButton() {
    for (const element of document.querySelectorAll('.xcp-list-loader, button, [role="button"]')) {
      if (cleanText(element.textContent) === "\u67E5\u770B\u66F4\u591A\u8BC4\u8BBA") return element;
    }
    return null;
  }
  async function waitForInitialComments(timeoutMs = 1e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const declaredCount2 = getDeclaredCommentCount();
      if (getCommentItems().length > 0 || declaredCount2 === 0) return;
      await sleep(250);
    }
    const declaredCount = getDeclaredCommentCount();
    if (declaredCount && declaredCount > 0) {
      throw new Error(`\u9875\u9762\u663E\u793A\u6709 ${declaredCount} \u6761\u8BC4\u8BBA\uFF0C\u4F46\u8BC4\u8BBA\u5217\u8868\u672A\u52A0\u8F7D`);
    }
  }
  async function loadAllComments() {
    await waitForInitialComments();
    for (let page = 0; page < MAX_LOAD_PAGES; page++) {
      const before = getCommentItems().length;
      const loadMore = findLoadMoreButton();
      if (!loadMore) {
        log(`\u8BC4\u8BBA\u5DF2\u5168\u90E8\u52A0\u8F7D\uFF0C\u5171 ${before} \u6761`);
        return;
      }
      log(`\u52A0\u8F7D\u8BC4\u8BBA\u4E0B\u4E00\u9875\uFF0C\u5F53\u524D ${before} \u6761`);
      loadMore.click();
      const deadline = Date.now() + 8e3;
      let after = before;
      while (Date.now() < deadline) {
        await sleep(250);
        after = getCommentItems().length;
        if (after > before || !findLoadMoreButton()) break;
      }
      if (after <= before && findLoadMoreButton()) {
        throw new Error("\u70B9\u51FB\u201C\u67E5\u770B\u66F4\u591A\u8BC4\u8BBA\u201D\u540E\u6CA1\u6709\u52A0\u8F7D\u65B0\u8BC4\u8BBA");
      }
    }
    if (findLoadMoreButton()) throw new Error("\u8BC4\u8BBA\u5206\u9875\u8D85\u8FC7\u5B89\u5168\u4E0A\u9650\uFF0C\u5DF2\u505C\u6B62\u7EE7\u7EED\u52A0\u8F7D");
  }
  function countMyComments(username) {
    const normalizedUsername = cleanText(username);
    const seenCommentIds = /* @__PURE__ */ new Set();
    let matchedCount = 0;
    for (const item of getCommentItems()) {
      const commentId = cleanText(item.dataset.replyId);
      if (!commentId || seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);
      const author = cleanText(item.querySelector(COMMENT_AUTHOR_SELECTOR)?.textContent);
      if (author === normalizedUsername) matchedCount++;
    }
    log(`\u7528\u6237\u201C${username}\u201D\u5339\u914D\u5230 ${matchedCount} \u6761\uFF0C\u53BB\u91CD\u540E\u5171\u68C0\u67E5 ${seenCommentIds.size} \u6761\u8BC4\u8BBA`);
    return matchedCount;
  }
  async function scanBaijiahaoPage() {
    log("===== \u5F00\u59CB\u626B\u63CF\u767E\u5BB6\u53F7 =====");
    const username = await getCurrentUsername();
    if (!username) {
      log("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u8D26\u53F7\u8BBE\u7F6E\u4E2D\u586B\u5199\u767E\u5BB6\u53F7\u7528\u6237\u540D");
      return null;
    }
    try {
      await loadAllComments();
      const commentCount = countMyComments(username);
      const title = getPageTitle();
      log(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
      return { platform: PLATFORM, title, commentCount, username };
    } catch (error) {
      const message = `\u767E\u5BB6\u53F7\u8BC4\u8BBA\u626B\u63CF\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      log(message);
      await appendAccountLog(PLATFORM, "error", message);
      return null;
    }
  }
})();
