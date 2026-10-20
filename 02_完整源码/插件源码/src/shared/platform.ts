 import type { Platform } from './types'
 
 /** 根据 URL 判断平台 */
export function detectPlatform(url: string): Platform | null {
   if (url.includes('csdn.net')) return 'csdn'
   if (url.includes('zhihu.com')) return 'zhihu'
   if (url.includes('toutiao.com')) return 'toutiao'
   if (url.includes('baijiahao.baidu.com')) return 'baijiahao'
   if (url.includes('163.com') || url.includes('netease.com')) return 'netease'
   if (url.includes('sohu.com')) return 'sohu'
   return null
}

/** 将同一篇文章的跟踪参数、锚点和末尾斜杠统一，作为存储唯一键。 */
export function normalizeArticleUrl(rawUrl: string, platform?: Platform | null): string {
  try {
    const url = new URL(rawUrl)
    const detectedPlatform = platform || detectPlatform(rawUrl)
    // 网易跟贴页和文章页使用同一个 thread id。历史版本曾把跟贴页直接写入记录，
    // 导致后续扫描把 comment.tie.163.com 当成文章页而返回 0/不支持。统一还原为文章 URL。
    if (detectedPlatform === 'netease' && url.hostname.toLowerCase() === 'comment.tie.163.com') {
      const threadId = url.pathname.match(/^\/([^/]+)\.html$/i)?.[1]
      if (threadId) {
        return `https://www.163.com/dy/article/${encodeURIComponent(threadId)}.html`
      }
    }
    url.hash = ''

    if (detectedPlatform === 'baijiahao') {
      const contentId = url.searchParams.get('id')
      url.search = ''
      if (contentId) url.searchParams.set('id', contentId)
    } else {
      url.search = ''
    }

    // 今日头条同一篇文章有 /item/{id} 与 /article/{id} 两种地址写法，页面会把
    // /item/ 重定向到 /article/。必须归一为 /article/{id}：否则导入时按用户粘贴的
    // /item/ 建一条记录，扫描时按页面实际地址 /article/ 又建一条，同一篇文章会出现
    // 两条记录（表现为“导入 11 条却显示 12 条”，且导入那条标题、账号、点赞收藏全空）。
    if (detectedPlatform === 'toutiao') {
      const articleId = url.pathname.match(/^\/(?:item|article)\/(\d+)/)
      if (articleId) url.pathname = `/article/${articleId[1]}`
    }

    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return rawUrl.split('#')[0]
  }
}

export interface ClassifiedArticleUrl {
  url: string
  platform: Platform
}

export interface ArticleUrlClassification {
  valid: ClassifiedArticleUrl[]
  invalid: string[]
  thirdParty: string[]
  duplicateCount: number
  byPlatform: Partial<Record<Platform, number>>
}

/** 校验、规范化、去重并按平台汇总一批文章链接。 */
export function classifyArticleUrls(rawUrls: string[]): ArticleUrlClassification {
  const valid: ClassifiedArticleUrl[] = []
  const invalid: string[] = []
  const thirdParty: string[] = []
  const seen = new Set<string>()
  const byPlatform: Partial<Record<Platform, number>> = {}
  let duplicateCount = 0

  for (const raw of rawUrls) {
    // 从 Markdown/聊天中复制的 URL 可能把下划线写成 `\_`。浏览器会把
    // 反斜杠编码进路径，导致搜狐文章页规则误判为无效链接。
    const value = raw.trim().replace(/\\([_~])/g, '$1').replace(/[),，。；;]+$/, '')
    if (!value) continue
    let parsed: URL
    try {
      parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    } catch {
      invalid.push(value)
      continue
    }
    const platform = detectPlatform(value)
    if (!platform) {
      const normalized = normalizeArticleUrl(value)
      if (seen.has(`third-party:${normalized}`)) duplicateCount++
      else {
        seen.add(`third-party:${normalized}`)
        thirdParty.push(normalized)
      }
      continue
    }
    if (!isArticlePage(value)) {
      invalid.push(value)
      continue
    }
    const url = normalizeArticleUrl(value, platform)
    const key = `${platform}:${url}`
    if (seen.has(key)) {
      duplicateCount++
      continue
    }
    seen.add(key)
    valid.push({ url, platform })
    byPlatform[platform] = (byPlatform[platform] || 0) + 1
  }

  return { valid, invalid, thirdParty, duplicateCount, byPlatform }
}
 
 /** 判断是否是文章页（粗略） */
export function isArticlePage(url: string): boolean {
   // CSDN 文章: /article/details/
   if (url.includes('csdn.net') && url.includes('/article/details/')) return true
   // 知乎文章/回答: /p/ 或 /answer/
   if (url.includes('zhihu.com') && (url.includes('/p/') || url.includes('/answer/'))) return true
   // 头条文章：新旧页面分别使用 /article/{id} 与 /item/{id}
   if (url.includes('toutiao.com') && (/\/article\/\d+/.test(url) || /\/item\/\d+/.test(url))) return true
   // 百家号
   if (url.includes('baijiahao.baidu.com')) return true
  // 网易文章
  if (url.includes('163.com') && url.includes('/article/')) return true
  // 网易评论页是文章评论操作的实际承载页。后台会从文章页跳转到
  // comment.tie.163.com，再执行评论和重新扫描；该页仍属于同一文章任务。
  if (url.includes('comment.tie.163.com') && /\/[^/]+\.html/.test(new URL(url).pathname)) return true
   // 搜狐文章
   if (url.includes('sohu.com') && /\/a\/\d+_\d+/.test(url)) return true
   return false
 }
 
 /** 获取平台对应的 content script 文件路径 */
 export function getContentScriptFile(platform: Platform): string {
   return `content/${platform}.js`
 }
