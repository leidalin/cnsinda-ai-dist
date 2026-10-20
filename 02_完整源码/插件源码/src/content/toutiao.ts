import type { Platform } from '@shared/types'
import { resolvePlatformUsername } from '@shared/account'

const PLATFORM: Platform = 'toutiao'
const DEBUG = true
const COMMENT_PAGE_SIZE = 20
const MAX_COMMENT_PAGES = 100

function log(...args: any[]) {
  if (DEBUG) console.log('[DL评论助手-头条]', ...args)
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

interface ToutiaoComment {
  id?: number | string
  id_str?: string
  user_id?: number | string
  user_name?: string
  reply_count?: number
  reply_list?: ToutiaoComment[]
  new_reply_list?: ToutiaoComment[]
}

interface ToutiaoCommentEntry {
  comment?: ToutiaoComment
}

interface ToutiaoCommentResponse {
  message?: string
  err_no?: number
  data?: ToutiaoCommentEntry[]
  total_number?: number
  has_more?: boolean
  offset?: number
}

/** 只读取顶部登录账号，避免误把评论作者或文章作者当成当前用户。 */
async function getCurrentUsername(): Promise<string | null> {
  const selectors = [
    'header a[aria-label][href*="/c/user/token/"]',
    '[role="banner"] a[aria-label][href*="/c/user/token/"]',
    'header a[aria-label][href*="/c/user/"]',
  ]

  let detected: string | null = null
  for (const selector of selectors) {
    for (const link of document.querySelectorAll<HTMLAnchorElement>(selector)) {
      const name = cleanText(link.getAttribute('aria-label'))
      if (name && name.length <= 60 && !/个人主页|作者头像/.test(name)) {
        log('从顶部账号入口识别用户名:', name)
        detected = name
        break
      }
    }
    if (detected) break
  }
  return resolvePlatformUsername(PLATFORM, detected)
}

function getArticleId(): string | null {
  return window.location.pathname.match(/^\/(?:article|item)\/(\d+)/)?.[1] || null
}

function getPageTitle(): string {
  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (cleanText(ogTitle)) return cleanText(ogTitle)
  const h1 = document.querySelector<HTMLElement>('main h1, h1')
  return cleanText(h1?.textContent) || document.title.replace(/\s*[-–]\s*今日头条\s*$/i, '').trim() || '未知文章'
}

function addComment(
  comment: ToutiaoComment | null | undefined,
  username: string,
  seenCommentIds: Set<string>,
): number {
  if (!comment) return 0

  let matchedCount = 0
  const commentId = cleanText(comment.id_str || String(comment.id ?? ''))
  if (!commentId || !seenCommentIds.has(commentId)) {
    if (commentId) seenCommentIds.add(commentId)
    if (cleanText(comment.user_name) === username) matchedCount++
  }

  // 部分文章会把回复直接嵌入根评论；两个字段可能重复，评论 ID 会负责去重。
  for (const reply of comment.reply_list || []) {
    matchedCount += addComment(reply, username, seenCommentIds)
  }
  for (const reply of comment.new_reply_list || []) {
    matchedCount += addComment(reply, username, seenCommentIds)
  }

  return matchedCount
}

async function fetchCommentPage(articleId: string, offset: number): Promise<ToutiaoCommentResponse> {
  const url = new URL('/article/v4/tab_comments/', 'https://www.toutiao.com')
  url.searchParams.set('aid', '24')
  url.searchParams.set('app_name', 'toutiao_web')
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('count', String(COMMENT_PAGE_SIZE))
  url.searchParams.set('group_id', articleId)
  url.searchParams.set('item_id', articleId)

  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`评论接口返回 HTTP ${response.status}`)

  const payload = await response.json() as ToutiaoCommentResponse
  if (payload.err_no !== 0 || payload.message !== 'success') {
    throw new Error(payload.message || `评论接口返回 err_no=${String(payload.err_no)}`)
  }
  return payload
}

async function countApiComments(articleId: string, username: string): Promise<number> {
  const seenOffsets = new Set<number>()
  const seenCommentIds = new Set<string>()
  let offset = 0
  let matchedCount = 0

  for (let page = 0; page < MAX_COMMENT_PAGES && !seenOffsets.has(offset); page++) {
    seenOffsets.add(offset)
    const payload = await fetchCommentPage(articleId, offset)

    for (const entry of payload.data || []) {
      matchedCount += addComment(entry.comment, username, seenCommentIds)
    }

    log(`评论分页 ${page + 1}: offset=${offset}, 返回 ${payload.data?.length || 0} 条`)
    if (!payload.has_more) break

    const nextOffset = Number(payload.offset)
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
      throw new Error('评论接口未返回有效的下一页 offset')
    }
    offset = nextOffset
  }

  return matchedCount
}

/** 今日头条扫描入口。 */
export async function scanToutiaoPage(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  username: string
} | null> {
  log('===== 开始扫描今日头条 =====')

  const username = await getCurrentUsername()
  const articleId = getArticleId()
  if (!username || !articleId) {
    log('未识别到当前登录账号或文章 ID')
    return null
  }

  try {
    const commentCount = await countApiComments(articleId, username)
    const title = getPageTitle()
    log(`===== 扫描完成: ${commentCount} 条 =====`)
    return { platform: PLATFORM, title, commentCount, username }
  } catch (error) {
    log('评论接口分页失败:', error)
    return null
  }
}
