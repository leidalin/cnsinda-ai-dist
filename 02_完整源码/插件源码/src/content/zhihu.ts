import type { Platform } from '@shared/types'

import { resolvePlatformUsername } from '@shared/account'

const PLATFORM: Platform = 'zhihu'
const DEBUG = true
const COMMENT_ROOT_SELECTOR = [
  '.Comments-container',
  '.Comments',
  '[class*="Comments-container"]',
  '[class*="Comments-list"]',
  '[class*="CommentList"]',
  '[class*="CommentModal"]',
  '[class*="CommentDrawer"]',
  '[data-za-detail-view-path-module*="CommentList"]',
  '[role="dialog"] [class*="Comment"]',
  '[role="dialog"]',
  '[class*="Modal"] [class*="Comment"]',
].join(',')
const COMMENT_ITEM_SELECTOR = [
  '.CommentItem',
  '[class*="CommentItem"]',
  '[class*="Comments-item"]',
  '[data-za-detail-view-path-module*="CommentItem"]',
].join(',')

function log(...args: any[]) {
  if (DEBUG) console.log('[DL评论助手-知乎]', ...args)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

interface ZhihuCommentApiItem {
  id?: string
  is_delete?: boolean
  author?: { name?: string }
}

interface ZhihuCommentApiResponse {
  data?: ZhihuCommentApiItem[]
  paging?: {
    is_end?: boolean
    next?: string
    totals?: number
  }
}

async function fetchArticleCommentCount(username: string): Promise<number | null> {
  const articleId = window.location.pathname.match(/^\/p\/(\d+)/)?.[1]
  if (!articleId) return null

  const apiPath = `/api/v4/comment_v5/articles/${articleId}/root_comment`
  let nextUrl: string | null = `https://www.zhihu.com${apiPath}?order_by=score&limit=20&offset=`
  const seenPages = new Set<string>()
  const seenComments = new Set<string>()
  let matchedCount = 0
  let pageCount = 0

  try {
    while (nextUrl && pageCount < 50 && !seenPages.has(nextUrl)) {
      const parsedUrl = new URL(nextUrl)
      if (parsedUrl.origin !== 'https://www.zhihu.com' || parsedUrl.pathname !== apiPath) {
        log('忽略非预期的评论分页地址:', nextUrl)
        break
      }

      seenPages.add(nextUrl)
      const response = await fetch(nextUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`评论接口返回 HTTP ${response.status}`)

      const payload = await response.json() as ZhihuCommentApiResponse
      for (const comment of payload.data || []) {
        if (comment.is_delete) continue
        const commentId = cleanText(comment.id)
        if (commentId && seenComments.has(commentId)) continue
        if (commentId) seenComments.add(commentId)
        if (cleanText(comment.author?.name) === username) matchedCount++
      }

      pageCount++
      nextUrl = payload.paging?.is_end ? null : payload.paging?.next || null
    }

    log(`评论接口分页完成: ${pageCount} 页，用户“${username}”共 ${matchedCount} 条`)
    return matchedCount
  } catch (error) {
    log('评论接口分页失败，回退到页面统计:', error)
    return null
  }
}

function isVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0
}

function extractNameFromAvatarAlt(alt: string): string | null {
  const value = cleanText(alt)
  if (!value || value.length > 60) return null
  const patterns = [
    /^(.+?)的头像$/,
    /^(.+?)头像$/,
    /^点击(?:打开|查看)(.+?)(?:的(?:主页|个人资料))?$/,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    const name = cleanText(match?.[1])
    if (name && name.length < 30) return name
  }
  return null
}

async function getCurrentUsername(): Promise<string | null> {
  let detected: string | null = null

  // 只检查顶部导航中的当前账号，避免把文章作者误认为当前用户。
  const headerSelectors = [
    '.AppHeader-profile img[alt]',
    '.AppHeader-userInfo img[alt]',
    'header button img[alt]',
    'header [aria-label*="个人"] img[alt]',
    'header [aria-label*="我的"] img[alt]',
    '[class*="AppHeader"] [class*="profile"] img[alt]',
  ]
  for (const selector of headerSelectors) {
    for (const image of document.querySelectorAll<HTMLImageElement>(selector)) {
      const name = extractNameFromAvatarAlt(image.alt)
      if (name) {
        log('从顶部账号头像识别用户名:', name)
        detected = name
        break
      }
    }
    if (detected) break
  }

  // 知乎页面数据中的当前登录用户。
  try {
    const initialState = document.querySelector<HTMLScriptElement>('#js-initialData, script[data-state]')?.textContent
    if (!detected && initialState) {
      const data = JSON.parse(initialState)
      const account = data?.initialState?.account || data?.initialState?.user || data?.account
      const name = cleanText(account?.name || account?.user?.name || account?.displayName)
      if (name && name.length < 30) {
        log('从页面状态识别用户名:', name)
        detected = name
      }
    }
  } catch (error) {
    log('读取页面账号状态失败:', error)
  }

  // 兼容部分旧页面保存的用户数据。
  try {
    for (const key of detected ? [] : Object.keys(localStorage)) {
      if (!/(user|account|profile)/i.test(key)) continue
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}')
        const queue: any[] = [data]
        const visited = new Set<any>()
        while (queue.length > 0) {
          const value = queue.shift()
          if (!value || typeof value !== 'object' || visited.has(value)) continue
          visited.add(value)
          const name = cleanText(value.name || value.nickname || value.displayName)
          if (name && name.length < 30) {
            detected = name
            break
          }
          queue.push(...Object.values(value))
        }
        if (detected) break
      } catch {}
    }
  } catch {}

  return resolvePlatformUsername(PLATFORM, detected)
}

function getPrimaryContentRoot(): HTMLElement | null {
  const pathname = window.location.pathname
  const selectors = pathname.includes('/answer/')
    ? ['.AnswerItem', '[itemprop="answer"]', 'article', 'main']
    : ['.Post-Main', '.Post-content', 'article', 'main']

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisible)
    if (candidates.length > 0) return candidates[0]
  }
  return document.querySelector<HTMLElement>('main') || document.body
}

function isCommentOpenButton(element: HTMLElement): boolean {
  if (!isVisible(element) || element.hasAttribute('disabled')) return false
  if (element.closest(COMMENT_ROOT_SELECTOR) || element.closest(COMMENT_ITEM_SELECTOR)) return false

  const text = cleanText(element.innerText || element.textContent)
  const ariaLabel = cleanText(element.getAttribute('aria-label'))
  const ariaControls = cleanText(element.getAttribute('aria-controls'))
  const title = cleanText(element.getAttribute('title'))
  const combined = `${text} ${ariaLabel} ${title}`

  if (/回复|收起评论|关闭评论|取消|发布|删除|写下你的评论/.test(combined)) return false
  if (/comment/i.test(ariaControls) && element.getAttribute('aria-expanded') !== 'true') return true
  if (/评论/.test(ariaLabel) && !/收起|关闭/.test(ariaLabel)) return true

  const exactMatch = /^(?:查看全部\s*)?\d*\s*条?评论$/.test(text)
    || /^(?:查看|展开|打开)(?:全部)?\s*\d*\s*条?评论$/.test(text)
    || /^(?:评论|添加评论|查看评论)$/.test(text)
  if (exactMatch) return true

  // 知乎按钮文字常混入图标占位符、不可见字符或额外计数，放宽操作栏中的按钮判断。
  const isClickable = element.tagName === 'BUTTON' || element.getAttribute('role') === 'button'
  const inActionBar = Boolean(element.closest(
    '.ContentItem-actions, .Post-actions, [class*="ContentItem-actions"], [class*="Post-actions"], [class*="BottomBar"], [class*="ActionBar"]'
  ))
  return isClickable && inActionBar && text.length <= 50 && /评论/.test(text)
}

function scoreCommentButton(element: HTMLElement, primaryRoot: HTMLElement | null): number {
  const text = cleanText(element.innerText || element.textContent)
  let score = 0
  if (element.tagName === 'BUTTON') score += 30
  if (element.getAttribute('role') === 'button') score += 15
  if (element.getAttribute('aria-label')?.includes('评论')) score += 35
  if (/\d+\s*条?评论/.test(text)) score += 40
  if (/查看全部|展开|打开/.test(text)) score += 20
  if (element.closest('.ContentItem-actions, .Post-actions, [class*="ContentItem-actions"], [class*="Post-actions"], [class*="BottomBar"]')) score += 35
  if (primaryRoot?.contains(element)) score += 50
  const rect = element.getBoundingClientRect()
  if (rect.top >= 0 && rect.top <= window.innerHeight) score += 10
  return score
}

function findCommentOpenButtons(): HTMLElement[] {
  const primaryRoot = getPrimaryContentRoot()
  const selector = [
    'button',
    '[role="button"]',
    '[tabindex="0"]',
    'a[aria-label*="评论"]',
    '[aria-controls*="comment" i]',
    '[class*="ContentItem-action"]',
    '[class*="Post-action"]',
    '[data-za-detail-view-path-module*="Comment"]',
    '[data-za-extra-module*="Comment"]',
  ].join(',')
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
  const unique = Array.from(new Set(elements.filter(isCommentOpenButton)))
  unique.sort((a, b) => scoreCommentButton(b, primaryRoot) - scoreCommentButton(a, primaryRoot))
  return unique
}

function findVisibleCommentRoot(): HTMLElement | null {
  const roots = Array.from(document.querySelectorAll<HTMLElement>(COMMENT_ROOT_SELECTOR))
    .filter(root => isVisible(root) && root.tagName !== 'BUTTON')
  if (roots.length > 0) {
    roots.sort((a, b) => {
      const aItems = a.querySelectorAll(COMMENT_ITEM_SELECTOR).length
      const bItems = b.querySelectorAll(COMMENT_ITEM_SELECTOR).length
      return bItems - aItems
    })
    return roots[0]
  }

  // 新版知乎可能使用哈希类名：从评论项反向找到共同容器。
  const visibleItem = Array.from(document.querySelectorAll<HTMLElement>(COMMENT_ITEM_SELECTOR)).find(isVisible)
  if (visibleItem) {
    let container = visibleItem.parentElement
    for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
      if (container.querySelectorAll(COMMENT_ITEM_SELECTOR).length >= 1) return container
    }
  }

  // 空评论区或尚未加载评论项时，用评论输入框定位侧栏/弹窗。
  const editor = Array.from(document.querySelectorAll<HTMLElement>(
    'textarea[placeholder*="评论"], input[placeholder*="评论"], [contenteditable="true"]'
  )).find(element => isVisible(element) && /评论|友善|写下/.test(cleanText(
    element.getAttribute('placeholder') || element.getAttribute('aria-label') || element.parentElement?.textContent
  )))
  if (editor) {
    return editor.closest<HTMLElement>('[role="dialog"], [class*="Modal"], [class*="Drawer"], section, form')
      || editor.parentElement
  }

  return null
}

function getCommentItems(root: HTMLElement): HTMLElement[] {
  const knownItems = Array.from(root.querySelectorAll<HTMLElement>(COMMENT_ITEM_SELECTOR)).filter(isVisible)
  if (knownItems.length > 0) return knownItems

  // 新版知乎的评论项只使用哈希类名。以每条评论唯一的“回复”按钮为锚点，
  // 向上找到其父级中包含多个同类评论的直接子项。
  const items = new Set<HTMLElement>()
  const replyButtons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter(element => isVisible(element) && cleanText(element.textContent) === '回复')

  for (const button of replyButtons) {
    let candidate = button.parentElement
    for (let depth = 0; candidate && candidate !== root && depth < 8; depth++) {
      const parent = candidate.parentElement
      if (!parent) break
      const siblingCommentCount = Array.from(parent.children).filter(sibling =>
        Array.from(sibling.querySelectorAll<HTMLElement>('button, [role="button"]'))
          .some(element => cleanText(element.textContent) === '回复')
      ).length
      if (siblingCommentCount >= 2) {
        items.add(candidate)
        break
      }
      candidate = parent
    }
  }

  return Array.from(items).filter(isVisible)
}

async function waitForCommentRoot(timeoutMs = 10000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const root = findVisibleCommentRoot()
    if (root) return root
    await sleep(250)
  }
  return null
}

async function clickCommentButton(button: HTMLElement): Promise<void> {
  button.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
  await sleep(300)
  button.focus({ preventScroll: true })
  if (button instanceof HTMLButtonElement) HTMLButtonElement.prototype.click.call(button)
  else HTMLElement.prototype.click.call(button)
}

async function openCommentArea(): Promise<HTMLElement | null> {
  const existing = findVisibleCommentRoot()
  if (existing) {
    log('评论区已经展开')
    return existing
  }

  const buttons = findCommentOpenButtons()
  log(`找到 ${buttons.length} 个评论入口候选`)
  for (const [index, button] of buttons.slice(0, 8).entries()) {
    const text = cleanText(button.innerText || button.textContent || button.getAttribute('aria-label'))
    log(`尝试评论入口 ${index + 1}:`, text, button.className)
    try {
      await clickCommentButton(button)
      const root = await waitForCommentRoot(5000)
      if (root) {
        log('评论区已成功展开')
        return root
      }
    } catch (error) {
      log('点击评论入口失败:', error)
    }
  }

  // 某些专栏页需先到文章末尾，底部评论工具栏才会挂载。
  const primaryRoot = getPrimaryContentRoot()
  const bottom = primaryRoot?.getBoundingClientRect().bottom ?? document.documentElement.scrollHeight
  window.scrollTo({ top: Math.max(0, window.scrollY + bottom - window.innerHeight + 80), behavior: 'auto' })
  await sleep(1200)

  const retryButtons = findCommentOpenButtons()
  for (const button of retryButtons.slice(0, 8)) {
    try {
      await clickCommentButton(button)
      const root = await waitForCommentRoot(5000)
      if (root) return root
    } catch {}
  }

  log('未能展开评论区')
  return null
}

function countLoadedCommentItems(root: HTMLElement): number {
  const items = getCommentItems(root)
  if (items.length > 0) return items.length
  // 知乎通常为每位评论作者渲染头像和用户名两个相同链接。
  return Math.ceil(root.querySelectorAll('a[href*="/people/"]').length / 2)
}

function findScrollableContainer(root: HTMLElement): HTMLElement | null {
  const candidates: HTMLElement[] = [root]
  let parent = root.parentElement
  while (parent && parent !== document.body) {
    candidates.push(parent)
    parent = parent.parentElement
  }
  candidates.push(...Array.from(root.querySelectorAll<HTMLElement>('[class*="scroll"], [class*="Scroll"], [role="dialog"]')))

  return candidates.find(element => {
    const style = getComputedStyle(element)
    return /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)
      && element.scrollHeight > element.clientHeight + 30
  }) || null
}

function findLoadMoreButton(root: HTMLElement): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"], a')
  for (const element of candidates) {
    if (!isVisible(element)) continue
    const text = cleanText(element.innerText || element.textContent)
    if (/^(?:加载|查看|展开)(?:更多|全部)?\s*(?:评论|回复)/.test(text)) return element
  }
  return null
}

async function loadAllComments(root: HTMLElement): Promise<number> {
  let currentRoot = root
  let previousCount = -1
  let stableRounds = 0

  for (let round = 0; round < 35; round++) {
    currentRoot = findVisibleCommentRoot() || currentRoot
    const before = countLoadedCommentItems(currentRoot)

    const moreButton = findLoadMoreButton(currentRoot)
    if (moreButton) {
      const text = cleanText(moreButton.innerText || moreButton.textContent)
      log(`点击加载按钮: ${text}`)
      try {
        moreButton.scrollIntoView({ behavior: 'auto', block: 'center' })
        await sleep(150)
        moreButton.click()
      } catch {}
    }

    const scrollContainer = findScrollableContainer(currentRoot)
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' })
    } else {
      const items = getCommentItems(currentRoot)
      const lastItem = items[items.length - 1]
      if (lastItem) lastItem.scrollIntoView({ behavior: 'auto', block: 'end' })
      else currentRoot.scrollIntoView({ behavior: 'auto', block: 'end' })
    }

    await sleep(moreButton ? 1000 : 700)
    const after = countLoadedCommentItems(currentRoot)
    log(`评论加载 ${round + 1}: ${before} → ${after}`)

    if (after > previousCount || moreButton) stableRounds = 0
    else stableRounds++
    previousCount = after

    if (stableRounds >= 5) break
  }

  return Math.max(0, previousCount)
}

function countMyComments(username: string, root: HTMLElement): number {
  const normalizedUsername = cleanText(username)
  const matchedItems = new Set<Element>()
  const items = getCommentItems(root)

  for (const item of items) {
    const authorLinks = item.querySelectorAll<HTMLAnchorElement>('a[href*="/people/"]')
    const matchedLink = Array.from(authorLinks).some(link =>
      cleanText(link.textContent || link.getAttribute('aria-label') || link.getAttribute('title')) === normalizedUsername
    )
    if (matchedLink) {
      matchedItems.add(item)
      continue
    }

    const author = item.querySelector<HTMLElement>(
      '[class*="CommentItem"] [class*="Author"], [class*="CommentItem"] [class*="name"], [data-za-detail-view-path-module*="Author"]'
    )
    if (cleanText(author?.textContent) === normalizedUsername) matchedItems.add(item)
  }

  log(`用户“${username}”匹配到 ${matchedItems.size} 条评论`)
  return matchedItems.size
}

function getPageTitle(): string {
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (cleanText(ogTitle)) return cleanText(ogTitle)
  const h1 = document.querySelector('h1')
  if (cleanText(h1?.textContent)) return cleanText(h1?.textContent)
  return document.title.replace(/\s*[-–]\s*(知乎|Zhihu).*$/i, '').trim() || '未知文章'
}

export async function scanZhihuPage(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  username: string
} | null> {
  log('===== 开始扫描知乎 =====')
  const username = await getCurrentUsername()
  if (!username) {
    log('未找到当前用户名，请在插件设置中填写知乎用户名')
    return null
  }

  const title = getPageTitle()
  log('用户:', username)
  log('标题:', title)

  const commentRoot = await openCommentArea()
  if (!commentRoot) return null

  // 新版知乎只在页面中渲染首批评论，继续滚动不会请求后续分页。
  // 接口分页用于完整统计；页面滚动仍保留，作为用户可见反馈和旧版页面兜底。
  const apiCountPromise = fetchArticleCommentCount(username)
  const loadedCount = await loadAllComments(commentRoot)
  log(`已加载评论元素: ${loadedCount}`)

  const latestRoot = findVisibleCommentRoot() || commentRoot
  const apiCount = await apiCountPromise
  const commentCount = apiCount ?? countMyComments(username, latestRoot)
  log(`===== 扫描完成: ${commentCount} 条 =====`)

  return { platform: PLATFORM, title, commentCount, username }
}

/** 截图任务的轻量预检：不打开评论弹窗，也不滚动页面。 */
export async function scanZhihuArchiveMetadata(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  username: string
} | null> {
  const username = await getCurrentUsername()
  if (!username) return null
  const commentCount = await fetchArticleCommentCount(username)
  return {
    platform: PLATFORM,
    title: getPageTitle(),
    commentCount: Math.max(0, commentCount || 0),
    username,
  }
}


