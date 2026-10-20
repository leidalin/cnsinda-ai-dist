import type { Platform } from '@shared/types'

import { appendAccountLog, getConfiguredUsername, resolvePlatformUsername } from '@shared/account'

const PLATFORM: Platform = 'baijiahao'
const DEBUG = true
const COMMENT_ITEM_SELECTOR = '.xcp-item[data-reply-id], .xcp-item, [class*="xcp-item"], [data-reply-id]'
const COMMENT_AUTHOR_SELECTOR = '.user-bar-uname, .uname, [class*="user-name"], [class*="uname"], [class*="author"]'
const MAX_LOAD_PAGES = 100

/**
 * 页面上的站点导航、按钮文案不是账号昵称。它们一旦被当成当前登录账号用于
 * 匹配评论作者，本账号评论数会恒为 0，进而被判成“没评论成功”而重复补发。
 */
const NON_ACCOUNT_TEXT = /^(?:百家号|百度|登录|立即登录|注册|个人中心|消息|消息中心|下载|下载APP|下载客户端|客户端|设置|退出|退出登录|帮助|反馈|意见反馈|更多|手机百度|创作者中心|我的|百度APP)$/i
const NON_ACCOUNT_KEYWORD = /(首页|登录|注册|客户端|意见反馈)/

function log(...args: any[]) {
  if (DEBUG) console.log('[DL评论助手-百家号]', ...args)
}

function cleanText(value: string | null | undefined): string {
  return (value || '').replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim()
}

/** 昵称长度合理、且不是站点导航文案，才允许作为当前账号候选。 */
function isPlausibleAccountName(value: string | null | undefined): boolean {
  const name = cleanText(value)
  if (!name || name.length > 60) return false
  if (NON_ACCOUNT_KEYWORD.test(name)) return false
  return !NON_ACCOUNT_TEXT.test(name)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 智能比对作者昵称与目标用户名：
 * 1. 严格全等或大小写不敏感全等
 * 2. 百度账号命名机制兼容：百度注册时常因重名被系统追加 1~3 位字母/数字后缀（如“大叔的温柔” vs “大叔的温柔i”或“大叔的温柔_1”）
 */
export function isAuthorMatched(author: string | null | undefined, targetUsername: string | null | undefined): boolean {
  const a = cleanText(author)
  const b = cleanText(targetUsername)
  if (!a || !b) return false
  if (a === b) return true
  if (a.toLowerCase() === b.toLowerCase()) return true

  // 1. 若 a 是 b 的带后缀版本（例如目标是“大叔的温柔”，作者名是“大叔的温柔i”）
  if (a.startsWith(b) && a.length - b.length <= 3 && /^[a-zA-Z0-9_-]+$/.test(a.slice(b.length))) {
    return true
  }
  // 2. 若 b 是 a 的带后缀版本（例如设置填了“大叔的温柔i”，作者名展示“大叔的温柔”）
  if (b.startsWith(a) && b.length - a.length <= 3 && /^[a-zA-Z0-9_-]+$/.test(b.slice(a.length))) {
    return true
  }
  // 3. 剔除两端常见 1~3 位字母/数字后缀后相同
  const stripSuffix = (s: string) => s.replace(/([a-zA-Z0-9_-]{1,3})$/, '')
  const aBase = stripSuffix(a)
  const bBase = stripSuffix(b)
  if (aBase && bBase && aBase.length >= 2 && aBase === bBase) {
    return true
  }

  return false
}

/** 从百度 Cookie 或百家号作者接口探测当前登录账号 */
function detectUsernameFromCookie(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)UN=([^;]+)/)
    if (match) {
      const decoded = decodeURIComponent(match[1])
      if (decoded && !/^(null|undefined)$/i.test(decoded)) return cleanText(decoded)
    }
  } catch {}
  return null
}

/** 只读取页面顶部登录账号；用户手填账号仍由 resolvePlatformUsername 优先。 */
function detectCurrentUsername(): string | null {
  // 1. 从百度 Passport Cookie 探测
  const cookieName = detectUsernameFromCookie()
  if (cookieName) return cookieName

  // 2. 从顶部导航链接与个人中心探测
  const accountLinks = document.querySelectorAll<HTMLAnchorElement>(
    'a[href="http://i.baidu.com/"], a[href="https://i.baidu.com/"], header a[href*="i.baidu.com"], .user-bar a, [class*="user-info"] a, [class*="passport"] a, ._2uMoE a, ._2Zd-E a[href*="baidu.com"]',
  )
  for (const link of accountLinks) {
    const name = cleanText(link.textContent || link.getAttribute('aria-label') || link.getAttribute('title'))
    if (isPlausibleAccountName(name)) return name
  }

  const directNames = document.querySelectorAll<HTMLElement>(
    '.user-name, [class*="user-name"], .header-user .name, [class*="account-name"], ._2uMoE span, ._2uMoE .name',
  )
  for (const el of directNames) {
    const text = cleanText(el.textContent)
    if (isPlausibleAccountName(text)) return text
  }

  // 3. 兼容部分旧版页面保存的当前登录用户数据
  try {
    for (const key of Object.keys(localStorage)) {
      if (!/(user|passport|account|profile)/i.test(key)) continue
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}')
        const queue: any[] = [data]
        const visited = new Set<any>()
        while (queue.length > 0) {
          const value = queue.shift()
          if (!value || typeof value !== 'object' || visited.has(value)) continue
          visited.add(value)
          const name = cleanText(value.nickname || value.displayName || value.userName)
          if (name && name.length <= 60) return name
          queue.push(...Object.values(value))
        }
      } catch {}
    }
  } catch {}

  return null
}

function getPageTitle(): string {
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
  if (cleanText(og)) return cleanText(og)
  const h1 = document.querySelector<HTMLElement>('h1')
  return cleanText(h1?.textContent) || document.title || '未知文章'
}

function getDeclaredCommentCount(): number | null {
  const headings = document.querySelectorAll<HTMLElement>(
    'h2, h3, .comment-title, .xcp-title, [class*="comment-num"], [class*="comment-count"], [class*="comment_title"], [class*="comment-header"]',
  )
  for (const heading of headings) {
    const text = cleanText(heading.textContent)
    const match = text.match(/(?:全部)?评论\s*[(（]?\s*(\d+)\s*[)）]?/) || text.match(/^(\d+)\s*条评论/)
    if (match) return Number(match[1])
  }
  // 从底部交互栏评论图标旁提取数字
  const bottomBarComment = document.querySelector<HTMLElement>('.interact-btn [class*="num"], div.interact-btn span')
  if (bottomBarComment) {
    const num = Number(cleanText(bottomBarComment.textContent).match(/(\d+)/)?.[1])
    if (Number.isFinite(num)) return num
  }
  return null
}

/** 从页面全局变量或 script 标签提取百家号评论专属 thread_id */
function detectThreadId(): string | null {
  try {
    const tid = (window as any).jsonData?.bsData?.comment?.tid
    if (tid && /^\d+$/.test(String(tid))) return String(tid)
  } catch {}

  // 兜底：从页面 HTML 或 script 内容中正则匹配
  const html = document.documentElement.outerHTML
  const match = html.match(/"comment":\{"tid":"(\d+)"/i) || html.match(/thread_id=(\d+)/i)
  if (match) return match[1]

  return null
}

interface BaijiahaoApiItem {
  thread_id?: string
  reply_id?: string
  uname?: string
  content?: string
}

/**
 * 通过 Background 请求百家号官方 RESTful 评论接口（https://ext.baidu.com/api/comment/v2/comment/list）
 * 100% 免疫后台标签页视口懒加载、滚动节流和组件更新
 */
async function scanBaijiahaoCommentsViaApi(username: string): Promise<{
  declaredCount: number
  loadedCount: number
  matchedCount: number
  totalPages: number
} | null> {
  const tid = detectThreadId()
  if (!tid) return null

  const pageSize = 20
  const maxPages = 15 // 最多拉取 15 页（300 条评论）
  let declaredCount = 0
  let loadedCount = 0
  let matchedCount = 0
  let totalPages = 0
  const seenReplyIds = new Set<string>()

  try {
    for (let page = 0; page < maxPages; page++) {
      const start = page * pageSize
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_BAIJIAHAO_COMMENTS',
        threadId: tid,
        start,
        num: pageSize,
      })

      if (!response?.success || !response.data) break
      const ret = response.data.ret
      if (!ret) break

      declaredCount = Number(ret.comment_count) || declaredCount
      const list: BaijiahaoApiItem[] = ret.list || []
      if (list.length === 0) break

      totalPages++

      for (const item of list) {
        const id = item.reply_id || `${item.uname}_${item.content?.slice(0, 30)}`
        if (!id || seenReplyIds.has(id)) continue
        seenReplyIds.add(id)
        loadedCount++

        if (isAuthorMatched(item.uname, username)) {
          matchedCount++
        }
      }

      if (list.length < pageSize || ret.is_over === true || loadedCount >= declaredCount) {
        break
      }
      await sleep(100)
    }

    return { declaredCount, loadedCount, matchedCount, totalPages }
  } catch (err) {
    log('百家号评论 API 获取异常，将降级使用 DOM 扫描备用', err)
    return null
  }
}

/** 在后台标签页中模拟滚动激活评论区 */
async function activatePageScroll(): Promise<void> {
  try {
    const docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 1200)
    window.scrollTo({ top: Math.floor(docHeight * 0.45), behavior: 'instant' })
    await sleep(300)
    const commentRoot = document.querySelector<HTMLElement>('#commentModule, #comment, .xcp-list, [class*="comment"]')
    if (commentRoot) {
      commentRoot.scrollIntoView({ behavior: 'instant', block: 'center' })
    } else {
      window.scrollTo({ top: docHeight, behavior: 'instant' })
    }
    await sleep(400)
  } catch {}
}

function getCommentItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(COMMENT_ITEM_SELECTOR))
}

function findLoadMoreButton(): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('.xcp-list-loader:not(.no-more), button, [role="button"]')) {
    const text = cleanText(element.textContent)
    if (text === '查看更多评论' || (element.classList.contains('xcp-list-loader') && !element.classList.contains('no-more') && text !== '没有更多啦')) {
      return element
    }
  }
  return null
}

async function waitForInitialComments(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (getCommentItems().length > 0) return
    window.scrollBy({ top: 120, behavior: 'instant' })
    await sleep(300)
  }
}

/** DOM 备用：加载更多分页评论 */
async function loadAllComments(): Promise<void> {
  await waitForInitialComments()

  for (let page = 0; page < MAX_LOAD_PAGES; page++) {
    const before = getCommentItems().length
    const loadMore = findLoadMoreButton()
    if (!loadMore) {
      log(`评论已全部加载，共 ${before} 条`)
      return
    }

    log(`加载评论下一页，当前 ${before} 条`)
    loadMore.scrollIntoView({ behavior: 'instant', block: 'center' })
    loadMore.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    loadMore.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    loadMore.click()

    const deadline = Date.now() + 6000
    let after = before
    while (Date.now() < deadline) {
      await sleep(250)
      after = getCommentItems().length
      if (after > before || !findLoadMoreButton()) break
    }

    if (after <= before && !findLoadMoreButton()) {
      break
    }
    if (after <= before) {
      break
    }
  }
}

function countMyCommentsInDom(username: string): number {
  const seenCommentIds = new Set<string>()
  let matchedCount = 0

  for (const item of getCommentItems()) {
    const commentId = cleanText(item.dataset.replyId) || cleanText(item.getAttribute('id')) || cleanText(item.textContent).slice(0, 100)
    if (!commentId || seenCommentIds.has(commentId)) continue
    seenCommentIds.add(commentId)

    const author = cleanText(item.querySelector<HTMLElement>(COMMENT_AUTHOR_SELECTOR)?.textContent)
    if (isAuthorMatched(author, username)) matchedCount++
  }

  log(`用户“${username}”匹配到 ${matchedCount} 条，去重后共检查 ${seenCommentIds.size} 条评论`)
  return matchedCount
}

/** 百家号扫描入口。 */
export async function scanBaijiahaoPage(): Promise<{
  platform: Platform
  title: string
  commentCount: number
  totalCommentCount?: number
  username: string
  diagnostics?: string
} | null> {
  log('===== 开始扫描百家号 =====')
  await activatePageScroll()
  let detected = detectCurrentUsername()
  if (!detected) {
    for (let waitRound = 1; waitRound <= 3; waitRound++) {
      await sleep(400)
      detected = detectCurrentUsername()
      if (detected) break
    }
  }
  // 页面识别不到账号时，手动配置的昵称就是唯一可信来源。若不把它作为别名传入，
  // resolvePlatformUsername 会把状态记成“账号未知”，导致补齐任务被误判为未登录而暂停。
  const aliases = detected ? [] : [await getConfiguredUsername(PLATFORM)].filter(Boolean)
  const username = await resolvePlatformUsername(PLATFORM, detected, aliases)
  if (!username) {
    log('未找到当前用户名，请在账号设置中填写百家号用户名')
    return null
  }

  // 1. 双轨通道首选：API 极速直连通道（彻底杜绝后台标签页视口懒加载与 DOM 加载更多点击丢失）
  const apiResult = await scanBaijiahaoCommentsViaApi(username)
  if (apiResult !== null) {
    const diagMsg = `【百家号API诊断】声明评论:${apiResult.declaredCount}条, 接口载入:${apiResult.loadedCount}条(共${apiResult.totalPages}页), 配置账号:[${username}], 探测到账号:[${detected || '无'}], 匹配到:${apiResult.matchedCount}条`
    log('===== 扫描完成(API) =====', diagMsg)
    return {
      platform: PLATFORM,
      title: getPageTitle(),
      commentCount: apiResult.matchedCount,
      totalCommentCount: Math.max(apiResult.declaredCount, apiResult.loadedCount),
      username,
      diagnostics: diagMsg,
    }
  }

  // 2. 备用通道：DOM 扫描
  try {
    await loadAllComments()
    const commentCount = countMyCommentsInDom(username)
    const title = getPageTitle()
    const declared = getDeclaredCommentCount() || 0
    const loaded = getCommentItems().length
    const diagMsg = `【百家号DOM诊断】声明评论:${declared}条, 列表载入:${loaded}条, 配置账号:[${username}], 探测到账号:[${detected || '无'}], 匹配到:${commentCount}条`
    log(`===== 扫描完成(DOM): ${commentCount} 条 =====`, diagMsg)
    return {
      platform: PLATFORM,
      title,
      commentCount,
      totalCommentCount: Math.max(declared, loaded),
      username,
      diagnostics: diagMsg,
    }
  } catch (error) {
    const message = `百家号评论扫描失败：${error instanceof Error ? error.message : String(error)}`
    log(message)
    await appendAccountLog(PLATFORM, 'error', message)
    return null
  }
}
