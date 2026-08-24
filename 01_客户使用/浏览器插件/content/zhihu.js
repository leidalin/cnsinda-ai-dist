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

  // src/content/zhihu.ts
  var PLATFORM = "zhihu";
  var DEBUG = true;
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
  function log(...args) {
    if (DEBUG) console.log("[DL\u8BC4\u8BBA\u52A9\u624B-\u77E5\u4E4E]", ...args);
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function cleanText(value) {
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
          log("\u5FFD\u7565\u975E\u9884\u671F\u7684\u8BC4\u8BBA\u5206\u9875\u5730\u5740:", nextUrl);
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
          const commentId = cleanText(comment.id);
          if (commentId && seenComments.has(commentId)) continue;
          if (commentId) seenComments.add(commentId);
          if (cleanText(comment.author?.name) === username) matchedCount++;
        }
        pageCount++;
        nextUrl = payload.paging?.is_end ? null : payload.paging?.next || null;
      }
      log(`\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5B8C\u6210: ${pageCount} \u9875\uFF0C\u7528\u6237\u201C${username}\u201D\u5171 ${matchedCount} \u6761`);
      return matchedCount;
    } catch (error) {
      log("\u8BC4\u8BBA\u63A5\u53E3\u5206\u9875\u5931\u8D25\uFF0C\u56DE\u9000\u5230\u9875\u9762\u7EDF\u8BA1:", error);
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
    const value = cleanText(alt);
    if (!value || value.length > 60) return null;
    const patterns = [
      /^(.+?)的头像$/,
      /^(.+?)头像$/,
      /^点击(?:打开|查看)(.+?)(?:的(?:主页|个人资料))?$/
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      const name = cleanText(match?.[1]);
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
          log("\u4ECE\u9876\u90E8\u8D26\u53F7\u5934\u50CF\u8BC6\u522B\u7528\u6237\u540D:", name);
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
        const name = cleanText(account?.name || account?.user?.name || account?.displayName);
        if (name && name.length < 30) {
          log("\u4ECE\u9875\u9762\u72B6\u6001\u8BC6\u522B\u7528\u6237\u540D:", name);
          detected = name;
        }
      }
    } catch (error) {
      log("\u8BFB\u53D6\u9875\u9762\u8D26\u53F7\u72B6\u6001\u5931\u8D25:", error);
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
            const name = cleanText(value.name || value.nickname || value.displayName);
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
    return resolvePlatformUsername(PLATFORM, detected);
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
    const text = cleanText(element.innerText || element.textContent);
    const ariaLabel = cleanText(element.getAttribute("aria-label"));
    const ariaControls = cleanText(element.getAttribute("aria-controls"));
    const title = cleanText(element.getAttribute("title"));
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
    const text = cleanText(element.innerText || element.textContent);
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
    )).find((element) => isVisible(element) && /评论|友善|写下/.test(cleanText(
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
    const replyButtons = Array.from(root.querySelectorAll('button, [role="button"]')).filter((element) => isVisible(element) && cleanText(element.textContent) === "\u56DE\u590D");
    for (const button of replyButtons) {
      let candidate = button.parentElement;
      for (let depth = 0; candidate && candidate !== root && depth < 8; depth++) {
        const parent = candidate.parentElement;
        if (!parent) break;
        const siblingCommentCount = Array.from(parent.children).filter(
          (sibling) => Array.from(sibling.querySelectorAll('button, [role="button"]')).some((element) => cleanText(element.textContent) === "\u56DE\u590D")
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
      await sleep(250);
    }
    return null;
  }
  async function clickCommentButton(button) {
    button.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await sleep(300);
    button.focus({ preventScroll: true });
    if (button instanceof HTMLButtonElement) HTMLButtonElement.prototype.click.call(button);
    else HTMLElement.prototype.click.call(button);
  }
  async function openCommentArea() {
    const existing = findVisibleCommentRoot();
    if (existing) {
      log("\u8BC4\u8BBA\u533A\u5DF2\u7ECF\u5C55\u5F00");
      return existing;
    }
    const buttons = findCommentOpenButtons();
    log(`\u627E\u5230 ${buttons.length} \u4E2A\u8BC4\u8BBA\u5165\u53E3\u5019\u9009`);
    for (const [index, button] of buttons.slice(0, 8).entries()) {
      const text = cleanText(button.innerText || button.textContent || button.getAttribute("aria-label"));
      log(`\u5C1D\u8BD5\u8BC4\u8BBA\u5165\u53E3 ${index + 1}:`, text, button.className);
      try {
        await clickCommentButton(button);
        const root = await waitForCommentRoot(5e3);
        if (root) {
          log("\u8BC4\u8BBA\u533A\u5DF2\u6210\u529F\u5C55\u5F00");
          return root;
        }
      } catch (error) {
        log("\u70B9\u51FB\u8BC4\u8BBA\u5165\u53E3\u5931\u8D25:", error);
      }
    }
    const primaryRoot = getPrimaryContentRoot();
    const bottom = primaryRoot?.getBoundingClientRect().bottom ?? document.documentElement.scrollHeight;
    window.scrollTo({ top: Math.max(0, window.scrollY + bottom - window.innerHeight + 80), behavior: "auto" });
    await sleep(1200);
    const retryButtons = findCommentOpenButtons();
    for (const button of retryButtons.slice(0, 8)) {
      try {
        await clickCommentButton(button);
        const root = await waitForCommentRoot(5e3);
        if (root) return root;
      } catch {
      }
    }
    log("\u672A\u80FD\u5C55\u5F00\u8BC4\u8BBA\u533A");
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
      const text = cleanText(element.innerText || element.textContent);
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
        const text = cleanText(moreButton.innerText || moreButton.textContent);
        log(`\u70B9\u51FB\u52A0\u8F7D\u6309\u94AE: ${text}`);
        try {
          moreButton.scrollIntoView({ behavior: "auto", block: "center" });
          await sleep(150);
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
      await sleep(moreButton ? 1e3 : 700);
      const after = countLoadedCommentItems(currentRoot);
      log(`\u8BC4\u8BBA\u52A0\u8F7D ${round + 1}: ${before} \u2192 ${after}`);
      if (after > previousCount || moreButton) stableRounds = 0;
      else stableRounds++;
      previousCount = after;
      if (stableRounds >= 5) break;
    }
    return Math.max(0, previousCount);
  }
  function countMyComments(username, root) {
    const normalizedUsername = cleanText(username);
    const matchedItems = /* @__PURE__ */ new Set();
    const items = getCommentItems(root);
    for (const item of items) {
      const authorLinks = item.querySelectorAll('a[href*="/people/"]');
      const matchedLink = Array.from(authorLinks).some(
        (link) => cleanText(link.textContent || link.getAttribute("aria-label") || link.getAttribute("title")) === normalizedUsername
      );
      if (matchedLink) {
        matchedItems.add(item);
        continue;
      }
      const author = item.querySelector(
        '[class*="CommentItem"] [class*="Author"], [class*="CommentItem"] [class*="name"], [data-za-detail-view-path-module*="Author"]'
      );
      if (cleanText(author?.textContent) === normalizedUsername) matchedItems.add(item);
    }
    log(`\u7528\u6237\u201C${username}\u201D\u5339\u914D\u5230 ${matchedItems.size} \u6761\u8BC4\u8BBA`);
    return matchedItems.size;
  }
  function getPageTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (cleanText(ogTitle)) return cleanText(ogTitle);
    const h1 = document.querySelector("h1");
    if (cleanText(h1?.textContent)) return cleanText(h1?.textContent);
    return document.title.replace(/\s*[-–]\s*(知乎|Zhihu).*$/i, "").trim() || "\u672A\u77E5\u6587\u7AE0";
  }
  async function scanZhihuPage() {
    log("===== \u5F00\u59CB\u626B\u63CF\u77E5\u4E4E =====");
    const username = await getCurrentUsername();
    if (!username) {
      log("\u672A\u627E\u5230\u5F53\u524D\u7528\u6237\u540D\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u586B\u5199\u77E5\u4E4E\u7528\u6237\u540D");
      return null;
    }
    const title = getPageTitle();
    log("\u7528\u6237:", username);
    log("\u6807\u9898:", title);
    const commentRoot = await openCommentArea();
    if (!commentRoot) return null;
    const apiCountPromise = fetchArticleCommentCount(username);
    const loadedCount = await loadAllComments(commentRoot);
    log(`\u5DF2\u52A0\u8F7D\u8BC4\u8BBA\u5143\u7D20: ${loadedCount}`);
    const latestRoot = findVisibleCommentRoot() || commentRoot;
    const apiCount = await apiCountPromise;
    const commentCount = apiCount ?? countMyComments(username, latestRoot);
    log(`===== \u626B\u63CF\u5B8C\u6210: ${commentCount} \u6761 =====`);
    return { platform: PLATFORM, title, commentCount, username };
  }
  async function scanZhihuArchiveMetadata() {
    const username = await getCurrentUsername();
    if (!username) return null;
    const commentCount = await fetchArticleCommentCount(username);
    return {
      platform: PLATFORM,
      title: getPageTitle(),
      commentCount: Math.max(0, commentCount || 0),
      username
    };
  }
})();
