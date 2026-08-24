"use strict";
(() => {
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
  function isArticlePage(url) {
    if (url.includes("csdn.net") && url.includes("/article/details/")) return true;
    if (url.includes("zhihu.com") && (url.includes("/p/") || url.includes("/answer/"))) return true;
    if (url.includes("toutiao.com") && (/\/article\/\d+/.test(url) || /\/item\/\d+/.test(url))) return true;
    if (url.includes("baijiahao.baidu.com")) return true;
    if (url.includes("163.com") && url.includes("/article/")) return true;
    if (url.includes("sohu.com") && /\/a\/\d+_\d+/.test(url)) return true;
    return false;
  }

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

  // src/content/zhihu.ts
  var PLATFORM2 = "zhihu";
  var DEBUG2 = true;
  var COMMENT_ROOT_SELECTOR = [
    ".Comments-container",
    ".Comments",
    '[class*="Comments-container"]',
    '[class*="Comments-list"]',
    '[class*="CommentList"]',
    '[class*="CommentModal"]',
    '[class*="CommentDrawer"]',
    '[data-za-detail-view-path-module*="CommentList"]',
    '[role="dialog"] [class*="Comment"]',
    '[role="dialog"]',
    '[class*="Modal"] [class*="Comment"]'
  ].join(",");
  var COMMENT_ITEM_SELECTOR = [
    ".CommentItem",
    '[class*="CommentItem"]',
    '[class*="Comments-item"]',
    '[data-za-detail-view-path-module*="CommentItem"]'
  ].join(",");
  function log2(...args) {
    if (DEBUG2) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u77E5\u4E4E]", ...args);
  }
  function sleep2(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function cleanText2(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  async function fetchArticleCommentCount(username) {
    const articleId = window.location.pathname.match(/^\/p\/(\d+)/)?.[1];
    if (!articleId) return null;
    const apiPath = `/api/v4/comment_v5/articles/${articleId}/root_comment`;
    let nextUrl = `https://www.zhihu.com${apiPath}?order_by=score&limit=20&offset=`;
    const seenPages = /* @__PURE__ */ new Set();
    const seenComments = /* @__PURE__ */ new Set();
    let matchedCount = 0;
    let pageCount = 0;
    try {
      while (nextUrl && pageCount < 50 && !seenPages.has(nextUrl)) {
        const parsedUrl = new URL(nextUrl);
        if (parsedUrl.origin !== "https://www.zhihu.com" || parsedUrl.pathname !== apiPath) {
          log2("\u5FFD\u7565\u975E\u9884\u671F\u7684\u8BC4\u8BBA\u5206\u9875\u5730\u5740:", nextUrl);
          break;
        }
        seenPages.add(nextUrl);
        const response = await fetch(nextUrl, {
          credentials: "include",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error(`\u8BC4\u8BBA\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`);
        const payload = await response.json();
        for (const comment of payload.data || []) {
          if (comment.is_delete) continue;
          const commentId = cleanText2(comment.id);
          if (commentId && seenComments.has(commentId)) continue;
          if (commentId) seenComments.add(commentId);
          if (cleanText2(comment.author?.name) === username) matchedCount++;
        }
        pageCount++;
        nextUrl = payload.paging?.is_end ? null : payload.paging?.next || null;
      }
      log2(`\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5B8C\u6210: ${pageCount} \u9875\uFF0C\u7528\u6237\u201C${username}\u201D\u5171 ${matchedCount} \u6761`);
      return matchedCount;
    } catch (error) {
      log2("\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u9875\u9762\u7EDF\u8BA1:", error);
      return null;
    }
  }
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function extractNameFromAvatarAlt(alt) {
    const value = cleanText2(alt);
    if (!value || value.length > 60) return null;
    const patterns = [
      /^(.+?)的头像$/,
      /^(.+?)头像$/,
      /^点击(?:打开|查看)(.+?)(?:的(?:主页|个人资料))?$/
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      const name = cleanText2(match?.[1]);
      if (name && name.length < 30) return name;
    }
    return null;
  }
  async function getCurrentUsername() {
    let detected = null;
    const headerSelectors = [
      ".AppHeader-profile img[alt]",
      ".AppHeader-userInfo img[alt]",
      "header button img[alt]",
      'header [aria-label*="\u4E2A\u4EBA"] img[alt]',
      'header [aria-label*="\u6211\u7684"] img[alt]',
      '[class*="AppHeader"] [class*="profile"] img[alt]'
    ];
    for (const selector of headerSelectors) {
      for (const image of document.querySelectorAll(selector)) {
        const name = extractNameFromAvatarAlt(image.alt);
        if (name) {
          log2("\u4ECE\u9876\u90E8\u8D26\u53F7\u5934\u50CF\u8BC6\u522B\u7528\u6237\u540D:", name);
          detected = name;
          break;
        }
      }
      if (detected) break;
    }
    try {
      const initialState = document.querySelector("#js-initialData, script[data-state]")?.textContent;
      if (!detected && initialState) {
        const data = JSON.parse(initialState);
        const account = data?.initialState?.account || data?.initialState?.user || data?.account;
        const name = cleanText2(account?.name || account?.user?.name || account?.displayName);
        if (name && name.length < 30) {
          log2("\u4ECE\u9875\u9762\u72B6\u6001\u8BC6\u522B\u7528\u6237\u540D:", name);
          detected = name;
        }
      }
    } catch (error) {
      log2("\u8BFB\u53D6\u9875\u9762\u8D26\u53F7\u72B6\u6001\u5931\u8D25:", error);
    }
    try {
      for (const key of detected ? [] : Object.keys(localStorage)) {
        if (!/(user|account|profile)/i.test(key)) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key) || "{}");
          const queue = [data];
          const visited = /* @__PURE__ */ new Set();
          while (queue.length > 0) {
            const value = queue.shift();
            if (!value || typeof value !== "object" || visited.has(value)) continue;
            visited.add(value);
            const name = cleanText2(value.name || value.nickname || value.displayName);
            if (name && name.length < 30) {
              detected = name;
              break;
            }
            queue.push(...Object.values(value));
          }
          if (detected) break;
        } catch {
        }
      }
    } catch {
    }
    return resolvePlatformUsername(PLATFORM2, detected);
  }
  function getPrimaryContentRoot() {
    const pathname = window.location.pathname;
    const selectors = pathname.includes("/answer/") ? [".AnswerItem", '[itemprop="answer"]', "article", "main"] : [".Post-Main", ".Post-content", "article", "main"];
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (candidates.length > 0) return candidates[0];
    }
    return document.querySelector("main") || document.body;
  }
  function isCommentOpenButton(element) {
    if (!isVisible(element) || element.hasAttribute("disabled")) return false;
    if (element.closest(COMMENT_ROOT_SELECTOR) || element.closest(COMMENT_ITEM_SELECTOR)) return false;
    const text = cleanText2(element.innerText || element.textContent);
    const ariaLabel = cleanText2(element.getAttribute("aria-label"));
    const ariaControls = cleanText2(element.getAttribute("aria-controls"));
    const title = cleanText2(element.getAttribute("title"));
    const combined = `${text} ${ariaLabel} ${title}`;
    if (/回复|收起评论|关闭评论|取消|发布|删除|写下你的评论/.test(combined)) return false;
    if (/comment/i.test(ariaControls) && element.getAttribute("aria-expanded") !== "true") return true;
    if (/评论/.test(ariaLabel) && !/收起|关闭/.test(ariaLabel)) return true;
    const exactMatch = /^(?:查看全部\s*)?\d*\s*条?评论$/.test(text) || /^(?:查看|展开|打开)(?:全部)?\s*\d*\s*条?评论$/.test(text) || /^(?:评论|添加评论|查看评论)$/.test(text);
    if (exactMatch) return true;
    const isClickable = element.tagName === "BUTTON" || element.getAttribute("role") === "button";
    const inActionBar = Boolean(element.closest(
      '.ContentItem-actions, .Post-actions, [class*="ContentItem-actions"], [class*="Post-actions"], [class*="BottomBar"], [class*="ActionBar"]'
    ));
    return isClickable && inActionBar && text.length <= 50 && /评论/.test(text);
  }
  function scoreCommentButton(element, primaryRoot) {
    const text = cleanText2(element.innerText || element.textContent);
    let score = 0;
    if (element.tagName === "BUTTON") score += 30;
    if (element.getAttribute("role") === "button") score += 15;
    if (element.getAttribute("aria-label")?.includes("\u8BC4\u8BBA")) score += 35;
    if (/\d+\s*条?评论/.test(text)) score += 40;
    if (/查看全部|展开|打开/.test(text)) score += 20;
    if (element.closest('.ContentItem-actions, .Post-actions, [class*="ContentItem-actions"], [class*="Post-actions"], [class*="BottomBar"]')) score += 35;
    if (primaryRoot?.contains(element)) score += 50;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.top <= window.innerHeight) score += 10;
    return score;
  }
  function findCommentOpenButtons() {
    const primaryRoot = getPrimaryContentRoot();
    const selector = [
      "button",
      '[role="button"]',
      '[tabindex="0"]',
      'a[aria-label*="\u8BC4\u8BBA"]',
      '[aria-controls*="comment" i]',
      '[class*="ContentItem-action"]',
      '[class*="Post-action"]',
      '[data-za-detail-view-path-module*="Comment"]',
      '[data-za-extra-module*="Comment"]'
    ].join(",");
    const elements = Array.from(document.querySelectorAll(selector));
    const unique = Array.from(new Set(elements.filter(isCommentOpenButton)));
    unique.sort((a, b) => scoreCommentButton(b, primaryRoot) - scoreCommentButton(a, primaryRoot));
    return unique;
  }
  function findVisibleCommentRoot() {
    const roots = Array.from(document.querySelectorAll(COMMENT_ROOT_SELECTOR)).filter((root) => isVisible(root) && root.tagName !== "BUTTON");
    if (roots.length > 0) {
      roots.sort((a, b) => {
        const aItems = a.querySelectorAll(COMMENT_ITEM_SELECTOR).length;
        const bItems = b.querySelectorAll(COMMENT_ITEM_SELECTOR).length;
        return bItems - aItems;
      });
      return roots[0];
    }
    const visibleItem = Array.from(document.querySelectorAll(COMMENT_ITEM_SELECTOR)).find(isVisible);
    if (visibleItem) {
      let container = visibleItem.parentElement;
      for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
        if (container.querySelectorAll(COMMENT_ITEM_SELECTOR).length >= 1) return container;
      }
    }
    const editor = Array.from(document.querySelectorAll(
      'textarea[placeholder*="\u8BC4\u8BBA"], input[placeholder*="\u8BC4\u8BBA"], [contenteditable="true"]'
    )).find((element) => isVisible(element) && /评论|友善|写下/.test(cleanText2(
      element.getAttribute("placeholder") || element.getAttribute("aria-label") || element.parentElement?.textContent
    )));
    if (editor) {
      return editor.closest('[role="dialog"], [class*="Modal"], [class*="Drawer"], section, form') || editor.parentElement;
    }
    return null;
  }
  function getCommentItems(root) {
    const knownItems = Array.from(root.querySelectorAll(COMMENT_ITEM_SELECTOR)).filter(isVisible);
    if (knownItems.length > 0) return knownItems;
    const items = /* @__PURE__ */ new Set();
    const replyButtons = Array.from(root.querySelectorAll('button, [role="button"]')).filter((element) => isVisible(element) && cleanText2(element.textContent) === "\u56DE\u590D");
    for (const button of replyButtons) {
      let candidate = button.parentElement;
      for (let depth = 0; candidate && candidate !== root && depth < 8; depth++) {
        const parent = candidate.parentElement;
        if (!parent) break;
        const siblingCommentCount = Array.from(parent.children).filter(
          (sibling) => Array.from(sibling.querySelectorAll('button, [role="button"]')).some((element) => cleanText2(element.textContent) === "\u56DE\u590D")
        ).length;
        if (siblingCommentCount >= 2) {
          items.add(candidate);
          break;
        }
        candidate = parent;
      }
    }
    return Array.from(items).filter(isVisible);
  }
  async function waitForCommentRoot(timeoutMs = 1e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const root = findVisibleCommentRoot();
      if (root) return root;
      await sleep2(250);
    }
    return null;
  }
  async function clickCommentButton(button) {
    button.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await sleep2(300);
    button.focus({ preventScroll: true });
    if (button instanceof HTMLButtonElement) HTMLButtonElement.prototype.click.call(button);
    else HTMLElement.prototype.click.call(button);
  }
  async function openCommentArea() {
    const existing = findVisibleCommentRoot();
    if (existing) {
      log2("\u8BC4\u8BBA\u533A\u5DF2\u7ECF\u5C55\u5F00");
      return existing;
    }
    const buttons = findCommentOpenButtons();
    log2(`\u627E\u5230 ${buttons.length} \u4E2A\u8BC4\u8BBA\u5165\u53E3\u5019\u9009`);
    for (const [index, button] of buttons.slice(0, 8).entries()) {
      const text = cleanText2(button.innerText || button.textContent || button.getAttribute("aria-label"));
      log2(`\u5C1D\u8BD5\u8BC4\u8BBA\u5165\u53E3 ${index + 1}:`, text, button.className);
      try {
        await clickCommentButton(button);
        const root = await waitForCommentRoot(5e3);
        if (root) {
          log2("\u8BC4\u8BBA\u533A\u5DF2\u6210\u529F\u5C55\u5F00");
          return root;
        }
      } catch (error) {
        log2("\u70B9\u51FB\u8BC4\u8BBA\u5165\u53E3\u5931\u8D25:", error);
      }
    }
    const primaryRoot = getPrimaryContentRoot();
    const bottom = primaryRoot?.getBoundingClientRect().bottom ?? document.documentElement.scrollHeight;
    window.scrollTo({ top: Math.max(0, window.scrollY + bottom - window.innerHeight + 80), behavior: "auto" });
    await sleep2(1200);
    const retryButtons = findCommentOpenButtons();
    for (const button of retryButtons.slice(0, 8)) {
      try {
        await clickCommentButton(button);
        const root = await waitForCommentRoot(5e3);
        if (root) return root;
      } catch {
      }
    }
    log2("\u672A\u80FD\u5C55\u5F00\u8BC4\u8BBA\u533A");
    return null;
  }
  function countLoadedCommentItems(root) {
    const items = getCommentItems(root);
    if (items.length > 0) return items.length;
    return Math.ceil(root.querySelectorAll('a[href*="/people/"]').length / 2);
  }
  function findScrollableContainer(root) {
    const candidates = [root];
    let parent = root.parentElement;
    while (parent && parent !== document.body) {
      candidates.push(parent);
      parent = parent.parentElement;
    }
    candidates.push(...Array.from(root.querySelectorAll('[class*="scroll"], [class*="Scroll"], [role="dialog"]')));
    return candidates.find((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`) && element.scrollHeight > element.clientHeight + 30;
    }) || null;
  }
  function findLoadMoreButton(root) {
    const candidates = root.querySelectorAll('button, [role="button"], a');
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const text = cleanText2(element.innerText || element.textContent);
      if (/^(?:加载|查看|展开)(?:更多|全部)?\s*(?:评论|回复)/.test(text)) return element;
    }
    return null;
  }
  async function loadAllComments(root) {
    let currentRoot = root;
    let previousCount = -1;
    let stableRounds = 0;
    for (let round = 0; round < 35; round++) {
      currentRoot = findVisibleCommentRoot() || currentRoot;
      const before = countLoadedCommentItems(currentRoot);
      const moreButton = findLoadMoreButton(currentRoot);
      if (moreButton) {
        const text = cleanText2(moreButton.innerText || moreButton.textContent);
        log2(`\u70B9\u51FB\u52A0\u8F7D\u6309\u94AE: ${text}`);
        try {
          moreButton.scrollIntoView({ behavior: "auto", block: "center" });
          await sleep2(150);
          moreButton.click();
        } catch {
        }
      }
      const scrollContainer = findScrollableContainer(currentRoot);
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "auto" });
      } else {
        const items = getCommentItems(currentRoot);
        const lastItem = items[items.length - 1];
        if (lastItem) lastItem.scrollIntoView({ behavior: "auto", block: "end" });
        else currentRoot.scrollIntoView({ behavior: "auto", block: "end" });
      }
      await sleep2(moreButton ? 1e3 : 700);
      const after = countLoadedCommentItems(currentRoot);
      log2(`\u8BC4\u8BBA\u52A0\u8F7D ${round + 1}: ${before} \u2192 ${after}`);
      if (after > previousCount || moreButton) stableRounds = 0;
      else stableRounds++;
      previousCount = after;
      if (stableRounds >= 5) break;
    }
    return Math.max(0, previousCount);
  }
  function countMyComments(username, root) {
    const normalizedUsername = cleanText2(username);
    const matchedItems = /* @__PURE__ */ new Set();
    const items = getCommentItems(root);
    for (const item of items) {
      const authorLinks = item.querySelectorAll('a[href*="/people/"]');
      const matchedLink = Array.from(authorLinks).some(
        (link) => cleanText2(link.textContent || link.getAttribute("aria-label") || link.getAttribute("title")) === normalizedUsername
      );
      if (matchedLink) {
        matchedItems.add(item);
        continue;
      }
      const author = item.querySelector(
        '[class*="CommentItem"] [class*="Author"], [class*="CommentItem"] [class*="name"], [data-za-detail-view-path-module*="Author"]'
      );
      if (cleanText2(author?.textContent) === normalizedUsername) matchedItems.add(item);
    }
    log2(`\u7528\u6237\u201C${username}\u201D\u5339\u914D\u5230 ${matchedItems.size} \u6761\u8BC4\u8BBA`);
    return matchedItems.size;
  }
  function getPageTitle2() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText2(ogTitle)) return cleanText2(ogTitle);
    const h1 = document.querySelector("h1");
    if (cleanText2(h1?.textContent)) return cleanText2(h1?.textContent);
    return document.title.replace(/\s*[-–]\s*(知乎|Zhihu).*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  async function scanZhihuPage() {
    log2("===== \u5F00\u59CB\u626B\u63CF\u77E5\u4E4E =====");
    const username = await getCurrentUsername();
    if (!username) {
      log2("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u77E5\u4E4E\u7528\u6237\u540D");
      return null;
    }
    const title = getPageTitle2();
    log2("\u7528\u6237:", username);
    log2("\u6807\u9898:", title);
    const commentRoot = await openCommentArea();
    if (!commentRoot) return null;
    const apiCountPromise = fetchArticleCommentCount(username);
    const loadedCount = await loadAllComments(commentRoot);
    log2(`\u5DF2\u52A0\u8F7D\u8BC4\u8BBA\u5143\u7D20: ${loadedCount}`);
    const latestRoot = findVisibleCommentRoot() || commentRoot;
    const apiCount = await apiCountPromise;
    const commentCount = apiCount ?? countMyComments(username, latestRoot);
    log2(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
    return { platform: PLATFORM2, title, commentCount, username };
  }
  async function scanZhihuArchiveMetadata() {
    const username = await getCurrentUsername();
    if (!username) return null;
    const commentCount = await fetchArticleCommentCount(username);
    return {
      platform: PLATFORM2,
      title: getPageTitle2(),
      commentCount: Math.max(0, commentCount || 0),
      username
    };
  }

  // src/content/toutiao.ts
  var PLATFORM3 = "toutiao";
  var DEBUG3 = true;
  var COMMENT_PAGE_SIZE2 = 20;
  var MAX_COMMENT_PAGES2 = 100;
  function log3(...args) {
    if (DEBUG3) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u5934\u6761]", ...args);
  }
  function cleanText3(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  async function getCurrentUsername2() {
    const selectors = [
      'header a[aria-label][href*="/c/user/token/"]',
      '[role="banner"] a[aria-label][href*="/c/user/token/"]',
      'header a[aria-label][href*="/c/user/"]'
    ];
    let detected = null;
    for (const selector of selectors) {
      for (const link of document.querySelectorAll(selector)) {
        const name = cleanText3(link.getAttribute("aria-label"));
        if (name && name.length <= 60 && !/个人主页|作者头像/.test(name)) {
          log3("\u4ECE\u9876\u90E8\u8D26\u53F7\u5165\u53E3\u8BC6\u522B\u7528\u6237\u540D:", name);
          detected = name;
          break;
        }
      }
      if (detected) break;
    }
    return resolvePlatformUsername(PLATFORM3, detected);
  }
  function getArticleId2() {
    return window.location.pathname.match(/^\/(?:article|item)\/(\d+)/)?.[1] || null;
  }
  function getPageTitle3() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText3(ogTitle)) return cleanText3(ogTitle);
    const h1 = document.querySelector("main h1, h1");
    return cleanText3(h1?.textContent) || document.title.replace(/\s*[-–]\s*今日头条\s*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  function addComment(comment, username, seenCommentIds) {
    if (!comment) return 0;
    let matchedCount = 0;
    const commentId = cleanText3(comment.id_str || String(comment.id ?? ""));
    if (!commentId || !seenCommentIds.has(commentId)) {
      if (commentId) seenCommentIds.add(commentId);
      if (cleanText3(comment.user_name) === username) matchedCount++;
    }
    for (const reply of comment.reply_list || []) {
      matchedCount += addComment(reply, username, seenCommentIds);
    }
    for (const reply of comment.new_reply_list || []) {
      matchedCount += addComment(reply, username, seenCommentIds);
    }
    return matchedCount;
  }
  async function fetchCommentPage2(articleId, offset) {
    const url = new URL("/article/v4/tab_comments/", "https://www.toutiao.com");
    url.searchParams.set("aid", "24");
    url.searchParams.set("app_name", "toutiao_web");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("count", String(COMMENT_PAGE_SIZE2));
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
  async function countApiComments2(articleId, username) {
    const seenOffsets = /* @__PURE__ */ new Set();
    const seenCommentIds = /* @__PURE__ */ new Set();
    let offset = 0;
    let matchedCount = 0;
    for (let page = 0; page < MAX_COMMENT_PAGES2 && !seenOffsets.has(offset); page++) {
      seenOffsets.add(offset);
      const payload = await fetchCommentPage2(articleId, offset);
      for (const entry of payload.data || []) {
        matchedCount += addComment(entry.comment, username, seenCommentIds);
      }
      log3(`\u8BC4\u8BBA\u5206\u9875 ${page + 1}: offset=${offset}, \u8FD4\u56DE ${payload.data?.length || 0} \u6761`);
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
    log3("===== \u5F00\u59CB\u626B\u63CF\u4ECA\u65E5\u5934\u6761 =====");
    const username = await getCurrentUsername2();
    const articleId = getArticleId2();
    if (!username || !articleId) {
      log3("\u672A\u8BC6\u522B\u5230\u5F53\u524D\u767B\u5F55\u8D26\u53F7\u6216\u6587\u7AE0 ID");
      return null;
    }
    try {
      const commentCount = await countApiComments2(articleId, username);
      const title = getPageTitle3();
      log3(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
      return { platform: PLATFORM3, title, commentCount, username };
    } catch (error) {
      log3("\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5931\u8D25:", error);
      return null;
    }
  }

  // src/content/baijiahao.ts
  var PLATFORM4 = "baijiahao";
  var DEBUG4 = true;
  var COMMENT_ITEM_SELECTOR2 = ".xcp-item[data-reply-id]";
  var COMMENT_AUTHOR_SELECTOR = ".user-bar-uname";
  var MAX_LOAD_PAGES = 100;
  function log4(...args) {
    if (DEBUG4) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u767E\u5BB6\u53F7]", ...args);
  }
  function cleanText4(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function sleep3(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function detectCurrentUsername() {
    const accountLinks = document.querySelectorAll(
      'a[href="http://i.baidu.com/"], a[href="https://i.baidu.com/"], header a[href*="i.baidu.com"]'
    );
    for (const link of accountLinks) {
      const name = cleanText4(link.textContent || link.getAttribute("aria-label") || link.getAttribute("title"));
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
            const name = cleanText4(value.nickname || value.displayName || value.userName);
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
  async function getCurrentUsername3() {
    return resolvePlatformUsername(PLATFORM4, detectCurrentUsername());
  }
  function getPageTitle4() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText4(og)) return cleanText4(og);
    const h1 = document.querySelector("h1");
    return cleanText4(h1?.textContent) || document.title || "\u672A\u77E5\u6587\u7AE0";
  }
  function getDeclaredCommentCount() {
    for (const heading of document.querySelectorAll("h2")) {
      const match = cleanText4(heading.textContent).match(/^评论\s*(\d+)$/);
      if (match) return Number(match[1]);
    }
    return null;
  }
  function getCommentItems2() {
    return Array.from(document.querySelectorAll(COMMENT_ITEM_SELECTOR2));
  }
  function findLoadMoreButton2() {
    for (const element of document.querySelectorAll('.xcp-list-loader, button, [role="button"]')) {
      if (cleanText4(element.textContent) === "\u67E5\u770B\u66F4\u591A\u8BC4\u8BBA") return element;
    }
    return null;
  }
  async function waitForInitialComments(timeoutMs = 1e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const declaredCount2 = getDeclaredCommentCount();
      if (getCommentItems2().length > 0 || declaredCount2 === 0) return;
      await sleep3(250);
    }
    const declaredCount = getDeclaredCommentCount();
    if (declaredCount && declaredCount > 0) {
      throw new Error(`\u9875\u9762\u663E\u793A\u6709 ${declaredCount} \u6761\u8BC4\u8BBA\uFF0C\u4F46\u8BC4\u8BBA\u5217\u8868\u672A\u52A0\u8F7D`);
    }
  }
  async function loadAllComments2() {
    await waitForInitialComments();
    for (let page = 0; page < MAX_LOAD_PAGES; page++) {
      const before = getCommentItems2().length;
      const loadMore = findLoadMoreButton2();
      if (!loadMore) {
        log4(`\u8BC4\u8BBA\u5DF2\u5168\u90E8\u52A0\u8F7D\uFF0C\u5171 ${before} \u6761`);
        return;
      }
      log4(`\u52A0\u8F7D\u8BC4\u8BBA\u4E0B\u4E00\u9875\uFF0C\u5F53\u524D ${before} \u6761`);
      loadMore.click();
      const deadline = Date.now() + 8e3;
      let after = before;
      while (Date.now() < deadline) {
        await sleep3(250);
        after = getCommentItems2().length;
        if (after > before || !findLoadMoreButton2()) break;
      }
      if (after <= before && findLoadMoreButton2()) {
        throw new Error("\u70B9\u51FB\u201C\u67E5\u770B\u66F4\u591A\u8BC4\u8BBA\u201D\u540E\u6CA1\u6709\u52A0\u8F7D\u65B0\u8BC4\u8BBA");
      }
    }
    if (findLoadMoreButton2()) throw new Error("\u8BC4\u8BBA\u5206\u9875\u8D85\u8FC7\u5B89\u5168\u4E0A\u9650\uFF0C\u5DF2\u505C\u6B62\u7EE7\u7EED\u52A0\u8F7D");
  }
  function countMyComments2(username) {
    const normalizedUsername = cleanText4(username);
    const seenCommentIds = /* @__PURE__ */ new Set();
    let matchedCount = 0;
    for (const item of getCommentItems2()) {
      const commentId = cleanText4(item.dataset.replyId);
      if (!commentId || seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);
      const author = cleanText4(item.querySelector(COMMENT_AUTHOR_SELECTOR)?.textContent);
      if (author === normalizedUsername) matchedCount++;
    }
    log4(`\u7528\u6237\u201C${username}\u201D\u5339\u914D\u5230 ${matchedCount} \u6761\uFF0C\u53BB\u91CD\u540E\u5171\u68C0\u67E5 ${seenCommentIds.size} \u6761\u8BC4\u8BBA`);
    return matchedCount;
  }
  async function scanBaijiahaoPage() {
    log4("===== \u5F00\u59CB\u626B\u63CF\u767E\u5BB6\u53F7 =====");
    const username = await getCurrentUsername3();
    if (!username) {
      log4("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u8D26\u53F7\u8BBE\u7F6E\u4E2D\u586B\u5199\u767E\u5BB6\u53F7\u7528\u6237\u540D");
      return null;
    }
    try {
      await loadAllComments2();
      const commentCount = countMyComments2(username);
      const title = getPageTitle4();
      log4(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
      return { platform: PLATFORM4, title, commentCount, username };
    } catch (error) {
      const message = `\u767E\u5BB6\u53F7\u8BC4\u8BBA\u626B\u63CF\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      log4(message);
      await appendAccountLog(PLATFORM4, "error", message);
      return null;
    }
  }

  // src/content/netease.ts
  var PLATFORM5 = "netease";
  var DEBUG5 = true;
  var COMMENT_PAGE_SIZE3 = 30;
  var MAX_COMMENT_PAGES3 = 100;
  var COMMENT_API_ORIGIN = "https://comment.api.163.com";
  function log5(...args) {
    if (DEBUG5) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u7F51\u6613]", ...args);
  }
  function cleanText5(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function detectCurrentAccount2() {
    const nickname = cleanText5(
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
  async function getCurrentAccount2() {
    const detected = detectCurrentAccount2();
    const username = await resolvePlatformUsername(
      PLATFORM5,
      detected.nickname,
      detected.userId ? [detected.userId] : []
    );
    if (!username) return null;
    const userId = cleanText5(username) === cleanText5(detected.nickname) ? detected.userId : null;
    return { username, userId };
  }
  function getPageTitle5() {
    const og = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText5(og)) return cleanText5(og);
    const h1 = document.querySelector("h1");
    return cleanText5(h1?.textContent) || document.title.replace(/[_|｜].*网易.*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
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
  async function fetchCommentPage3(template, listType, offset) {
    const url = new URL(template.toString());
    url.pathname = url.pathname.replace(/\/(?:newList|hotList)$/, `/${listType}`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(COMMENT_PAGE_SIZE3));
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
      const commentId = cleanText5(comment.postId || String(comment.commentId ?? ""));
      if (!commentId || seenCommentIds.has(commentId)) continue;
      seenCommentIds.add(commentId);
      const sameUserId = Boolean(account.userId) && cleanText5(String(comment.user?.userId ?? "")) === account.userId;
      const sameNickname = cleanText5(comment.user?.nickname) === cleanText5(account.username);
      if (sameUserId || sameNickname) {
        matchedCount++;
        const nickname = cleanText5(comment.user?.nickname);
        if (nickname) matchedNicknames.add(nickname);
      }
    }
    return matchedCount;
  }
  async function scanCommentList(template, listType, account, seenCommentIds, matchedNicknames) {
    let offset = 0;
    let matchedCount = 0;
    for (let page = 0; page < MAX_COMMENT_PAGES3; page++) {
      const payload = await fetchCommentPage3(template, listType, offset);
      const commentIds = payload.commentIds || [];
      matchedCount += addComments(payload, account, seenCommentIds, matchedNicknames);
      const declaredTotal = Number(listType === "newList" ? payload.newListSize : payload.hotListSize);
      log5(`${listType} \u5206\u9875 ${page + 1}: offset=${offset}, \u8FD4\u56DE ${commentIds.length} \u6761\u6839\u8DDF\u8D34`);
      if (commentIds.length === 0 || commentIds.length < COMMENT_PAGE_SIZE3) break;
      offset += commentIds.length;
      if (Number.isFinite(declaredTotal) && offset >= declaredTotal) break;
    }
    return matchedCount;
  }
  async function countApiComments3(template, account) {
    const seenCommentIds = /* @__PURE__ */ new Set();
    const matchedNicknames = /* @__PURE__ */ new Set();
    let matchedCount = await scanCommentList(template, "newList", account, seenCommentIds, matchedNicknames);
    matchedCount += await scanCommentList(template, "hotList", account, seenCommentIds, matchedNicknames);
    log5(`\u6839\u8DDF\u8D34\u548C\u53C2\u4E0E\u56DE\u590D\u53BB\u91CD\u540E\u5171\u68C0\u67E5 ${seenCommentIds.size} \u6761\uFF0C\u5F53\u524D\u8D26\u53F7\u5339\u914D ${matchedCount} \u6761`);
    return { count: matchedCount, nickname: [...matchedNicknames][0] || "" };
  }
  async function scanNeteasePage() {
    log5("===== \u5F00\u59CB\u626B\u63CF\u7F51\u6613 =====");
    const account = await getCurrentAccount2();
    if (!account) {
      log5("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u8D26\u53F7\u8BBE\u7F6E\u4E2D\u586B\u5199\u7F51\u6613\u7528\u6237\u540D");
      return null;
    }
    try {
      const template = await waitForCommentApiTemplate();
      if (!template) throw new Error("\u672A\u53D1\u73B0\u7F51\u6613\u8BC4\u8BBA\u63A5\u53E3\uFF0C\u8BC4\u8BBA\u533A\u53EF\u80FD\u5C1A\u672A\u52A0\u8F7D");
      const comments = await countApiComments3(template, account);
      const title = getPageTitle5();
      log5(`===== \u626B\u63CF\u5B8C\u6210: ${comments.count} \u6761 =====`);
      return {
        platform: PLATFORM5,
        title,
        commentCount: comments.count,
        username: comments.nickname || account.username
      };
    } catch (error) {
      const message = `\u7F51\u6613\u8BC4\u8BBA\u626B\u63CF\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      log5(message);
      await appendAccountLog(PLATFORM5, "error", message);
      return null;
    }
  }

  // src/content/sohu.ts
  var PLATFORM6 = "sohu";
  function cleanText6(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  }
  function sleep4(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function detectCurrentUsername2() {
    const selectors = [
      "#commentList .comment-item",
      "#meComment .comment-submit .login-area .username",
      ".user-info .name",
      ".user-info .nickname",
      ".login-info .name",
      ".header-user .name",
      '[class*="user-center"] [class*="name"]',
      'a[href*="mp.sohu.com/profile"]'
    ];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = cleanText6(element.textContent || element.getAttribute("title"));
        if (text && !/登录|注册|个人中心|消息/.test(text) && text.length <= 40) return text;
      }
    }
    return null;
  }
  function getPageTitle6() {
    return cleanText6(
      document.querySelector('meta[property="og:title"]')?.content || document.querySelector("h1")?.textContent || document.title
    );
  }
  function commentItems() {
    const selectors = [
      "#commentList [data-comment-id]",
      "#commentList [data-id]",
      "#commentList .comment-item",
      "#commentList .comment-list-item",
      '#commentList [class*="comment-item"]',
      "[data-comment-id]",
      "[data-reply-id]",
      ".comment-list .comment-item",
      ".comment-list-item",
      ".cmt-list .cmt-item",
      '.comment-area [class*="comment-item"]'
    ];
    const unique = /* @__PURE__ */ new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((item) => unique.add(item));
    }
    return [...unique];
  }
  function authorName(item) {
    const element = item.querySelector(
      '.author-area.name, .author-area .name, .author-area .username, .user-name, .username, .nickname, .name, [class*="author-name"], [class*="user-name"]'
    );
    return cleanText6(element?.textContent || element?.getAttribute("title"));
  }
  async function openAndLoadComments() {
    const commentButton = document.querySelector("#leftComment") || Array.from(document.querySelectorAll('button, [role="button"], div.item')).find((element) => /评论|跟帖/.test(cleanText6(element.textContent)) || Boolean(element.querySelector('img[src*="icon_comment"]')));
    commentButton?.click();
    const deadline = Date.now() + 1e4;
    while (Date.now() < deadline && !document.querySelector("#meComment, #commentList")) await sleep4(500);
    for (let round = 0; round < 12; round++) {
      const more = Array.from(document.querySelectorAll('button, [role="button"], a, div')).find((element) => /加载更多|查看更多评论|更多评论/.test(cleanText6(element.textContent)) && element.offsetParent !== null);
      if (!more) break;
      more.click();
      await sleep4(800);
    }
  }
  async function scanSohuPage() {
    const detected = detectCurrentUsername2();
    const username = await resolvePlatformUsername(PLATFORM6, detected);
    if (!username) return null;
    await openAndLoadComments();
    const normalized = cleanText6(username);
    const seen = /* @__PURE__ */ new Set();
    let count = 0;
    for (const item of commentItems()) {
      const id = cleanText6(item.dataset.commentId || item.dataset.replyId || item.id);
      const key = id || cleanText6(item.textContent).slice(0, 160);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (authorName(item) === normalized) count++;
    }
    return { platform: PLATFORM6, title: getPageTitle6(), commentCount: count, username };
  }

  // src/content/actions.ts
  function sleep5(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function cleanLabel(value) {
    return (value || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, "").trim();
  }
  function visible(elements) {
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && !element.hasAttribute("disabled")) return element;
    }
    return null;
  }
  async function waitForVisible(locate, timeoutMs = 1e4) {
    const deadline = Date.now() + timeoutMs;
    let element = locate();
    while (!element && Date.now() < deadline) {
      await sleep5(350);
      element = locate();
    }
    return element;
  }
  function byText(pattern, selector = 'button, [role="button"], a, span, div') {
    return visible(Array.from(document.querySelectorAll(selector)).filter((element) => pattern.test((element.textContent || "").replace(/\s+/g, " ").trim())));
  }
  function stateEvidence(element) {
    const visibleDescendants = Array.from(element.querySelectorAll("*")).filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    }).slice(0, 40);
    const nodes = [element, ...visibleDescendants];
    return nodes.map((node) => [
      node.getAttribute("class") || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || "",
      node.getAttribute("data-state") || "",
      node.getAttribute("data-status") || "",
      node.getAttribute("src") || "",
      node.getAttribute("href") || ""
    ].join(" ")).join(" ");
  }
  function pressed(element, positive, negative) {
    if (!element) return null;
    const ariaPressed = element.getAttribute("aria-pressed");
    if (ariaPressed === "true") return true;
    if (ariaPressed === "false") return false;
    const ariaChecked = element.getAttribute("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;
    const evidence = `${stateEvidence(element)} ${cleanLabel(element.textContent)}`;
    if (positive.test(evidence)) return true;
    if (negative?.test(evidence)) return false;
    return null;
  }
  async function clickAndConfirm(locate, read, allowClick = true) {
    let element = locate();
    const before = read(element);
    if (before === true || !allowClick) return { value: before, performed: false };
    if (!element) return { value: null, performed: false };
    element.click();
    const deadline = Date.now() + 4500;
    let after = before;
    do {
      await sleep5(450);
      element = locate();
      after = read(element);
      if (after === true) return { value: true, performed: true };
    } while (Date.now() < deadline);
    return { value: after, performed: false };
  }
  function zhihuLike() {
    return visible(document.querySelectorAll('button[aria-label^="\u8D5E\u540C"], button[aria-label^="\u5DF2\u8D5E\u540C"]'));
  }
  function zhihuCollect() {
    return visible(document.querySelectorAll('button[aria-label*="\u6536\u85CF"], [role="button"][aria-label*="\u6536\u85CF"]'));
  }
  async function ensureZhihu(actions) {
    const liked = await clickAndConfirm(zhihuLike, (element) => {
      const label = element?.getAttribute("aria-label") || "";
      return element ? /^已赞同/.test(label) : null;
    }, actions.like !== false);
    const collected = await clickAndConfirm(zhihuCollect, (element) => {
      if (!element) return null;
      const label = cleanLabel(element.getAttribute("aria-label"));
      if (/已收藏|取消收藏/.test(label)) return true;
      if (label === "\u6536\u85CF") return false;
      return pressed(element, /is-active|selected|collected|已收藏|取消收藏/i, /not-collected|uncollected/i);
    }, actions.collect !== false);
    return {
      liked: liked.value,
      collected: collected.value,
      likePerformed: liked.performed,
      collectPerformed: collected.performed,
      warnings: []
    };
  }
  async function ensureToutiao(actions) {
    const like = () => visible(document.querySelectorAll('div.detail-like[role="button"]'));
    const collect = () => visible(document.querySelectorAll('div.detail-interaction-collect[role="button"]'));
    const liked = await clickAndConfirm(like, (element) => pressed(
      element,
      /(?:^|[\s_-])(?:active|liked|selected)(?:$|[\s_-])|cancel(?:-|_)?like|已赞|取消点赞/i,
      /(?:^|[\s_-])(?:inactive|unliked|not-liked)(?:$|[\s_-])|去点赞/i
    ), actions.like !== false);
    const collected = await clickAndConfirm(collect, (element) => pressed(
      element,
      /(?:^|[\s_-])(?:active|collected|selected)(?:$|[\s_-])|cancel(?:-|_)?collect|已收藏|取消收藏/i,
      /(?:^|[\s_-])(?:inactive|uncollected|not-collected)(?:$|[\s_-])|去收藏/i
    ), actions.collect !== false);
    return {
      liked: liked.value,
      collected: collected.value,
      likePerformed: liked.performed,
      collectPerformed: collected.performed,
      warnings: []
    };
  }
  async function ensureCsdn(actions) {
    const like = () => visible(document.querySelectorAll("li#is-like"));
    const collect = () => visible(document.querySelectorAll("#blog_detail_zk_collection"));
    const readCollected = (element) => {
      if (!element) return null;
      const activeIcon = visible(element.querySelectorAll(
        'img.collect-status.isactive, img[src*="CollectionActive"], img[src*="collectionActive"]'
      ));
      if (activeIcon) return true;
      const inactiveIcon = visible(element.querySelectorAll(
        'img.un-collect-status.isdefault, img[src*="tobarCollect2"]'
      ));
      if (inactiveIcon) return false;
      return pressed(
        element,
        /is-collection|has-collection|collected|cancel(?:-|_)?collection|已收藏|取消收藏/i,
        /not-collection|去收藏/i
      );
    };
    const liked = await clickAndConfirm(like, (element) => {
      if (!element) return null;
      return Boolean(document.querySelector("#is-like-imgactive.isactive")?.offsetParent) || /cancel-like|liked|已赞|取消点赞/i.test(`${element.className} ${element.getAttribute("title") || ""}`);
    }, actions.like !== false);
    const collectedResult = await clickAndConfirm(collect, readCollected, actions.collect !== false);
    let collected = collectedResult.value;
    let collectPerformed = collectedResult.performed;
    if (actions.collect !== false && collected === false) {
      const folder = visible(document.querySelectorAll("ul.csdn-collection-items li .collect-btn"));
      if (folder) {
        folder.click();
        const deadline = Date.now() + 4500;
        do {
          await sleep5(450);
          collected = readCollected(collect());
          if (collected === true) break;
        } while (Date.now() < deadline);
        collectPerformed = collected === true;
      }
    }
    return {
      liked: liked.value,
      collected,
      likePerformed: liked.performed,
      collectPerformed,
      warnings: []
    };
  }
  function baiduButton(icon) {
    return visible(Array.from(document.querySelectorAll("div.interact-btn")).filter((element) => Boolean(element.querySelector(`img[src*="${icon}"]`))));
  }
  async function ensureBaijiahao(actions) {
    const read = (element) => {
      if (!element) return null;
      const state = pressed(
        element,
        /_on\b|(?:^|[\s_-])(?:active|selected|checked|collected|liked)(?:$|[\s_-])|已收藏|取消收藏|已点赞|取消点赞/i,
        /_off\b|(?:^|[\s_-])(?:inactive|unselected|not-collected|not-liked)(?:$|[\s_-])|去收藏|去点赞/i
      );
      if (state !== null) return state;
      const imageSrc = element.querySelector("img")?.getAttribute("src") || "";
      if (/icon_(?:great|collect)/i.test(imageSrc)) return false;
      return null;
    };
    const liked = await clickAndConfirm(() => baiduButton("icon_great"), read, actions.like !== false);
    const collected = await clickAndConfirm(() => baiduButton("icon_collect"), read, actions.collect !== false);
    return {
      liked: liked.value,
      collected: collected.value,
      likePerformed: liked.performed,
      collectPerformed: collected.performed,
      warnings: []
    };
  }
  async function ensureSohu(actions) {
    const like = () => visible(document.querySelectorAll(".share-interaction-c .like-c-1"));
    const collect = () => visible(document.querySelectorAll(".share-interaction-c .collection-c-1"));
    const liked = await clickAndConfirm(like, (element) => {
      if (!element) return null;
      if (element.querySelector(".like-icon")) return true;
      if (element.querySelector(".no-like-icon")) return false;
      return null;
    }, actions.like !== false);
    const collected = await clickAndConfirm(collect, (element) => {
      if (!element) return null;
      if (element.querySelector(".collection-icon")) return true;
      if (element.querySelector(".no-collection-icon")) return false;
      return null;
    }, actions.collect !== false);
    return {
      liked: liked.value,
      collected: collected.value,
      likePerformed: liked.performed,
      collectPerformed: collected.performed,
      warnings: []
    };
  }
  async function ensureInteractions(platform, actions = { like: true, collect: true }) {
    switch (platform) {
      case "zhihu":
        return ensureZhihu(actions);
      case "toutiao":
        return ensureToutiao(actions);
      case "csdn":
        return ensureCsdn(actions);
      case "baijiahao":
        return ensureBaijiahao(actions);
      case "sohu":
        return ensureSohu(actions);
      // 网易文章页没有文章级点赞/收藏。这里直接跳过，避免误识别评论点赞或推荐列表按钮。
      case "netease":
        return { liked: null, collected: null, likePerformed: false, collectPerformed: false, warnings: [] };
      default:
        return { liked: null, collected: null, likePerformed: false, collectPerformed: false, warnings: ["\u5F53\u524D\u5E73\u53F0\u7B49\u5F85\u5F00\u53D1"] };
    }
  }
  function readInteractions(platform) {
    return ensureInteractions(platform, { like: false, collect: false });
  }
  function extractArticleText() {
    const selectors = [
      ".Post-RichText",
      "article",
      "#content_views",
      ".article-content",
      ".main-text",
      ".post_body",
      "#endText",
      ".content-box",
      "main"
    ];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.innerText?.trim() || "";
      if (text.length > 80) return text.slice(0, 8e3);
    }
    return (document.body.innerText || "").trim().slice(0, 8e3);
  }
  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function locateToutiaoDrawer() {
    return visible(document.querySelectorAll(
      '[role="dialog"][aria-label="\u8BC4\u8BBA"], .ttp-drawer[role="dialog"], .ttp-drawer, .ttp-portal-wrapper.ttp-comment-drawer'
    ));
  }
  function locateToutiaoEditor(drawerOnly = false) {
    const drawer = locateToutiaoDrawer();
    if (drawerOnly && !drawer) return null;
    const root = drawer || document;
    return visible(root.querySelectorAll(
      '.ttp-comment-input .comment-textarea[contenteditable="true"], [contenteditable="true"], textarea[placeholder*="\u8BC4\u8BBA"], textarea[placeholder*="\u53CB\u5584"]'
    ));
  }
  async function postZhihu(text) {
    const response = await chrome.runtime.sendMessage({
      type: "TRUSTED_ZHIHU_COMMENT",
      text
    });
    if (!response?.success) throw new Error(response?.error || "\u77E5\u4E4E\u8BC4\u8BBA\u64CD\u4F5C\u672A\u5B8C\u6210");
  }
  async function postToutiao(text) {
    let editor = locateToutiaoEditor();
    let drawer = locateToutiaoDrawer();
    if (!editor) {
      const openers = [
        ...Array.from(document.querySelectorAll(
          '[aria-label^="\u6253\u5F00\u8BC4\u8BBA\u9762\u677F"], div.detail-interaction-comment[role="button"], [class*="interaction-comment"][role="button"]'
        )),
        ...Array.from(document.querySelectorAll('button, [role="button"]')).filter((element) => /^查看全部\d*条评论$/.test(cleanLabel(element.textContent)))
      ].filter((element, index, all) => all.indexOf(element) === index);
      for (const opener of openers) {
        if (visible([opener]) !== opener) continue;
        opener.click();
        const surface = await waitForVisible(
          () => locateToutiaoDrawer() || locateToutiaoEditor(),
          3500
        );
        if (!surface) continue;
        drawer = locateToutiaoDrawer();
        editor = await waitForVisible(() => locateToutiaoEditor(Boolean(drawer)), 3500);
        if (editor) break;
      }
    }
    editor || (editor = await waitForVisible(() => locateToutiaoEditor(Boolean(drawer)), 12e3));
    if (!editor) throw new Error("\u627E\u4E0D\u5230\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u8F93\u5165\u6846");
    const scope = editor.closest('.main-input, [role="dialog"], .ttp-drawer, form') || document.body;
    const button = visible(Array.from(scope.querySelectorAll("div.main-input button, button.submit-btn")).filter((item) => /^(发布|发表|发送|评论)$/.test(cleanLabel(item.textContent))));
    if (!button) throw new Error("\u627E\u4E0D\u5230\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u6309\u94AE");
    const response = await chrome.runtime.sendMessage({
      type: "TRUSTED_TOUTIAO_COMMENT",
      text
    });
    if (!response?.success) throw new Error(response?.error || "\u4ECA\u65E5\u5934\u6761\u8BC4\u8BBA\u64CD\u4F5C\u672A\u5B8C\u6210");
  }
  async function postBaijiahao(text) {
    const response = await chrome.runtime.sendMessage({
      type: "TRUSTED_BAIJIAHAO_COMMENT",
      text
    });
    if (!response?.success) throw new Error(response?.error || "\u767E\u5BB6\u53F7\u8BC4\u8BBA\u64CD\u4F5C\u672A\u5B8C\u6210");
  }
  async function postTextarea(text, inputSelector, buttonSelector, missingLabel, openerSelector) {
    let editor = visible(document.querySelectorAll(inputSelector));
    if (!editor && openerSelector) {
      visible(document.querySelectorAll(openerSelector))?.click();
      editor = await waitForVisible(() => visible(document.querySelectorAll(inputSelector)), 1e4);
    }
    if (!editor) throw new Error(`\u627E\u4E0D\u5230${missingLabel}\u8BC4\u8BBA\u8F93\u5165\u6846`);
    editor.focus();
    setNativeValue(editor, text);
    const button = await waitForVisible(() => visible(document.querySelectorAll(buttonSelector)), 6e3);
    if (!button) throw new Error(`\u627E\u4E0D\u5230${missingLabel}\u53D1\u5E03\u6309\u94AE`);
    button.click();
  }
  async function postNetease(text) {
    const editor = await waitForVisible(() => visible(document.querySelectorAll(
      '#tieArea textarea.js-cnt-box, #tieArea textarea, #tieArea [contenteditable="true"], .tie-input-bar textarea'
    )), 1e4);
    if (!editor) throw new Error("\u627E\u4E0D\u5230\u7F51\u6613\u8DDF\u5E16\u8F93\u5165\u6846");
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) setNativeValue(editor, text);
    else {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    const button = await waitForVisible(() => visible(document.querySelectorAll(
      '#tieArea .submit-btn.js-submit-btn, #tieArea button[type="submit"], #tieArea .submit-btn, .tie-submit'
    )) || byText(/^\s*(我要发贴|发布|发表|跟贴)\s*$/), 6e3);
    if (!button) throw new Error("\u627E\u4E0D\u5230\u7F51\u6613\u8DDF\u5E16\u53D1\u5E03\u6309\u94AE");
    button.click();
  }
  async function postSohu(text) {
    const editor = await waitForVisible(() => visible(document.querySelectorAll(
      '#meComment textarea#commentEditor, .comment-submit textarea[placeholder*="\u641C\u72D0"]'
    )), 1e4);
    if (!editor) throw new Error("\u627E\u4E0D\u5230\u641C\u72D0\u8BC4\u8BBA\u8F93\u5165\u6846");
    editor.focus();
    setNativeValue(editor, text);
    const button = await waitForVisible(() => visible(Array.from(document.querySelectorAll(
      "#meComment .comment-submit .submit, #meComment button"
    )).filter((element) => /^(发布|发表|评论)$/.test(cleanLabel(element.textContent)))), 6e3);
    if (!button) throw new Error("\u627E\u4E0D\u5230\u641C\u72D0\u8BC4\u8BBA\u53D1\u5E03\u6309\u94AE");
    button.click();
  }
  async function postComment(platform, text) {
    switch (platform) {
      case "zhihu":
        return postZhihu(text);
      case "toutiao":
        return postToutiao(text);
      case "csdn":
        return postTextarea(
          text,
          "textarea#comment_content",
          'input.btn-comment-input[type="submit"]',
          "CSDN",
          "a.has-comment-bt-right.go-side-comment"
        );
      case "baijiahao":
        return postBaijiahao(text);
      case "netease":
        return postNetease(text);
      case "sohu":
        return postSohu(text);
      default:
        throw new Error("\u5F53\u524D\u5E73\u53F0\u7B49\u5F85\u5F00\u53D1\uFF0C\u6682\u4E0D\u652F\u6301\u8BC4\u8BBA");
    }
  }

  // src/shared/types.ts
  var PlatformLabel = {
    csdn: "CSDN",
    zhihu: "\u77E5\u4E4E",
    toutiao: "\u4ECA\u65E5\u5934\u6761",
    baijiahao: "\u767E\u5BB6\u53F7",
    netease: "\u7F51\u6613",
    sohu: "\u641C\u72D0",
    third_party: "\u7B2C\u4E09\u65B9\u5E73\u53F0"
  };

  // src/content/evidence.ts
  var COMMENT_CONTENT_SELECTORS = {
    csdn: ".comment-list-box .new-comment, .comment-list-box .comment-content, .comment-box .new-comment, .comment-box .comment-content",
    zhihu: '.Comments-container .CommentContent, [class*="CommentItem"] [class*="CommentContent"]',
    toutiao: '.ttp-comment-item .content, [class*="comment-item"] [class*="content"]',
    baijiahao: ".xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text",
    netease: ".tie-new .tie-cnt, .tie-hot .tie-cnt, #tieArea .tie-cnt, #tieArea .comment-content",
    sohu: '#commentList .comment-content-text, #commentList .comment-content, #commentList .comment-text, #commentList [class*="comment-content"]'
  };
  var COMMENT_ITEM_SELECTORS = {
    csdn: ".comment-list-item",
    zhihu: "div[data-id]",
    toutiao: '.ttp-comment-item, [class*="comment-list"] [class*="comment-item"]',
    baijiahao: ".xcp-item[data-reply-id]",
    netease: '.tie-new .list-bdy > .trunk, .tie-hot .list-bdy > .trunk, .tie-new .list-bdy > .trunk .floor .self, .tie-hot .list-bdy > .trunk .floor .self, #tieArea .single-tie, #tieArea .comment-item, #tieArea [class*="tie-item"]',
    sohu: '#commentList .comment-item, #commentList [data-comment-id], #commentList [data-id], #commentList .comment-list-item, #commentList [class*="comment-item"]'
  };
  var COMMENT_AUTHOR_SELECTORS = {
    csdn: '.name-href .name, .user-name, .comment-user-name, .comment-nickname, [class*="user-name"], [class*="nick"]',
    zhihu: 'a[href*="/people/"], .UserLink-link, [class*="CommentItem"] [class*="author"]',
    toutiao: '.user-name, [class*="user-name"], [class*="userName"], a[href*="/c/user/"]',
    baijiahao: ".user-bar-uname",
    netease: '.nickname, .tie-author .name, [class*="user-name"], [class*="nickname"]',
    sohu: '.author-area.name, .author-area .name, .author-area .username, .username, .user-name, .nickname, [class*="user-name"], [class*="author-name"]'
  };
  var COMMENT_BODY_SELECTORS = {
    csdn: '.new-comment, .comment-content, [class*="comment-content"]',
    zhihu: '.CommentContent, [class*="CommentContent"]',
    toutiao: '.content, [class*="comment-content"], [class*="commentContent"]',
    baijiahao: ".x-interact-rich-text, .rich-text",
    netease: '.tie-cnt, .comment-content, [class*="comment-content"]',
    sohu: '.comment-content-text, .comment-content, .comment-text, [class*="comment-content"], [class*="comment-text"]'
  };
  var accountCommentCaptureSession = null;
  var COMMENT_ROOT_SELECTORS = {
    csdn: ".comment-side-content, .comment-list-box, .comment-box",
    zhihu: '.Modal-content, .Comments-container, .Comments, [class*="CommentModal"], [class*="CommentDrawer"]',
    toutiao: '.ttp-drawer, .ttp-comment-block, .ttp-comment-list, [class*="comment-list"]',
    baijiahao: '.xcp-list, [class*="comment-list"], .xcp-comment',
    netease: ".tie-new, .tie-hot, #tieArea",
    sohu: "#commentList, #meComment"
  };
  function comparable(value) {
    return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, "").trim();
  }
  function isElementVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 1 && rect.height > 1;
  }
  function findCommentRoot(platform) {
    if (platform === "csdn") {
      return Array.from(document.querySelectorAll(".comment-side-content")).find(isElementVisible) || null;
    }
    if (platform === "netease" && location.hostname === "comment.tie.163.com") {
      return isElementVisible(document.body) ? document.body : null;
    }
    const selector = COMMENT_ROOT_SELECTORS[platform];
    if (!selector) return null;
    const roots = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
    return roots.sort((a, b) => b.querySelectorAll(COMMENT_ITEM_SELECTORS[platform] || "*").length - a.querySelectorAll(COMMENT_ITEM_SELECTORS[platform] || "*").length)[0] || null;
  }
  function commentBody(item, platform) {
    if (platform === "netease" && item.classList.contains("trunk")) {
      return item.querySelector(":scope > .rgt-col > .tie-bdy > .tie-cnt");
    }
    if (platform === "netease" && item.classList.contains("self")) {
      return item.querySelector(":scope > .tie-cnt");
    }
    const selector = COMMENT_BODY_SELECTORS[platform];
    return selector ? item.querySelector(selector) : null;
  }
  function commentAuthorValues(item, platform) {
    const values = [];
    if (platform === "netease") {
      const author = item.classList.contains("trunk") ? item.querySelector(":scope > .rgt-col > .tie-author .nickname") : item.classList.contains("self") ? item.querySelector(":scope > .tie-author .nickname") : null;
      const text = comparable(author?.textContent || author?.getAttribute("title") || "");
      if (text) return [text];
    }
    const selector = COMMENT_AUTHOR_SELECTORS[platform];
    if (selector) {
      for (const element of item.querySelectorAll(selector)) {
        const text = comparable(element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "");
        if (text && text.length <= 100) values.push(text);
      }
    }
    if (platform === "csdn") {
      for (const link of item.querySelectorAll('a[href*="blog.csdn.net/"]')) {
        try {
          const account = decodeURIComponent(new URL(link.href, location.href).pathname.split("/").filter(Boolean)[0] || "");
          if (account) values.push(comparable(account));
        } catch {
        }
      }
    }
    return [...new Set(values)];
  }
  function itemMatchesAccount(item, session) {
    const expected = comparable(session.expectedComment);
    const text = comparable(commentBody(item, session.platform)?.textContent || "");
    if (expected) return Boolean(text && text.includes(expected));
    const username = comparable(session.username).toLowerCase();
    if (!username) return false;
    return commentAuthorValues(item, session.platform).some((value) => value.toLowerCase() === username);
  }
  function currentMatchingItems(session) {
    const root = findCommentRoot(session.platform);
    const selector = COMMENT_ITEM_SELECTORS[session.platform];
    if (!root || !selector) return [];
    const candidates = [...new Set(Array.from(root.querySelectorAll(selector)))].filter(isElementVisible);
    const occurrences = /* @__PURE__ */ new Map();
    const result = [];
    for (const item of candidates) {
      if (!itemMatchesAccount(item, session)) continue;
      const body = commentBody(item, session.platform);
      const commentText = (body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2e3);
      if (!commentText) continue;
      const commentId = readCommentId(item);
      const author = commentAuthorValues(item, session.platform)[0] || session.username;
      const platformDisplayedTime = readPlatformTime(item);
      const baseKey = commentId ? `id:${commentId}` : `text:${comparable(author)}:${comparable(commentText).slice(0, 800)}:${comparable(platformDisplayedTime)}`;
      const occurrence = occurrences.get(baseKey) || 0;
      occurrences.set(baseKey, occurrence + 1);
      const commentKey = occurrence > 0 ? `${baseKey}:copy:${occurrence + 1}` : baseKey;
      result.push({
        item,
        target: {
          commentId: commentId || void 0,
          commentKey,
          commentText,
          author,
          platformDisplayedTime: platformDisplayedTime || void 0
        }
      });
    }
    return result;
  }
  async function waitForCommentRoot2(platform, timeoutMs = 8e3) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const root = findCommentRoot(platform);
      if (root) return root;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return findCommentRoot(platform);
  }
  async function openCommentAreaForCapture(platform) {
    document.getElementById("ai-comment-notification")?.remove();
    if (platform === "csdn") {
      const sidePanelOpen = Array.from(document.querySelectorAll(".comment-side-content")).some(isElementVisible);
      if (!sidePanelOpen) {
        const opener = Array.from(document.querySelectorAll(
          ".has-comment-tit.go-side-comment, .tool-item-href.go-side-comment, .go-side-comment"
        )).find((element) => isElementVisible(element) && /(?:条评论|评论|写评论)/.test(comparable(element.textContent || "")));
        opener?.click();
        if (opener) {
          const deadline = Date.now() + 8e3;
          while (!Array.from(document.querySelectorAll(".comment-side-content")).some(isElementVisible) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    }
    if (platform === "toutiao") {
      const drawerOpen = Array.from(document.querySelectorAll(".ttp-drawer")).some(isElementVisible);
      if (!drawerOpen) {
        const panel = Array.from(document.querySelectorAll(
          'div.detail-interaction-comment[role="button"], [aria-label^="\u6253\u5F00\u8BC4\u8BBA\u9762\u677F"], [class*="interaction-comment"][role="button"]'
        )).find(isElementVisible);
        panel?.click();
        if (panel) {
          const deadline = Date.now() + 8e3;
          while (!Array.from(document.querySelectorAll(".ttp-drawer")).some(isElementVisible) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    }
    if (platform === "zhihu") {
      const isModalOpen = () => Array.from(document.querySelectorAll(".Modal-content")).some(isElementVisible);
      let modalOpen = isModalOpen();
      if (!modalOpen) {
        const viewAll = Array.from(document.querySelectorAll(
          'button, a, [role="button"], div'
        )).find((element) => isElementVisible(element) && /^(?:点击)?查看全部评论$/.test(comparable(element.textContent || "")));
        viewAll?.click();
        if (viewAll) {
          const deadline = Date.now() + 8e3;
          while (!isModalOpen() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          modalOpen = isModalOpen();
        }
      }
      if (!modalOpen) {
        const opener = Array.from(document.querySelectorAll(
          'button.BottomActions-CommentBtn, button[aria-label*="\u6761\u8BC4\u8BBA"], button[aria-label*="\u8BC4\u8BBA"]'
        )).find((element) => isElementVisible(element) && /评论/.test(`${element.getAttribute("aria-label") || ""}${element.textContent || ""}`));
        opener?.click();
        if (opener) {
          const deadline = Date.now() + 8e3;
          while (!isModalOpen() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    }
    if (platform === "sohu") {
      const root2 = findCommentRoot(platform);
      if (!root2 || !root2.querySelector(COMMENT_ITEM_SELECTORS.sohu || "")) {
        document.querySelector("#leftComment")?.click();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    const root = await waitForCommentRoot2(platform);
    if (platform !== "zhihu") root?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  function findLoadMoreCommentButton(root) {
    return Array.from(root.querySelectorAll(
      '.look-flod-comment, .look-more-comment, .load-more-btn, button, [role="button"], a, [class*="loader"]'
    )).find((element) => {
      if (!isElementVisible(element)) return false;
      if (element.classList.contains("look-flod-comment")) return true;
      const text = (element.textContent || "").replace(/\s+/g, "").trim();
      return /^(?:(?:查看|加载|展开)(?:全部)?(?:更多)?\d*条?(?:评论|回复)|下一页|下页)$/.test(text);
    }) || null;
  }
  function findScrollableCommentContainer(root) {
    const candidates = [root, ...Array.from(root.querySelectorAll("div, ul, ol, section"))];
    return candidates.find((element) => {
      if (!isElementVisible(element)) return false;
      const style = getComputedStyle(element);
      return /(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflow}`) && element.scrollHeight > element.clientHeight + 20;
    }) || null;
  }
  function findScrollableCommentAncestor(item, root) {
    let current = item.parentElement;
    while (current) {
      const style = getComputedStyle(current);
      if (isElementVisible(current) && /(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflow}`) && current.scrollHeight > current.clientHeight + 20) {
        return current;
      }
      if (current === root) break;
      current = current.parentElement;
    }
    return null;
  }
  function isItemInsideCaptureViewport(item, scrollable) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
      return false;
    }
    if (!scrollable) return true;
    const containerRect = scrollable.getBoundingClientRect();
    return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
  }
  function usesDynamicCommentList(platform) {
    return platform === "zhihu" || platform === "toutiao";
  }
  function currentItemForKey(session, commentKey) {
    return currentMatchingItems(session).find((entry) => entry.target.commentKey === commentKey)?.item || null;
  }
  async function positionCommentForScreenshot(item, session, commentKey) {
    const platform = session.platform;
    let currentItem = item;
    const maxAttempts = usesDynamicCommentList(platform) ? 1 : 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (usesDynamicCommentList(platform)) {
        currentItem = currentItemForKey(session, commentKey) || currentItem;
      }
      if (!currentItem.isConnected) {
        currentItem = currentItemForKey(session, commentKey) || currentItem;
        if (!currentItem.isConnected) return false;
      }
      const root = findCommentRoot(platform);
      const scrollable = root ? findScrollableCommentAncestor(currentItem, root) : null;
      currentItem.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      if (scrollable) {
        const itemRect = currentItem.getBoundingClientRect();
        const containerRect = scrollable.getBoundingClientRect();
        scrollable.scrollTo({
          top: Math.max(0, scrollable.scrollTop + itemRect.top + itemRect.height / 2 - (containerRect.top + containerRect.height / 2)),
          behavior: "auto"
        });
      }
      await new Promise((resolve) => setTimeout(
        resolve,
        usesDynamicCommentList(platform) ? 300 : 350 + attempt * 150
      ));
      if (usesDynamicCommentList(platform)) {
        currentItem = currentItemForKey(session, commentKey) || currentItem;
      }
      const currentRoot = findCommentRoot(platform);
      const currentScrollable = currentRoot ? findScrollableCommentAncestor(currentItem, currentRoot) : null;
      if (currentItem.isConnected && isElementVisible(currentItem) && isItemInsideCaptureViewport(currentItem, currentScrollable)) {
        return true;
      }
    }
    return false;
  }
  function commentListSignature(platform) {
    const root = findCommentRoot(platform);
    const selector = COMMENT_ITEM_SELECTORS[platform];
    if (!root || !selector) return "";
    const items = Array.from(root.querySelectorAll(selector)).filter(isElementVisible);
    const samples = items.length <= 12 ? items : [...items.slice(0, 4), ...items.slice(-8)];
    return `${items.length}:${samples.map((item) => {
      const id = readCommentId(item);
      if (id) return `id:${id}`;
      const author = commentAuthorValues(item, platform)[0] || "";
      const body = comparable(commentBody(item, platform)?.textContent || "").slice(0, 120);
      return `${author}:${body}`;
    }).join("|")}`;
  }
  async function advanceCommentList(session) {
    const root = findCommentRoot(session.platform);
    if (!root) return false;
    if (session.platform === "netease") {
      const newView = document.querySelector(".tie-new");
      const hotView = document.querySelector(".tie-hot");
      const activeView = newView && isElementVisible(newView) ? { name: "new", element: newView } : hotView && isElementVisible(hotView) ? { name: "hot", element: hotView } : null;
      const pageScope = activeView?.element || root;
      const nextPage = Array.from(pageScope.querySelectorAll(
        ".m-page .next.z-enable, .m-page li .next.z-enable"
      )).find(isElementVisible);
      if (nextPage) {
        const beforeSignature = commentListSignature(session.platform);
        nextPage.click();
        const deadline = Date.now() + 6e3;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (commentListSignature(session.platform) !== beforeSignature) return true;
        }
        return false;
      }
      if (activeView) {
        session.neteaseVisitedViews.add(activeView.name);
        const alternate = activeView.name === "new" ? { name: "hot", element: hotView } : { name: "new", element: newView };
        if (alternate.element && !session.neteaseVisitedViews.has(alternate.name)) {
          activeView.element.style.display = "none";
          alternate.element.style.display = "block";
          alternate.element.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
          await new Promise((resolve) => setTimeout(resolve, 600));
          return true;
        }
      }
      return false;
    }
    const loadMore = findLoadMoreCommentButton(root);
    let scrollable = null;
    let beforeScrollTop = 0;
    if (loadMore) {
      loadMore.scrollIntoView({ behavior: "auto", block: "center" });
      loadMore.click();
    } else {
      scrollable = findScrollableCommentContainer(root);
      if (scrollable) {
        beforeScrollTop = scrollable.scrollTop;
        scrollable.scrollTo({
          top: Math.min(scrollable.scrollHeight, scrollable.scrollTop + Math.max(240, scrollable.clientHeight * 0.8)),
          behavior: "auto"
        });
      } else {
        const selector = COMMENT_ITEM_SELECTORS[session.platform] || "";
        const items = selector ? Array.from(root.querySelectorAll(selector)) : [];
        const last = items.length ? items[items.length - 1] : null;
        if (last) last.scrollIntoView({ behavior: "auto", block: "end" });
        else window.scrollBy({ top: Math.max(300, window.innerHeight * 0.75), behavior: "auto" });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, loadMore ? 1100 : 800));
    if (usesDynamicCommentList(session.platform)) {
      const moved = Boolean(scrollable && Math.abs(scrollable.scrollTop - beforeScrollTop) > 2);
      return Boolean(loadMore || moved);
    }
    return Boolean(loadMore || findScrollableCommentContainer(root));
  }
  async function startAccountCommentCapture(request) {
    if (!COMMENT_ITEM_SELECTORS[request.platform] || !COMMENT_ROOT_SELECTORS[request.platform]) {
      return { success: false, error: "\u5F53\u524D\u5E73\u53F0\u6CA1\u6709\u8BC4\u8BBA\u622A\u56FE\u89C4\u5219" };
    }
    accountCommentCaptureSession = {
      platform: request.platform,
      username: String(request.username || "").trim(),
      expectedComment: String(request.expectedComment || "").trim().slice(0, 2e3),
      seenKeys: /* @__PURE__ */ new Set(),
      advanceAttempts: 0,
      stableRounds: 0,
      positionFailures: /* @__PURE__ */ new Map(),
      neteaseVisitedViews: /* @__PURE__ */ new Set()
    };
    await openCommentAreaForCapture(request.platform);
    let root = findCommentRoot(request.platform);
    if (root && usesDynamicCommentList(request.platform)) {
      const scrollable = findScrollableCommentContainer(root);
      if (scrollable && scrollable.scrollTop > 2) {
        scrollable.scrollTo({ top: 0, behavior: "auto" });
        await new Promise((resolve) => setTimeout(resolve, 450));
        root = findCommentRoot(request.platform);
      }
    }
    const selector = COMMENT_ITEM_SELECTORS[request.platform];
    const candidateCount = root && selector ? root.querySelectorAll(selector).length : 0;
    const matchingCount = currentMatchingItems(accountCommentCaptureSession).length;
    return {
      success: true,
      rootFound: Boolean(root),
      modalFound: request.platform !== "zhihu" || Array.from(document.querySelectorAll(".Modal-content")).some(isElementVisible),
      candidateCount,
      matchingCount,
      scrollContainerFound: Boolean(root && findScrollableCommentContainer(root))
    };
  }
  async function nextAccountCommentCapture() {
    const session = accountCommentCaptureSession;
    if (!session) return { success: false, done: true, error: "\u8BC4\u8BBA\u622A\u56FE\u4F1A\u8BDD\u5C1A\u672A\u5F00\u59CB" };
    if (usesDynamicCommentList(session.platform)) {
      const available = currentMatchingItems(session).find((entry) => !session.seenKeys.has(entry.target.commentKey));
      if (available) {
        const positioned = await positionCommentForScreenshot(
          available.item,
          session,
          available.target.commentKey
        );
        if (!positioned) {
          const failures = (session.positionFailures.get(available.target.commentKey) || 0) + 1;
          session.positionFailures.set(available.target.commentKey, failures);
          if (failures >= 2) {
            const advanced2 = await advanceCommentList(session);
            session.advanceAttempts++;
            session.stableRounds = advanced2 ? 0 : session.stableRounds + 1;
          }
          return { success: true, done: false };
        }
        session.seenKeys.add(available.target.commentKey);
        session.positionFailures.delete(available.target.commentKey);
        session.stableRounds = 0;
        const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const x = Math.max(0, window.scrollX);
        const y = Math.max(0, window.scrollY);
        const width = Math.max(1, Math.min(documentWidth - x, window.innerWidth, 2200));
        const height = Math.max(1, Math.min(documentHeight - y, window.innerHeight, 5e3));
        return {
          success: true,
          done: false,
          target: { ...available.target, clip: { x, y, width, height } }
        };
      }
      if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
        const matches = currentMatchingItems(session);
        const root = findCommentRoot(session.platform);
        const selector = COMMENT_ITEM_SELECTORS[session.platform];
        return {
          success: true,
          done: true,
          candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
          matchingCount: matches.length,
          advanceAttempts: session.advanceAttempts
        };
      }
      const advanced = await advanceCommentList(session);
      session.advanceAttempts++;
      session.stableRounds = advanced ? 0 : session.stableRounds + 1;
      return { success: true, done: false };
    }
    for (let cycle = 0; cycle < 4; cycle++) {
      const available = currentMatchingItems(session).find((entry) => !session.seenKeys.has(entry.target.commentKey));
      if (available) {
        if (!await positionCommentForScreenshot(available.item, session, available.target.commentKey)) {
          const failures = (session.positionFailures.get(available.target.commentKey) || 0) + 1;
          session.positionFailures.set(available.target.commentKey, failures);
          if (usesDynamicCommentList(session.platform)) {
            const advanced2 = await advanceCommentList(session);
            session.advanceAttempts++;
            session.stableRounds = advanced2 ? 0 : session.stableRounds + 1;
            if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
              const matches = currentMatchingItems(session);
              const root = findCommentRoot(session.platform);
              const selector = COMMENT_ITEM_SELECTORS[session.platform];
              return {
                success: true,
                done: true,
                candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
                matchingCount: matches.length,
                advanceAttempts: session.advanceAttempts
              };
            }
          } else {
            if (failures >= 3) session.seenKeys.add(available.target.commentKey);
            session.stableRounds++;
          }
          continue;
        }
        session.seenKeys.add(available.target.commentKey);
        session.positionFailures.delete(available.target.commentKey);
        const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const x = Math.max(0, window.scrollX);
        const y = Math.max(0, window.scrollY);
        const width = Math.max(1, Math.min(documentWidth - x, window.innerWidth, 2200));
        const height = Math.max(1, Math.min(documentHeight - y, window.innerHeight, 5e3));
        session.stableRounds = 0;
        return {
          success: true,
          done: false,
          target: { ...available.target, clip: { x, y, width, height } }
        };
      }
      if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
        const matches = currentMatchingItems(session);
        const root = findCommentRoot(session.platform);
        const selector = COMMENT_ITEM_SELECTORS[session.platform];
        return {
          success: true,
          done: true,
          candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
          matchingCount: matches.length,
          advanceAttempts: session.advanceAttempts
        };
      }
      const beforeSignature = commentListSignature(session.platform);
      const advanced = await advanceCommentList(session);
      session.advanceAttempts++;
      const afterSignature = commentListSignature(session.platform);
      session.stableRounds = usesDynamicCommentList(session.platform) ? advanced ? 0 : session.stableRounds + 1 : !advanced || beforeSignature === afterSignature ? session.stableRounds + 1 : 0;
    }
    return { success: true, done: false };
  }
  function endAccountCommentCapture() {
    accountCommentCaptureSession = null;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function articleIdFromUrl(value) {
    try {
      const url = new URL(value);
      const matched = url.pathname.match(/(?:article|item|p|answer|detail)[/_-]?(\d{5,})/i) || url.pathname.match(/(\d{5,})(?:\/|\.html)?$/);
      return matched?.[1] || url.pathname.replace(/^\/+|\/+$/g, "") || url.hostname;
    } catch {
      return "";
    }
  }
  function readCommentId(element) {
    if (!element) return "";
    const attributes = ["data-reply-id", "data-comment-id", "data-commentid", "data-post-id", "data-id"];
    const candidates = [
      element,
      element.querySelector("[data-reply-id], [data-comment-id], [data-commentid], [data-post-id]")
    ].filter((candidate) => Boolean(candidate));
    for (const candidate of candidates) {
      for (const name of attributes) {
        const value = candidate.getAttribute(name)?.trim();
        if (value) return value.slice(0, 160);
      }
    }
    return "";
  }
  function readPlatformTime(element) {
    if (!element) return "";
    const candidate = element.querySelector('time, [class*="time"], [class*="date"], [data-time]');
    return (candidate?.getAttribute("datetime") || candidate?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  function readDeclaredTotalCount(root) {
    const scope = root || document.body;
    const candidates = Array.from(scope.querySelectorAll('h1, h2, h3, [aria-label], [class*="comment-title"], [class*="comment-count"]')).slice(0, 120);
    for (const element of candidates) {
      const text = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`.replace(/\s+/g, " ").trim();
      const match = text.match(/(?:评论|跟帖|参与)[^\d]{0,8}(\d{1,8})|([0-9]{1,8})[^\d]{0,4}(?:条)?(?:评论|跟帖)/);
      const value = Number(match?.[1] || match?.[2]);
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    return void 0;
  }
  function sanitizeClone(source, isTarget) {
    const clone = source.cloneNode(true);
    if (isTarget) clone.classList.add("evidence-target-node");
    for (const blocked of Array.from(clone.querySelectorAll(
      "script, style, link, iframe, object, embed, form, input, textarea, button, select, option, canvas, video, audio, noscript, template, svg, img"
    ))) blocked.remove();
    for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const keep = name === "class" || name === "title" || name === "datetime" || name === "aria-label";
        if (!keep || name.startsWith("on")) element.removeAttribute(attribute.name);
      }
      if (element instanceof HTMLAnchorElement) element.removeAttribute("href");
    }
    return clone;
  }
  function selectCommentItems(root, selector, targetItem) {
    const candidates = Array.from(root.querySelectorAll(selector));
    const all = candidates.filter((item) => !candidates.some((other) => other !== item && other.contains(item)));
    if (targetItem && !all.includes(targetItem)) all.push(targetItem);
    if (all.length <= 40) return all;
    const targetIndex = targetItem ? all.indexOf(targetItem) : -1;
    if (targetIndex < 0) return all.slice(0, 40);
    const start = Math.max(0, Math.min(targetIndex - 19, all.length - 40));
    return all.slice(start, start + 40);
  }
  function buildArchiveDocument(request, commentHtml, targetFoundInDom, capturedItemCount, commentId, platformDisplayedTime, declaredTotalCount) {
    const platform = PlatformLabel[request.platform];
    const capturedAtText = new Date(request.capturedAt).toLocaleString("zh-CN", { hour12: false });
    const basisText = targetFoundInDom ? "\u9875\u9762\u8BC4\u8BBA\u8282\u70B9\u4E0E\u672C\u6B21\u8BC4\u8BBA\u6587\u5B57\u4E00\u81F4" : request.comment ? "\u672C\u6B21\u6307\u5B9A\u4E86\u76EE\u6807\u8BC4\u8BBA\uFF0C\u4F46\u5F53\u524D\u9875\u9762\u672A\u52A0\u8F7D\u5BF9\u5E94\u8BC4\u8BBA\u8282\u70B9" : "\u672C\u6B21\u4E3A\u8BC4\u8BBA\u533A\u72B6\u6001\u626B\u63CF\uFF0C\u8BB0\u5F55\u5F53\u524D\u8D26\u53F7\u8BC4\u8BBA\u6570\u91CF\u548C\u5DF2\u52A0\u8F7D\u8BC4\u8BBA\u8282\u70B9";
    const totalText = declaredTotalCount == null ? "\u9875\u9762\u672A\u63D0\u4F9B\u7A33\u5B9A\u603B\u6570" : `${declaredTotalCount} \u6761`;
    const targetSection = request.comment ? `<section class="target">
      <div class="label">\u76EE\u6807\u8BC4\u8BBA</div>
      <div class="text">${escapeHtml(request.comment)}</div>
      <div class="basis">\u5B58\u6863\u4F9D\u636E\uFF1A${escapeHtml(basisText)}</div>
    </section>` : `<section class="target neutral">
      <div class="label">\u8BC4\u8BBA\u533A\u72B6\u6001\u5FEB\u7167</div>
      <div class="text">\u5B58\u6863\u65F6\u672C\u8D26\u53F7\u5171\u6709 ${request.afterCommentCount} \u6761\u8BC4\u8BBA</div>
      <div class="basis">${escapeHtml(basisText)}</div>
    </section>`;
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>\u8BC4\u8BBA\u533A\u5B58\u6863 - ${escapeHtml(request.title || platform)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#17202a;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}
    .page{max-width:960px;margin:0 auto;padding:28px 20px 48px}.header{background:#fff;border:1px solid #dfe5eb;border-top:4px solid #1677ff;padding:22px 24px;border-radius:6px}
    h1{font-size:22px;line-height:1.35;margin:0 0 8px}.sub{color:#657180}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin-top:18px;padding-top:16px;border-top:1px solid #edf0f3}
    .meta div{min-width:0}.meta b{display:inline-block;color:#44515f;margin-right:8px}.url{word-break:break-all;color:#345}.target{margin:18px 0;background:#f0f9eb;border:1px solid #95d475;border-left:5px solid #3a9b42;padding:18px 20px;border-radius:5px}.target.neutral{background:#eef6ff;border-color:#a8cdf5;border-left-color:#1677ff}
    .target .label{font-size:12px;color:#2f7d36;font-weight:700;margin-bottom:7px}.target .text{font-size:16px;white-space:pre-wrap;word-break:break-word}.basis{margin-top:9px;color:#52616f;font-size:12px}
    .comments{background:#fff;border:1px solid #dfe5eb;border-radius:6px;padding:8px 22px}.comments-title{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid #edf0f3;font-weight:700}
    .comment-entry{padding:16px 4px;border-bottom:1px solid #edf0f3;word-break:break-word}.comment-entry:last-child{border-bottom:0}.comment-entry *{max-width:100%;word-break:break-word}.comment-entry [class*="avatar"],.comment-entry [class*="icon"]{display:none!important}
    .evidence-target-node{background:#f0f9eb!important;outline:2px solid #67c23a;outline-offset:5px;border-radius:2px}.empty{padding:24px 4px;color:#718096;text-align:center}
    .notice{margin-top:16px;color:#6b7280;font-size:12px}.notice strong{color:#4b5563}@media(max-width:650px){.page{padding:14px 10px 30px}.header{padding:18px 16px}.meta{grid-template-columns:1fr}.comments{padding:6px 14px}}
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <h1>${escapeHtml(request.title || "\u672A\u8BFB\u53D6\u5230\u6587\u7AE0\u6807\u9898")}</h1>
      <div class="sub">${escapeHtml(platform)}\u8BC4\u8BBA\u533A\u9759\u6001\u5B58\u6863</div>
      <div class="meta">
        <div><b>\u5B58\u6863\u65F6\u95F4</b>${escapeHtml(capturedAtText)}</div>
        <div><b>\u8D26\u53F7</b>${escapeHtml(request.username || "\u672A\u8BB0\u5F55")}</div>
        <div><b>\u672C\u8D26\u53F7\u8BC4\u8BBA\u6570</b>${request.beforeCommentCount} \u2192 ${request.afterCommentCount}</div>
        <div><b>\u9875\u9762\u8BC4\u8BBA\u603B\u6570</b>${escapeHtml(totalText)}</div>
        <div><b>\u8BC4\u8BBA ID</b>${escapeHtml(commentId || "\u9875\u9762\u672A\u63D0\u4F9B")}</div>
        <div><b>\u5E73\u53F0\u663E\u793A\u65F6\u95F4</b>${escapeHtml(platformDisplayedTime || "\u9875\u9762\u672A\u63D0\u4F9B")}</div>
        <div class="url" style="grid-column:1/-1"><b>\u539F\u94FE\u63A5</b>${escapeHtml(request.url)}</div>
      </div>
    </section>
    ${targetSection}
    <section class="comments">
      <div class="comments-title"><span>\u5F53\u65F6\u5DF2\u52A0\u8F7D\u7684\u8BC4\u8BBA</span><span>${capturedItemCount} \u6761</span></div>
      ${commentHtml || '<div class="empty">\u5F53\u524D\u9875\u9762\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u8BC4\u8BBA\u8282\u70B9\uFF0C\u5DF2\u4FDD\u7559\u53D1\u5E03\u7ED3\u679C\u548C\u6570\u91CF\u4FE1\u606F\u3002</div>'}
    </section>
    <p class="notice"><strong>\u8BF4\u660E\uFF1A</strong>\u8FD9\u662F\u91C7\u96C6\u65F6\u523B\u7684\u9759\u6001\u9875\u9762\u8BB0\u5F55\uFF0C\u4E0D\u4F1A\u6267\u884C\u811A\u672C\u3001\u63D0\u4EA4\u8868\u5355\u6216\u8BBF\u95EE\u8DDF\u8E2A\u8D44\u6E90\uFF0C\u4E5F\u4E0D\u4EE3\u8868\u5E73\u53F0\u5F53\u524D\u72B6\u6001\u3002\u8BF7\u7ED3\u5408\u539F\u94FE\u63A5\u7684\u5728\u7EBF\u6838\u9A8C\u7ED3\u679C\u5224\u65AD\u8BC4\u8BBA\u662F\u5426\u4ECD\u7136\u5B58\u5728\u3002</p>
  </main>
</body>
</html>`;
  }
  function captureCommentEvidence(request) {
    try {
      const expected = comparable(request.comment);
      const contentSelector = COMMENT_CONTENT_SELECTORS[request.platform];
      const itemSelector = COMMENT_ITEM_SELECTORS[request.platform];
      const rootSelector = COMMENT_ROOT_SELECTORS[request.platform];
      if (!contentSelector || !itemSelector || !rootSelector) {
        return { success: false, error: "\u5F53\u524D\u5E73\u53F0\u6CA1\u6709\u8BC4\u8BBA\u533A\u5B58\u6863\u89C4\u5219" };
      }
      const targetContent = expected ? Array.from(document.querySelectorAll(contentSelector)).find((element) => comparable(element.textContent || "").includes(expected)) || null : null;
      const targetItem = targetContent?.closest(itemSelector) || targetContent;
      const root = targetItem?.closest(rootSelector) || document.querySelector(rootSelector) || targetItem?.parentElement || document.body;
      const items = selectCommentItems(root, itemSelector, targetItem);
      const entries = items.map((item) => {
        const isTarget = item === targetItem || Boolean(targetContent && item.contains(targetContent));
        const clone = sanitizeClone(item, isTarget);
        return `<article class="comment-entry">${clone.outerHTML}</article>`;
      }).join("");
      const targetFoundInDom = Boolean(targetContent);
      const commentId = readCommentId(targetItem);
      const platformDisplayedTime = readPlatformTime(targetItem);
      const declaredTotalCount = readDeclaredTotalCount(root);
      const htmlDocument = buildArchiveDocument(
        request,
        entries,
        targetFoundInDom,
        items.length,
        commentId,
        platformDisplayedTime,
        declaredTotalCount
      );
      return {
        success: true,
        htmlDocument,
        articleId: articleIdFromUrl(request.url),
        commentId: commentId || void 0,
        platformDisplayedTime: platformDisplayedTime || void 0,
        declaredTotalCount,
        capturedItemCount: items.length,
        targetFoundInDom
      };
    } catch (error) {
      return { success: false, error: `\u8BC4\u8BBA\u533A\u5B58\u6863\u751F\u6210\u5931\u8D25\uFF1A${String(error?.message || error)}` };
    }
  }

  // src/content/index.ts
  var DEBUG6 = true;
  function log6(...args) {
    if (DEBUG6) console.log("[DL\u8BC4\u8BBA\u52A9\u624B]", ...args);
  }
  function supportsArticleInteractions(platform) {
    return platform !== "netease";
  }
  function escapeHtml2(value) {
    return value.replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[char] || char);
  }
  function isInvalidArticlePage(_platform) {
    const title = document.title.trim();
    if (/^404(?:\s|$|[-_|])|页面不存在|内容不存在|文章不存在|内容已删除/i.test(title)) return true;
    const errorContainer = document.querySelector(
      '.new_404, .error-404, .error-page, .error-container, .not-found, [class*="404"]'
    );
    const errorText = errorContainer?.textContent?.replace(/\s+/g, "") || "";
    return /内容不存在|文章不存在|页面不存在|作者删除了内容|想找的内容离你而去/.test(errorText);
  }
  var RiskControlError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "RiskControlError";
    }
  };
  function detectRiskControlMessage() {
    const selectors = [
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      '[class*="verify" i]',
      '[id*="verify" i]',
      '[class*="risk" i]',
      '[class*="security-check" i]',
      '[role="dialog"]',
      ".toast",
      ".message",
      ".notification"
    ];
    const pattern = /验证码|滑块验证|安全验证|请完成验证|操作频繁|访问频繁|请求频繁|账号异常|行为异常|稍后再试/;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.offsetParent === null) continue;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300);
        const match = text.match(pattern);
        if (match) return `\u5E73\u53F0\u89E6\u53D1\u201C${match[0]}\u201D\u63D0\u793A\uFF0C\u4EFB\u52A1\u5DF2\u5B89\u5168\u6682\u505C`;
      }
    }
    return null;
  }
  function commentVerificationDelay(platform) {
    const delays = {
      csdn: 3e3,
      zhihu: 4500,
      toutiao: 5e3,
      baijiahao: 7500,
      netease: 6e3,
      sohu: 5e3
    };
    return delays[platform] || 5e3;
  }
  async function waitForPublishedComment(platform, comment, maxDelay) {
    const deadline = Date.now() + maxDelay;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
      if (hasPublishedCommentInDom(platform, comment)) return;
    }
  }
  function publishedCommentSelectors(platform) {
    const selectors = {
      csdn: ".comment-list-box .comment-content, .comment-box .comment-content",
      zhihu: ".Comments-container .CommentContent",
      toutiao: ".ttp-comment-item .content",
      baijiahao: ".xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text",
      netease: '#tieArea .comment-content, #tieArea .tie-cnt, #tieArea [class*="comment"]',
      sohu: '#commentList .comment-content-text, #commentList .comment-content, #commentList .comment-text, #commentList [class*="comment-content"]'
    };
    return selectors[platform] || "__unsupported_comment_platform__";
  }
  function hasPublishedCommentInDom(platform, comment) {
    const expected = cleanComparableText(comment);
    if (!expected) return false;
    return Array.from(document.querySelectorAll(publishedCommentSelectors(platform))).some((element) => cleanComparableText(element.textContent || "").includes(expected));
  }
  async function locatePublishedCommentInFullArea(platform, comment) {
    const expected = cleanComparableText(comment);
    if (!expected) return false;
    const start = await startAccountCommentCapture({
      type: "START_ACCOUNT_COMMENT_CAPTURE",
      platform,
      username: "",
      expectedComment: comment
    });
    if (!start.success) return false;
    try {
      for (let attempt = 0; attempt < 120; attempt++) {
        const next = await nextAccountCommentCapture();
        if (!next.success) return false;
        if (next.target && cleanComparableText(next.target.commentText).includes(expected)) return true;
        if (next.done) return false;
      }
      return false;
    } finally {
      await endAccountCommentCapture();
    }
  }
  async function verifyCommentEvidence(request) {
    const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (isInvalidArticlePage(request.platform)) {
      return {
        success: true,
        presence: "suspected_deleted",
        checkedAt,
        currentCommentCount: 0,
        linkStatus: "invalid",
        reason: "\u6587\u7AE0\u94FE\u63A5\u5F53\u524D\u5DF2\u7ECF\u5931\u6548\uFF0C\u65E0\u6CD5\u7EE7\u7EED\u6838\u9A8C\u8BC4\u8BBA"
      };
    }
    try {
      const scan = await scanCurrentPage();
      if (hasPublishedCommentInDom(request.platform, request.comment)) {
        return {
          success: true,
          presence: "present",
          checkedAt,
          currentCommentCount: scan?.commentCount,
          linkStatus: "active",
          reason: "\u5F53\u524D\u9875\u9762\u4ECD\u80FD\u5B9A\u4F4D\u5230\u76F8\u540C\u8BC4\u8BBA\u6587\u5B57"
        };
      }
      if (await locatePublishedCommentInFullArea(request.platform, request.comment)) {
        return {
          success: true,
          presence: "present",
          checkedAt,
          currentCommentCount: scan?.commentCount,
          linkStatus: "active",
          reason: "\u5DF2\u5728\u5B8C\u6574\u8BC4\u8BBA\u533A\u5B9A\u4F4D\u5230\u76F8\u540C\u8BC4\u8BBA\u6587\u5B57"
        };
      }
      if (scan && scan.commentCount < request.archivedAfterCommentCount) {
        return {
          success: true,
          presence: "suspected_deleted",
          checkedAt,
          currentCommentCount: scan.commentCount,
          linkStatus: "active",
          reason: `\u672C\u8D26\u53F7\u8BC4\u8BBA\u6570\u5DF2\u7531\u5B58\u6863\u65F6\u7684 ${request.archivedAfterCommentCount} \u6761\u964D\u4E3A ${scan.commentCount} \u6761\uFF0C\u7591\u4F3C\u5DF2\u5220\u9664`
        };
      }
      return {
        success: true,
        presence: "unknown",
        checkedAt,
        currentCommentCount: scan?.commentCount,
        linkStatus: "active",
        reason: "\u9875\u9762\u672A\u52A0\u8F7D\u5230\u76F8\u540C\u8BC4\u8BBA\u8282\u70B9\uFF0C\u4F46\u8BC4\u8BBA\u6570\u91CF\u672A\u4E0B\u964D\uFF0C\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4"
      };
    } catch (error) {
      return {
        success: false,
        presence: "unknown",
        checkedAt,
        reason: "\u5728\u7EBF\u6838\u9A8C\u672A\u5B8C\u6210",
        error: String(error?.message || error)
      };
    }
  }
  function cleanComparableText(value) {
    return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, "").trim();
  }
  var notificationDismissed = false;
  var notificationHideTimer;
  var notificationProgressTimer;
  function removeNotification() {
    document.getElementById("ai-comment-notification")?.remove();
    if (notificationHideTimer != null) {
      window.clearTimeout(notificationHideTimer);
      notificationHideTimer = void 0;
    }
    if (notificationProgressTimer != null) {
      window.clearInterval(notificationProgressTimer);
      notificationProgressTimer = void 0;
    }
  }
  function showNotification(data) {
    if (notificationDismissed) return;
    if (notificationHideTimer != null) {
      window.clearTimeout(notificationHideTimer);
      notificationHideTimer = void 0;
    }
    if (notificationProgressTimer != null) {
      window.clearInterval(notificationProgressTimer);
      notificationProgressTimer = void 0;
    }
    let notif = document.getElementById("ai-comment-notification");
    const isNew = !notif;
    if (!notif) {
      notif = document.createElement("div");
      notif.id = "ai-comment-notification";
      document.body.appendChild(notif);
    }
    notif.style.cssText = [
      "position:fixed",
      "top:80px",
      "right:20px",
      "z-index:2147483647",
      "background:#fff",
      "border-radius:12px",
      "box-shadow:0 4px 20px rgba(0,0,0,.18)",
      "padding:16px 18px",
      "width:300px",
      "max-width:calc(100vw - 40px)",
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      "border-left:4px solid #409EFF",
      "box-sizing:border-box",
      isNew ? "animation:aiCommentSlideIn .3s ease" : ""
    ].filter(Boolean).join(";");
    const title = data.title.length > 38 ? `${data.title.slice(0, 38)}...` : data.title;
    const countHtml = data.commentCount == null ? '<span style="color:#909399;font-weight:600;">\u626B\u63CF\u4E2D...</span>' : `<span style="color:#409EFF;font-weight:700;font-size:20px;">${data.commentCount}</span><span style="color:#606266;"> \u6761</span>`;
    const usernameHtml = data.username ? `<div style="font-size:12px;color:#909399;margin-top:5px;">\u8D26\u53F7\uFF1A<span style="color:#303133;">${escapeHtml2(data.username)}</span></div>` : "";
    const interactionText = (value, positive, negative) => data.interactionsSupported === false ? '<span style="color:#909399;">\u5E73\u53F0\u65E0\u6B64\u9879</span>' : value === true ? `<span style="color:#67C23A;font-weight:600;">${positive}</span>` : value === false ? `<span style="color:#F56C6C;font-weight:600;">${negative}</span>` : '<span style="color:#909399;">\u6682\u672A\u8BC6\u522B</span>';
    const interactionsHtml = data.interactionsSupported === false || data.liked !== void 0 || data.collected !== void 0 ? `<div style="display:flex;gap:18px;margin:0 0 8px;padding:8px 10px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#606266;">
        <span>\u70B9\u8D5E\uFF1A${interactionText(data.liked, "\u5DF2\u70B9\u8D5E", "\u672A\u70B9\u8D5E")}</span>
        <span>\u6536\u85CF\uFF1A${interactionText(data.collected, "\u5DF2\u6536\u85CF", "\u672A\u6536\u85CF")}</span>
      </div>` : "";
    const progressPercent = data.progressPercent == null ? null : Math.max(0, Math.min(100, Math.round(data.progressPercent)));
    const progressHtml = progressPercent == null ? "" : `<div style="margin:9px 0 7px;padding:9px 10px;background:#ecf5ff;border-radius:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:11px;color:#606266;">
          <span>${escapeHtml2(data.actionLabel || "\u5F53\u524D\u64CD\u4F5C")}</span>
          <span>${progressPercent}%</span>
        </div>
        <div style="height:7px;background:#d9ecff;border-radius:99px;overflow:hidden;">
          <div style="width:${progressPercent}%;height:100%;background:#409EFF;border-radius:99px;transition:width .25s ease;"></div>
        </div>
        <div id="ai-comment-progress-countdown" style="margin-top:6px;font-size:11px;color:#7a8799;">
          ${data.etaSeconds && data.etaSeconds > 0 ? `\u9884\u8BA1\u7EA6 ${Math.ceil(data.etaSeconds)} \u79D2\u8FDB\u5165\u4E0B\u4E00\u6B65` : "\u6B63\u5728\u7B49\u5F85\u5E73\u53F0\u5B8C\u6210\u5F53\u524D\u6B65\u9AA4"}
        </div>
      </div>`;
    notif.innerHTML = `
    <style>@keyframes aiCommentSlideIn{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}</style>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:14px;font-weight:700;color:#303133;">DL\u8BC4\u8BBA\u52A9\u624B</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-size:11px;color:#67C23A;">\u25CF \u5355\u6B21\u626B\u63CF</div>
        <button id="ai-comment-notification-close" type="button" title="\u5173\u95ED" style="border:0;background:transparent;color:#909399;font-size:20px;line-height:16px;cursor:pointer;padding:0;">\xD7</button>
      </div>
    </div>
    <div style="font-size:12px;color:#909399;margin-bottom:5px;">\u5E73\u53F0\uFF1A<span style="color:#409EFF;font-weight:600;">${escapeHtml2(data.platform)}</span></div>
    <div style="font-size:12px;color:#909399;line-height:18px;word-break:break-all;">\u6587\u7AE0\uFF1A<span style="color:#303133;">${escapeHtml2(title)}</span></div>
    ${usernameHtml}
    <div style="margin:10px 0 7px;padding:9px 10px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#606266;">\u6211\u7684\u8BC4\u8BBA\uFF1A${countHtml}</div>
    ${interactionsHtml}
    ${progressHtml}
    <div style="font-size:12px;color:#909399;line-height:18px;">\u72B6\u6001\uFF1A<span style="color:${data.statusColor || "#409EFF"};">${escapeHtml2(data.status)}</span></div>
    ${data.recordStatus ? `<div style="font-size:11px;color:#909399;margin-top:5px;">${escapeHtml2(data.recordStatus)}</div>` : ""}
  `;
    notif.querySelector("#ai-comment-notification-close")?.addEventListener("click", () => {
      notificationDismissed = true;
      removeNotification();
    });
    if (progressPercent != null && progressPercent < 100 && data.etaSeconds && data.etaSeconds > 0) {
      const deadline = Date.now() + Math.ceil(data.etaSeconds) * 1e3;
      notificationProgressTimer = window.setInterval(() => {
        const countdown = notif?.querySelector("#ai-comment-progress-countdown");
        if (!countdown) return;
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1e3));
        countdown.textContent = remaining > 0 ? `\u9884\u8BA1\u7EA6 ${remaining} \u79D2\u8FDB\u5165\u4E0B\u4E00\u6B65` : "\u9884\u8BA1\u65F6\u95F4\u5DF2\u5230\uFF0C\u6B63\u5728\u7B49\u5F85\u5E73\u53F0\u54CD\u5E94";
      }, 1e3);
    }
    if ((progressPercent == null || progressPercent >= 100) && (data.commentCount != null || /完成|失败/.test(data.status))) {
      notificationHideTimer = window.setTimeout(removeNotification, 15e3);
    }
  }
  async function saveResultToBackground(result, url) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_SCAN_RESULT",
        platform: result.platform,
        url,
        title: result.title,
        commentCount: result.commentCount,
        username: result.username,
        linkStatus: result.linkStatus,
        liked: result.liked,
        collected: result.collected
      });
      return response?.success === true;
    } catch (e) {
      log6("\u4FDD\u5B58\u5230\u540E\u53F0\u5931\u8D25:", e);
      return false;
    }
  }
  async function readInteractionsWithSafeRetry(platform) {
    if (!supportsArticleInteractions(platform)) {
      return { liked: null, collected: null, warnings: [] };
    }
    let liked = null;
    let collected = null;
    const warnings = [];
    const retryDelays = [0, 3e3, 4500];
    for (let index = 0; index < retryDelays.length; index++) {
      if (retryDelays[index] > 0) await new Promise((resolve) => setTimeout(resolve, retryDelays[index]));
      const state = await readInteractions(platform).catch(() => ({
        liked: null,
        collected: null,
        likePerformed: false,
        collectPerformed: false,
        warnings: []
      }));
      if (typeof state.liked === "boolean") liked = state.liked;
      if (typeof state.collected === "boolean") collected = state.collected;
      warnings.push(...state.warnings);
      if (typeof liked === "boolean" && typeof collected === "boolean") break;
    }
    return { liked, collected, warnings };
  }
  async function performScan() {
    const rawUrl = window.location.href;
    const platform = detectPlatform(rawUrl);
    if (!platform || !isArticlePage(rawUrl)) {
      log6("\u8DF3\u8FC7: \u975E\u652F\u6301\u9875\u9762", rawUrl, platform);
      return null;
    }
    const url = normalizeArticleUrl(rawUrl, platform);
    log6("\u68C0\u6D4B\u5230\u5E73\u53F0:", platform);
    if (isInvalidArticlePage(platform)) {
      const invalidResult = {
        platform,
        title: "\u94FE\u63A5\u5DF2\u5931\u6548\uFF08404\uFF09",
        commentCount: 0,
        username: "",
        linkStatus: "invalid"
      };
      const saved2 = await saveResultToBackground(invalidResult, url);
      showNotification({
        platform,
        title: invalidResult.title,
        commentCount: 0,
        status: saved2 ? "\u26A0 \u94FE\u63A5\u5DF2\u5931\u6548\uFF0C\u8BB0\u5F55\u5DF2\u66F4\u65B0" : "\u26A0 \u94FE\u63A5\u5DF2\u5931\u6548\uFF0C\u4F46\u8BB0\u5F55\u4FDD\u5B58\u5931\u8D25",
        statusColor: "#F56C6C",
        recordStatus: "\u9875\u9762\u5DF2\u8FD4\u56DE 404\uFF0C\u4E0D\u518D\u4F7F\u7528\u8BC4\u8BBA\u63A5\u53E3\u4E2D\u7684\u5386\u53F2\u6570\u636E"
      });
      return {
        type: "SCAN_RESULT",
        platform,
        url,
        title: invalidResult.title,
        commentCount: 0,
        username: "",
        linkStatus: "invalid"
      };
    }
    showNotification({
      platform,
      title: document.title || url,
      commentCount: null,
      status: "\u6B63\u5728\u81EA\u52A8\u8BFB\u53D6\u8BC4\u8BBA\u2026",
      recordStatus: "\u626B\u63CF\u5B8C\u6210\u540E\u5C06\u81EA\u52A8\u8BB0\u5F55\uFF1B\u540C\u4E00\u94FE\u63A5\u53EA\u66F4\u65B0\uFF0C\u4E0D\u91CD\u590D\u65B0\u589E",
      liked: null,
      collected: null,
      interactionsSupported: supportsArticleInteractions(platform)
    });
    let result = null;
    try {
      switch (platform) {
        case "csdn":
          result = await scanCsdnPage();
          break;
        case "zhihu":
          result = await scanZhihuPage();
          break;
        case "toutiao":
          result = await scanToutiaoPage();
          break;
        case "baijiahao":
          result = await scanBaijiahaoPage();
          break;
        case "netease":
          result = await scanNeteasePage();
          break;
        case "sohu":
          result = await scanSohuPage();
          break;
        default:
          log6("\u672A\u77E5\u5E73\u53F0:", platform);
          return null;
      }
    } catch (e) {
      console.error("[DL\u8BC4\u8BBA\u52A9\u624B] \u626B\u63CF\u5F02\u5E38:", platform, e);
      await appendAccountLog(platform, "error", `\u626B\u63CF\u5F02\u5E38\uFF1A${String(e)}`);
      return null;
    }
    if (!result) {
      log6("\u626B\u63CF\u65E0\u7ED3\u679C\uFF08\u53EF\u80FD\u672A\u767B\u5F55\u6216\u9875\u9762\u4E0D\u53D7\u652F\u6301\uFF09");
      await appendAccountLog(platform, "warning", "\u626B\u63CF\u65E0\u7ED3\u679C\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u72B6\u6001\u3001\u624B\u52A8\u8D26\u53F7\u540D\u79F0\u6216\u5E73\u53F0\u8BC4\u8BBA\u63A5\u53E3\u3002");
      showNotification({
        platform,
        title: document.title || url,
        commentCount: null,
        status: "\u626B\u63CF\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u72B6\u6001\u6216\u7528\u6237\u540D\u8BBE\u7F6E",
        statusColor: "#F56C6C",
        recordStatus: "\u672C\u6B21\u672A\u5199\u5165\u8BB0\u5F55"
      });
      return null;
    }
    log6("\u626B\u63CF\u7ED3\u679C:", result);
    const interactionState = await readInteractionsWithSafeRetry(platform);
    const interactionPatch = {
      ...typeof interactionState.liked === "boolean" ? { liked: interactionState.liked } : {},
      ...typeof interactionState.collected === "boolean" ? { collected: interactionState.collected } : {}
    };
    const saved = await saveResultToBackground({ ...result, ...interactionPatch, linkStatus: "active" }, url);
    if (!saved) {
      await appendAccountLog(platform, "error", "\u8BC4\u8BBA\u6570\u91CF\u5DF2\u626B\u63CF\uFF0C\u4F46\u4FDD\u5B58\u6700\u65B0\u8BB0\u5F55\u5931\u8D25\u3002");
    }
    showNotification({
      platform: result.platform,
      title: result.title,
      commentCount: result.commentCount,
      username: result.username,
      status: saved ? "\u626B\u63CF\u5B8C\u6210\uFF0C\u8BB0\u5F55\u5DF2\u66F4\u65B0" : "\u626B\u63CF\u5B8C\u6210\uFF0C\u4F46\u8BB0\u5F55\u4FDD\u5B58\u5931\u8D25",
      statusColor: saved ? "#67C23A" : "#F56C6C",
      recordStatus: saved ? supportsArticleInteractions(platform) ? `\u70B9\u8D5E ${interactionState.liked === true ? "\u5DF2\u70B9\u8D5E" : interactionState.liked === false ? "\u672A\u70B9\u8D5E" : "\u6682\u672A\u8BC6\u522B"}\uFF1B\u6536\u85CF ${interactionState.collected === true ? "\u5DF2\u6536\u85CF" : interactionState.collected === false ? "\u672A\u6536\u85CF" : "\u6682\u672A\u8BC6\u522B"}` : "\u7F51\u6613\u6587\u7AE0\u9875\u6CA1\u6709\u6587\u7AE0\u7EA7\u70B9\u8D5E\u548C\u6536\u85CF\uFF0C\u4EC5\u7EDF\u8BA1\u8BC4\u8BBA" : "\u8BF7\u6253\u5F00\u6269\u5C55\u9875\u68C0\u67E5\u9519\u8BEF\u4FE1\u606F",
      liked: interactionState.liked,
      collected: interactionState.collected,
      interactionsSupported: supportsArticleInteractions(platform)
    });
    return {
      type: "SCAN_RESULT",
      platform: result.platform,
      url,
      title: result.title,
      commentCount: result.commentCount,
      username: result.username,
      linkStatus: "active",
      accountStatus: await getFreshAccountState(result.platform),
      ...interactionPatch
    };
  }
  async function getFreshAccountState(platform) {
    const data = await chrome.storage.local.get(accountStateKey(platform));
    const state = data[accountStateKey(platform)];
    if (!state || Date.now() - new Date(state.time).getTime() > 2 * 60 * 1e3) return "unknown";
    return state.status;
  }
  async function supplementCurrentPage(targetCommentCount, actions) {
    const platform = detectPlatform(window.location.href);
    const url = platform ? normalizeArticleUrl(window.location.href, platform) : window.location.href;
    const target = Math.max(0, Math.min(10, Math.floor(targetCommentCount || 0)));
    const requested = {
      comment: actions?.comment !== false,
      like: platform ? supportsArticleInteractions(platform) && actions?.like !== false : false,
      collect: platform ? supportsArticleInteractions(platform) && actions?.collect !== false : false
    };
    const emptyResult = {
      type: "SUPPLEMENT_RESULT",
      platform: platform || "csdn",
      url,
      title: document.title,
      username: "",
      targetCommentCount: target,
      beforeCommentCount: 0,
      afterCommentCount: 0,
      commentPosted: false,
      liked: null,
      collected: null,
      accountStatus: "unknown",
      status: "failed"
    };
    if (!platform || !isArticlePage(window.location.href)) {
      return { ...emptyResult, error: "\u5F53\u524D\u9875\u9762\u4E0D\u662F\u652F\u6301\u7684\u6587\u7AE0\u9875", errorCode: "UNSUPPORTED_PAGE" };
    }
    if (isInvalidArticlePage(platform)) {
      return { ...emptyResult, platform, error: "\u6587\u7AE0\u94FE\u63A5\u5DF2\u5931\u6548", errorCode: "PAGE_INVALID" };
    }
    showNotification({
      platform,
      title: document.title,
      commentCount: null,
      status: "\u6B63\u5728\u6267\u884C\u767B\u5F55\u4E0E\u8D26\u53F7\u9884\u68C0\u2026",
      recordStatus: "\u9884\u68C0\u901A\u8FC7\u540E\u624D\u4F1A\u8BC4\u8BBA\u3001\u70B9\u8D5E\u6216\u6536\u85CF",
      liked: null,
      collected: null,
      interactionsSupported: supportsArticleInteractions(platform),
      progressPercent: 8,
      etaSeconds: 20,
      actionLabel: "\u767B\u5F55\u4E0E\u8D26\u53F7\u9884\u68C0"
    });
    const before = await scanCurrentPage();
    if (!before) {
      await appendAccountLog(platform, "error", "\u667A\u80FD\u8865\u9F50\u5DF2\u6682\u505C\uFF1A\u672A\u68C0\u6D4B\u5230\u6709\u6548\u767B\u5F55\u8D26\u53F7\u3002");
      showNotification({
        platform,
        title: document.title,
        commentCount: null,
        status: "\u672A\u767B\u5F55\u6216\u8D26\u53F7\u65E0\u6CD5\u8BC6\u522B\uFF0C\u5DF2\u6682\u505C\u64CD\u4F5C",
        statusColor: "#F56C6C",
        recordStatus: "\u8BF7\u767B\u5F55\u5E73\u53F0\u540E\u91CD\u65B0\u626B\u63CF\u5E76\u7EE7\u7EED",
        progressPercent: 100,
        actionLabel: "\u64CD\u4F5C\u5DF2\u6682\u505C"
      });
      return { ...emptyResult, platform, accountStatus: "auth_required", error: "\u672A\u767B\u5F55\u6216\u8D26\u53F7\u65E0\u6CD5\u8BC6\u522B", errorCode: "AUTH_REQUIRED" };
    }
    const accountStatus = await getFreshAccountState(platform);
    if (accountStatus !== "logged_in") {
      const code = accountStatus === "account_mismatch" ? "ACCOUNT_MISMATCH" : "AUTH_REQUIRED";
      const error = accountStatus === "account_mismatch" ? "\u5F53\u524D\u767B\u5F55\u8D26\u53F7\u4E0E\u624B\u52A8\u914D\u7F6E\u8D26\u53F7\u4E0D\u4E00\u81F4" : "\u65E0\u6CD5\u786E\u8BA4\u5F53\u524D\u767B\u5F55\u8D26\u53F7\uFF0C\u8BF7\u5148\u767B\u5F55\u6216\u6253\u5F00\u8D26\u53F7\u8BBE\u7F6E\u6838\u5BF9";
      await appendAccountLog(platform, "error", `\u667A\u80FD\u8865\u9F50\u5DF2\u6682\u505C\uFF1A${error}`);
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount,
        username: before.username,
        status: error,
        statusColor: "#F56C6C",
        recordStatus: "\u4E3A\u907F\u514D\u9519\u8BEF\u8D26\u53F7\u64CD\u4F5C\uFF0C\u672C\u6B21\u6CA1\u6709\u8BC4\u8BBA\u3001\u70B9\u8D5E\u6216\u6536\u85CF",
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 100,
        actionLabel: "\u64CD\u4F5C\u5DF2\u6682\u505C"
      });
      return {
        ...emptyResult,
        platform,
        title: before.title,
        username: before.username,
        beforeCommentCount: before.commentCount,
        afterCommentCount: before.commentCount,
        accountStatus: accountStatus || "unknown",
        status: "needs_attention",
        error,
        errorCode: code
      };
    }
    let liked = null;
    let collected = null;
    let likePerformed = false;
    let collectPerformed = false;
    let commentPosted = false;
    let commentText = "";
    try {
      const initialRisk = detectRiskControlMessage();
      if (initialRisk) throw new RiskControlError(initialRisk);
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount,
        username: before.username,
        status: "\u6B63\u5728\u68C0\u6D4B\u5E76\u5904\u7406\u70B9\u8D5E\u3001\u6536\u85CF\u72B6\u6001\u2026",
        recordStatus: "\u53EA\u4F1A\u64CD\u4F5C\u672C\u6B21\u9009\u4E2D\u7684\u9879\u76EE",
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 28,
        etaSeconds: 15,
        actionLabel: "\u70B9\u8D5E\u4E0E\u6536\u85CF\u9884\u68C0"
      });
      const interactions = await ensureInteractions(platform, requested);
      liked = interactions.liked;
      collected = interactions.collected;
      likePerformed = interactions.likePerformed;
      collectPerformed = interactions.collectPerformed;
      const interactionRisk = detectRiskControlMessage();
      if (interactionRisk) throw new RiskControlError(interactionRisk);
      if (requested.comment && before.commentCount < target) {
        showNotification({
          platform,
          title: before.title,
          commentCount: before.commentCount,
          username: before.username,
          status: "\u6B63\u5728\u6309\u5F53\u524D\u8BC4\u8BBA\u6A21\u5F0F\u51C6\u5907\u5185\u5BB9\u2026",
          recordStatus: `\u5F53\u524D ${before.commentCount} \u6761\uFF0C\u76EE\u6807 ${target} \u6761\uFF1B\u672C\u8F6E\u6700\u591A\u53D1\u5E03 1 \u6761`,
          liked,
          collected,
          interactionsSupported: supportsArticleInteractions(platform),
          progressPercent: 45,
          etaSeconds: 20,
          actionLabel: "\u51C6\u5907\u8BC4\u8BBA"
        });
        const articleText = extractArticleText();
        const generated = await chrome.runtime.sendMessage({
          type: "GENERATE_AI_COMMENT",
          platform,
          url,
          articleText
        });
        if (!generated?.success || !generated?.data?.comment) {
          throw new Error(generated?.error || "\u63D2\u4EF6\u672A\u8FD4\u56DE\u8BC4\u8BBA\u5185\u5BB9");
        }
        commentText = String(generated.data.comment).trim();
        const commentSourceLabel = generated.data.source === "manual-template" ? generated.data.selection === "random" ? "\u5DF2\u968F\u673A\u62BD\u53D6\u6A21\u677F" : "\u5DF2\u6309\u987A\u5E8F\u9009\u62E9\u6A21\u677F" : "AI \u8BC4\u8BBA\u5DF2\u751F\u6210";
        const prePostRisk = detectRiskControlMessage();
        if (prePostRisk) throw new RiskControlError(prePostRisk);
        showNotification({
          platform,
          title: before.title,
          commentCount: before.commentCount,
          username: before.username,
          status: `${commentSourceLabel}\uFF0C\u6B63\u5728\u5B9A\u4F4D\u8F93\u5165\u6846\u5E76\u53D1\u5E03\u2026`,
          recordStatus: "\u8BF7\u6682\u65F6\u4E0D\u8981\u624B\u52A8\u5207\u6362\u9875\u9762\u6216\u64CD\u4F5C\u8BC4\u8BBA\u6846",
          liked,
          collected,
          interactionsSupported: supportsArticleInteractions(platform),
          progressPercent: 66,
          etaSeconds: 22,
          actionLabel: "\u586B\u5199\u5E76\u53D1\u5E03\u8BC4\u8BBA"
        });
        await postComment(platform, commentText);
        commentPosted = true;
        const verificationDelay = commentVerificationDelay(platform);
        showNotification({
          platform,
          title: before.title,
          commentCount: before.commentCount,
          username: before.username,
          status: "\u8BC4\u8BBA\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u7B49\u5F85\u5E73\u53F0\u540C\u6B65\u5E76\u91CD\u65B0\u68C0\u6D4B\u2026",
          recordStatus: "\u6B64\u9636\u6BB5\u4E0D\u4F1A\u91CD\u590D\u53D1\u5E03\u8BC4\u8BBA",
          liked,
          collected,
          interactionsSupported: supportsArticleInteractions(platform),
          progressPercent: 84,
          etaSeconds: Math.ceil(verificationDelay / 1e3),
          actionLabel: "\u7B49\u5F85\u5E73\u53F0\u540C\u6B65"
        });
        await waitForPublishedComment(platform, commentText, verificationDelay);
      } else {
        showNotification({
          platform,
          title: before.title,
          commentCount: before.commentCount,
          username: before.username,
          status: "\u9875\u9762\u64CD\u4F5C\u5B8C\u6210\uFF0C\u6B63\u5728\u91CD\u65B0\u68C0\u6D4B\u6700\u7EC8\u72B6\u6001\u2026",
          recordStatus: requested.comment ? "\u5F53\u524D\u8BC4\u8BBA\u6570\u91CF\u5DF2\u8FBE\u5230\u76EE\u6807" : "\u672C\u6B21\u672A\u9009\u62E9\u8BC4\u8BBA\u64CD\u4F5C",
          liked,
          collected,
          interactionsSupported: supportsArticleInteractions(platform),
          progressPercent: 84,
          etaSeconds: 8,
          actionLabel: "\u6700\u7EC8\u72B6\u6001\u590D\u68C0"
        });
      }
      const postRisk = detectRiskControlMessage();
      if (postRisk) throw new RiskControlError(postRisk);
      const after = await scanCurrentPage();
      const scannedAfterCount = after?.commentCount ?? before.commentCount;
      const verifiedLiked = typeof after?.liked === "boolean" ? after.liked : liked;
      const verifiedCollected = typeof after?.collected === "boolean" ? after.collected : collected;
      liked = verifiedLiked;
      collected = verifiedCollected;
      const commentVisibleInDom = commentPosted && hasPublishedCommentInDom(platform, commentText);
      const commentVerified = !commentPosted || scannedAfterCount > before.commentCount || commentVisibleInDom;
      const afterCount = commentVisibleInDom ? Math.max(scannedAfterCount, before.commentCount + 1) : scannedAfterCount;
      const fullySatisfied = (!requested.comment || afterCount >= target) && (!requested.like || liked === true) && (!requested.collect || collected === true);
      const pendingCommentConfirmation = commentPosted && !commentVerified;
      const status = pendingCommentConfirmation ? "needs_attention" : fullySatisfied ? "verified" : "partial";
      const errorCode = pendingCommentConfirmation ? "COMMENT_PENDING_CONFIRMATION" : void 0;
      const error = pendingCommentConfirmation ? "\u8BC4\u8BBA\u5DF2\u63D0\u4EA4\uFF0C\u4F46\u5E73\u53F0\u5217\u8868\u6682\u672A\u540C\u6B65\uFF1B\u5DF2\u505C\u6B62\u91CD\u590D\u53D1\u5E03\uFF0C\u8BF7\u7A0D\u540E\u91CD\u65B0\u626B\u63CF\u786E\u8BA4" : void 0;
      showNotification({
        platform,
        title: before.title,
        commentCount: afterCount,
        username: before.username,
        status: pendingCommentConfirmation ? "\u8BC4\u8BBA\u5DF2\u63D0\u4EA4\uFF0C\u7B49\u5F85\u5E73\u53F0\u540C\u6B65" : fullySatisfied ? "\u8865\u9F50\u5B8C\u6210\u5E76\u5DF2\u91CD\u65B0\u9A8C\u8BC1" : "\u672C\u8F6E\u5B8C\u6210\uFF0C\u4ECD\u6709\u7F3A\u53E3",
        statusColor: fullySatisfied ? "#67C23A" : "#E6A23C",
        recordStatus: `\u8BC4\u8BBA ${requested.comment ? `\u76EE\u6807 ${target} \u6761` : "\u672A\u9009\u62E9"}\uFF1B\u70B9\u8D5E ${supportsArticleInteractions(platform) ? requested.like ? liked === true ? "\u5DF2\u5B8C\u6210" : "\u672A\u786E\u8BA4" : "\u672A\u9009\u62E9" : "\u5E73\u53F0\u65E0\u6B64\u9879"}\uFF1B\u6536\u85CF ${supportsArticleInteractions(platform) ? requested.collect ? collected === true ? "\u5DF2\u5B8C\u6210" : "\u672A\u786E\u8BA4" : "\u672A\u9009\u62E9" : "\u5E73\u53F0\u65E0\u6B64\u9879"}`,
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 100,
        actionLabel: fullySatisfied ? "\u64CD\u4F5C\u5B8C\u6210" : "\u672C\u8F6E\u64CD\u4F5C\u7ED3\u675F"
      });
      return {
        type: "SUPPLEMENT_RESULT",
        platform,
        url,
        title: before.title,
        username: before.username,
        targetCommentCount: target,
        beforeCommentCount: before.commentCount,
        afterCommentCount: afterCount,
        commentPosted,
        commentText: commentPosted ? commentText : void 0,
        likePerformed,
        collectPerformed,
        liked,
        collected,
        accountStatus,
        status,
        error,
        errorCode
      };
    } catch (error) {
      const riskBlocked = error instanceof RiskControlError;
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount,
        username: before.username,
        status: riskBlocked ? "\u68C0\u6D4B\u5230\u5E73\u53F0\u5B89\u5168\u9A8C\u8BC1\uFF0C\u4EFB\u52A1\u5DF2\u6682\u505C" : "\u672C\u8F6E\u9875\u9762\u64CD\u4F5C\u5931\u8D25",
        statusColor: "#F56C6C",
        recordStatus: String(error?.message || error),
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 100,
        actionLabel: riskBlocked ? "\u5B89\u5168\u6682\u505C" : "\u64CD\u4F5C\u7ED3\u675F"
      });
      return {
        type: "SUPPLEMENT_RESULT",
        platform,
        url,
        title: before.title,
        username: before.username,
        targetCommentCount: target,
        beforeCommentCount: before.commentCount,
        afterCommentCount: before.commentCount,
        commentPosted,
        commentText: commentPosted ? commentText : void 0,
        likePerformed,
        collectPerformed,
        liked,
        collected,
        accountStatus,
        status: riskBlocked ? "needs_attention" : "failed",
        error: String(error?.message || error),
        errorCode: riskBlocked ? "RISK_CONTROL_BLOCKED" : "ACTION_FAILED"
      };
    }
  }
  var activeScan = null;
  var lastScanResult = null;
  function scanCurrentPage() {
    if (activeScan) return activeScan;
    activeScan = performScan().then((result) => {
      lastScanResult = result;
      return result;
    }).finally(() => {
      activeScan = null;
    });
    return activeScan;
  }
  var autoScannedUrls = /* @__PURE__ */ new Set();
  async function autoScan() {
    const platform = detectPlatform(window.location.href);
    if (!platform || !isArticlePage(window.location.href)) return;
    const scanKey = normalizeArticleUrl(window.location.href, platform);
    if (autoScannedUrls.has(scanKey)) {
      log6("\u5F53\u524D\u94FE\u63A5\u5DF2\u81EA\u52A8\u626B\u63CF\u8FC7\uFF0C\u8DF3\u8FC7\u91CD\u590D\u626B\u63CF:", scanKey);
      return;
    }
    autoScannedUrls.add(scanKey);
    log6("\u81EA\u52A8\u626B\u63CF...");
    try {
      const result = await scanCurrentPage();
      if (!result) {
        log6("\u65E0\u7ED3\u679C\uFF0C\u4E0D\u66F4\u65B0 badge");
        return;
      }
      chrome.runtime.sendMessage({
        type: "UPDATE_BADGE",
        count: result.commentCount
      }).catch((e) => {
        log6("\u53D1\u9001\u6D88\u606F\u5931\u8D25:", e);
      });
    } catch (e) {
      console.error("[DL\u8BC4\u8BBA\u52A9\u624B] autoScan \u5F02\u5E38:", e);
    }
  }
  function init() {
    log6("Content script \u5DF2\u52A0\u8F7D");
    const initialPlatform = detectPlatform(window.location.href);
    if (initialPlatform && isArticlePage(window.location.href)) {
      showNotification({
        platform: initialPlatform,
        title: document.title || window.location.href,
        commentCount: null,
        status: "\u7B49\u5F85\u81EA\u52A8\u626B\u63CF\u2026",
        recordStatus: "\u65E0\u9700\u70B9\u51FB\u63D2\u4EF6\uFF0C\u9875\u9762\u52A0\u8F7D\u540E\u81EA\u52A8\u7EDF\u8BA1\u5E76\u66F4\u65B0\u8BB0\u5F55"
      });
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(autoScan, 2e3);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(autoScan, 2e3);
      });
    }
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        log6("SPA \u8DEF\u7531\u53D8\u5316:", lastUrl);
        notificationDismissed = false;
        removeNotification();
        lastScanResult = null;
        const nextPlatform = detectPlatform(lastUrl);
        if (nextPlatform && isArticlePage(lastUrl)) {
          showNotification({
            platform: nextPlatform,
            title: document.title || lastUrl,
            commentCount: null,
            status: "\u9875\u9762\u5DF2\u5207\u6362\uFF0C\u7B49\u5F85\u81EA\u52A8\u626B\u63CF\u2026",
            recordStatus: "\u76F8\u540C\u94FE\u63A5\u5C06\u66F4\u65B0\u539F\u8BB0\u5F55"
          });
        }
        setTimeout(autoScan, 2e3);
      }
    });
    observer.observe(document, { subtree: true, childList: true });
  }
  init();
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "CLEAR_SCAN_CACHE") {
      lastScanResult = null;
      notificationDismissed = true;
      removeNotification();
      sendResponse({ success: true });
      return false;
    }
    if (message.type === "GET_CURRENT_RESULT") {
      if (activeScan) {
        activeScan.then(sendResponse).catch(() => sendResponse(null));
        return true;
      }
      sendResponse(lastScanResult);
      return false;
    }
    if (message.type === "SCAN_PAGE") {
      log6("\u6536\u5230\u6D88\u606F:", message.type);
      const platform = detectPlatform(window.location.href);
      if (platform && isArticlePage(window.location.href)) {
        autoScannedUrls.add(normalizeArticleUrl(window.location.href, platform));
      }
      scanCurrentPage().then((result) => {
        sendResponse(result);
      }).catch((e) => {
        console.error("[DL\u8BC4\u8BBA\u52A9\u624B] \u6D88\u606F\u5904\u7406\u5F02\u5E38:", e);
        sendResponse(null);
      });
      return true;
    }
    if (message.type === "SCAN_ARCHIVE_METADATA") {
      if (message.platform !== "zhihu") {
        sendResponse(null);
        return false;
      }
      scanZhihuArchiveMetadata().then((result) => sendResponse(result ? {
        type: "SCAN_RESULT",
        platform: result.platform,
        url: window.location.href,
        title: result.title,
        commentCount: result.commentCount,
        username: result.username,
        linkStatus: "active"
      } : null)).catch(() => sendResponse(null));
      return true;
    }
    if (message.type === "CAPTURE_COMMENT_EVIDENCE") {
      sendResponse(captureCommentEvidence(message));
      return false;
    }
    if (message.type === "START_ACCOUNT_COMMENT_CAPTURE") {
      startAccountCommentCapture(message).then(sendResponse).catch((error) => sendResponse({
        success: false,
        error: String(error?.message || error)
      }));
      return true;
    }
    if (message.type === "NEXT_ACCOUNT_COMMENT_CAPTURE") {
      nextAccountCommentCapture().then(sendResponse).catch((error) => sendResponse({
        success: false,
        done: true,
        error: String(error?.message || error)
      }));
      return true;
    }
    if (message.type === "END_ACCOUNT_COMMENT_CAPTURE") {
      endAccountCommentCapture();
      sendResponse({ success: true });
      return false;
    }
    if (message.type === "VERIFY_COMMENT_EVIDENCE") {
      verifyCommentEvidence(message).then(sendResponse).catch((error) => sendResponse({
        success: false,
        presence: "unknown",
        checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reason: "\u5728\u7EBF\u6838\u9A8C\u672A\u5B8C\u6210",
        error: String(error)
      }));
      return true;
    }
    if (message.type === "SUPPLEMENT_PAGE") {
      supplementCurrentPage(message.targetCommentCount, message.actions).then(sendResponse).catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }
  });
})();
