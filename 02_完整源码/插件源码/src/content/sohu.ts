import { resolvePlatformUsername } from '@shared/account'

const PLATFORM = 'sohu' as const

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function detectUsernameFromApi(): Promise<string | null> {
  try {
    const res = await fetch('https://uis.mp.sohu.com/comment/api/user', {
      credentials: 'include',
    })
    const json = await res.json()
    if (json?.code === 200 && json?.data?.userName) {
      return cleanText(json.data.userName)
    }
  } catch {}
  return null
}

function detectCurrentUsername(): string | null {
  const selectors = [
    '#meComment .comment-submit .login-area .username',
    '#meComment .login-area .username',
    '#meComment .username',
    '#meComment .user-name',
    '.login-info .name',
    '.header-user .name',
    '.header-user .user-name',
    '#userNav .user-name',
    '#userNav .name',
    '.nav-user .name',
    '.nav-user .user-name',
    '[class*="user-center"] [class*="name"]',
  ]
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest('.article-info, .author-info, .left-author, #article-info, .article-side, [data-spm="author"]')) continue
      const text = cleanText(element.textContent || element.getAttribute('title'))
      if (text && !/登录|注册|个人中心|消息|订阅/.test(text) && text.length <= 40) return text
    }
  }
  return null
}

function hasLoggedInAccount(): boolean {
  const commentRoot = document.querySelector<HTMLElement>('#meComment')
  if (commentRoot && commentRoot.querySelector(
    'a[href*="passport.sohu.com"], a[href*="ucenter"], .username, .user-info .name, .user-info .nickname, .user-name, [class*="user-name"]',
  )) {
    return true
  }

  const headerUser = document.querySelector<HTMLElement>(
    '.header-user, .login-info, [class*="user-center"], #userNav, .nav-user',
  )
  if (headerUser && !/登录|注册/.test(cleanText(headerUser.textContent))) {
    return true
  }

  return Boolean(detectCurrentUsername())
}

function getPageTitle(): string {
  return cleanText(
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      || document.querySelector<HTMLElement>('h1')?.textContent
      || document.title,
  )
}

function commentItems(): HTMLElement[] {
  const selectors = [
    '#commentList [data-comment-id]',
    '#commentList [data-id]',
    '#commentList .comment-item',
    '#commentList .comment-list-item',
    '#commentList [class*="comment-item"]',
    '[data-comment-id]',
    '[data-reply-id]',
    '.comment-list .comment-item',
    '.comment-list-item',
    '.cmt-list .cmt-item',
    '.comment-area [class*="comment-item"]',
  ]
  const unique = new Set<HTMLElement>()
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach(item => unique.add(item))
  }
  return [...unique]
}

function authorName(item: HTMLElement): string {
  const element = item.querySelector<HTMLElement>(
    '.author-area.name, .author-area .name, .author-area .username, .user-name, .username, .nickname, .name, [class*="author-name"], [class*="user-name"]',
  )
  return cleanText(element?.textContent || element?.getAttribute('title'))
}

function isInteractable(element: HTMLElement | null): boolean {
  if (!element) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

async function openAndLoadComments(): Promise<{ declaredCount: number; loadedCount: number; hotCount: number; latestCount: number; moreClicks: number }> {
  const commentButton = document.querySelector<HTMLElement>('#leftComment')
    || Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], div.item'))
    .find(element => /评论|跟帖/.test(cleanText(element.textContent))
      || Boolean(element.querySelector('img[src*="icon_comment"]')))
  commentButton?.click()

  let declaredCount = 0
  let moreClicks = 0

  // 避免在后台标签页或慢速网络下点击后瞬间读取为 0，轮询等待评论头数据或列表渲染
  const waitHeaderDeadline = Date.now() + 3500
  while (Date.now() < waitHeaderDeadline) {
    const headerEl = document.querySelector<HTMLElement>(
      '#meComment .comment-header, #meComment [class*="header"], .comment-title, #meComment [class*="title"]',
    )
    const headerText = cleanText(headerEl?.textContent)
    const match = headerText.match(/(\d+)\s*条评论/) || headerText.match(/评论\s*[(（]?\s*(\d+)\s*[)）]?/)
    if (match) {
      declaredCount = Number(match[1])
      break
    }
    if (document.querySelectorAll('#commentList .comment-item, #commentList [class*="comment"]').length > 0) {
      break
    }
    await sleep(200)
  }

  // 兜底：从左侧边栏评论按钮文字或图标旁提取数字
  if (declaredCount === 0 && commentButton) {
    const leftText = cleanText(commentButton.textContent)
    const leftMatch = leftText.match(/(\d+)/)
    if (leftMatch) declaredCount = Number(leftMatch[1])
  }

  // 等待列表容器初始化
  const deadline = Date.now() + 2500
  do {
    const list = document.querySelector('#commentList')
    const items = list?.querySelectorAll('.comment-item, [class*="comment-item"]').length || 0
    if (list && items > 0) break
    await sleep(200)
  } while (Date.now() < deadline)

  // 必须点击“最新评论”Tab（后台标签页中 fixed 容器内 offsetParent 为 null，改用 isInteractable 判定）
  const latestTab = document.querySelector<HTMLElement>('#newCommentTab')
  if (latestTab && isInteractable(latestTab)) {
    latestTab.click()
    await sleep(400)
  }

  let moreStableRounds = 0
  for (let round = 0; round < 6 && moreStableRounds < 2; round++) {
    const beforeMoreCount = document.querySelectorAll('#commentList .comment-item').length
    const more = Array.from(document.querySelectorAll<HTMLElement>(
      '#hotComment .more, #newComment .more, #commentList button, #commentList [role="button"], #commentList a',
    )).find(element => /加载更多|查看更多评论|更多评论|点击查看更多精彩评论/.test(cleanText(element.textContent))
      && isInteractable(element))
    if (!more) break
    more.click()
    moreClicks++
    const deadlineMore = Date.now() + 1200
    while (Date.now() < deadlineMore) {
      await sleep(200)
      if (document.querySelectorAll('#commentList .comment-item').length > beforeMoreCount) break
    }
    const afterMoreCount = document.querySelectorAll('#commentList .comment-item').length
    moreStableRounds = afterMoreCount > beforeMoreCount ? 0 : moreStableRounds + 1
  }

  let stableRounds = 0
  let previousCount = document.querySelectorAll('#commentList .comment-item').length
  for (let round = 0; round < 8 && stableRounds < 2; round++) {
    if (previousCount >= declaredCount && declaredCount > 0) break
    const list = document.querySelector<HTMLElement>('#commentList')
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('.comment-item')) : []
    const last = items[items.length - 1]
    if (last) last.scrollIntoView({ behavior: 'auto', block: 'end' })
    else list?.scrollIntoView({ behavior: 'auto', block: 'end' })
    const scrollTargets = [
      document.querySelector<HTMLElement>('#newComment'),
      document.querySelector<HTMLElement>('#hotComment'),
      list,
      last?.parentElement,
    ].filter((target): target is HTMLElement => Boolean(target))
    for (const target of scrollTargets) {
      target.scrollTop = target.scrollHeight
      target.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    await sleep(350)
    const nextCount = document.querySelectorAll('#commentList .comment-item').length
    stableRounds = nextCount > previousCount ? 0 : stableRounds + 1
    previousCount = nextCount
  }

  const loadedCount = document.querySelectorAll('#commentList .comment-item').length
  const hotCount = document.querySelectorAll('#hotComment .comment-item').length
  const latestCount = document.querySelectorAll('#newComment .comment-item').length
  return { declaredCount, loadedCount, hotCount, latestCount, moreClicks }
}

interface SohuApiCommentItem {
  id: number
  userId: number
  content: string
  date?: number
}

interface SohuApiLoadResult {
  code: number
  msg?: string
  data?: {
    outerCmtSum?: number
    totalPageNo?: number
    participationSum?: number
    comments?: SohuApiCommentItem[]
    hotComments?: SohuApiCommentItem[]
    users?: Record<string | number, {
      id: number
      userName: string
      passport?: string
      avatar?: string
    }>
  }
}

/** 通过搜狐官方评论加载接口直接拉取评论列表，100% 免疫后台标签页 DOM 节流与组件改版 */
async function scanSohuCommentsViaApi(username: string): Promise<{
  declaredCount: number
  loadedCount: number
  matchedCount: number
  totalPages: number
} | null> {
  const url = window.location.href
  const match = url.match(/\/a\/(\d+)_(\d+)/)
  if (!match) return null

  const [, articleId, mediaId] = match
  const normalized = cleanText(username)
  const pageSize = 20
  const maxPages = 15 // 最多拉取 15 页（300 条评论）
  let totalPages = 1
  let declaredCount = 0
  let loadedCount = 0
  let matchedCount = 0
  const seenCommentIds = new Set<number>()

  try {
    for (let page = 1; page <= maxPages && page <= totalPages; page++) {
      // 搜狐底层分页专用接口为 /api/comments/pages（/comments/load 传 page_no>1 不生效）
      const apiUrl = `https://uis.mp.sohu.com/wap/api/comments/pages?page_size=${pageSize}&page_no=${page}&source_id=mp_${articleId}&media_id=${mediaId}`
      const res = await fetch(apiUrl, { credentials: 'include' })
      if (!res.ok) break
      const json: SohuApiLoadResult = await res.json()
      if (json.code !== 1 || !json.data) break

      declaredCount = Number(json.data.outerCmtSum) || declaredCount
      totalPages = Number(json.data.totalPageNo) || 1
      const users = json.data.users || {}
      const combined = [...(json.data.comments || []), ...(json.data.hotComments || [])]

      for (const item of combined) {
        if (!item?.id || seenCommentIds.has(item.id)) continue
        seenCommentIds.add(item.id)
        loadedCount++
        const author = cleanText(users[item.userId]?.userName)
        if (normalized && author === normalized) {
          matchedCount++
        }
      }

      if (page >= totalPages) break
      await sleep(100)
    }

    return { declaredCount, loadedCount, matchedCount, totalPages }
  } catch (err) {
    console.warn('[DL评论助手] 搜狐评论 API 获取失败，将使用 DOM 扫描备用', err)
    return null
  }
}

export async function scanSohuPage(): Promise<{
  platform: typeof PLATFORM
  title: string
  commentCount: number
  totalCommentCount: number
  username: string
  diagnostics?: string
} | null> {
  // 1. 探测用户名：优先从官方用户接口，其次从页面 DOM，最后与设置中的用户名结合
  let detected = await detectUsernameFromApi()
  if (!detected) {
    detected = detectCurrentUsername()
  }
  if (!detected) {
    for (let waitRound = 1; waitRound <= 2; waitRound++) {
      await sleep(400)
      detected = await detectUsernameFromApi() || detectCurrentUsername()
      if (detected) break
    }
  }
  const username = await resolvePlatformUsername(PLATFORM, detected)
  const normalized = username ? cleanText(username) : ''

  // 2. 双轨驱动：首选 API 极速通道（解决搜狐前端改为自定义组件导致 DOM 无法渲染列表的致命问题）
  const apiResult = await scanSohuCommentsViaApi(normalized)
  if (apiResult !== null) {
    const diagMsg = `【搜狐API诊断】声明评论:${apiResult.declaredCount}条, 接口载入:${apiResult.loadedCount}条(共${apiResult.totalPages}页), 配置账号:[${normalized || '未设置'}], 探测到账号:[${detected || '无'}], 匹配到:${apiResult.matchedCount}条`
    console.info('[DL评论助手] 搜狐扫描结果(API)', diagMsg)
    return {
      platform: PLATFORM,
      title: getPageTitle(),
      commentCount: apiResult.matchedCount,
      totalCommentCount: Math.max(apiResult.declaredCount, apiResult.loadedCount),
      username: username || '',
      diagnostics: diagMsg,
    }
  }

  // 3. 备选方案：若 API 通道受阻，使用传统 DOM 扫描
  const loadDiagnostics = await openAndLoadComments()
  const countMatches = () => {
    if (!normalized) return 0
    let count = 0
    const seen = new Set<string>()
    for (const item of commentItems()) {
      const id = cleanText(item.dataset.commentId || item.dataset.replyId || item.id)
      const key = id || cleanText(item.textContent).slice(0, 160)
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (authorName(item) === normalized) count++
    }
    return count
  }
  const count = countMatches()

  const diagMsg = `【搜狐DOM诊断】声明评论:${loadDiagnostics.declaredCount}条, 列表载入:${loadDiagnostics.loadedCount}条, 配置账号:[${normalized || '未设置'}], 探测到账号:[${detected || '无'}], 匹配到:${count}条`
  console.info('[DL评论助手] 搜狐扫描结果(DOM)', diagMsg)

  return {
    platform: PLATFORM,
    title: getPageTitle(),
    commentCount: count,
    totalCommentCount: Math.max(loadDiagnostics.declaredCount, loadDiagnostics.loadedCount),
    username: username || '',
    diagnostics: diagMsg,
  }
}
