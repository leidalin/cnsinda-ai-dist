import type { Platform } from '@shared/types'
import { resolvePlatformUsername } from '@shared/account'

const PLATFORM: Platform = 'csdn'
const DEBUG = true
const COMMENT_PAGE_SIZE = 10
const MAX_COMMENT_PAGES = 100

function log(...args: any[]) {
  if (DEBUG) console.log('[DL评论助手-CSDN]', ...args)
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

interface CsdnAccount {
  userName: string
  nickName: string
}

interface CsdnCommentInfo {
  commentId?: number | string
  userName?: string
  nickName?: string
}

interface CsdnCommentItem {
  info?: CsdnCommentInfo
  sub?: CsdnCommentItem[]
}

interface CsdnCommentResponse {
  code?: number
  message?: string
  data?: {
    pageCount?: number
    list?: CsdnCommentItem[]
  }
}

interface DetectedCsdnAccount {
  userName: string
  nickName: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** CSDN 顶部账号卡片在后台标签页中会先显示“--”，不能当成真实昵称。 */
function isValidAccountName(value: string): boolean {
  const name = cleanText(value)
  if (!name || name.length > 60) return false
  return !/^(?:[-—–_]{1,}|加载中\.{0,3}|登录|未登录|null|undefined)$/i.test(name)
}

function detectCurrentAccount(): DetectedCsdnAccount {
  const accountRoot = document.querySelector<HTMLElement>('.toolbar-btn-login-new, .toolbar-btn-login')
  const profileLinks = accountRoot?.querySelectorAll<HTMLAnchorElement>(
    'a.hasAvatar[href*="blog.csdn.net/"], a.csdn-profile-avatar[href*="blog.csdn.net/"], a.csdn-img-text-box[href*="blog.csdn.net/"]'
  ) || []

  let userName = ''
  for (const link of profileLinks) {
    try {
      const url = new URL(link.href, window.location.href)
      if (url.hostname !== 'blog.csdn.net') continue
      const candidate = cleanText(url.pathname.split('/').filter(Boolean)[0])
      if (candidate && candidate !== 'blog') {
        userName = candidate
        break
      }
    } catch {}
  }

  const nicknameCandidate = cleanText(
    accountRoot?.querySelector<HTMLElement>('.csdn-profile-nickName')?.textContent
      || accountRoot?.querySelector<HTMLElement>('.csdn-profile-top')?.textContent
  )
  const nickName = isValidAccountName(nicknameCandidate) ? nicknameCandidate : ''
  return { userName, nickName }
}

/**
 * 只从顶部登录账号菜单读取当前用户，避免把文章作者误认为当前用户。
 * CSDN 评论接口使用账号 ID（例如 m0_56676924），昵称只用于界面展示。
 */
async function getCurrentAccount(): Promise<CsdnAccount | null> {
  let detected = detectCurrentAccount()
  const deadline = Date.now() + 8000

  // 稳定账号 ID 通常先于昵称出现；只要拿到 ID 就可以准确扫描。
  while (!detected.userName && Date.now() < deadline) {
    await sleep(250)
    detected = detectCurrentAccount()
  }

  const detectedPrimary = detected.userName || detected.nickName || null
  const aliases = detected.nickName ? [detected.nickName] : []
  const resolved = await resolvePlatformUsername(PLATFORM, detectedPrimary, aliases)
  if (!resolved) {
    log('未找到顶部登录账号，且未设置手动账号')
    return null
  }

  log(
    '当前登录账号:',
    detected.userName || '未自动识别',
    '页面昵称:',
    detected.nickName || '未加载/占位符已忽略',
    '统计账号:',
    resolved,
  )
  return { userName: resolved, nickName: resolved }
}

function getArticleId(): string | null {
  return window.location.pathname.match(/\/article\/details\/(\d+)/)?.[1] || null
}

function getPageTitle(): string {
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (cleanText(ogTitle)) return cleanText(ogTitle)
  const h1 = document.querySelector<HTMLElement>('h1.title-article, h1.article-title, main h1, h1')
  return cleanText(h1?.textContent) || document.title.replace(/-CSDN博客\s*$/i, '').trim() || '未知文章'
}

function addCommentAndReplies(
  item: CsdnCommentItem,
  currentUserName: string,
  seenCommentIds: Set<string>,
  matchedNicknames: Set<string>,
): number {
  let count = 0
  const info = item.info
  const commentId = cleanText(String(info?.commentId ?? ''))

  if (!commentId || !seenCommentIds.has(commentId)) {
    if (commentId) seenCommentIds.add(commentId)
    if (cleanText(info?.userName) === currentUserName || cleanText(info?.nickName) === currentUserName) {
      count++
      const nickname = cleanText(info?.nickName)
      if (nickname) matchedNicknames.add(nickname)
    }
  }

  for (const reply of item.sub || []) {
    count += addCommentAndReplies(reply, currentUserName, seenCommentIds, matchedNicknames)
  }
  return count
}

async function fetchCommentPage(
  articleId: string,
  page: number,
  fold: 'unfold' | 'fold',
): Promise<CsdnCommentResponse> {
  const apiPath = `/phoenix/web/v1/comment/list/${articleId}`
  const url = new URL(apiPath, 'https://blog.csdn.net')
  url.searchParams.set('page', String(page))
  url.searchParams.set('size', String(COMMENT_PAGE_SIZE))
  url.searchParams.set('fold', fold)
  if (page === 1 && fold === 'unfold') url.searchParams.set('commentId', '')

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`评论接口返回 HTTP ${response.status}`)

  const payload = await response.json() as CsdnCommentResponse
  if (payload.code !== 200 || !payload.data) {
    throw new Error(payload.message || `评论接口返回 code=${String(payload.code)}`)
  }
  return payload
}

async function countApiComments(articleId: string, currentUserName: string): Promise<{
  count: number
  nickname: string
}> {
  const seenCommentIds = new Set<string>()
  const matchedNicknames = new Set<string>()
  let matchedCount = 0

  // CSDN 将正常评论和低质折叠评论分别分页，两组都必须扫描。
  for (const fold of ['unfold', 'fold'] as const) {
    const firstPage = await fetchCommentPage(articleId, 1, fold)
    let pageCount = Math.max(1, Number(firstPage.data?.pageCount) || 1)
    pageCount = Math.min(pageCount, MAX_COMMENT_PAGES)

    for (const item of firstPage.data?.list || []) {
      matchedCount += addCommentAndReplies(item, currentUserName, seenCommentIds, matchedNicknames)
    }

    for (let page = 2; page <= pageCount; page++) {
      const payload = await fetchCommentPage(articleId, page, fold)
      for (const item of payload.data?.list || []) {
        matchedCount += addCommentAndReplies(item, currentUserName, seenCommentIds, matchedNicknames)
      }
    }

    log(`${fold === 'fold' ? '折叠' : '正常'}评论扫描完成: ${pageCount} 页`)
  }

  return { count: matchedCount, nickname: [...matchedNicknames][0] || '' }
}

/** CSDN 扫描入口。 */
export async function scanCsdnPage(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  username: string
} | null> {
  log('===== 开始扫描 CSDN =====')

  const account = await getCurrentAccount()
  const articleId = getArticleId()
  if (!account || !articleId) {
    log('未识别到当前登录账号或文章 ID')
    return null
  }

  try {
    const comments = await countApiComments(articleId, account.userName)
    const title = getPageTitle()
    log(`===== 扫描完成: ${comments.count} 条 =====`)
    return {
      platform: PLATFORM,
      title,
      commentCount: comments.count,
      username: comments.nickname || account.nickName,
    }
  } catch (error) {
    log('评论接口分页失败:', error)
    return null
  }
}
