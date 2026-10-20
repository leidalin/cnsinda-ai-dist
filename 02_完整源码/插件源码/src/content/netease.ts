import type { Platform } from '@shared/types'

import { appendAccountLog, resolvePlatformUsername } from '@shared/account'

const PLATFORM: Platform = 'netease'
const DEBUG = true
const COMMENT_PAGE_SIZE = 30
const MAX_COMMENT_PAGES = 100
const COMMENT_API_ORIGIN = 'https://comment.api.163.com'
/**
 * 网易跟贴系统的产品 Key。文章页 HTML 内联了 `productKey`，正常情况下走页面解析；
 * 这里保留一个网易新闻/订阅通用的默认值，作为页面结构再次改版时的兜底。
 */
const DEFAULT_PRODUCT_KEY = 'a2869674571f77b5a0867c3d71db5856'

function log(...args: any[]) {
  if (DEBUG) console.log('[DL评论助手-网易]', ...args)
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * 网易在评论列表里会把手机网友渲染成“昵称[网易江苏无锡手机网友]”，
 * 接口原始昵称不带后缀，比对前统一去掉方括号尾巴，避免同一账号被算成两个名字。
 */
function normalizeNickname(value: string | null | undefined): string {
  return cleanText(value).replace(/\[[^\]]{0,40}\]$/, '').trim()
}

interface DetectedNeteaseAccount {
  nickname: string | null
  userId: string | null
}

interface ResolvedNeteaseAccount {
  username: string
  userId: string | null
}

interface NeteaseCommentUser {
  nickname?: string
  userId?: string | number
}

interface NeteaseComment {
  commentId?: string | number
  postId?: string
  del?: boolean
  isDel?: boolean
  user?: NeteaseCommentUser
}

interface NeteaseCommentPayload {
  commentIds?: Array<string | number>
  comments?: Record<string, NeteaseComment>
  newListSize?: number
  hotListSize?: number
}

interface NeteaseFetchResponse {
  success?: boolean
  text?: string
  error?: string
}

interface NeteaseTarget {
  productKey: string
  threadId: string
  keySource: string
  threadSource: string
}

/** 读取评论输入区的登录昵称和退出链接中的稳定用户 ID。 */
function detectCurrentAccount(): DetectedNeteaseAccount {
  const nickname = cleanText(
    document.querySelector<HTMLElement>('#tieArea .tie-input-bar .photo-area .nickname')?.textContent
      || document.querySelector<HTMLElement>('#tieArea .submit-row .photo-area')?.textContent,
  ) || null

  let userId: string | null = null
  const logoutLink = document.querySelector<HTMLAnchorElement>('#tieArea a[href*="reg.163.com/Logout.jsp"]')
  if (logoutLink?.href) {
    try {
      const value = new URL(logoutLink.href).searchParams.get('username')
      if (value && /^\d+$/.test(value)) userId = value
    } catch {}
  }

  return { nickname, userId }
}

async function getCurrentAccount(): Promise<ResolvedNeteaseAccount | null> {
  const detected = detectCurrentAccount()
  const username = await resolvePlatformUsername(
    PLATFORM,
    detected.nickname,
    detected.userId ? [detected.userId] : [],
  )
  if (!username) return null

  // 用户手填名称与自动昵称不一致时，严格按手填名称统计，不沿用自动用户 ID。
  const userId = cleanText(username) === cleanText(detected.nickname) ? detected.userId : null
  return { username, userId }
}

function getPageTitle(): string {
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (cleanText(og)) return cleanText(og)
  const h1 = document.querySelector<HTMLElement>('h1')
  return cleanText(h1?.textContent) || document.title.replace(/[_|｜].*网易.*$/i, '').trim() || '未知文章'
}

/**
 * 解析当前页面对应的跟贴线程 ID。
 * 网易文章页与跟贴页的地址末段就是 thread id，例如
 * `www.163.com/dy/article/L9BSK1OF0556BVJA.html`、`www.163.com/news/article/XXXX.html`、
 * `c.m.163.com/news/a/XXXX.html`、`comment.tie.163.com/XXXX.html`。
 */
function resolveThreadIdFromLocation(): { threadId: string; source: string } | null {
  const match = location.pathname.match(/\/([A-Za-z0-9]{6,})\.html?$/i)
  if (match) return { threadId: match[1], source: '页面地址' }
  return null
}

/** 从页面上已经发生的评论接口请求里反查产品 Key。 */
function resolveProductKeyFromResourceTiming(): string | null {
  try {
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const name = typeof entry?.name === 'string' ? entry.name : ''
      if (!name.includes(COMMENT_API_ORIGIN)) continue
      const match = name.match(/\/api\/v1\/products\/([A-Za-z0-9]+)\/threads\//)
      if (match) return match[1]
    }
  } catch {}
  return null
}

/** 从页面内联的 `productKey` 配置里读取产品 Key（转义与非转义写法都能命中）。 */
function resolveProductKeyFromPageHtml(): string | null {
  const html = document.documentElement?.innerHTML || ''
  const match = html.match(/productKey[^0-9A-Za-z]{0,6}([0-9A-Za-z]{16,})/i)
  return match ? match[1] : null
}

/**
 * 解析评论接口所需的 {产品 Key, 线程 ID}。
 * 网易评论区改为滚动懒加载后，后台标签页不会触发评论请求，
 * 因此不再依赖“页面上出现过 newList 请求”，而是直接由地址和页面配置推导。
 */
function resolveNeteaseTarget(): NeteaseTarget | null {
  const thread = resolveThreadIdFromLocation()
  if (!thread) return null

  const fromRequest = resolveProductKeyFromResourceTiming()
  if (fromRequest) {
    return { productKey: fromRequest, threadId: thread.threadId, keySource: '页面接口请求', threadSource: thread.source }
  }
  const fromHtml = resolveProductKeyFromPageHtml()
  if (fromHtml) {
    return { productKey: fromHtml, threadId: thread.threadId, keySource: '页面内联配置', threadSource: thread.source }
  }
  return { productKey: DEFAULT_PRODUCT_KEY, threadId: thread.threadId, keySource: '内置默认值', threadSource: thread.source }
}

function parseJsonp(text: string): NeteaseCommentPayload {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as NeteaseCommentPayload

  const open = trimmed.indexOf('(')
  const close = trimmed.lastIndexOf(')')
  if (open < 1 || close <= open) throw new Error('评论接口返回的 JSONP 格式无效')
  return JSON.parse(trimmed.slice(open + 1, close)) as NeteaseCommentPayload
}

/** 直接拼装评论列表接口地址，不再依赖页面上出现过的请求模板。 */
function buildCommentListUrl(target: NeteaseTarget, listType: 'newList' | 'hotList', offset: number): string {
  const url = new URL(
    `${COMMENT_API_ORIGIN}/api/v1/products/${encodeURIComponent(target.productKey)}`
    + `/threads/${encodeURIComponent(target.threadId)}/comments/${listType}`,
  )
  url.searchParams.set('offset', String(offset))
  url.searchParams.set('limit', String(COMMENT_PAGE_SIZE))
  url.searchParams.set('showLevelThreshold', '200')
  url.searchParams.set('headLimit', '100')
  url.searchParams.set('tailLimit', '100')
  url.searchParams.set('ibc', 'jssdk')
  url.searchParams.set('_', String(Date.now()))
  return url.toString()
}

async function fetchCommentPage(
  target: NeteaseTarget,
  listType: 'newList' | 'hotList',
  offset: number,
): Promise<NeteaseCommentPayload> {
  const url = buildCommentListUrl(target, listType, offset)

  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_NETEASE_COMMENTS',
    url,
  }) as NeteaseFetchResponse

  if (!response?.success || typeof response.text !== 'string') {
    throw new Error(response?.error || '扩展后台未返回评论数据')
  }
  return parseJsonp(response.text)
}

function addComments(
  payload: NeteaseCommentPayload,
  account: ResolvedNeteaseAccount,
  seenCommentIds: Set<string>,
  matchedNicknames: Set<string>,
): number {
  let matchedCount = 0

  // comments 同时包含根跟贴和参与回复；热门与最新列表会重叠，统一按 postId 去重。
  for (const comment of Object.values(payload.comments || {})) {
    if (comment.del || comment.isDel) continue
    const commentId = cleanText(comment.postId || String(comment.commentId ?? ''))
    if (!commentId || seenCommentIds.has(commentId)) continue
    seenCommentIds.add(commentId)

    const sameUserId = Boolean(account.userId)
      && cleanText(String(comment.user?.userId ?? '')) === account.userId
    const sameNickname = normalizeNickname(comment.user?.nickname) === normalizeNickname(account.username)
    if (sameUserId || sameNickname) {
      matchedCount++
      const nickname = normalizeNickname(comment.user?.nickname)
      if (nickname) matchedNicknames.add(nickname)
    }
  }

  return matchedCount
}

interface NeteaseListResult {
  matched: number
  loaded: number
  declared: number
  errors?: string[]
}

async function scanCommentList(
  target: NeteaseTarget,
  listType: 'newList' | 'hotList',
  account: ResolvedNeteaseAccount,
  seenCommentIds: Set<string>,
  matchedNicknames: Set<string>,
): Promise<NeteaseListResult> {
  let offset = 0
  let matchedCount = 0
  let loadedCount = 0
  let declaredTotal = 0
  const errors: string[] = []

  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    let payload: NeteaseCommentPayload
    try {
      payload = await fetchCommentPage(target, listType, offset)
    } catch (error) {
      // 分页中途失败时保留已经拿到的结果，同时把原因写进诊断，方便直接定位。
      errors.push(`第${page + 1}页读取失败：${error instanceof Error ? error.message : String(error)}`)
      break
    }

    const commentIds = payload.commentIds || []
    const declared = Number(listType === 'newList' ? payload.newListSize : payload.hotListSize)
    if (Number.isFinite(declared)) declaredTotal = Math.max(declaredTotal, declared)
    matchedCount += addComments(payload, account, seenCommentIds, matchedNicknames)
    loadedCount += commentIds.length

    log(`${listType} 分页 ${page + 1}: offset=${offset}, 返回 ${commentIds.length} 条根跟贴`)
    if (commentIds.length === 0 || commentIds.length < COMMENT_PAGE_SIZE) break

    offset += commentIds.length
    if (Number.isFinite(declared) && offset >= declared) break
  }

  if (errors.length) log(`${listType} 分页异常:`, errors.join('；'))
  return { matched: matchedCount, loaded: loadedCount, declared: declaredTotal, ...(errors.length ? { errors } : {}) }
}

async function countApiComments(target: NeteaseTarget, account: ResolvedNeteaseAccount): Promise<{
  count: number
  nickname: string
  newList: NeteaseListResult
  hotList: NeteaseListResult
}> {
  const seenCommentIds = new Set<string>()
  const matchedNicknames = new Set<string>()
  const newList = await scanCommentList(target, 'newList', account, seenCommentIds, matchedNicknames)
  const hotList = await scanCommentList(target, 'hotList', account, seenCommentIds, matchedNicknames)
  const matched = newList.matched + hotList.matched
  log(`根跟贴和参与回复去重后共检查 ${seenCommentIds.size} 条，当前账号匹配 ${matched} 条`)
  return {
    count: matched,
    nickname: [...matchedNicknames][0] || '',
    newList,
    hotList,
  }
}

/**
 * 网易扫描入口。
 * 自 2026-10 起网易文章页的评论区改为滚动懒加载，后台标签页不会触发 newList 请求，
 * 旧版“从页面请求里找接口模板”的写法因此恒定失败。现改为直接推导线程与产品 Key 后
 * 调用官方评论接口，不再依赖页面是否渲染评论区。
 */
export async function scanNeteasePage(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  totalCommentCount?: number
  username: string
  diagnostics?: string
} | null> {
  log('===== 开始扫描网易 =====')
  const detected = detectCurrentAccount()
  const account = await getCurrentAccount()
  if (!account) {
    log('未找到当前用户名，请在账号设置中填写网易用户名')
    await appendAccountLog(PLATFORM, 'warning', '网易扫描失败：未配置网易昵称，且页面未识别到登录昵称')
    return null
  }

  const target = resolveNeteaseTarget()
  if (!target) {
    const message = `网易扫描失败：无法从地址解析跟贴线程 ID（当前地址 ${location.pathname}）`
    log(message)
    await appendAccountLog(PLATFORM, 'error', message)
    return null
  }

  try {
    const comments = await countApiComments(target, account)
    const title = getPageTitle()
    const declared = Math.max(comments.newList.declared, comments.hotList.declared)
    const pageErrors = [...(comments.newList.errors || []), ...(comments.hotList.errors || [])]
    const diagMsg = `【网易API诊断】线程:${target.threadId}(${target.threadSource}), 产品Key:${target.productKey}(${target.keySource}), `
      + `newList:${comments.newList.loaded}条, hotList:${comments.hotList.loaded}条, 声明:${declared}条, `
      + `配置账号:[${account.username}], 探测账号:[${detected.nickname || '未登录页面'}], 匹配到:${comments.count}条`
      + (pageErrors.length ? `；分页异常:${pageErrors.join('；')}` : '')
    log(`===== 扫描完成: ${comments.count} 条 =====`, diagMsg)
    return {
      platform: PLATFORM,
      title,
      commentCount: comments.count,
      totalCommentCount: Math.max(declared, comments.newList.loaded, comments.hotList.loaded),
      username: comments.nickname || account.username,
      diagnostics: diagMsg,
    }
  } catch (error) {
    const message = `网易评论扫描失败：${error instanceof Error ? error.message : String(error)}`
    log(message)
    await appendAccountLog(PLATFORM, 'error', message)
    // 抛出详细原因，由 content/index.ts 汇总为可见的错误提示与操作日志。
    throw new Error(message)
  }
}
