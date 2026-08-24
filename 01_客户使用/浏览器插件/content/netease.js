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

  // src/content/netease.ts
  var PLATFORM = "netease";
  var DEBUG = true;
  var COMMENT_PAGE_SIZE = 30;
  var MAX_COMMENT_PAGES = 100;
  var COMMENT_API_ORIGIN = "https://comment.api.163.com";
  function log(...args) {
    if (DEBUG) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u7F51\u6613]", ...args);
  }
  function cleanText(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function detectCurrentAccount() {
    const nickname = cleanText(
      document.querySelector("#tieArea .tie-input-bar .photo-area .nickname")?.textContent || document.querySelector("#tieArea .submit-row .photo-area")?.textContent
    ) || null;
    let userId = null;
    const logoutLink = document.querySelector('#tieArea a[href*="reg.163.com/Logout.jsp"]');
    if (logoutLink?.href) {
      try {
        const value = new URL(logoutLink.href).searchParams.get("username");
        if (value && /^\d+$/.test(value)) userId = value;
      } catch {
      }
    }
    return { nickname, userId };
  }
  async function getCurrentAccount() {
    const detected = detectCurrentAccount();
    const username = await resolvePlatformUsername(
      PLATFORM,
      detected.nickname,
      detected.userId ? [detected.userId] : []
    );
    if (!username) return null;
    const userId = cleanText(username) === cleanText(detected.nickname) ? detected.userId : null;
    return { username, userId };
  }
  function getPageTitle() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText(og)) return cleanText(og);
    const h1 = document.querySelector("h1");
    return cleanText(h1?.textContent) || document.title.replace(/[_|｜].*网易.*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  function isNeteaseCommentListUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === COMMENT_API_ORIGIN && /\/api\/v1\/products\/[^/]+\/threads\/[^/]+\/comments\/(?:newList|hotList)$/.test(url.pathname);
    } catch {
      return false;
    }
  }
  function findCommentApiTemplate() {
    const candidates = [];
    try {
      for (const entry of performance.getEntriesByType("resource")) {
        if (typeof entry.name === "string") candidates.push(entry.name);
      }
    } catch {
    }
    for (const script of document.querySelectorAll("script[src]")) {
      if (script.src) candidates.push(script.src);
    }
    const newList = candidates.find((value) => isNeteaseCommentListUrl(value) && value.includes("/newList"));
    const source = newList || candidates.find(isNeteaseCommentListUrl);
    return source ? new URL(source) : null;
  }
  async function waitForCommentApiTemplate(timeoutMs = 1e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const template = findCommentApiTemplate();
      if (template) return template;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }
  function parseJsonp(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) return JSON.parse(trimmed);
    const open = trimmed.indexOf("(");
    const close = trimmed.lastIndexOf(")");
    if (open < 1 || close <= open) throw new Error("\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE\u7684 JSONP \u683C\u5F0F\u65E0\u6548");
    return JSON.parse(trimmed.slice(open + 1, close));
  }
  async function fetchCommentPage(template, listType, offset) {
    const url = new URL(template.toString());
    url.pathname = url.pathname.replace(/\/(?:newList|hotList)$/, `/${listType}`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(COMMENT_PAGE_SIZE));
    url.searchParams.set("showLevelThreshold", "200");
    url.searchParams.set("headLimit", "100");
    url.searchParams.set("tailLimit", "100");
    url.searchParams.set("ibc", "jssdk");
    url.searchParams.set("callback", `_aiNetease${Date.now()}${offset}`);
    url.searchParams.set("_", String(Date.now()));
    const response = await chrome.runtime.sendMessage({
      type: "FETCH_NETEASE_COMMENTS",
      url: url.toString()
    });
    if (!response?.success || typeof response.text !== "string") {
      throw new Error(response?.error || "\u6269\u5C55\u540E\u53F0\u672A\u8FD4\u56DE\u8BC4\u8BBA\u6570\u636E");
    }
    return parseJsonp(response.text);
  }
  function addComments(payload, account, seenCommentIds, matchedNicknames) {
    let matchedCount = 0;
    for (const comment of Object.values(payload.comments || {})) {
      if (comment.del || comment.isDel) continue;
      const commentId = cleanText(comment.postId || String(comment.commentId ?? ""));
      if (!commentId || seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);
      const sameUserId = Boolean(account.userId) && cleanText(String(comment.user?.userId ?? "")) === account.userId;
      const sameNickname = cleanText(comment.user?.nickname) === cleanText(account.username);
      if (sameUserId || sameNickname) {
        matchedCount++;
        const nickname = cleanText(comment.user?.nickname);
        if (nickname) matchedNicknames.add(nickname);
      }
    }
    return matchedCount;
  }
  async function scanCommentList(template, listType, account, seenCommentIds, matchedNicknames) {
    let offset = 0;
    let matchedCount = 0;
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
      const payload = await fetchCommentPage(template, listType, offset);
      const commentIds = payload.commentIds || [];
      matchedCount += addComments(payload, account, seenCommentIds, matchedNicknames);
      const declaredTotal = Number(listType === "newList" ? payload.newListSize : payload.hotListSize);
      log(`${listType} \u5206\u9875 ${page + 1}: offset=${offset}, \u8FD4\u56DE ${commentIds.length} \u6761\u6839\u8DDF\u8D34`);
      if (commentIds.length === 0 || commentIds.length < COMMENT_PAGE_SIZE) break;
      offset += commentIds.length;
      if (Number.isFinite(declaredTotal) && offset >= declaredTotal) break;
    }
    return matchedCount;
  }
  async function countApiComments(template, account) {
    const seenCommentIds = /* @__PURE__ */ new Set();
    const matchedNicknames = /* @__PURE__ */ new Set();
    let matchedCount = await scanCommentList(template, "newList", account, seenCommentIds, matchedNicknames);
    matchedCount += await scanCommentList(template, "hotList", account, seenCommentIds, matchedNicknames);
    log(`\u6839\u8DDF\u8D34\u548C\u53C2\u4E0E\u56DE\u590D\u53BB\u91CD\u540E\u5171\u68C0\u67E5 ${seenCommentIds.size} \u6761\uFF0C\u5F53\u524D\u8D26\u53F7\u5339\u914D ${matchedCount} \u6761`);
    return { count: matchedCount, nickname: [...matchedNicknames][0] || "" };
  }
  async function scanNeteasePage() {
    log("===== \u5F00\u59CB\u626B\u63CF\u7F51\u6613 =====");
    const account = await getCurrentAccount();
    if (!account) {
      log("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u8D26\u53F7\u8BBE\u7F6E\u4E2D\u586B\u5199\u7F51\u6613\u7528\u6237\u540D");
      return null;
    }
    try {
      const template = await waitForCommentApiTemplate();
      if (!template) throw new Error("\u672A\u53D1\u73B0\u7F51\u6613\u8BC4\u8BBA\u63A5\u53E3\uFF0C\u8BC4\u8BBA\u533A\u53EF\u80FD\u5C1A\u672A\u52A0\u8F7D");
      const comments = await countApiComments(template, account);
      const title = getPageTitle();
      log(`===== \u626B\u63CF\u5B8C\u6210: ${comments.count} \u6761 =====`);
      return {
        platform: PLATFORM,
        title,
        commentCount: comments.count,
        username: comments.nickname || account.username
      };
    } catch (error) {
      const message = `\u7F51\u6613\u8BC4\u8BBA\u626B\u63CF\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      log(message);
      await appendAccountLog(PLATFORM, "error", message);
      return null;
    }
  }
})();
