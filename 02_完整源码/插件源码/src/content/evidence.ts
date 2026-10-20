import type {
  AccountCommentScreenshotTarget,
  CaptureCommentEvidenceRequest,
  CommentEvidenceCaptureResult,
  NextAccountCommentCaptureResult,
  Platform,
  StartAccountCommentCaptureRequest,
  StartAccountCommentCaptureResult,
} from '@shared/types'
import { PlatformLabel } from '@shared/types'

const COMMENT_CONTENT_SELECTORS: Partial<Record<Platform, string>> = {
  csdn: '.comment-list-box .new-comment, .comment-list-box .comment-content, .comment-box .new-comment, .comment-box .comment-content',
  zhihu: '.Comments-container .CommentContent, [class*="CommentItem"] [class*="CommentContent"]',
  toutiao: '.ttp-comment-item .content, [class*="comment-item"] [class*="content"]',
  baijiahao: '.xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text',
  netease: '.tie-new .tie-cnt, .tie-hot .tie-cnt, #tieArea .tie-cnt, #tieArea .comment-content',
  sohu: '#commentList .comment-content-text, #commentList .comment-content, #commentList .comment-text, #commentList [class*="comment-content"]',
}

const COMMENT_ITEM_SELECTORS: Partial<Record<Platform, string>> = {
  csdn: '.comment-list-item',
  zhihu: 'div[data-id]',
  toutiao: '.ttp-comment-item, [class*="comment-list"] [class*="comment-item"]',
  baijiahao: '.xcp-item[data-reply-id]',
  netease: '.tie-new .list-bdy > .trunk, .tie-hot .list-bdy > .trunk, .tie-new .list-bdy > .trunk .floor .self, .tie-hot .list-bdy > .trunk .floor .self, #tieArea .single-tie, #tieArea .comment-item, #tieArea [class*="tie-item"], body > .tie-new .trunk, body > .tie-hot .trunk',
  sohu: '#commentList .comment-item, #commentList [data-comment-id], #commentList [data-id], #commentList .comment-list-item, #commentList [class*="comment-item"]',
}

const COMMENT_AUTHOR_SELECTORS: Partial<Record<Platform, string>> = {
  csdn: '.name-href .name, .user-name, .comment-user-name, .comment-nickname, [class*="user-name"], [class*="nick"]',
  zhihu: 'a[href*="/people/"], .UserLink-link, [class*="CommentItem"] [class*="author"]',
  toutiao: '.user-name, [class*="user-name"], [class*="userName"], a[href*="/c/user/"]',
  baijiahao: '.user-bar-uname',
  netease: '.nickname, .tie-author .name, [class*="user-name"], [class*="nickname"]',
  sohu: '.author-area.name, .author-area .name, .author-area .username, .username, .user-name, .nickname, [class*="user-name"], [class*="author-name"]',
}

const COMMENT_BODY_SELECTORS: Partial<Record<Platform, string>> = {
  csdn: '.new-comment, .comment-content, [class*="comment-content"]',
  zhihu: '.CommentContent, [class*="CommentContent"]',
  toutiao: '.content, [class*="comment-content"], [class*="commentContent"]',
  baijiahao: '.x-interact-rich-text, .rich-text',
  netease: '.tie-cnt, .comment-content, [class*="comment-content"]',
  sohu: '.comment-content-text, .comment-content, .comment-text, [class*="comment-content"], [class*="comment-text"]',
}

interface AccountCommentCaptureSession {
  platform: Platform
  username: string
  expectedComment: string
  seenKeys: Set<string>
  advanceAttempts: number
  stableRounds: number
  positionFailures: Map<string, number>
  neteaseVisitedViews: Set<'new' | 'hot'>
}

let accountCommentCaptureSession: AccountCommentCaptureSession | null = null

const COMMENT_ROOT_SELECTORS: Partial<Record<Platform, string>> = {
  csdn: '.comment-side-content, .comment-list-box, .comment-box',
  zhihu: '.Modal-content, .Comments-container, .Comments, [class*="CommentModal"], [class*="CommentDrawer"]',
  toutiao: '.ttp-drawer, .ttp-comment-block, .ttp-comment-list, [class*="comment-list"]',
  baijiahao: '.xcp-list, [class*="comment-list"], .xcp-comment',
  netease: '.tie-new, .tie-hot, #tieArea, body',
  sohu: '#commentList, #meComment',
}

function comparable(value: string): string {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, '').trim()
}

function isElementVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    && rect.width > 1 && rect.height > 1
}

function findCommentRoot(platform: Platform): HTMLElement | null {
  if (platform === 'csdn') {
    return Array.from(document.querySelectorAll<HTMLElement>('.comment-side-content'))
      .find(isElementVisible) || null
  }
  if (platform === 'netease' && location.hostname === 'comment.tie.163.com') {
    return isElementVisible(document.body) ? document.body : null
  }
  const selector = COMMENT_ROOT_SELECTORS[platform]
  if (!selector) return null
  const roots = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isElementVisible)
  return roots.sort((a, b) => b.querySelectorAll(COMMENT_ITEM_SELECTORS[platform] || '*').length
    - a.querySelectorAll(COMMENT_ITEM_SELECTORS[platform] || '*').length)[0] || null
}

function commentBody(item: HTMLElement, platform: Platform): HTMLElement | null {
  if (platform === 'netease' && item.classList.contains('trunk')) {
    return item.querySelector<HTMLElement>(':scope > .rgt-col > .tie-bdy > .tie-cnt')
  }
  if (platform === 'netease' && item.classList.contains('self')) {
    return item.querySelector<HTMLElement>(':scope > .tie-cnt')
  }
  const selector = COMMENT_BODY_SELECTORS[platform]
  return selector ? item.querySelector<HTMLElement>(selector) : null
}

function commentAuthorValues(item: HTMLElement, platform: Platform): string[] {
  const values: string[] = []
  if (platform === 'netease') {
    const author = item.classList.contains('trunk')
      ? item.querySelector<HTMLElement>(':scope > .rgt-col > .tie-author .nickname')
      : item.classList.contains('self')
        ? item.querySelector<HTMLElement>(':scope > .tie-author .nickname')
        : null
    const text = comparable(author?.textContent || author?.getAttribute('title') || '')
    if (text) return [text]
  }
  const selector = COMMENT_AUTHOR_SELECTORS[platform]
  if (selector) {
    for (const element of item.querySelectorAll<HTMLElement>(selector)) {
      const text = comparable(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '')
      if (text && text.length <= 100) values.push(text)
    }
  }
  if (platform === 'csdn') {
    for (const link of item.querySelectorAll<HTMLAnchorElement>('a[href*="blog.csdn.net/"]')) {
      try {
        const account = decodeURIComponent(new URL(link.href, location.href).pathname.split('/').filter(Boolean)[0] || '')
        if (account) values.push(comparable(account))
      } catch {}
    }
  }
  return [...new Set(values)]
}

function itemMatchesAccount(item: HTMLElement, session: AccountCommentCaptureSession): boolean {
  const expected = comparable(session.expectedComment)
  const text = comparable(commentBody(item, session.platform)?.textContent || '')
  if (expected) return Boolean(text && text.includes(expected))
  const username = comparable(session.username).toLowerCase()
  if (!username) return false
  return commentAuthorValues(item, session.platform).some(value => value.toLowerCase() === username)
}

function currentMatchingItems(session: AccountCommentCaptureSession): Array<{
  item: HTMLElement
  target: Omit<AccountCommentScreenshotTarget, 'clip'>
}> {
  const root = findCommentRoot(session.platform)
  const selector = COMMENT_ITEM_SELECTORS[session.platform]
  if (!root || !selector) return []
  const candidates = [...new Set(Array.from(root.querySelectorAll<HTMLElement>(selector)))]
    .filter(isElementVisible)
  const occurrences = new Map<string, number>()
  const result: Array<{ item: HTMLElement; target: Omit<AccountCommentScreenshotTarget, 'clip'> }> = []
  for (const item of candidates) {
    if (!itemMatchesAccount(item, session)) continue
    const body = commentBody(item, session.platform)
    const commentText = (body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
    if (!commentText) continue
    const commentId = readCommentId(item)
    const author = commentAuthorValues(item, session.platform)[0] || session.username
    const platformDisplayedTime = readPlatformTime(item)
    const baseKey = commentId
      ? `id:${commentId}`
      : `text:${comparable(author)}:${comparable(commentText).slice(0, 800)}:${comparable(platformDisplayedTime)}`
    const occurrence = occurrences.get(baseKey) || 0
    occurrences.set(baseKey, occurrence + 1)
    const commentKey = occurrence > 0 ? `${baseKey}:copy:${occurrence + 1}` : baseKey
    result.push({
      item,
      target: {
        commentId: commentId || undefined,
        commentKey,
        commentText,
        author,
        platformDisplayedTime: platformDisplayedTime || undefined,
      },
    })
  }
  return result
}

async function waitForCommentRoot(platform: Platform, timeoutMs = 8000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const root = findCommentRoot(platform)
    if (root) return root
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return findCommentRoot(platform)
}

async function openCommentAreaForCapture(platform: Platform): Promise<void> {
  document.getElementById('ai-comment-notification')?.remove()
  if (platform === 'csdn') {
    const sidePanelOpen = Array.from(document.querySelectorAll<HTMLElement>('.comment-side-content'))
      .some(isElementVisible)
    if (!sidePanelOpen) {
      const opener = Array.from(document.querySelectorAll<HTMLElement>(
        '.has-comment-tit.go-side-comment, .tool-item-href.go-side-comment, .go-side-comment',
      )).find(element => isElementVisible(element)
        && /(?:条评论|评论|写评论)/.test(comparable(element.textContent || '')))
      opener?.click()
      if (opener) {
        const deadline = Date.now() + 8000
        while (!Array.from(document.querySelectorAll<HTMLElement>('.comment-side-content')).some(isElementVisible)
          && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
    }
  }
  if (platform === 'toutiao') {
    const drawerOpen = Array.from(document.querySelectorAll<HTMLElement>('.ttp-drawer'))
      .some(isElementVisible)
    if (!drawerOpen) {
      const panel = Array.from(document.querySelectorAll<HTMLElement>(
        'div.detail-interaction-comment[role="button"], [aria-label^="打开评论面板"], [class*="interaction-comment"][role="button"]',
      )).find(isElementVisible)
      panel?.click()
      if (panel) {
        const deadline = Date.now() + 8000
        while (!Array.from(document.querySelectorAll<HTMLElement>('.ttp-drawer')).some(isElementVisible)
          && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
    }
  }
  if (platform === 'zhihu') {
    // Zhihu initially shows a short inline list plus a separate entry for the
    // complete list. Do not mistake that preview for the opened comment area.
    const isModalOpen = () => Array.from(document.querySelectorAll<HTMLElement>('.Modal-content'))
      .some(isElementVisible)
    let modalOpen = isModalOpen()
    if (!modalOpen) {
      const viewAll = Array.from(document.querySelectorAll<HTMLElement>(
        'button, a, [role="button"], div',
      )).find(element => isElementVisible(element)
        && /^(?:点击)?查看全部评论$/.test(comparable(element.textContent || '')))
      viewAll?.click()
      if (viewAll) {
        const deadline = Date.now() + 8000
        while (!isModalOpen() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        modalOpen = isModalOpen()
      }
    }
    if (!modalOpen) {
      const opener = Array.from(document.querySelectorAll<HTMLElement>(
        'button.BottomActions-CommentBtn, button[aria-label*="条评论"], button[aria-label*="评论"]',
      )).find(element => isElementVisible(element)
        && /评论/.test(`${element.getAttribute('aria-label') || ''}${element.textContent || ''}`))
      opener?.click()
      if (opener) {
        const deadline = Date.now() + 8000
        while (!isModalOpen() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250))
        }
      }
    }
  }
  if (platform === 'sohu') {
    const root = findCommentRoot(platform)
    if (!root || !root.querySelector(COMMENT_ITEM_SELECTORS.sohu || '')) {
      const opener = document.querySelector<HTMLElement>('#leftComment')
        || document.querySelector<HTMLElement>('#meComment .comment-header .right')
        || document.querySelector<HTMLElement>('#meComment .comment-header')
        || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a, div'))
          .find(element => isElementVisible(element) && /(?:\d+\s*人参与，?\s*)?\d+\s*条评论/.test(element.textContent || ''))
      opener?.click()
      const deadline = Date.now() + 12000
      while (Date.now() < deadline) {
        const currentRoot = findCommentRoot(platform)
        if (currentRoot?.querySelector(COMMENT_ITEM_SELECTORS.sohu || '')) break
        await new Promise(resolve => setTimeout(resolve, 350))
      }
    }
  }
  const root = await waitForCommentRoot(platform)
  if (platform !== 'zhihu') root?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  await new Promise(resolve => setTimeout(resolve, 500))
}

function findLoadMoreCommentButton(root: HTMLElement): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>(
    '.look-flod-comment, .look-more-comment, .load-more-btn, button, [role="button"], a, [class*="loader"]',
  ))
    .find((element) => {
      if (!isElementVisible(element)) return false
      if (element.classList.contains('look-flod-comment')) return true
      const text = (element.textContent || '').replace(/\s+/g, '').trim()
      return /^(?:(?:查看|加载|展开)(?:全部)?(?:更多)?\d*条?(?:评论|回复)|下一页|下页)$/.test(text)
    }) || null
}

function findScrollableCommentContainer(root: HTMLElement): HTMLElement | null {
  const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>('div, ul, ol, section'))]
  return candidates.find((element) => {
    if (!isElementVisible(element)) return false
    const style = getComputedStyle(element)
    return /(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflow}`)
      && element.scrollHeight > element.clientHeight + 20
  }) || null
}

function findScrollableCommentAncestor(item: HTMLElement, root: HTMLElement): HTMLElement | null {
  let current = item.parentElement
  while (current) {
    const style = getComputedStyle(current)
    if (isElementVisible(current)
      && /(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflow}`)
      && current.scrollHeight > current.clientHeight + 20) {
      return current
    }
    if (current === root) break
    current = current.parentElement
  }
  return null
}

function isItemInsideCaptureViewport(item: HTMLElement, scrollable: HTMLElement | null): boolean {
  const rect = item.getBoundingClientRect()
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
    return false
  }
  if (!scrollable) return true
  const containerRect = scrollable.getBoundingClientRect()
  return rect.bottom > containerRect.top && rect.top < containerRect.bottom
}

function usesDynamicCommentList(platform: Platform): boolean {
  return platform === 'zhihu' || platform === 'toutiao'
}

function currentItemForKey(
  session: AccountCommentCaptureSession,
  commentKey: string,
): HTMLElement | null {
  return currentMatchingItems(session)
    .find(entry => entry.target.commentKey === commentKey)?.item || null
}

async function positionCommentForScreenshot(
  item: HTMLElement,
  session: AccountCommentCaptureSession,
  commentKey: string,
): Promise<boolean> {
  const platform = session.platform
  let currentItem = item
  const maxAttempts = usesDynamicCommentList(platform) ? 1 : 4
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (usesDynamicCommentList(platform)) {
      currentItem = currentItemForKey(session, commentKey) || currentItem
    }
    if (!currentItem.isConnected) {
      currentItem = currentItemForKey(session, commentKey) || currentItem
      if (!currentItem.isConnected) return false
    }
    const root = findCommentRoot(platform)
    const scrollable = root ? findScrollableCommentAncestor(currentItem, root) : null
    currentItem.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    if (scrollable) {
      const itemRect = currentItem.getBoundingClientRect()
      const containerRect = scrollable.getBoundingClientRect()
      scrollable.scrollTo({
        top: Math.max(0, scrollable.scrollTop
          + itemRect.top + itemRect.height / 2
          - (containerRect.top + containerRect.height / 2)),
        behavior: 'auto',
      })
    }
    await new Promise(resolve => setTimeout(resolve,
      usesDynamicCommentList(platform) ? 300 : 350 + attempt * 150))
    if (usesDynamicCommentList(platform)) {
      currentItem = currentItemForKey(session, commentKey) || currentItem
    }
    const currentRoot = findCommentRoot(platform)
    const currentScrollable = currentRoot ? findScrollableCommentAncestor(currentItem, currentRoot) : null
    if (currentItem.isConnected && isElementVisible(currentItem)
      && isItemInsideCaptureViewport(currentItem, currentScrollable)) {
      return true
    }
  }
  return false
}

function commentListSignature(platform: Platform): string {
  const root = findCommentRoot(platform)
  const selector = COMMENT_ITEM_SELECTORS[platform]
  if (!root || !selector) return ''
  const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(isElementVisible)
  const samples = items.length <= 12
    ? items
    : [...items.slice(0, 4), ...items.slice(-8)]
  return `${items.length}:${samples.map((item) => {
    const id = readCommentId(item)
    if (id) return `id:${id}`
    const author = commentAuthorValues(item, platform)[0] || ''
    const body = comparable(commentBody(item, platform)?.textContent || '').slice(0, 120)
    return `${author}:${body}`
  }).join('|')}`
}

async function advanceCommentList(session: AccountCommentCaptureSession): Promise<boolean> {
  const root = findCommentRoot(session.platform)
  if (!root) return false
  if (session.platform === 'netease') {
    const newView = document.querySelector<HTMLElement>('.tie-new')
    const hotView = document.querySelector<HTMLElement>('.tie-hot')
    const activeView = newView && isElementVisible(newView)
      ? { name: 'new' as const, element: newView }
      : hotView && isElementVisible(hotView)
        ? { name: 'hot' as const, element: hotView }
        : null
    const pageScope = activeView?.element || root
    const nextPage = Array.from(pageScope.querySelectorAll<HTMLElement>(
      '.m-page .next.z-enable, .m-page li .next.z-enable',
    )).find(isElementVisible)
    if (nextPage) {
      const beforeSignature = commentListSignature(session.platform)
      nextPage.click()
      const deadline = Date.now() + 6000
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250))
        if (commentListSignature(session.platform) !== beforeSignature) return true
      }
      return false
    }
    if (activeView) {
      session.neteaseVisitedViews.add(activeView.name)
      const alternate = activeView.name === 'new'
        ? { name: 'hot' as const, element: hotView }
        : { name: 'new' as const, element: newView }
      if (alternate.element && !session.neteaseVisitedViews.has(alternate.name)) {
        activeView.element.style.display = 'none'
        alternate.element.style.display = 'block'
        alternate.element.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' })
        await new Promise(resolve => setTimeout(resolve, 600))
        return true
      }
    }
    return false
  }
  const loadMore = findLoadMoreCommentButton(root)
  let scrollable: HTMLElement | null = null
  let beforeScrollTop = 0
  if (loadMore) {
    loadMore.scrollIntoView({ behavior: 'auto', block: 'center' })
    loadMore.click()
  } else {
    scrollable = findScrollableCommentContainer(root)
    if (scrollable) {
      beforeScrollTop = scrollable.scrollTop
      scrollable.scrollTo({
        top: Math.min(scrollable.scrollHeight, scrollable.scrollTop + Math.max(240, scrollable.clientHeight * 0.8)),
        behavior: 'auto',
      })
    } else {
      const selector = COMMENT_ITEM_SELECTORS[session.platform] || ''
      const items = selector ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : []
      const last = items.length ? items[items.length - 1] : null
      if (last) last.scrollIntoView({ behavior: 'auto', block: 'end' })
      else window.scrollBy({ top: Math.max(300, window.innerHeight * 0.75), behavior: 'auto' })
    }
  }
  await new Promise(resolve => setTimeout(resolve, loadMore ? 1100 : 800))
  if (usesDynamicCommentList(session.platform)) {
    const moved = Boolean(scrollable && Math.abs(scrollable.scrollTop - beforeScrollTop) > 2)
    return Boolean(loadMore || moved)
  }
  return Boolean(loadMore || findScrollableCommentContainer(root))
}

export async function startAccountCommentCapture(
  request: StartAccountCommentCaptureRequest,
): Promise<StartAccountCommentCaptureResult> {
  if (!COMMENT_ITEM_SELECTORS[request.platform] || !COMMENT_ROOT_SELECTORS[request.platform]) {
    return { success: false, error: '当前平台没有评论截图规则' }
  }
  accountCommentCaptureSession = {
    platform: request.platform,
    username: String(request.username || '').trim(),
    expectedComment: String(request.expectedComment || '').trim().slice(0, 2000),
    seenKeys: new Set(),
    advanceAttempts: 0,
    stableRounds: 0,
    positionFailures: new Map(),
    neteaseVisitedViews: new Set(),
  }
  await openCommentAreaForCapture(request.platform)
  let root = findCommentRoot(request.platform)
  if (root && usesDynamicCommentList(request.platform)) {
    const scrollable = findScrollableCommentContainer(root)
    if (scrollable && scrollable.scrollTop > 2) {
      scrollable.scrollTo({ top: 0, behavior: 'auto' })
      await new Promise(resolve => setTimeout(resolve, 450))
      root = findCommentRoot(request.platform)
    }
  }
  const selector = COMMENT_ITEM_SELECTORS[request.platform]
  const candidateCount = root && selector ? root.querySelectorAll(selector).length : 0
  const matchingCount = currentMatchingItems(accountCommentCaptureSession).length
  return {
    success: true,
    rootFound: Boolean(root),
    modalFound: request.platform !== 'zhihu'
      || Array.from(document.querySelectorAll<HTMLElement>('.Modal-content')).some(isElementVisible),
    candidateCount,
    matchingCount,
    scrollContainerFound: Boolean(root && findScrollableCommentContainer(root)),
  }
}

export async function nextAccountCommentCapture(): Promise<NextAccountCommentCaptureResult> {
  const session = accountCommentCaptureSession
  if (!session) return { success: false, done: true, error: '评论截图会话尚未开始' }

  if (usesDynamicCommentList(session.platform)) {
    const available = currentMatchingItems(session)
      .find(entry => !session.seenKeys.has(entry.target.commentKey))
    if (available) {
      const positioned = await positionCommentForScreenshot(
        available.item,
        session,
        available.target.commentKey,
      )
      if (!positioned) {
        const failures = (session.positionFailures.get(available.target.commentKey) || 0) + 1
        session.positionFailures.set(available.target.commentKey, failures)
        // Keep this call short. The next background round retries the target or
        // advances the virtual list instead of exceeding the 15-second timeout.
        if (failures >= 2) {
          const advanced = await advanceCommentList(session)
          session.advanceAttempts++
          session.stableRounds = advanced ? 0 : session.stableRounds + 1
        }
        return { success: true, done: false }
      }

      session.seenKeys.add(available.target.commentKey)
      session.positionFailures.delete(available.target.commentKey)
      session.stableRounds = 0
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      const x = Math.max(0, window.scrollX)
      const y = Math.max(0, window.scrollY)
      const width = Math.max(1, Math.min(documentWidth - x, window.innerWidth, 2200))
      const height = Math.max(1, Math.min(documentHeight - y, window.innerHeight, 5000))
      return {
        success: true,
        done: false,
        target: { ...available.target, clip: { x, y, width, height } },
      }
    }

    if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
      const matches = currentMatchingItems(session)
      const root = findCommentRoot(session.platform)
      const selector = COMMENT_ITEM_SELECTORS[session.platform]
      return {
        success: true,
        done: true,
        candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
        matchingCount: matches.length,
        advanceAttempts: session.advanceAttempts,
      }
    }

    const advanced = await advanceCommentList(session)
    session.advanceAttempts++
    session.stableRounds = advanced ? 0 : session.stableRounds + 1
    return { success: true, done: false }
  }

  for (let cycle = 0; cycle < 4; cycle++) {
    const available = currentMatchingItems(session).find(entry => !session.seenKeys.has(entry.target.commentKey))
    if (available) {
      if (!await positionCommentForScreenshot(available.item, session, available.target.commentKey)) {
        const failures = (session.positionFailures.get(available.target.commentKey) || 0) + 1
        session.positionFailures.set(available.target.commentKey, failures)
        if (usesDynamicCommentList(session.platform)) {
          const advanced = await advanceCommentList(session)
          session.advanceAttempts++
          session.stableRounds = advanced ? 0 : session.stableRounds + 1
          if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
            const matches = currentMatchingItems(session)
            const root = findCommentRoot(session.platform)
            const selector = COMMENT_ITEM_SELECTORS[session.platform]
            return {
              success: true,
              done: true,
              candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
              matchingCount: matches.length,
              advanceAttempts: session.advanceAttempts,
            }
          }
        } else {
          if (failures >= 3) session.seenKeys.add(available.target.commentKey)
          session.stableRounds++
        }
        continue
      }
      session.seenKeys.add(available.target.commentKey)
      session.positionFailures.delete(available.target.commentKey)
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      // 五个平台统一截取目标评论滚动到可见区域后的完整网页视口。
      // 定位仍按当前账号逐条进行，但图片保留页面、评论区和前后评论上下文。
      const x = Math.max(0, window.scrollX)
      const y = Math.max(0, window.scrollY)
      const width = Math.max(1, Math.min(documentWidth - x, window.innerWidth, 2200))
      const height = Math.max(1, Math.min(documentHeight - y, window.innerHeight, 5000))
      session.stableRounds = 0
      return {
        success: true,
        done: false,
        target: { ...available.target, clip: { x, y, width, height } },
      }
    }

    if (session.advanceAttempts >= 80 || session.stableRounds >= 3) {
      const matches = currentMatchingItems(session)
      const root = findCommentRoot(session.platform)
      const selector = COMMENT_ITEM_SELECTORS[session.platform]
      return {
        success: true,
        done: true,
        candidateCount: root && selector ? root.querySelectorAll(selector).length : 0,
        matchingCount: matches.length,
        advanceAttempts: session.advanceAttempts,
      }
    }
    const beforeSignature = commentListSignature(session.platform)
    const advanced = await advanceCommentList(session)
    session.advanceAttempts++
    const afterSignature = commentListSignature(session.platform)
    session.stableRounds = usesDynamicCommentList(session.platform)
      ? advanced ? 0 : session.stableRounds + 1
      : !advanced || beforeSignature === afterSignature ? session.stableRounds + 1 : 0
  }
  return { success: true, done: false }
}

export function endAccountCommentCapture(): void {
  accountCommentCaptureSession = null
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function articleIdFromUrl(value: string): string {
  try {
    const url = new URL(value)
    const matched = url.pathname.match(/(?:article|item|p|answer|detail)[/_-]?(\d{5,})/i)
      || url.pathname.match(/(\d{5,})(?:\/|\.html)?$/)
    return matched?.[1] || url.pathname.replace(/^\/+|\/+$/g, '') || url.hostname
  } catch {
    return ''
  }
}

function readCommentId(element: HTMLElement | null): string {
  if (!element) return ''
  const attributes = ['data-reply-id', 'data-comment-id', 'data-commentid', 'data-post-id', 'data-id']
  const candidates = [
    element,
    element.querySelector<HTMLElement>('[data-reply-id], [data-comment-id], [data-commentid], [data-post-id]'),
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate))
  for (const candidate of candidates) {
    for (const name of attributes) {
      const value = candidate.getAttribute(name)?.trim()
      if (value) return value.slice(0, 160)
    }
  }
  return ''
}

function readPlatformTime(element: HTMLElement | null): string {
  if (!element) return ''
  const candidate = element.querySelector<HTMLElement>('time, [class*="time"], [class*="date"], [data-time]')
  return (candidate?.getAttribute('datetime') || candidate?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function readDeclaredTotalCount(root: HTMLElement | null): number | undefined {
  const scope = root || document.body
  const candidates = Array.from(scope.querySelectorAll<HTMLElement>('h1, h2, h3, [aria-label], [class*="comment-title"], [class*="comment-count"]')).slice(0, 120)
  for (const element of candidates) {
    const text = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.replace(/\s+/g, ' ').trim()
    const match = text.match(/(?:评论|跟帖|参与)[^\d]{0,8}(\d{1,8})|([0-9]{1,8})[^\d]{0,4}(?:条)?(?:评论|跟帖)/)
    const value = Number(match?.[1] || match?.[2])
    if (Number.isSafeInteger(value) && value >= 0) return value
  }
  return undefined
}

function sanitizeClone(source: HTMLElement, isTarget: boolean): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  if (isTarget) clone.classList.add('evidence-target-node')

  for (const blocked of Array.from(clone.querySelectorAll(
    'script, style, link, iframe, object, embed, form, input, textarea, button, select, option, canvas, video, audio, noscript, template, svg, img',
  ))) blocked.remove()

  for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const keep = name === 'class' || name === 'title' || name === 'datetime' || name === 'aria-label'
      if (!keep || name.startsWith('on')) element.removeAttribute(attribute.name)
    }
    if (element instanceof HTMLAnchorElement) element.removeAttribute('href')
  }
  return clone
}

function selectCommentItems(root: HTMLElement, selector: string, targetItem: HTMLElement | null): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector))
  const all = candidates.filter(item => !candidates.some(other => other !== item && other.contains(item)))
  if (targetItem && !all.includes(targetItem)) all.push(targetItem)
  if (all.length <= 40) return all

  const targetIndex = targetItem ? all.indexOf(targetItem) : -1
  if (targetIndex < 0) return all.slice(0, 40)
  const start = Math.max(0, Math.min(targetIndex - 19, all.length - 40))
  return all.slice(start, start + 40)
}

function buildArchiveDocument(
  request: CaptureCommentEvidenceRequest,
  commentHtml: string,
  targetFoundInDom: boolean,
  capturedItemCount: number,
  commentId: string,
  platformDisplayedTime: string,
  declaredTotalCount?: number,
): string {
  const platform = PlatformLabel[request.platform]
  const capturedAtText = new Date(request.capturedAt).toLocaleString('zh-CN', { hour12: false })
  const basisText = targetFoundInDom
    ? '页面评论节点与本次评论文字一致'
    : request.comment
      ? '本次指定了目标评论，但当前页面未加载对应评论节点'
      : '本次为评论区状态扫描，记录当前账号评论数量和已加载评论节点'
  const totalText = declaredTotalCount == null ? '页面未提供稳定总数' : `${declaredTotalCount} 条`
  const targetSection = request.comment
    ? `<section class="target">
      <div class="label">目标评论</div>
      <div class="text">${escapeHtml(request.comment)}</div>
      <div class="basis">存档依据：${escapeHtml(basisText)}</div>
    </section>`
    : `<section class="target neutral">
      <div class="label">评论区状态快照</div>
      <div class="text">存档时本账号共有 ${request.afterCommentCount} 条评论</div>
      <div class="basis">${escapeHtml(basisText)}</div>
    </section>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>评论区存档 - ${escapeHtml(request.title || platform)}</title>
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
      <h1>${escapeHtml(request.title || '未读取到文章标题')}</h1>
      <div class="sub">${escapeHtml(platform)}评论区静态存档</div>
      <div class="meta">
        <div><b>存档时间</b>${escapeHtml(capturedAtText)}</div>
        <div><b>账号</b>${escapeHtml(request.username || '未记录')}</div>
        <div><b>本账号评论数</b>${request.beforeCommentCount} → ${request.afterCommentCount}</div>
        <div><b>页面评论总数</b>${escapeHtml(totalText)}</div>
        <div><b>评论 ID</b>${escapeHtml(commentId || '页面未提供')}</div>
        <div><b>平台显示时间</b>${escapeHtml(platformDisplayedTime || '页面未提供')}</div>
        <div class="url" style="grid-column:1/-1"><b>原链接</b>${escapeHtml(request.url)}</div>
      </div>
    </section>
    ${targetSection}
    <section class="comments">
      <div class="comments-title"><span>当时已加载的评论</span><span>${capturedItemCount} 条</span></div>
      ${commentHtml || '<div class="empty">当前页面没有可保存的评论节点，已保留发布结果和数量信息。</div>'}
    </section>
    <p class="notice"><strong>说明：</strong>这是采集时刻的静态页面记录，不会执行脚本、提交表单或访问跟踪资源，也不代表平台当前状态。请结合原链接的在线核验结果判断评论是否仍然存在。</p>
  </main>
</body>
</html>`
}

export function captureCommentEvidence(request: CaptureCommentEvidenceRequest): CommentEvidenceCaptureResult {
  try {
    const expected = comparable(request.comment)

    const contentSelector = COMMENT_CONTENT_SELECTORS[request.platform]
    const itemSelector = COMMENT_ITEM_SELECTORS[request.platform]
    const rootSelector = COMMENT_ROOT_SELECTORS[request.platform]
    if (!contentSelector || !itemSelector || !rootSelector) {
      return { success: false, error: '当前平台没有评论区存档规则' }
    }

    const targetContent = expected
      ? Array.from(document.querySelectorAll<HTMLElement>(contentSelector))
        .find(element => comparable(element.textContent || '').includes(expected)) || null
      : null
    const targetItem = targetContent?.closest<HTMLElement>(itemSelector) || targetContent
    const root = targetItem?.closest<HTMLElement>(rootSelector)
      || document.querySelector<HTMLElement>(rootSelector)
      || targetItem?.parentElement
      || document.body
    const items = selectCommentItems(root, itemSelector, targetItem)
    const entries = items.map((item) => {
      const isTarget = item === targetItem || Boolean(targetContent && item.contains(targetContent))
      const clone = sanitizeClone(item, isTarget)
      return `<article class="comment-entry">${clone.outerHTML}</article>`
    }).join('')
    const targetFoundInDom = Boolean(targetContent)
    const commentId = readCommentId(targetItem)
    const platformDisplayedTime = readPlatformTime(targetItem)
    const declaredTotalCount = readDeclaredTotalCount(root)
    const htmlDocument = buildArchiveDocument(
      request,
      entries,
      targetFoundInDom,
      items.length,
      commentId,
      platformDisplayedTime,
      declaredTotalCount,
    )

    return {
      success: true,
      htmlDocument,
      articleId: articleIdFromUrl(request.url),
      commentId: commentId || undefined,
      platformDisplayedTime: platformDisplayedTime || undefined,
      declaredTotalCount,
      capturedItemCount: items.length,
      targetFoundInDom,
    }
  } catch (error) {
    return { success: false, error: `评论区存档生成失败：${String((error as Error)?.message || error)}` }
  }
}
