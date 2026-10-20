/**
 * Content script 入口
 * 注入到所有平台页面，自动检测 + 扫描 + 响应消息 + 通知浮层
 */
import { detectPlatform, isArticlePage, normalizeArticleUrl } from '@shared/platform'
import { accountStateKey, appendAccountLog, type AccountRuntimeState } from '@shared/account'
import type {
  ExtensionMessage,
  Platform,
  ScanResponse,
  SupplementActions,
  SupplementResult,
  VerifyCommentEvidenceRequest,
  VerifyCommentOnlineResult,
} from '@shared/types'
import { scanCsdnPage } from './csdn'
import { scanZhihuArchiveMetadata, scanZhihuPage } from './zhihu'
import { scanToutiaoPage } from './toutiao'
import { scanBaijiahaoPage } from './baijiahao'
import { scanNeteasePage } from './netease'
import { scanSohuPage } from './sohu'
import { ensureInteractions, extractArticleText, postComment, readInteractions } from './actions'
import {
  captureCommentEvidence,
  endAccountCommentCapture,
  nextAccountCommentCapture,
  startAccountCommentCapture,
} from './evidence'

const DEBUG = true
function log(...args: any[]) { if (DEBUG) console.log('[DL评论助手]', ...args) }

interface FloatingStatus {
  platform: string
  title: string
  commentCount: number | null
  totalCommentCount?: number
  username?: string
  status: string
  statusColor?: string
  recordStatus?: string
  liked?: boolean | null
  collected?: boolean | null
  interactionsSupported?: boolean
  progressPercent?: number
  etaSeconds?: number
  actionLabel?: string
}

function supportsArticleInteractions(platform: Platform): boolean {
  // 网易文章页没有文章级点赞或收藏；评论列表中的点赞不能当作文章互动。
  return platform !== 'netease'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char] || char)
}

/**
 * 评论接口可能仍会返回已经删除文章的历史评论，因此先以文章页面本身为准。
 * CSDN 的失效页标题为 404，并使用 .new_404 显示“内容不存在”。
 */
function isInvalidArticlePage(_platform: string): boolean {
  const title = document.title.trim()
  if (/^404(?:\s|$|[-_|])|页面不存在|内容不存在|文章不存在|内容已删除/i.test(title)) return true

  const errorContainer = document.querySelector(
    '.new_404, .error-404, .error-page, .error-container, .not-found, [class*="404"]',
  )
  const errorText = errorContainer?.textContent?.replace(/\s+/g, '') || ''
  return /内容不存在|文章不存在|页面不存在|作者删除了内容|想找的内容离你而去/.test(errorText)
}

/** 只认各平台页头/评论区中可见的明确登录控件，避免把正文或页脚文字误判为未登录。带有防抖复检，避免异步渲染闪烁。 */
async function detectLoginRequiredWithRetry(platform: Platform): Promise<boolean> {
  const checkOnce = () => {
    const selectors: Partial<Record<Platform, string[]>> = {
      csdn: ['.toolbar-btn-login-new', '.toolbar-btn-login', 'a[href*="passport.csdn.net/login"]'],
      zhihu: ['header button', '.AppHeader button', 'button.SignFlow-submitButton'],
      toutiao: ['header button', '[class*="login-button" i]', '[class*="loginBtn" i]'],
      baijiahao: ['header button', '[class*="login" i] button', 'a[href*="passport.baidu.com"]'],
      // 网易文章页顶部始终有站点级“登录/注册”入口，未登录与已登录都可能存在。
      // 只认评论区自身的登录控件，避免把页头导航误判成未登录。
      netease: ['#tieArea .submit-btn', '#tieArea a[href*="reg.163.com"]'],
      sohu: ['#meComment .login-area', '.header-login', 'a[href*="login.sohu.com"]'],
    }
    const loginText = /^(?:登录|立即登录|账号登录|手机号登录|登录后评论|登录并发贴|登录后跟贴)$/
    return (selectors[platform] || []).some(selector =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).some(element => {
        const style = window.getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const text = (element.textContent || element.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim()
        return loginText.test(text)
      }),
    )
  }

  if (!checkOnce()) return false
  // 初次命中登录控件时等待 800ms 复检一次，避免异步渲染过程中的占位闪烁
  await new Promise(resolve => setTimeout(resolve, 800))
  return checkOnce()
}

class RiskControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RiskControlError'
  }
}

/** 只检查验证码、频控提示等局部控件，避免把文章正文中的“安全/风险”误判为风控。 */
function detectRiskControlMessage(): string | null {
  const selectors = [
    '[class*="captcha" i]', '[id*="captcha" i]', '[class*="verify" i]', '[id*="verify" i]',
    '[class*="risk" i]', '[class*="security-check" i]', '[role="dialog"]',
    '.toast', '.message', '.notification',
  ]
  const pattern = /验证码|滑块验证|安全验证|请完成验证|操作频繁|访问频繁|请求频繁|账号异常|行为异常|稍后再试/
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.offsetParent === null) continue
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
      const match = text.match(pattern)
      if (match) return `平台触发“${match[0]}”提示，任务已安全暂停`
    }
  }
  return null
}

function commentVerificationDelay(platform: Platform): number {
  const delays: Partial<Record<Platform, number>> = {
    csdn: 3000,
    zhihu: 4500,
    toutiao: 5000,
    baijiahao: 7500,
    netease: 6000,
    sohu: 5000,
  }
  return delays[platform] || 5000
}

async function waitForPublishedComment(platform: Platform, comment: string, maxDelay: number): Promise<void> {
  const deadline = Date.now() + maxDelay
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))))
    if (hasPublishedCommentInDom(platform, comment)) return
  }
}

function publishedCommentSelectors(platform: Platform): string {
  const selectors: Partial<Record<Platform, string>> = {
    csdn: '.comment-list-box .new-comment, .comment-list-box .comment-content, .comment-box .new-comment, .comment-box .comment-content',
    zhihu: '.Comments-container .CommentContent',
    toutiao: '.ttp-comment-item .content',
    baijiahao: '.xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text',
    netease: '#tieArea .comment-content, #tieArea .tie-cnt, #tieArea [class*="comment"]',
    sohu: '#commentList .comment-content-text, #commentList .comment-content, #commentList .comment-text, #commentList [class*="comment-content"]',
  }
  return selectors[platform] || '__unsupported_comment_platform__'
}

function hasPublishedCommentInDom(platform: Platform, comment: string): boolean {
  const expected = cleanComparableText(comment)
  if (!expected) return false
  return Array.from(document.querySelectorAll<HTMLElement>(publishedCommentSelectors(platform)))
    .some(element => cleanComparableText(element.textContent || '').includes(expected))
}

async function locatePublishedCommentInFullArea(platform: Platform, comment: string): Promise<boolean> {
  const expected = cleanComparableText(comment)
  if (!expected) return false
  const start = await startAccountCommentCapture({
    type: 'START_ACCOUNT_COMMENT_CAPTURE',
    platform,
    username: '',
    expectedComment: comment,
  })
  if (!start.success) return false
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      const next = await nextAccountCommentCapture()
      if (!next.success) return false
      if (next.target && cleanComparableText(next.target.commentText).includes(expected)) return true
      if (next.done) return false
    }
    return false
  } finally {
    await endAccountCommentCapture()
  }
}

async function verifyCommentEvidence(
  request: VerifyCommentEvidenceRequest,
): Promise<VerifyCommentOnlineResult> {
  const checkedAt = new Date().toISOString()
  if (isInvalidArticlePage(request.platform)) {
    return {
      success: true,
      presence: 'suspected_deleted',
      checkedAt,
      currentCommentCount: 0,
      linkStatus: 'invalid',
      reason: '文章链接当前已经失效，无法继续核验评论',
    }
  }

  try {
    const scan = await scanCurrentPage()
    if (hasPublishedCommentInDom(request.platform, request.comment)) {
      return {
        success: true,
        presence: 'present',
        checkedAt,
        currentCommentCount: scan?.commentCount,
        linkStatus: 'active',
        reason: '当前页面仍能定位到相同评论文字',
      }
    }
    // 普通数量扫描可能只走接口，不会把完整评论列表挂到 DOM。在线核验需要
    // 展开评论区并按评论正文逐步定位，确认存在后才能同步历史状态。
    if (await locatePublishedCommentInFullArea(request.platform, request.comment)) {
      return {
        success: true,
        presence: 'present',
        checkedAt,
        currentCommentCount: scan?.commentCount,
        linkStatus: 'active',
        reason: '已在完整评论区定位到相同评论文字',
      }
    }
    if (scan && scan.commentCount < request.archivedAfterCommentCount) {
      return {
        success: true,
        presence: 'suspected_deleted',
        checkedAt,
        currentCommentCount: scan.commentCount,
        linkStatus: 'active',
        reason: `本账号评论数已由存档时的 ${request.archivedAfterCommentCount} 条降为 ${scan.commentCount} 条，疑似已删除`,
      }
    }
    return {
      success: true,
      presence: 'unknown',
      checkedAt,
      currentCommentCount: scan?.commentCount,
      linkStatus: 'active',
      reason: '页面未加载到相同评论节点，但评论数量未下降，暂时无法确认',
    }
  } catch (error) {
    return {
      success: false,
      presence: 'unknown',
      checkedAt,
      reason: '在线核验未完成',
      error: String((error as Error)?.message || error),
    }
  }
}

function cleanComparableText(value: string): string {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, '').trim()
}

let notificationDismissed = false
let notificationHideTimer: number | undefined
let notificationProgressTimer: number | undefined

function removeNotification() {
  document.getElementById('ai-comment-notification')?.remove()
  if (notificationHideTimer != null) {
    window.clearTimeout(notificationHideTimer)
    notificationHideTimer = undefined
  }
  if (notificationProgressTimer != null) {
    window.clearInterval(notificationProgressTimer)
    notificationProgressTimer = undefined
  }
}

/** 显示当前页面扫描状态；完成后自动消失，也可以手动关闭。 */
function showNotification(data: FloatingStatus) {
  if (notificationDismissed) return
  if (notificationHideTimer != null) {
    window.clearTimeout(notificationHideTimer)
    notificationHideTimer = undefined
  }
  if (notificationProgressTimer != null) {
    window.clearInterval(notificationProgressTimer)
    notificationProgressTimer = undefined
  }

  let notif = document.getElementById('ai-comment-notification')
  const isNew = !notif
  if (!notif) {
    notif = document.createElement('div')
    notif.id = 'ai-comment-notification'
    document.body.appendChild(notif)
  }

  notif.style.cssText = [
    'position:fixed', 'top:80px', 'right:20px', 'z-index:2147483647',
    'background:#fff', 'border-radius:12px', 'box-shadow:0 4px 20px rgba(0,0,0,.18)',
    'padding:16px 18px', 'width:300px', 'max-width:calc(100vw - 40px)',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'border-left:4px solid #409EFF', 'box-sizing:border-box',
    isNew ? 'animation:aiCommentSlideIn .3s ease' : '',
  ].filter(Boolean).join(';')

  const title = data.title.length > 38 ? `${data.title.slice(0, 38)}...` : data.title
  const countHtml = data.commentCount == null
    ? '<span style="color:#909399;font-weight:600;">扫描中...</span>'
    : `<span style="color:#409EFF;font-weight:700;font-size:20px;">${data.commentCount}</span><span style="color:#606266;"> 条</span>`
  const usernameHtml = data.username
    ? `<div style="font-size:12px;color:#909399;margin-top:5px;">账号：<span style="color:#303133;">${escapeHtml(data.username)}</span></div>`
    : ''
  const interactionText = (value: boolean | null | undefined, positive: string, negative: string) => data.interactionsSupported === false
    ? '<span style="color:#909399;">平台无此项</span>'
    : value === true
      ? `<span style="color:#67C23A;font-weight:600;">${positive}</span>`
      : value === false
        ? `<span style="color:#F56C6C;font-weight:600;">${negative}</span>`
        : '<span style="color:#909399;">暂未识别</span>'
  const interactionsHtml = data.interactionsSupported === false || data.liked !== undefined || data.collected !== undefined
    ? `<div style="display:flex;gap:18px;margin:0 0 8px;padding:8px 10px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#606266;">
        <span>点赞：${interactionText(data.liked, '已点赞', '未点赞')}</span>
        <span>收藏：${interactionText(data.collected, '已收藏', '未收藏')}</span>
      </div>`
    : ''
  const progressPercent = data.progressPercent == null
    ? null
    : Math.max(0, Math.min(100, Math.round(data.progressPercent)))
  const progressHtml = progressPercent == null
    ? ''
    : `<div style="margin:9px 0 7px;padding:9px 10px;background:#ecf5ff;border-radius:8px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:11px;color:#606266;">
          <span>${escapeHtml(data.actionLabel || '当前操作')}</span>
          <span>${progressPercent}%</span>
        </div>
        <div style="height:7px;background:#d9ecff;border-radius:99px;overflow:hidden;">
          <div style="width:${progressPercent}%;height:100%;background:#409EFF;border-radius:99px;transition:width .25s ease;"></div>
        </div>
        <div id="ai-comment-progress-countdown" style="margin-top:6px;font-size:11px;color:#7a8799;">
          ${data.etaSeconds && data.etaSeconds > 0 ? `预计约 ${Math.ceil(data.etaSeconds)} 秒进入下一步` : '正在等待平台完成当前步骤'}
        </div>
      </div>`

  notif.innerHTML = `
    <style>@keyframes aiCommentSlideIn{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}</style>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:14px;font-weight:700;color:#303133;">DL评论助手</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-size:11px;color:#67C23A;">● 单次扫描</div>
        <button id="ai-comment-notification-close" type="button" title="关闭" style="border:0;background:transparent;color:#909399;font-size:20px;line-height:16px;cursor:pointer;padding:0;">×</button>
      </div>
    </div>
    <div style="font-size:12px;color:#909399;margin-bottom:5px;">平台：<span style="color:#409EFF;font-weight:600;">${escapeHtml(data.platform)}</span></div>
    <div style="font-size:12px;color:#909399;line-height:18px;word-break:break-all;">文章：<span style="color:#303133;">${escapeHtml(title)}</span></div>
    ${usernameHtml}
    <div style="margin:10px 0 7px;padding:9px 10px;background:#f5f7fa;border-radius:8px;font-size:12px;color:#606266;">我的评论：${countHtml}</div>
    ${interactionsHtml}
    ${progressHtml}
    <div style="font-size:12px;color:#909399;line-height:18px;">状态：<span style="color:${data.statusColor || '#409EFF'};">${escapeHtml(data.status)}</span></div>
    ${data.recordStatus ? `<div style="font-size:11px;color:#909399;margin-top:5px;">${escapeHtml(data.recordStatus)}</div>` : ''}
  `

  notif.querySelector<HTMLButtonElement>('#ai-comment-notification-close')?.addEventListener('click', () => {
    notificationDismissed = true
    removeNotification()
  })

  if (progressPercent != null && progressPercent < 100 && data.etaSeconds && data.etaSeconds > 0) {
    const deadline = Date.now() + Math.ceil(data.etaSeconds) * 1000
    notificationProgressTimer = window.setInterval(() => {
      const countdown = notif?.querySelector<HTMLElement>('#ai-comment-progress-countdown')
      if (!countdown) return
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      countdown.textContent = remaining > 0
        ? `预计约 ${remaining} 秒进入下一步`
        : '预计时间已到，正在等待平台响应'
    }, 1000)
  }

  if ((progressPercent == null || progressPercent >= 100) && (data.commentCount != null || /完成|失败/.test(data.status))) {
    notificationHideTimer = window.setTimeout(removeNotification, 15000)
  }
}

/** 将扫描结果保存到扩展后台（写入扩展上下文的 IndexedDB） */
async function saveResultToBackground(
  result: {
    platform: string
    title: string
    commentCount: number
    totalCommentCount?: number
    username: string
    linkStatus?: 'active' | 'invalid'
    liked?: boolean
    collected?: boolean
  },
  url: string,
): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_SCAN_RESULT',
      platform: result.platform,
      url,
      title: result.title,
      commentCount: result.commentCount,
      totalCommentCount: result.totalCommentCount,
      username: result.username,
      linkStatus: result.linkStatus,
      liked: result.liked,
      collected: result.collected,
    })
    return response?.success === true
  } catch (e) {
    log('保存到后台失败:', e)
    return false
  }
}

/**
 * 点赞/收藏按钮通常晚于正文和评论接口挂载。只读取 DOM 状态，按安全间隔复检，
 * 不刷新页面、不重复请求评论接口，也绝不在扫描阶段触发点击。
 */
async function readInteractionsWithSafeRetry(platform: Platform) {
  if (!supportsArticleInteractions(platform)) {
    return { liked: null, collected: null, warnings: [] as string[] }
  }

  let liked: boolean | null = null
  let collected: boolean | null = null
  const warnings: string[] = []
  // 增强探活：首轮 0ms，若任一为 null 或未确认，自动触发页面微滚动激活惰性加载，并以 400ms、800ms、1200ms 重试
  const retryDelays = [0, 400, 800, 1200]

  for (let index = 0; index < retryDelays.length; index++) {
    if (retryDelays[index] > 0) {
      // 微滚动激活惰性交互组件（搜狐、头条等平台在滚动事件后才挂载互动状态）
      try {
        window.scrollBy({ top: 150, behavior: "instant" })
      } catch {}
      await new Promise(resolve => setTimeout(resolve, retryDelays[index]))
    }
    const state = await readInteractions(platform).catch(() => ({
      liked: null,
      collected: null,
      likePerformed: false,
      collectPerformed: false,
      warnings: [],
    }))
    if (typeof state.liked === 'boolean') liked = state.liked
    if (typeof state.collected === 'boolean') collected = state.collected
    warnings.push(...state.warnings)
    if (typeof liked === 'boolean' && typeof collected === 'boolean') break
  }

  return { liked, collected, warnings }
}

/** 执行扫描并返回结果 */
async function performScan(): Promise<ScanResponse | null> {
  const rawUrl = window.location.href
  const platform = detectPlatform(rawUrl)

  if (!platform || !isArticlePage(rawUrl)) {
    log('跳过: 非支持页面', rawUrl, platform)
    return null
  }
  const url = normalizeArticleUrl(rawUrl, platform)
  log('检测到平台:', platform)

  if (isInvalidArticlePage(platform)) {
    const invalidResult = {
      platform,
      title: '链接已失效（404）',
      commentCount: 0,
      username: '',
      linkStatus: 'invalid' as const,
    }
    const saved = await saveResultToBackground(invalidResult, url)
    showNotification({
      platform,
      title: invalidResult.title,
      commentCount: 0,
      status: saved ? '⚠ 链接已失效，记录已更新' : '⚠ 链接已失效，但记录保存失败',
      statusColor: '#F56C6C',
      recordStatus: '页面已返回 404，不再使用评论接口中的历史数据',
    })
    return {
      type: 'SCAN_RESULT',
      platform,
      url,
      title: invalidResult.title,
      commentCount: 0,
      username: '',
      linkStatus: 'invalid',
    }
  }

  showNotification({
    platform,
    title: document.title || url,
    commentCount: null,
    status: '正在自动读取评论…',
    recordStatus: '扫描完成后将自动记录；同一链接只更新，不重复新增',
    liked: null,
    collected: null,
    interactionsSupported: supportsArticleInteractions(platform),
  })

  if (await detectLoginRequiredWithRetry(platform)) {
    const error = '当前平台未登录，请登录后重新检测'
    await appendAccountLog(platform, 'error', error)
    showNotification({
      platform,
      title: document.title || url,
      commentCount: null,
      status: '未登录，已停止检测',
      statusColor: '#F56C6C',
      recordStatus: '请登录当前平台后重新检测；本次不会保存为 0 条评论',
      liked: null,
      collected: null,
      interactionsSupported: supportsArticleInteractions(platform),
    })
    return {
      type: 'SCAN_RESULT',
      platform,
      url,
      title: document.title || '',
      commentCount: 0,
      username: '',
      linkStatus: 'active',
      accountStatus: 'auth_required',
      error,
    }
  }

  let result: { platform: string; title: string; commentCount: number; totalCommentCount?: number; username: string; diagnostics?: string } | null = null
  // 记录各平台扫描抛出的具体原因，避免失败时只剩一句笼统的“扫描无结果”。
  let scanFailureReason = ''

  try {
    switch (platform) {
      case 'csdn':
        result = await scanCsdnPage()
        break
      case 'zhihu':
        result = await scanZhihuPage()
        break
      case 'toutiao':
        result = await scanToutiaoPage()
        break
      case 'baijiahao':
        result = await scanBaijiahaoPage()
        break
      case 'netease':
        result = await scanNeteasePage()
        break
      case 'sohu':
        result = await scanSohuPage()
        break
      default:
        log('未知平台:', platform)
        return null
    }
  } catch (e) {
    console.error('[DL评论助手] 扫描异常:', platform, e)
    scanFailureReason = e instanceof Error ? e.message : String(e)
    await appendAccountLog(platform, 'error', `扫描异常：${scanFailureReason}`)
  }

  if (!result) {
    log('扫描无结果（可能未登录或页面不受支持）')
    const accountStatus = await getFreshAccountState(platform)
    const authRequired = accountStatus === 'auth_required'
    const error = authRequired
      ? '当前平台未登录，请登录后重新检测'
      : scanFailureReason
        ? `扫描失败：${scanFailureReason}`
        : '扫描无结果，请检查登录状态、手动账号名称或平台评论接口'
    await appendAccountLog(platform, authRequired ? 'error' : 'warning', error)
    showNotification({
      platform,
      title: document.title || url,
      commentCount: null,
      status: authRequired ? '未登录，已停止检测' : '扫描失败，请查看下方原因',
      statusColor: '#F56C6C',
      recordStatus: authRequired
        ? '请登录当前平台后重新检测；本次不会保存为 0 条评论'
        : `本次未写入记录：${scanFailureReason || '未取得评论数据'}`,
    })
    return {
      type: 'SCAN_RESULT',
      platform,
      url,
      title: document.title || '',
      commentCount: 0,
      username: '',
      linkStatus: 'active',
      accountStatus: authRequired ? 'auth_required' : 'unknown',
      error,
    }
  }

  log('扫描结果:', result)

  // 读取点赞/收藏只检查状态，不触发点击；控件延迟加载时按安全间隔自动复检。
  const interactionState = await readInteractionsWithSafeRetry(platform)
  const interactionPatch = {
    ...(typeof interactionState.liked === 'boolean' ? { liked: interactionState.liked } : {}),
    ...(typeof interactionState.collected === 'boolean' ? { collected: interactionState.collected } : {}),
  }

  // 保存使用规范化链接；已有相同链接时只覆盖最新扫描状态。
  const saved = await saveResultToBackground({ ...result, ...interactionPatch, linkStatus: 'active' }, url)
  if (!saved) {
    await appendAccountLog(platform, 'error', '评论数量已扫描，但保存最新记录失败。')
  }

  showNotification({
    platform: result.platform,
    title: result.title,
    commentCount: result.commentCount,
    totalCommentCount: result.totalCommentCount,
    username: result.username,
    status: saved ? '扫描完成，记录已更新' : '扫描完成，但记录保存失败',
    statusColor: saved ? '#67C23A' : '#F56C6C',
    recordStatus: saved
      ? supportsArticleInteractions(platform)
        ? `点赞 ${interactionState.liked === true ? '已点赞' : interactionState.liked === false ? '未点赞' : '暂未识别'}；收藏 ${interactionState.collected === true ? '已收藏' : interactionState.collected === false ? '未收藏' : '暂未识别'}`
        : '网易文章页没有文章级点赞和收藏，仅统计评论'
      : '请打开扩展页检查错误信息',
    liked: interactionState.liked,
    collected: interactionState.collected,
    interactionsSupported: supportsArticleInteractions(platform),
  })

  return {
    type: 'SCAN_RESULT',
    platform: result.platform as any,
    url,
    title: result.title,
    commentCount: result.commentCount,
    username: result.username,
    linkStatus: 'active',
    accountStatus: await getFreshAccountState(result.platform as Platform),
    diagnostics: result.diagnostics,
    ...interactionPatch,
  }
}

async function getFreshAccountState(platform: Platform): Promise<ScanResponse['accountStatus']> {
  const data = await chrome.storage.local.get(accountStateKey(platform))
  const state = data[accountStateKey(platform)] as AccountRuntimeState | undefined
  if (!state || Date.now() - new Date(state.time).getTime() > 2 * 60 * 1000) return 'unknown'
  return state.status
}

/** 同一文章连续发布不足评论，全部输入发布完成后再统一扫描验证。 */
async function supplementCurrentPage(
  targetCommentCount: number,
  actions?: Partial<SupplementActions>,
): Promise<SupplementResult> {
  const platform = detectPlatform(window.location.href)
  const url = platform ? normalizeArticleUrl(window.location.href, platform) : window.location.href
  const target = Math.max(0, Math.min(10, Math.floor(targetCommentCount || 0)))
  const requested: SupplementActions = {
    comment: actions?.comment !== false,
    like: platform ? supportsArticleInteractions(platform) && actions?.like !== false : false,
    collect: platform ? supportsArticleInteractions(platform) && actions?.collect !== false : false,
  }
  const emptyResult: SupplementResult = {
    type: 'SUPPLEMENT_RESULT',
    platform: platform || 'csdn',
    url,
    title: document.title,
    username: '',
    targetCommentCount: target,
    beforeCommentCount: 0,
    afterCommentCount: 0,
    commentPosted: false,
    liked: null,
    collected: null,
    accountStatus: 'unknown',
    status: 'failed',
  }

  if (!platform || !isArticlePage(window.location.href)) {
    return { ...emptyResult, error: '当前页面不是支持的文章页', errorCode: 'UNSUPPORTED_PAGE' }
  }
  if (isInvalidArticlePage(platform)) {
    return { ...emptyResult, platform, error: '文章链接已失效', errorCode: 'PAGE_INVALID' }
  }

  showNotification({
    platform,
    title: document.title,
    commentCount: null,
    status: '正在执行登录与账号预检…',
    recordStatus: '预检通过后才会评论、点赞或收藏',
    liked: null,
    collected: null,
    interactionsSupported: supportsArticleInteractions(platform),
    progressPercent: 8,
    etaSeconds: 20,
    actionLabel: '登录与账号预检',
  })

  const before = await scanCurrentPage()
  if (!before) {
    await appendAccountLog(platform, 'error', '智能补齐已暂停：未检测到有效登录账号。')
    showNotification({
      platform,
      title: document.title,
      commentCount: null,
      status: '未登录或账号无法识别，已暂停操作',
      statusColor: '#F56C6C',
      recordStatus: '请登录平台后重新扫描并继续',
      progressPercent: 100,
      actionLabel: '操作已暂停',
    })
    return { ...emptyResult, platform, accountStatus: 'auth_required', error: '未登录或账号无法识别', errorCode: 'AUTH_REQUIRED' }
  }

  const accountStatus = await getFreshAccountState(platform)
  if (accountStatus !== 'logged_in') {
    const code = accountStatus === 'account_mismatch' ? 'ACCOUNT_MISMATCH' : 'AUTH_REQUIRED'
    const error = accountStatus === 'account_mismatch'
      ? '当前登录账号与手动配置账号不一致'
      : '无法确认当前登录账号，请先登录或打开账号设置核对'
    await appendAccountLog(platform, 'error', `智能补齐已暂停：${error}`)
    showNotification({
      platform,
      title: before.title,
      commentCount: before.commentCount,
      username: before.username,
      status: error,
      statusColor: '#F56C6C',
      recordStatus: '为避免错误账号操作，本次没有评论、点赞或收藏',
      interactionsSupported: supportsArticleInteractions(platform),
      progressPercent: 100,
      actionLabel: '操作已暂停',
    })
    return {
      ...emptyResult,
      platform,
      title: before.title,
      username: before.username,
      beforeCommentCount: before.commentCount,
      afterCommentCount: before.commentCount,
      accountStatus: accountStatus || 'unknown',
      status: 'needs_attention',
      error,
      errorCode: code,
    }
  }

  let liked: boolean | null = null
  let collected: boolean | null = null
  let likePerformed = false
  let collectPerformed = false
  let commentPosted = false
  let commentText = ''
  const commentTexts: string[] = []
  try {
    const initialRisk = detectRiskControlMessage()
    if (initialRisk) throw new RiskControlError(initialRisk)

    showNotification({
      platform,
      title: before.title,
      commentCount: before.commentCount,
      username: before.username,
      status: '正在检测并处理点赞、收藏状态…',
      recordStatus: '只会操作本次选中的项目',
      liked,
      collected,
      interactionsSupported: supportsArticleInteractions(platform),
      progressPercent: 28,
      etaSeconds: 15,
      actionLabel: '点赞与收藏预检',
    })

    const interactions = await ensureInteractions(platform, requested)
    liked = interactions.liked
    collected = interactions.collected
    likePerformed = interactions.likePerformed
    collectPerformed = interactions.collectPerformed

    const interactionRisk = detectRiskControlMessage()
    if (interactionRisk) throw new RiskControlError(interactionRisk)

    if (requested.comment && before.commentCount < target) {
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount,
        username: before.username,
        status: '正在按当前评论模式准备内容…',
        recordStatus: `当前 ${before.commentCount} 条，目标 ${target} 条；将在当前页面连续发布后统一复检`,
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 45,
        etaSeconds: 20,
        actionLabel: '准备评论',
      })
      const articleText = extractArticleText()
      const publishCount = Math.max(0, target - before.commentCount)
      for (let index = 0; index < publishCount; index++) {
        const generated = await chrome.runtime.sendMessage({
          type: 'GENERATE_AI_COMMENT', platform, url, articleText,
        })
        if (!generated?.success || !generated?.data?.comment) {
          throw new Error(generated?.error || '插件未返回评论内容')
        }
        commentText = String(generated.data.comment).trim()
        const prePostRisk = detectRiskControlMessage()
        if (prePostRisk) throw new RiskControlError(prePostRisk)
        showNotification({
          platform,
          title: before.title,
          commentCount: before.commentCount + commentTexts.length,
          username: before.username,
          status: `正在连续发布第 ${index + 1}/${publishCount} 条评论…`,
          recordStatus: '输入并发布完成后继续下一条，全部结束后统一扫描',
          liked,
          collected,
          interactionsSupported: supportsArticleInteractions(platform),
          progressPercent: 55 + Math.round(((index + 1) / publishCount) * 25),
          etaSeconds: Math.ceil((publishCount - index) * 4),
          actionLabel: '连续填写并发布',
        })
        await postComment(platform, commentText)
        commentTexts.push(commentText)
        commentPosted = true
        const risk = detectRiskControlMessage()
        if (risk) throw new RiskControlError(risk)
        if (index < publishCount - 1) await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 2500))
      }
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount + commentTexts.length,
        username: before.username,
        status: `${commentTexts.length} 条评论已连续提交，正在统一扫描验证…`,
        recordStatus: '评论之间未执行整页扫描',
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 84,
        etaSeconds: 3,
        actionLabel: '最终统一复检',
      })
      const verifyDeadline = Date.now() + Math.min(3000, commentVerificationDelay(platform))
      while (Date.now() < verifyDeadline) {
        if (commentTexts.some(text => hasPublishedCommentInDom(platform, text))) break
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    } else {
      showNotification({
        platform,
        title: before.title,
        commentCount: before.commentCount,
        username: before.username,
        status: '页面操作完成，正在重新检测最终状态…',
        recordStatus: requested.comment ? '当前评论数量已达到目标' : '本次未选择评论操作',
        liked,
        collected,
        interactionsSupported: supportsArticleInteractions(platform),
        progressPercent: 84,
        etaSeconds: 8,
        actionLabel: '最终状态复检',
      })
    }

    const postRisk = detectRiskControlMessage()
    if (postRisk) throw new RiskControlError(postRisk)

    const after = await scanCurrentPage()
    const scannedAfterCount = after?.commentCount ?? before.commentCount
    // 最终扫描已经对点赞/收藏做了安全重试，必须采用该次最新状态。旧逻辑只取评论数，
    // 导致页面已经点赞或收藏成功，任务结果仍沿用操作阶段的 unknown。
    const verifiedLiked = typeof after?.liked === 'boolean' ? after.liked : liked
    const verifiedCollected = typeof after?.collected === 'boolean' ? after.collected : collected
    liked = verifiedLiked
    collected = verifiedCollected
    const visiblePublishedCount = commentTexts.filter(text => hasPublishedCommentInDom(platform, text)).length
    const commentVisibleInDom = visiblePublishedCount > 0
    const expectedAfterCount = before.commentCount + commentTexts.length
    const commentVerified = !commentPosted || scannedAfterCount >= expectedAfterCount || visiblePublishedCount === commentTexts.length
    // 平台接口同步较慢时，以页面中已经出现的本次唯一评论作为即时成功依据；后续扫描仍会覆盖为最新真实数量。
    const afterCount = commentVisibleInDom
      ? Math.max(scannedAfterCount, before.commentCount + visiblePublishedCount)
      : scannedAfterCount
    const fullySatisfied = (!requested.comment || afterCount >= target)
      && (!requested.like || liked === true)
      && (!requested.collect || collected === true)
    const pendingCommentConfirmation = commentPosted && !commentVerified
    const status = pendingCommentConfirmation ? 'needs_attention' : fullySatisfied ? 'verified' : 'partial'
    const errorCode = pendingCommentConfirmation ? 'COMMENT_PENDING_CONFIRMATION' : undefined
    const error = pendingCommentConfirmation
      ? '评论已提交，但平台列表暂未同步；已停止重复发布，请稍后重新扫描确认'
      : undefined

    showNotification({
      platform,
      title: before.title,
      commentCount: afterCount,
      username: before.username,
      status: pendingCommentConfirmation ? '评论已提交，等待平台同步' : fullySatisfied ? '补齐完成并已重新验证' : '本轮完成，仍有缺口',
      statusColor: fullySatisfied ? '#67C23A' : '#E6A23C',
      recordStatus: `评论 ${requested.comment ? `目标 ${target} 条` : '未选择'}；点赞 ${supportsArticleInteractions(platform) ? requested.like ? (liked === true ? '已完成' : '未确认') : '未选择' : '平台无此项'}；收藏 ${supportsArticleInteractions(platform) ? requested.collect ? (collected === true ? '已完成' : '未确认') : '未选择' : '平台无此项'}`,
      liked,
      collected,
      interactionsSupported: supportsArticleInteractions(platform),
      progressPercent: 100,
      actionLabel: fullySatisfied ? '操作完成' : '本轮操作结束',
    })

    return {
      type: 'SUPPLEMENT_RESULT', platform, url, title: before.title, username: before.username,
      targetCommentCount: target, beforeCommentCount: before.commentCount, afterCommentCount: afterCount,
      commentPosted, commentText: commentPosted ? commentText : undefined,
      commentTexts, commentPostedCount: commentTexts.length,
      likePerformed, collectPerformed,
      liked, collected, accountStatus, status, error, errorCode,
    }
  } catch (error) {
    const riskBlocked = error instanceof RiskControlError
    showNotification({
      platform,
      title: before.title,
      commentCount: before.commentCount,
      username: before.username,
      status: riskBlocked ? '检测到平台安全验证，任务已暂停' : '本轮页面操作失败',
      statusColor: '#F56C6C',
      recordStatus: String((error as Error)?.message || error),
      liked,
      collected,
      interactionsSupported: supportsArticleInteractions(platform),
      progressPercent: 100,
      actionLabel: riskBlocked ? '安全暂停' : '操作结束',
    })
    return {
      type: 'SUPPLEMENT_RESULT', platform, url, title: before.title, username: before.username,
      targetCommentCount: target, beforeCommentCount: before.commentCount, afterCommentCount: before.commentCount,
      commentPosted, commentText: commentPosted ? commentText : undefined,
      commentTexts, commentPostedCount: commentTexts.length,
      likePerformed, collectPerformed,
      liked, collected, accountStatus, status: riskBlocked ? 'needs_attention' : 'failed',
      error: String((error as Error)?.message || error),
      errorCode: riskBlocked ? 'RISK_CONTROL_BLOCKED' : 'ACTION_FAILED',
    }
  }
}

let activeScan: Promise<ScanResponse | null> | null = null
let lastScanResult: ScanResponse | null = null

function scanCurrentPage(): Promise<ScanResponse | null> {
  if (activeScan) return activeScan
  activeScan = performScan()
    .then((result) => {
      lastScanResult = result
      return result
    })
    .finally(() => {
      activeScan = null
    })
  return activeScan
}

/** 主动扫描并更新 badge */
const autoScannedUrls = new Set<string>()
async function autoScan(): Promise<void> {
  const platform = detectPlatform(window.location.href)
  if (!platform || !isArticlePage(window.location.href)) return
  const scanKey = normalizeArticleUrl(window.location.href, platform)
  if (autoScannedUrls.has(scanKey)) {
    log('当前链接已自动扫描过，跳过重复扫描:', scanKey)
    return
  }
  autoScannedUrls.add(scanKey)

  log('自动扫描...')
  try {
    const result = await scanCurrentPage()
    if (!result) {
      log('无结果，不更新 badge')
      return
    }

    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: result.commentCount,
    } as any).catch((e) => {
      log('发送消息失败:', e)
    })
  } catch (e) {
    console.error('[DL评论助手] autoScan 异常:', e)
  }
}

function init() {
  log('Content script 已加载')

  const initialPlatform = detectPlatform(window.location.href)
  if (initialPlatform && isArticlePage(window.location.href)) {
    showNotification({
      platform: initialPlatform,
      title: document.title || window.location.href,
      commentCount: null,
      status: '等待自动扫描…',
      recordStatus: '无需点击插件，页面加载后自动统计并更新记录',
    })
  }

  // 页面加载后自动扫描
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoScan, 2000)
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(autoScan, 2000)
    })
  }

  // SPA 路由变化监听
  let lastUrl = window.location.href
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      log('SPA 路由变化:', lastUrl)
      notificationDismissed = false
      removeNotification()
      lastScanResult = null
      const nextPlatform = detectPlatform(lastUrl)
      if (nextPlatform && isArticlePage(lastUrl)) {
        showNotification({
          platform: nextPlatform,
          title: document.title || lastUrl,
          commentCount: null,
          status: '页面已切换，等待自动扫描…',
          recordStatus: '相同链接将更新原记录',
        })
      }
      setTimeout(autoScan, 2000)
    }
  })
  observer.observe(document, { subtree: true, childList: true })
}

init()

// 监听来自 popup / service worker 的消息
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'CLEAR_SCAN_CACHE') {
    lastScanResult = null
    notificationDismissed = true
    removeNotification()
    sendResponse({ success: true })
    return false
  }

  if (message.type === 'GET_CURRENT_RESULT') {
    if (activeScan) {
      activeScan.then(sendResponse).catch(() => sendResponse(null))
      return true
    }
    sendResponse(lastScanResult)
    return false
  }

  if (message.type === 'SCAN_PAGE') {
    log('收到消息:', message.type)
    // 后台批量检测已主动发起扫描时，标记当前链接，避免稍后的自动扫描再次触发平台接口。
    const platform = detectPlatform(window.location.href)
    if (platform && isArticlePage(window.location.href)) {
      autoScannedUrls.add(normalizeArticleUrl(window.location.href, platform))
    }
    scanCurrentPage().then((result) => {
      sendResponse(result)
    }).catch((e) => {
      console.error('[DL评论助手] 消息处理异常:', e)
      sendResponse(null)
    })
    return true
  }

  if (message.type === 'SCAN_ARCHIVE_METADATA') {
    if (message.platform !== 'zhihu') {
      sendResponse(null)
      return false
    }
    scanZhihuArchiveMetadata().then((result) => sendResponse(result ? {
      type: 'SCAN_RESULT',
      platform: result.platform,
      url: window.location.href,
      title: result.title,
      commentCount: result.commentCount,
      username: result.username,
      linkStatus: 'active',
    } : null)).catch(() => sendResponse(null))
    return true
  }

  if (message.type === 'CAPTURE_COMMENT_EVIDENCE') {
    sendResponse(captureCommentEvidence(message))
    return false
  }

  if (message.type === 'START_ACCOUNT_COMMENT_CAPTURE') {
    startAccountCommentCapture(message).then(sendResponse).catch(error => sendResponse({
      success: false, error: String((error as Error)?.message || error),
    }))
    return true
  }

  if (message.type === 'NEXT_ACCOUNT_COMMENT_CAPTURE') {
    nextAccountCommentCapture().then(sendResponse).catch(error => sendResponse({
      success: false, done: true, error: String((error as Error)?.message || error),
    }))
    return true
  }

  if (message.type === 'END_ACCOUNT_COMMENT_CAPTURE') {
    endAccountCommentCapture()
    sendResponse({ success: true })
    return false
  }

  if (message.type === 'VERIFY_COMMENT_EVIDENCE') {
    verifyCommentEvidence(message).then(sendResponse).catch(error => sendResponse({
      success: false,
      presence: 'unknown',
      checkedAt: new Date().toISOString(),
      reason: '在线核验未完成',
      error: String(error),
    }))
    return true
  }

  if (message.type === 'SUPPLEMENT_PAGE') {
    supplementCurrentPage(message.targetCommentCount, message.actions)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: String(error) }))
    return true
  }
})
