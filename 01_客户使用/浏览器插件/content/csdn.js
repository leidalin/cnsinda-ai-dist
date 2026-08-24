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

  // src/content/csdn.ts
  var PLATFORM = "csdn";
  var DEBUG = true;
  var COMMENT_PAGE_SIZE = 10;
  var MAX_COMMENT_PAGES = 100;
  function log(...args) {
    if (DEBUG) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-CSDN]", ...args);
  }
  function cleanText(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function isValidAccountName(value) {
    const name = cleanText(value);
    if (!name || name.length > 60) return false;
    return !/^(?:[-—–_]{1,}|加载中\.{0,3}|登录|未登录|null|undefined)$/i.test(name);
  }
  function detectCurrentAccount() {
    const accountRoot = document.querySelector(".toolbar-btn-login-new, .toolbar-btn-login");
    const profileLinks = accountRoot?.querySelectorAll(
      'a.hasAvatar[href*="blog.csdn.net/"], a.csdn-profile-avatar[href*="blog.csdn.net/"], a.csdn-img-text-box[href*="blog.csdn.net/"]'
    ) || [];
    let userName = "";
    for (const link of profileLinks) {
      try {
        const url = new URL(link.href, window.location.href);
        if (url.hostname !== "blog.csdn.net") continue;
        const candidate = cleanText(url.pathname.split("/").filter(Boolean)[0]);
        if (candidate && candidate !== "blog") {
          userName = candidate;
          break;
        }
      } catch {
      }
    }
    const nicknameCandidate = cleanText(
      accountRoot?.querySelector(".csdn-profile-nickName")?.textContent || accountRoot?.querySelector(".csdn-profile-top")?.textContent
    );
    const nickName = isValidAccountName(nicknameCandidate) ? nicknameCandidate : "";
    return { userName, nickName };
  }
  async function getCurrentAccount() {
    let detected = detectCurrentAccount();
    const deadline = Date.now() + 8e3;
    while (!detected.userName && Date.now() < deadline) {
      await sleep(250);
      detected = detectCurrentAccount();
    }
    const detectedPrimary = detected.userName || detected.nickName || null;
    const aliases = detected.nickName ? [detected.nickName] : [];
    const resolved = await resolvePlatformUsername(PLATFORM, detectedPrimary, aliases);
    if (!resolved) {
      log("\u672A\u627E\u5230\u9876\u90E8\u767B\u5F55\u8D26\u53F7\uFF0C\u4E14\u672A\u8BBE\u7F6E\u624B\u52A8\u8D26\u53F7");
      return null;
    }
    log(
      "\u5F53\u524D\u767B\u5F55\u8D26\u53F7:",
      detected.userName || "\u672A\u81EA\u52A8\u8BC6\u522B",
      "\u9875\u9762\u6635\u79F0:",
      detected.nickName || "\u672A\u52A0\u8F7D/\u5360\u4F4D\u7B26\u5DF2\u5FFD\u7565",
      "\u7EDF\u8BA1\u8D26\u53F7:",
      resolved
    );
    return { userName: resolved, nickName: resolved };
  }
  function getArticleId() {
    return window.location.pathname.match(/\/article\/details\/(\d+)/)?.[1] || null;
  }
  function getPageTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText(ogTitle)) return cleanText(ogTitle);
    const h1 = document.querySelector("h1.title-article, h1.article-title, main h1, h1");
    return cleanText(h1?.textContent) || document.title.replace(/-CSDN博客\s*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  function addCommentAndReplies(item, currentUserName, seenCommentIds, matchedNicknames) {
    let count = 0;
    const info = item.info;
    const commentId = cleanText(String(info?.commentId ?? ""));
    if (!commentId || !seenCommentIds.has(commentId)) {
      if (commentId) seenCommentIds.add(commentId);
      if (cleanText(info?.userName) === currentUserName || cleanText(info?.nickName) === currentUserName) {
        count++;
        const nickname = cleanText(info?.nickName);
        if (nickname) matchedNicknames.add(nickname);
      }
    }
    for (const reply of item.sub || []) {
      count += addCommentAndReplies(reply, currentUserName, seenCommentIds, matchedNicknames);
    }
    return count;
  }
  async function fetchCommentPage(articleId, page, fold) {
    const apiPath = `/phoenix/web/v1/comment/list/${articleId}`;
    const url = new URL(apiPath, "https://blog.csdn.net");
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(COMMENT_PAGE_SIZE));
    url.searchParams.set("fold", fold);
    if (page === 1 && fold === "unfold") url.searchParams.set("commentId", "");
    const response = await fetch(url.toString(), {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.code !== 200 || !payload.data) {
      throw new Error(payload.message || `\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE code=${String(payload.code)}`);
    }
    return payload;
  }
  async function countApiComments(articleId, currentUserName) {
    const seenCommentIds = /* @__PURE__ */ new Set();
    const matchedNicknames = /* @__PURE__ */ new Set();
    let matchedCount = 0;
    for (const fold of ["unfold", "fold"]) {
      const firstPage = await fetchCommentPage(articleId, 1, fold);
      let pageCount = Math.max(1, Number(firstPage.data?.pageCount) || 1);
      pageCount = Math.min(pageCount, MAX_COMMENT_PAGES);
      for (const item of firstPage.data?.list || []) {
        matchedCount += addCommentAndReplies(item, currentUserName, seenCommentIds, matchedNicknames);
      }
      for (let page = 2; page <= pageCount; page++) {
        const payload = await fetchCommentPage(articleId, page, fold);
        for (const item of payload.data?.list || []) {
          matchedCount += addCommentAndReplies(item, currentUserName, seenCommentIds, matchedNicknames);
        }
      }
      log(`${fold === "fold" ? "\u6298\u53E0" : "\u6B63\u5E38"}\u8BC4\u8BBA\u626B\u63CF\u5B8C\u6210: ${pageCount} \u9875`);
    }
    return { count: matchedCount, nickname: [...matchedNicknames][0] || "" };
  }
  async function scanCsdnPage() {
    log("===== \u5F00\u59CB\u626B\u63CF CSDN =====");
    const account = await getCurrentAccount();
    const articleId = getArticleId();
    if (!account || !articleId) {
      log("\u672A\u8BC6\u522B\u5230\u5F53\u524D\u767B\u5F55\u8D26\u53F7\u6216\u6587\u7AE0 ID");
      return null;
    }
    try {
      const comments = await countApiComments(articleId, account.userName);
      const title = getPageTitle();
      log(`===== \u626B\u63CF\u5B8C\u6210: ${comments.count} \u6761 =====`);
      return {
        platform: PLATFORM,
        title,
        commentCount: comments.count,
        username: comments.nickname || account.nickName
      };
    } catch (error) {
      log("\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5931\u8D25:", error);
      return null;
    }
  }
})();
