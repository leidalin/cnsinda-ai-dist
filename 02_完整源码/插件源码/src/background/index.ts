/**
 * Service Worker
 * 处理批量检测、保存扫描结果、badge 更新、消息路由
 */
import type {
  CommentArchiveRunSummary,
  CommentRecord,
  CommentEvidenceSnapshot,
  CaptureUrlArchiveRequest,
  CaptureUrlArchiveResult,
  CommentPublishHistoryItem,
  ExtensionMessage,
  BatchResultItem,
  NextAccountCommentCaptureResult,
  Platform,
  StartAccountCommentCaptureResult,
  SupplementActions,
  SupplementResult,
  VerifyCommentOnlineRequest,
  VerifyCommentOnlineResult,
} from '@shared/types'
import { COMMENT_ARCHIVE_RUN_HISTORY_KEY, COMMENT_ARCHIVE_RUNS_KEY } from '@shared/types'
import { classifyArticleUrls, detectPlatform, normalizeArticleUrl } from '@shared/platform'
import { getAllCommentEvidence, getCommentEvidence, pruneCommentEvidence, saveCommentEvidence, saveRecord } from '@db/index'
import { localClientCommand } from './local-client'

const CLIENT_COMMANDS = new Set([
  'HELLO', 'GET_AI_CONFIG', 'IMPORT_AIPROXY_CONFIG', 'FETCH_AI_MODELS',
  'SAVE_AI_CONFIG', 'TEST_AI_CONNECTION', 'GENERATE_COMMENT',
  'EXPORT_CONFIG_BACKUP', 'IMPORT_CONFIG_BACKUP',
  'LIST_LOGS', 'CLEAR_LOGS', 'OPEN_LOG_DIR', 'EXPORT_LOGS',
  'GET_TASK_STATE', 'SAVE_TASK_STATE', 'APPEND_LOG',
])

const nativeCommand = localClientCommand

function writeClientLog(channel: 'operation' | 'error', entry: Record<string, unknown>): Promise<void> {
  return nativeCommand('APPEND_LOG', { channel, entry }).then(() => undefined).catch(() => undefined)
}

function notifyAttention(title: string, message: string) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  }).catch(() => {})
}

/** 更新 toolbar badge */
function updateBadge(count: number, tabId?: number) {
  const text = count > 0 ? String(count) : ''
  const action = chrome.action
  if (tabId) {
    action.setBadgeText({ text, tabId })
    action.setBadgeBackgroundColor({ color: '#409EFF', tabId })
  } else {
    action.setBadgeText({ text })
    action.setBadgeBackgroundColor({ color: '#409EFF' })
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`扫描超时（${timeoutMs / 1000} 秒）`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId)
  }
}

function isMissingContentScriptError(error: unknown): boolean {
  const message = String((error as Error)?.message || error)
  return /Receiving end does not exist|Could not establish connection|message channel closed|message port closed|asynchronous response/i.test(message)
}

/**
 * Chrome may leave an inactive or extension-reload-created article tab without
 * the declared content script. Inject only on a verified supported article and
 * retry once so archive scans do not require a manual page refresh.
 */
async function sendContentScriptMessage<T>(tabId: number, message: ExtensionMessage): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as T
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error
    const tab = await chrome.tabs.get(tabId)
    const platform = detectPlatform(tab.url || '')
    if (!platform || !tab.url || !/^https?:/i.test(tab.url)) throw error

    await writeClientLog('error', {
      stage: 'comment-evidence', action: 'content-script-missing', platform,
      url: normalizeArticleUrl(tab.url, platform), code: 'CONTENT_SCRIPT_MISSING',
      message: '文章后台页未连接内容脚本，正在自动注入并重试',
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.js'],
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    const response = await chrome.tabs.sendMessage(tabId, message) as T
    await writeClientLog('operation', {
      stage: 'comment-evidence', action: 'content-script-recovered', platform,
      url: normalizeArticleUrl(tab.url, platform), message: '文章后台页内容脚本已恢复',
    })
    return response
  }
}

function neteaseCommentThreadUrl(articleUrl: string): string {
  const url = new URL(articleUrl)
  if (url.hostname === 'comment.tie.163.com') return url.toString()
  const threadId = url.pathname.match(/\/article\/([A-Za-z0-9_-]+)\.html(?:$|\/)/i)?.[1]
  if (!threadId) throw new Error('无法从网易文章链接识别跟贴编号')
  return `https://comment.tie.163.com/${encodeURIComponent(threadId)}.html`
}

async function navigateTabAndWait(tabId: number, url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timeoutId)
      if (error) reject(error)
      else resolve()
    }
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        setTimeout(() => finish(), 2500)
      }
    }
    const timeoutId = setTimeout(() => finish(), 20000)
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.update(tabId, { url, active: false }).catch(finish)
  })
}

class BatchCancelledError extends Error {
  constructor() {
    super('批量检测已停止')
    this.name = 'BatchCancelledError'
  }
}

interface BatchScanController {
  cancelled: boolean
  activeTabIds: Set<number>
  cancelHandlers: Set<() => void>
}

function cancelBatchScan(controller: BatchScanController) {
  if (controller.cancelled) return
  controller.cancelled = true
  for (const cancel of [...controller.cancelHandlers]) cancel()
  for (const tabId of [...controller.activeTabIds]) {
    chrome.tabs.remove(tabId).catch(() => {})
  }
}

function withBatchCancellation<T>(promise: Promise<T>, controller: BatchScanController): Promise<T> {
  if (controller.cancelled) return Promise.reject(new BatchCancelledError())

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      controller.cancelHandlers.delete(cancel)
      callback()
    }
    const cancel = () => finish(() => reject(new BatchCancelledError()))
    controller.cancelHandlers.add(cancel)

    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
  })
}

function cancellableDelay(delayMs: number, controller: BatchScanController): Promise<void> {
  if (delayMs <= 0) {
    return controller.cancelled ? Promise.reject(new BatchCancelledError()) : Promise.resolve()
  }
  return withBatchCancellation(new Promise(resolve => setTimeout(resolve, delayMs)), controller)
}

function safePost(port: chrome.runtime.Port, message: unknown) {
  try {
    port.postMessage(message)
  } catch {}
}

/** 在后台标签页中处理单个URL */

async function sendMessageWithRetry<T = any>(
  tabId: number,
  message: any,
  options: { maxRetries?: number; retryDelay?: number; timeout?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5
  const retryDelay = options.retryDelay ?? 600
  const timeout = options.timeout ?? 60000

  let lastError: any = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage(tabId, message),
        timeout,
      )
      return response as T
    } catch (err: any) {
      lastError = err
      const errMsg = String(err?.message || err)
      const isConnectionError = errMsg.includes("Could not establish connection")
        || errMsg.includes("Receiving end does not exist")
        || errMsg.includes("The message port closed")

      if (isConnectionError && attempt < maxRetries) {
        // 尝试自动重新向标签页注入 content script 作为兜底
        if (attempt === 2) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ["content/index.js"],
            })
          } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
        continue
      }
      throw err
    }
  }
  throw lastError || new Error("Failed to send message after retries")
}

async function scanUrlInTab(url: string, controller: BatchScanController): Promise<BatchResultItem | null> {
  const platform = detectPlatform(url)
  if (!platform) {
    return { platform: 'csdn' as any, url, commentCount: 0, title: '', error: '无法识别的平台' }
  }
  const normalizedUrl = normalizeArticleUrl(url, platform)
  let tabId: number | undefined

  try {
    if (controller.cancelled) throw new BatchCancelledError()
    const tab = await chrome.tabs.create({ url: normalizedUrl, active: false })
    tabId = tab?.id
    if (tabId == null) throw new Error('无法创建后台标签页')
    controller.activeTabIds.add(tabId)
    if (controller.cancelled) throw new BatchCancelledError()

    await withBatchCancellation(new Promise<void>((resolve) => {
      const listener = (tabId: number, changeInfo: { status?: string }) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener)
            resolve()
          }, 1500)
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }, 15000)
    }), controller)

    const result = await withBatchCancellation(
      sendMessageWithRetry(tabId, {
        type: "SCAN_PAGE",
        platform,
        url: normalizedUrl,
      }, { maxRetries: 5, retryDelay: 600, timeout: 60000 }),
      controller,
    )

    if (result?.type === 'SCAN_RESULT') {
      if (result.accountStatus === 'auth_required') {
        writeClientLog('error', {
          stage: 'account-check',
          action: 'batch-scan-auth-required',
          code: 'AUTH_REQUIRED',
          platform: result.platform,
          url: normalizeArticleUrl(result.url, result.platform),
          message: result.error || '当前平台未登录，请登录后重新检测',
        })
      }
      return {
        platform: result.platform,
        url: normalizeArticleUrl(result.url, result.platform),
        commentCount: result.commentCount,
        title: result.title,
        linkStatus: result.linkStatus || 'active',
        username: result.username,
        accountStatus: result.accountStatus,
        liked: result.liked,
        collected: result.collected,
        diagnostics: result.diagnostics,
        error: result.error,
      }
    }

    return { platform, url: normalizedUrl, commentCount: 0, title: '', error: '未获取到数据' }
  } catch (err) {
    if (err instanceof BatchCancelledError) return null
    return { platform, url: normalizedUrl, commentCount: 0, title: '', error: String(err) }
  } finally {
    if (tabId != null) {
      controller.activeTabIds.delete(tabId)
      try {
        await chrome.tabs.remove(tabId)
      } catch {}
    }
  }
}

async function verifyCommentOnline(
  request: VerifyCommentOnlineRequest,
): Promise<VerifyCommentOnlineResult> {
  const checkedAt = new Date().toISOString()
  const detectedPlatform = detectPlatform(request.url)
  if (!detectedPlatform || detectedPlatform !== request.platform || request.platform === 'third_party') {
    return {
      success: false,
      presence: 'unknown',
      checkedAt,
      reason: '在线核验未完成',
      error: '该链接不是当前支持的平台文章页',
    }
  }

  const normalizedUrl = normalizeArticleUrl(request.url, request.platform)
  let tabId: number | undefined
  try {
    const tab = await chrome.tabs.create({ url: normalizedUrl, active: false })
    tabId = tab.id
    if (tabId == null) throw new Error('无法创建在线核验页面')
    await new Promise<void>((resolve) => {
      const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          setTimeout(resolve, 1250)
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }, 20000)
    })
    return await withTimeout(chrome.tabs.sendMessage(tabId, {
      type: 'VERIFY_COMMENT_EVIDENCE',
      platform: request.platform,
      url: normalizedUrl,
      comment: request.comment,
      archivedAfterCommentCount: request.archivedAfterCommentCount,
    }), 150000) as VerifyCommentOnlineResult
  } catch (error) {
    return {
      success: false,
      presence: 'unknown',
      checkedAt: new Date().toISOString(),
      reason: '在线核验未完成',
      error: String((error as Error)?.message || error),
    }
  } finally {
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {})
  }
}

async function captureUrlArchive(
  request: CaptureUrlArchiveRequest,
): Promise<CaptureUrlArchiveResult> {
  const detectedPlatform = detectPlatform(request.url)
  if (!detectedPlatform || detectedPlatform !== request.platform || request.platform === 'third_party') {
    return { success: false, error: '该链接属于第三方平台，当前版本只记录链接，暂不生成评论区快照' }
  }

  const normalizedUrl = normalizeArticleUrl(request.url, request.platform)
  let tabId: number | undefined
  let windowId: number | undefined
  try {
    const operationWindow = await chrome.windows.create({
      url: normalizedUrl,
      type: 'popup',
      focused: false,
      width: 760,
      height: 860,
    })
    if (!operationWindow) throw new Error('无法创建快照操作窗口')
    windowId = operationWindow.id
    const tab = operationWindow.tabs?.[0] || (windowId != null ? (await chrome.tabs.query({ windowId }))[0] : undefined)
    tabId = tab?.id
    if (tabId == null) throw new Error('无法创建快照扫描页面')
    await new Promise<void>((resolve) => {
      const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener)
          setTimeout(resolve, 2500)
        }
      }
      chrome.tabs.onUpdated.addListener(listener)
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }, 20000)
    })

    const scan = await withTimeout(sendContentScriptMessage(tabId, {
      type: request.platform === 'zhihu' ? 'SCAN_ARCHIVE_METADATA' : 'SCAN_PAGE',
      platform: request.platform,
      url: normalizedUrl,
    }), 150000) as any
    if (!scan || scan.type !== 'SCAN_RESULT') throw new Error('页面没有返回有效扫描结果')
    if (scan.linkStatus === 'invalid') throw new Error('文章链接已经失效，未生成快照')

    if (request.platform === 'netease') {
      const threadUrl = neteaseCommentThreadUrl(normalizedUrl)
      await writeClientLog('operation', {
        stage: 'comment-evidence', action: 'netease-thread-page-opening', platform: request.platform,
        url: normalizedUrl, message: '文章信息已读取，正在进入网易完整跟贴页并准备分页截图',
      })
      await navigateTabAndWait(tabId, threadUrl)
    }

    const capture = await captureAccountCommentImagesInTab(tabId, {
      platform: request.platform,
      url: normalizedUrl,
      title: scan.title || '',
      username: scan.username || '',
      beforeCommentCount: Number(scan.commentCount) || 0,
      afterCommentCount: Number(scan.commentCount) || 0,
      expectedComment: String(request.expectedComment || '').trim().slice(0, 2000),
      source: 'manual_scan',
      updateArchiveRun: true,
    })
    await saveRecord({
      platform: request.platform,
      url: normalizedUrl,
      title: scan.title || '',
      commentCount: Math.max(Number(scan.commentCount) || 0, capture.detectedCommentCount || 0),
      checkTime: new Date().toISOString(),
      username: scan.username || '',
      linkStatus: scan.linkStatus || 'active',
      liked: scan.liked,
      collected: scan.collected,
    })
    writeClientLog('operation', {
      stage: 'comment-evidence', action: 'manual-comment-screenshots-finished', platform: request.platform,
      url: normalizedUrl, detectedCommentCount: capture.detectedCommentCount,
      capturedCommentCount: capture.capturedCommentCount, missingCount: capture.missingCount,
      status: capture.status, error: capture.error, message: '当前账号评论截图任务已完成',
    })
    return capture
  } catch (error) {
    const message = String((error as Error)?.message || error)
    writeClientLog('error', {
      stage: 'comment-evidence', action: 'manual-archive-failed', platform: request.platform,
      url: normalizedUrl, code: 'MANUAL_ARCHIVE_FAILED', message,
    })
    return { success: false, error: message }
  } finally {
    if (windowId != null) await chrome.windows.remove(windowId).catch(() => {})
    else if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {})
  }
}

interface AccountCommentImageCaptureOptions {
  platform: Platform
  url: string
  title: string
  username: string
  beforeCommentCount: number
  afterCommentCount: number
  expectedComment?: string
  source: 'automatic_comment' | 'manual_scan'
  updateArchiveRun: boolean
}

const COMMENT_SCREENSHOT_FORMAT_VERSION = 'viewport-v2'

function archiveArticleId(value: string): string {
  try {
    const url = new URL(value)
    return url.pathname.match(/(?:article|item|p|answer|detail)[/_-]?(\d{5,})/i)?.[1]
      || url.pathname.match(/(\d{5,})(?:\/|\.html)?$/)?.[1]
      || url.pathname.replace(/^\/+|\/+$/g, '')
      || url.hostname
  } catch {
    return ''
  }
}

async function saveArchiveRunSummary(summary: CommentArchiveRunSummary): Promise<void> {
  const stored = await chrome.storage.local.get([COMMENT_ARCHIVE_RUNS_KEY, COMMENT_ARCHIVE_RUN_HISTORY_KEY])
  const current = stored[COMMENT_ARCHIVE_RUNS_KEY] && typeof stored[COMMENT_ARCHIVE_RUNS_KEY] === 'object'
    ? stored[COMMENT_ARCHIVE_RUNS_KEY] as Record<string, CommentArchiveRunSummary>
    : {}
  const key = `${summary.platform}:${normalizeArticleUrl(summary.url, summary.platform)}`
  const next = { ...current, [key]: summary }
  const entries = Object.entries(next).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).slice(0, 1000)
  const history = Array.isArray(stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY])
    ? stored[COMMENT_ARCHIVE_RUN_HISTORY_KEY] as CommentArchiveRunSummary[]
    : []
  const nextHistory = [...history.filter(run => run.id !== summary.id), summary]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3000)
  await chrome.storage.local.set({
    [COMMENT_ARCHIVE_RUNS_KEY]: Object.fromEntries(entries),
    [COMMENT_ARCHIVE_RUN_HISTORY_KEY]: nextHistory,
  })
}

async function attachScreenshotDebugger(tabId: number): Promise<void> {
  await chrome.debugger.attach({ tabId }, '1.3')
  await chrome.debugger.sendCommand({ tabId }, 'Page.enable')
  await enableTrustedPageInteraction({ tabId })
}

async function captureCommentNodeImage(
  tabId: number,
): Promise<string> {
  const response = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
    format: 'webp',
    quality: 88,
    fromSurface: true,
    captureBeyondViewport: false,
  }) as { data?: string }
  if (!response?.data) throw new Error('Chrome 没有返回评论截图数据')
  return `data:image/webp;base64,${response.data}`
}

async function settlePageForCommentScreenshot(tabId: number): Promise<void> {
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      let style = document.getElementById('dl-comment-screenshot-stability');
      if (!style) {
        style = document.createElement('style');
        style.id = 'dl-comment-screenshot-stability';
        style.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}';
        (document.head || document.documentElement).appendChild(style);
      }
      setTimeout(resolve, 650);
    })`,
    awaitPromise: true,
    returnByValue: true,
  }).catch(() => new Promise(resolve => setTimeout(resolve, 800)))
}

async function captureAccountCommentImagesInTab(
  tabId: number,
  options: AccountCommentImageCaptureOptions,
): Promise<CaptureUrlArchiveResult> {
  const capturedAt = new Date().toISOString()
  const archiveRunId = `${options.platform}:run:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`
  const normalizedUrl = normalizeArticleUrl(options.url, options.platform)
  await writeClientLog('operation', {
    stage: 'comment-evidence', action: 'capture-session-start', platform: options.platform,
    url: normalizedUrl, expectedCount: options.afterCommentCount,
    exactCommentMode: Boolean(options.expectedComment), message: '开始定位当前账号评论并生成截图',
  })
  const start = await withTimeout(sendContentScriptMessage(tabId, {
    type: 'START_ACCOUNT_COMMENT_CAPTURE',
    platform: options.platform,
    username: options.username,
    expectedComment: options.expectedComment || '',
  }), 20000) as StartAccountCommentCaptureResult
  if (!start?.success) throw new Error(start?.error || '页面未能开始评论截图')
  await writeClientLog('operation', {
    stage: 'comment-evidence', action: 'capture-session-ready', platform: options.platform,
    url: normalizedUrl, rootFound: start.rootFound, modalFound: start.modalFound,
    candidateCount: start.candidateCount, matchingCount: start.matchingCount,
    scrollContainerFound: start.scrollContainerFound, message: '评论截图页面准备完成',
  })

  const existing = (await getAllCommentEvidence()).filter(snapshot => snapshot.archiveFormat === 'image'
    && snapshot.platform === options.platform
    && normalizeArticleUrl(snapshot.url, snapshot.platform) === normalizedUrl
    && Boolean(snapshot.imageDataUrl))
  const existingByKey = new Map(existing.filter(snapshot => snapshot.commentKey)
    .map(snapshot => [snapshot.commentKey!, snapshot]))
  const evidenceIds: string[] = []
  let locatedCommentCount = 0
  let capturedNewCount = 0
  let reusedCount = 0
  let failedCount = 0
  const captureFailureReasons: string[] = []
  let debuggerAttached = false
  let debuggerUnavailable = ''
  const maxTargets = options.expectedComment ? 1 : 1000

  try {
    for (let index = 0; index < maxTargets; index++) {
      const next = await withTimeout(sendContentScriptMessage(tabId, {
        type: 'NEXT_ACCOUNT_COMMENT_CAPTURE',
      }), 15000) as NextAccountCommentCaptureResult
      if (!next?.success) throw new Error(next?.error || '页面评论定位失败')
      if (next.done) {
        await writeClientLog('operation', {
          stage: 'comment-evidence', action: 'comment-locate-finished', platform: options.platform,
          url: normalizedUrl, candidateCount: next.candidateCount,
          matchingCount: next.matchingCount, advanceAttempts: next.advanceAttempts,
          locatedCommentCount, message: '当前账号评论定位结束',
        })
        break
      }
      if (!next.target) continue
      locatedCommentCount++

      const commentKey = `${COMMENT_SCREENSHOT_FORMAT_VERSION}:${options.platform}:${next.target.commentKey}`
      const previous = existingByKey.get(commentKey)
      if (previous?.imageDataUrl) {
        evidenceIds.push(previous.id)
        reusedCount++
        await writeClientLog('operation', {
          stage: 'comment-evidence', action: 'comment-screenshot-reused', platform: options.platform,
          url: normalizedUrl, targetIndex: locatedCommentCount,
          hasCommentId: Boolean(next.target.commentId), message: '已复用当前评论的历史截图',
        })
        continue
      }

      if (!debuggerAttached) {
        try {
          await attachScreenshotDebugger(tabId)
          debuggerAttached = true
          await writeClientLog('operation', {
            stage: 'comment-evidence', action: 'screenshot-debugger-attached', platform: options.platform,
            url: normalizedUrl, message: '页面截图通道已建立',
          })
        } catch (error) {
          debuggerUnavailable = `无法启动页面截图：${String((error as Error)?.message || error)}`
          failedCount++
          await writeClientLog('error', {
            stage: 'comment-evidence', action: 'screenshot-debugger-failed', platform: options.platform,
            url: normalizedUrl, code: 'SCREENSHOT_DEBUGGER_FAILED', message: debuggerUnavailable,
          })
          break
        }
      }

      try {
        // 评论抽屉、弹窗和滚动列表可能仍处于半透明过渡。每次定位后等待页面
        // 完成两帧布局并关闭动画，再截取当前文章标签页的完整可视区域。
        await settlePageForCommentScreenshot(tabId)
        const imageDataUrl = await captureCommentNodeImage(tabId)
        const evidenceId = `${options.platform}:image:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
        const sha256 = await sha256Hex(imageDataUrl)
        const snapshot: CommentEvidenceSnapshot = {
          id: evidenceId,
          createdAt: capturedAt,
          platform: options.platform,
          url: normalizedUrl,
          articleId: archiveArticleId(normalizedUrl),
          title: options.title,
          username: options.username,
          comment: next.target.commentText,
          commentId: next.target.commentId,
          platformDisplayedTime: next.target.platformDisplayedTime,
          beforeCommentCount: options.beforeCommentCount,
          afterCommentCount: options.afterCommentCount,
          capturedItemCount: 1,
          targetFoundInDom: true,
          verificationBasis: 'page_dom',
          source: options.source,
          archiveFormat: 'image',
          imageDataUrl,
          imageMimeType: 'image/webp',
          commentKey,
          archiveRunId,
          sha256,
        }
        await saveCommentEvidence(snapshot)
        existingByKey.set(commentKey, snapshot)
        evidenceIds.push(evidenceId)
        capturedNewCount++
        await writeClientLog('operation', {
          stage: 'comment-evidence', action: 'comment-screenshot-saved', platform: options.platform,
          url: normalizedUrl, targetIndex: locatedCommentCount,
          hasCommentId: Boolean(next.target.commentId), imageBytes: Math.round(imageDataUrl.length * 0.75),
          message: '当前评论截图已生成并写入存档',
        })
      } catch (error) {
        failedCount++
        const failureMessage = String((error as Error)?.message || error).slice(0, 300)
        if (captureFailureReasons.length < 3) {
          captureFailureReasons.push(failureMessage)
        }
        await writeClientLog('error', {
          stage: 'comment-evidence', action: 'comment-screenshot-save-failed', platform: options.platform,
          url: normalizedUrl, targetIndex: locatedCommentCount,
          code: 'COMMENT_SCREENSHOT_SAVE_FAILED', message: failureMessage,
        })
      }
    }
  } finally {
    await sendContentScriptMessage(tabId, { type: 'END_ACCOUNT_COMMENT_CAPTURE' }).catch(() => {})
    if (debuggerAttached) await chrome.debugger.detach({ tabId }).catch(() => {})
  }

  const uniqueEvidenceIds = [...new Set(evidenceIds)]
  const detectedCommentCount = Math.max(0, options.afterCommentCount, locatedCommentCount)
  const capturedCommentCount = uniqueEvidenceIds.length
  const missingCount = Math.max(0, detectedCommentCount - capturedCommentCount)
  const noLocatedComment = locatedCommentCount === 0
  const status: 'complete' | 'incomplete' | 'failed' = debuggerUnavailable && capturedCommentCount === 0
    ? 'failed'
    : missingCount === 0 && failedCount === 0 && (detectedCommentCount === 0 || !noLocatedComment) ? 'complete' : 'incomplete'
  const failureDetail = captureFailureReasons.length ? `；截图错误：${captureFailureReasons.join('；')}` : ''
  const error = debuggerUnavailable || (noLocatedComment
    ? `检测到 ${detectedCommentCount} 条当前账号评论，但评论面板中没有定位到匹配节点。请检查该平台账号设置是否与页面昵称一致，然后重新存档。`
    : status === 'incomplete'
      ? `检测到 ${detectedCommentCount} 条，已保存 ${capturedCommentCount} 条截图，仍缺少 ${missingCount} 条${failureDetail}`
      : undefined)

  if (options.updateArchiveRun) {
    await saveArchiveRunSummary({
      id: archiveRunId,
      createdAt: capturedAt,
      platform: options.platform,
      url: normalizedUrl,
      title: options.title,
      username: options.username,
      detectedCommentCount,
      locatedCommentCount,
      capturedCommentCount,
      capturedNewCount,
      reusedCount,
      failedCount,
      missingCount,
      evidenceIds: uniqueEvidenceIds,
      status,
      error,
    })
  }

  await writeClientLog(status === 'complete' ? 'operation' : 'error', {
    stage: 'comment-evidence', action: 'capture-session-finished', platform: options.platform,
    url: normalizedUrl, detectedCommentCount, locatedCommentCount, capturedCommentCount,
    capturedNewCount, reusedCount, failedCount, missingCount, status,
    code: status === 'complete' ? undefined : 'COMMENT_SCREENSHOT_INCOMPLETE',
    message: error || '当前账号评论截图任务完成',
  })

  return {
    success: true,
    evidenceId: uniqueEvidenceIds[0],
    evidenceIds: uniqueEvidenceIds,
    capturedAt,
    commentCount: detectedCommentCount,
    targetFoundInDom: locatedCommentCount > 0,
    detectedCommentCount,
    locatedCommentCount,
    capturedCommentCount,
    capturedNewCount,
    reusedCount,
    failedCount,
    missingCount,
    status,
    error,
  }
}

/** 处理批量检测请求 */
async function handleBatchScan(urls: string[], port: chrome.runtime.Port, controller: BatchScanController) {
  const prepared = classifyArticleUrls(urls)
  writeClientLog('operation', {
    stage: 'batch-classification',
    action: 'batch-urls-classified',
    count: urls.length,
    validCount: prepared.valid.length,
    invalidCount: prepared.invalid.length,
    thirdPartyCount: prepared.thirdParty.length,
    duplicateCount: prepared.duplicateCount,
    byPlatform: prepared.byPlatform,
    message: '批量链接分类完成',
  })
  for (const invalidUrl of prepared.invalid) {
    writeClientLog('error', {
      stage: 'batch-classification',
      action: 'invalid-article-url',
      code: 'INVALID_ARTICLE_URL',
      url: invalidUrl,
      message: '链接格式无效或不是当前平台支持的文章页',
    })
  }
  const total = prepared.valid.length
  const resultSlots: Array<BatchResultItem | undefined> = new Array(total)
  let nextIndex = 0
  let completed = 0
  let nextStartAt = Date.now()
  const concurrency = Math.min(5, total)
  const startIntervalMs = 2500

  safePost(port, {
    type: 'BATCH_PREPARED',
    total,
    duplicateCount: prepared.duplicateCount,
    invalid: prepared.invalid,
    byPlatform: prepared.byPlatform,
  })

  async function worker() {
    while (!controller.cancelled) {
      const index = nextIndex++
      if (index >= total) return
      const item = prepared.valid[index]

      const now = Date.now()
      const delayMs = Math.max(0, nextStartAt - now)
      nextStartAt = Math.max(now, nextStartAt) + startIntervalMs
      try {
        await cancellableDelay(delayMs, controller)
      } catch (error) {
        if (error instanceof BatchCancelledError) return
        throw error
      }
      if (controller.cancelled) return

      safePost(port, {
        type: 'BATCH_PROGRESS',
        current: index + 1,
        completed,
        total,
        url: item.url,
        platform: item.platform,
      })

      const result = await scanUrlInTab(item.url, controller)
      if (!result) return
      resultSlots[index] = result
      completed += 1
      safePost(port, {
        type: 'BATCH_ITEM_COMPLETE',
        current: index + 1,
        completed,
        total,
        url: item.url,
        result,
      })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const results = resultSlots.filter((item): item is BatchResultItem => item != null)

  safePost(port, controller.cancelled
    ? { type: 'BATCH_CANCELLED', results }
    : { type: 'BATCH_COMPLETE', results })
}

// 监听来自 popup 的连接（用于批量检测）
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'batch-scan') {
    const controller: BatchScanController = {
      cancelled: false,
      activeTabIds: new Set(),
      cancelHandlers: new Set(),
    }
    let running = false

    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'BATCH_CANCEL') {
        writeClientLog('operation', { stage: 'user-action', action: 'batch-scan-cancel', message: '用户停止批量扫描' })
        cancelBatchScan(controller)
      } else if (msg.type === 'BATCH_SCAN' && !running) {
        writeClientLog('operation', { stage: 'user-action', action: 'batch-scan-start', count: msg.urls?.length || 0, message: '用户开始批量扫描' })
        running = true
        await handleBatchScan(msg.urls, port, controller)
        running = false
        writeClientLog('operation', { stage: 'user-action', action: 'batch-scan-finish', message: '批量扫描流程结束' })
      }
    })
    port.onDisconnect.addListener(() => cancelBatchScan(controller))
  }

  if (port.name === 'supplement-tasks') {
    const controller: BatchScanController = {
      cancelled: false,
      activeTabIds: new Set(),
      cancelHandlers: new Set(),
    }
    let running = false
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'SUPPLEMENT_CANCEL') {
        writeClientLog('operation', { stage: 'user-action', action: 'supplement-cancel', message: '用户停止智能补齐' })
        cancelBatchScan(controller)
        await nativeCommand('SAVE_TASK_STATE', { status: 'cancelled', updatedAt: new Date().toISOString() })
      } else if (msg.type === 'SUPPLEMENT_START' && !running) {
        writeClientLog('operation', { stage: 'user-action', action: 'supplement-start', count: msg.items?.length || 0, message: '用户开始智能补齐' })
        running = true
        await handleSupplementTasks(msg.items || [], port, controller)
        running = false
        writeClientLog('operation', { stage: 'user-action', action: 'supplement-finish', message: '智能补齐流程结束' })
      }
    })
    port.onDisconnect.addListener(() => cancelBatchScan(controller))
  }
})

interface SupplementQueueItem {
  url: string
  platform?: Platform
  targetCommentCount: number
  currentCommentCount?: number
  attempt?: number
  actions?: Partial<SupplementActions>
}

const COMMENT_HISTORY_KEY = 'commentPublishHistory'
const COMMENT_TEMPLATES_KEY = 'manualCommentTemplates'
const COMMENT_TEMPLATE_INDEX_KEY = 'manualCommentTemplateIndex'
const COMMENT_TEMPLATE_LAST_INDEX_KEY = 'manualCommentTemplateLastIndex'
const COMMENT_MODE_KEY = 'commentGenerationMode'
const COMMENT_TEMPLATE_SELECTION_KEY = 'manualTemplateSelection'
let commentHistoryWriteQueue: Promise<void> = Promise.resolve()

async function nextManualCommentTemplate(selection: 'sequential' | 'random'): Promise<string> {
  const stored = await chrome.storage.local.get([
    COMMENT_TEMPLATES_KEY,
    COMMENT_TEMPLATE_INDEX_KEY,
    COMMENT_TEMPLATE_LAST_INDEX_KEY,
  ])
  const templates = Array.isArray(stored[COMMENT_TEMPLATES_KEY])
    ? (stored[COMMENT_TEMPLATES_KEY] as unknown[])
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 500)
    : []
  if (!templates.length) return ''

  let index = 0
  if (selection === 'random') {
    const lastIndex = Number(stored[COMMENT_TEMPLATE_LAST_INDEX_KEY])
    if (templates.length === 1) index = 0
    else {
      const safeLastIndex = Number.isInteger(lastIndex) && lastIndex >= 0 && lastIndex < templates.length
        ? lastIndex
        : -1
      const randomOffset = Math.floor(Math.random() * (templates.length - 1)) + 1
      index = safeLastIndex < 0 ? Math.floor(Math.random() * templates.length) : (safeLastIndex + randomOffset) % templates.length
    }
    await chrome.storage.local.set({ [COMMENT_TEMPLATE_LAST_INDEX_KEY]: index })
  } else {
    index = Math.max(0, Number(stored[COMMENT_TEMPLATE_INDEX_KEY]) || 0) % templates.length
    await chrome.storage.local.set({ [COMMENT_TEMPLATE_INDEX_KEY]: (index + 1) % templates.length })
  }
  return templates[index]
}

async function generateComment(message: Extract<ExtensionMessage, { type: 'GENERATE_AI_COMMENT' }>) {
  const preferences = await chrome.storage.local.get([COMMENT_MODE_KEY, COMMENT_TEMPLATE_SELECTION_KEY])
  const configuredMode = preferences[COMMENT_MODE_KEY]
  const selection = preferences[COMMENT_TEMPLATE_SELECTION_KEY] === 'random' ? 'random' : 'sequential'
  if (configuredMode === 'template') {
    const template = await nextManualCommentTemplate(selection)
    if (template) return { success: true, data: { comment: template, source: 'manual-template', selection } }
    return {
      success: false,
      error: '当前选择的是无 Key 模板模式，请先填写并保存评论模板',
      code: 'COMMENT_SOURCE_REQUIRED',
    }
  }

  const config = await nativeCommand<any>('GET_AI_CONFIG')
  // 未保存过模式的旧用户继续沿用原有自动选择，首次打开新版数据中心后会写入明确模式。
  const mode = configuredMode === 'ai'
    ? 'ai'
    : config.success && config.data?.hasApiKey ? 'ai' : 'template'

  if (mode === 'ai') {
    if (!config.success || !config.data?.hasApiKey) {
      return { success: false, error: '当前选择的是 AI 评论模式，请先配置并保存 API Key', code: 'AI_KEY_REQUIRED' }
    }
    const generated = await nativeCommand<any>('GENERATE_COMMENT', {
      platform: message.platform,
      url: normalizeArticleUrl(message.url, message.platform),
      articleText: message.articleText,
    })
    if (!generated.success) return generated
    return { ...generated, data: { ...generated.data, source: 'ai' } }
  }

  const template = await nextManualCommentTemplate(selection)
  if (template) return { success: true, data: { comment: template, source: 'manual-template', selection } }
  return {
    success: false,
    error: '当前选择的是无 Key 模板模式，请先填写并保存评论模板',
    code: 'COMMENT_SOURCE_REQUIRED',
  }
}

function appendCommentHistory(
  result: SupplementResult,
  actions?: Partial<SupplementActions>,
): Promise<void> {
  if (actions?.comment === false) return Promise.resolve()
  const write = async () => {
    const data = await chrome.storage.local.get(COMMENT_HISTORY_KEY)
    const existing = Array.isArray(data[COMMENT_HISTORY_KEY])
      ? data[COMMENT_HISTORY_KEY] as CommentPublishHistoryItem[]
      : []
    const time = new Date().toISOString()
    const verificationStatus: CommentPublishHistoryItem['verificationStatus'] = result.commentPosted
      ? result.afterCommentCount > result.beforeCommentCount ? 'verified' : 'pending'
      : result.status === 'satisfied' || result.afterCommentCount >= result.targetCommentCount
        ? 'verified'
        : 'failed'
    const comments = result.commentTexts?.length ? result.commentTexts : [result.commentText || '']
    const historyItems: CommentPublishHistoryItem[] = comments.map((comment, index) => ({
      id: `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${time}:${index}:${crypto.randomUUID()}`,
      time,
      platform: result.platform,
      url: normalizeArticleUrl(result.url, result.platform),
      title: result.title,
      username: result.username,
      comment,
      verificationStatus,
      failureReason: verificationStatus === 'failed' ? result.error || '本轮未能发布评论' : undefined,
      errorCode: result.errorCode,
      evidenceId: index === comments.length - 1 ? result.evidenceId : undefined,
      evidenceSha256: index === comments.length - 1 ? result.evidenceSha256 : undefined,
      evidenceCapturedAt: index === comments.length - 1 ? result.evidenceCapturedAt : undefined,
      evidenceTargetFound: index === comments.length - 1 ? result.evidenceTargetFound : undefined,
      evidenceError: index === comments.length - 1 ? result.evidenceError : undefined,
      currentPresence: verificationStatus === 'verified' && result.commentPosted ? 'present' : undefined,
      lastVerifiedAt: verificationStatus === 'verified' && result.commentPosted ? time : undefined,
      lastConfirmedPresentAt: verificationStatus === 'verified' && result.commentPosted ? time : undefined,
      lastKnownCommentCount: result.afterCommentCount,
    }))
    const historyIds = new Set(historyItems.map(item => item.id))
    const nextHistory = [...historyItems, ...existing.filter(item => !historyIds.has(item.id))].slice(0, 500)
    await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: nextHistory })
    const confirmed = await chrome.storage.local.get(COMMENT_HISTORY_KEY)
    const confirmedEntries = Array.isArray(confirmed[COMMENT_HISTORY_KEY])
      ? confirmed[COMMENT_HISTORY_KEY] as CommentPublishHistoryItem[]
      : []
    if (!historyItems.every(item => confirmedEntries.some(entry => entry.id === item.id))) {
      await chrome.storage.local.set({ [COMMENT_HISTORY_KEY]: [...historyItems, ...confirmedEntries].slice(0, 500) })
    }
    await writeClientLog('operation', {
      stage: 'comment-history', action: 'comment-history-saved', platform: result.platform,
      url: result.url, historyId: historyItems.map(item => item.id).join(','), commentPosted: result.commentPosted,
      commentPostedCount: comments.length,
      total: Math.min(500, confirmedEntries.length + historyItems.length),
      message: '本次评论任务已写入评论历史',
    })
    await pruneCommentEvidence(nextHistory.map(item => item.evidenceId || '')).catch(() => {})
  }
  const pending = commentHistoryWriteQueue.catch(() => {}).then(write)
  commentHistoryWriteQueue = pending.catch(() => {})
  return pending
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function captureAndSaveCommentEvidence(
  tabId: number,
  result: SupplementResult,
): Promise<void> {
  if (result.platform === 'netease') {
    await navigateTabAndWait(tabId, neteaseCommentThreadUrl(result.url))
  }
  const capture = await captureAccountCommentImagesInTab(tabId, {
    platform: result.platform,
    url: result.url,
    title: result.title,
    username: result.username,
    beforeCommentCount: result.beforeCommentCount,
    afterCommentCount: result.afterCommentCount,
    expectedComment: result.commentText || '',
    source: result.commentPosted ? 'automatic_comment' : 'manual_scan',
    updateArchiveRun: true,
  })
  if (!capture.evidenceId) {
    if (capture.detectedCommentCount === 0) return
    throw new Error(capture.error || '未能定位并截取当前账号评论')
  }
  const snapshot = await getCommentEvidence(capture.evidenceId)
  if (!snapshot) throw new Error('新评论截图保存后无法读取')
  result.evidenceId = snapshot.id
  result.evidenceSha256 = snapshot.sha256
  result.evidenceCapturedAt = snapshot.createdAt
  result.evidenceTargetFound = true
  // 截图在网易完整跟贴页完成后，操作页必须回到原文章页。
  // 下一条任务依赖文章页的账号、点赞/收藏和评论控件，不能把跟贴页当作可复用页面。
  if (result.platform === 'netease') {
    await navigateTabAndWait(tabId, normalizeArticleUrl(result.url, result.platform))
  }
}

function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs))
}

interface SupplementOperationSurface {
  windowId?: number
  tabId?: number
  currentUrl?: string
}

async function waitForOperationTabLoad(
  tabId: number,
  controller: BatchScanController,
  settleDelay = 1250,
): Promise<void> {
  const current = await chrome.tabs.get(tabId)
  if (current.status === 'complete') {
    await cancellableDelay(settleDelay, controller)
    return
  }
  await withBatchCancellation(new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timeoutId)
      resolve()
    }
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') setTimeout(finish, settleDelay)
    }
    const timeoutId = setTimeout(finish, 20000)
    chrome.tabs.onUpdated.addListener(listener)
  }), controller)
}

async function ensureSupplementOperationSurface(
  surface: SupplementOperationSurface,
  url: string,
  controller: BatchScanController,
): Promise<{ tabId: number; reused: boolean }> {
  const operationWidth = detectPlatform(url) === 'csdn' ? 1100 : 760
  if (surface.tabId == null || surface.windowId == null) {
    const created = await chrome.windows.create({
      url,
      type: 'popup',
      focused: false,
      width: operationWidth,
      height: 860,
    })
    if (!created) throw new Error('无法创建独立操作窗口')
    const tab = created.tabs?.[0] || (created.id != null ? (await chrome.tabs.query({ windowId: created.id }))[0] : undefined)
    if (created.id == null || tab?.id == null) throw new Error('无法创建独立操作窗口')
    surface.windowId = created.id
    surface.tabId = tab.id
    surface.currentUrl = url
    controller.activeTabIds.add(tab.id)
    await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false })
    await waitForOperationTabLoad(tab.id, controller)
    await writeClientLog('operation', {
      stage: 'page-action', action: 'operation-window-created', url,
      message: '已创建不抢焦点的独立操作窗口，任务页面将在其中持续运行',
    })
    return { tabId: tab.id, reused: false }
  }

  const windowState = await chrome.windows.get(surface.windowId).catch(() => null)
  if (!windowState) {
    controller.activeTabIds.delete(surface.tabId)
    surface.windowId = undefined
    surface.tabId = undefined
    surface.currentUrl = undefined
    return ensureSupplementOperationSurface(surface, url, controller)
  }
  if (windowState.state === 'minimized') {
    await chrome.windows.update(surface.windowId, { state: 'normal', focused: false }).catch(() => {})
    await writeClientLog('operation', {
      stage: 'page-action', action: 'operation-window-restored', url,
      message: '检测到操作窗口已最小化，已恢复窗口以继续页面渲染',
    })
  }
  if (detectPlatform(url) === 'csdn' && Number(windowState.width || 0) < operationWidth) {
    await chrome.windows.update(surface.windowId, { width: operationWidth, focused: false }).catch(() => {})
    await writeClientLog('operation', {
      stage: 'page-action', action: 'operation-window-widened', platform: 'csdn', url,
      width: operationWidth,
      message: '已将CSDN操作窗口切换为桌面宽度，避免响应式页面隐藏评论入口',
    })
  }

  const tab = await chrome.tabs.get(surface.tabId).catch(() => null)
  if (!tab) {
    controller.activeTabIds.delete(surface.tabId)
    surface.windowId = undefined
    surface.tabId = undefined
    surface.currentUrl = undefined
    return ensureSupplementOperationSurface(surface, url, controller)
  }
  await chrome.tabs.update(surface.tabId, { active: true, autoDiscardable: false })
  const actualPlatform = detectPlatform(tab.url || '')
  const actualUrl = actualPlatform ? normalizeArticleUrl(tab.url || '', actualPlatform) : ''
  if (surface.currentUrl === url && actualUrl === url && !tab.discarded) {
    return { tabId: surface.tabId, reused: true }
  }

  surface.currentUrl = url
  await chrome.tabs.update(surface.tabId, { url, active: true, autoDiscardable: false })
  await waitForOperationTabLoad(surface.tabId, controller)
  return { tabId: surface.tabId, reused: false }
}

async function closeSupplementOperationSurface(
  surface: SupplementOperationSurface,
  controller: BatchScanController,
): Promise<void> {
  if (surface.tabId != null) controller.activeTabIds.delete(surface.tabId)
  if (surface.windowId != null) await chrome.windows.remove(surface.windowId).catch(() => {})
  else if (surface.tabId != null) await chrome.tabs.remove(surface.tabId).catch(() => {})
  surface.windowId = undefined
  surface.tabId = undefined
  surface.currentUrl = undefined
}

async function scanUrlInSupplementSurface(
  item: SupplementQueueItem,
  controller: BatchScanController,
  surface: SupplementOperationSurface,
): Promise<BatchResultItem> {
  const platform = item.platform || detectPlatform(item.url)
  if (!platform || platform === 'third_party') {
    return { platform: 'third_party', url: item.url, commentCount: 0, title: '', error: '无法识别的平台' }
  }
  const url = normalizeArticleUrl(item.url, platform)
  try {
    const operationPage = await ensureSupplementOperationSurface(surface, url, controller)
    await cancellableDelay(operationPage.reused ? 300 : 1250, controller)
    const result = await withBatchCancellation(withTimeout(sendContentScriptMessage<any>(operationPage.tabId, {
      type: 'SCAN_PAGE', platform, url,
    }), 150000), controller)
    if (result?.type !== 'SCAN_RESULT') {
      return { platform, url, commentCount: 0, title: '', error: '未获取到统一复扫结果' }
    }
    return {
      platform: result.platform,
      url: normalizeArticleUrl(result.url, result.platform),
      commentCount: Number(result.commentCount) || 0,
      title: result.title || '',
      linkStatus: result.linkStatus || 'active',
      username: result.username || '',
      accountStatus: result.accountStatus,
      liked: result.liked,
      collected: result.collected,
      diagnostics: result.diagnostics,
    }
  } catch (error) {
    if (error instanceof BatchCancelledError) throw error
    return { platform, url, commentCount: 0, title: '', error: String((error as Error)?.message || error) }
  }
}

async function supplementUrlInTab(
  item: SupplementQueueItem,
  controller: BatchScanController,
  surface: SupplementOperationSurface,
  reportProgress?: (status: string, stagePercent: number, etaSeconds?: number) => void,
): Promise<SupplementResult | null> {
  const platform = item.platform || detectPlatform(item.url)
  if (!platform) return null
  const url = normalizeArticleUrl(item.url, platform)
  let tabId: number | undefined
  try {
    if (controller.cancelled) throw new BatchCancelledError()
    reportProgress?.('正在准备独立操作窗口', 8, 25)
    const operationPage = await ensureSupplementOperationSurface(surface, url, controller)
    tabId = operationPage.tabId
    reportProgress?.(
      operationPage.reused ? '正在复用当前文章页面，无需重新加载' : '文章页已打开，等待页面控件加载',
      18,
      operationPage.reused ? 3 : 18,
    )
    await cancellableDelay(operationPage.reused ? 150 : platform === 'zhihu' ? 600 : 300, controller)

    const actionStatus = item.actions?.comment !== false
      ? '正在预检账号并生成评论，随后将完成发布验证'
      : item.actions?.like !== false && item.actions?.collect !== false
        ? '正在检测并执行点赞、收藏'
        : item.actions?.like !== false
          ? '正在检测并执行点赞'
          : '正在检测并执行收藏'
    reportProgress?.(actionStatus, 42, item.actions?.comment !== false ? 38 : 18)

    const result = await withBatchCancellation(withTimeout(
      chrome.tabs.sendMessage(tabId, {
        type: 'SUPPLEMENT_PAGE', platform, url,
        targetCommentCount: Math.max(0, Math.min(10, Math.floor(item.targetCommentCount))),
        actions: item.actions,
      }),
      150000,
    ), controller) as SupplementResult
    const shouldCaptureScreenshot = item.actions?.screenshot === true
      || (item.actions?.comment !== false
        && result?.commentPosted
        && result.afterCommentCount > result.beforeCommentCount
        && Boolean(result.commentText))

    if (result?.type === 'SUPPLEMENT_RESULT' && shouldCaptureScreenshot) {
      reportProgress?.('正在执行当前评论截图存档…', 97, 2)
      try {
        await captureAndSaveCommentEvidence(tabId, result)
        writeClientLog('operation', {
          stage: 'comment-evidence', action: 'evidence-saved', platform, url,
          evidenceId: result.evidenceId, sha256: result.evidenceSha256,
          targetFoundInDom: result.evidenceTargetFound,
          message: '评论截图已保存',
        })
      } catch (error) {
        result.evidenceError = String((error as Error)?.message || error)
        writeClientLog('error', {
          stage: 'comment-evidence', action: 'evidence-save-failed', platform, url,
          code: 'COMMENT_EVIDENCE_FAILED', message: result.evidenceError,
        })
      }
    }
    reportProgress?.('页面操作已结束，正在保存并更新扫描记录', 99, 1)
    return result?.type === 'SUPPLEMENT_RESULT' ? result : null
  } catch (error) {
    if (error instanceof BatchCancelledError) return null
    return {
      type: 'SUPPLEMENT_RESULT', platform, url, title: '', username: '',
      targetCommentCount: item.targetCommentCount, beforeCommentCount: 0, afterCommentCount: 0,
      commentPosted: false, liked: null, collected: null, accountStatus: 'unknown', status: 'failed',
      error: String((error as Error)?.message || error), errorCode: 'TAB_TASK_FAILED',
    }
  } finally {}
}

async function persistSupplementOutcome(
  result: SupplementResult,
  item: SupplementQueueItem,
): Promise<void> {
  result.requestedActions = item.actions
  const storedResults = await chrome.storage.local.get('lastSupplementResults')
  const previousResults = Array.isArray(storedResults.lastSupplementResults)
    ? storedResults.lastSupplementResults as SupplementResult[]
    : []
  const resultKey = `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${item.actions?.comment ? 'comment' : item.actions?.like ? 'like' : 'collect'}`
  const nextResults = previousResults.filter(previous => {
    const previousKey = `${previous.platform}:${normalizeArticleUrl(previous.url, previous.platform)}:${previous.requestedActions?.comment ? 'comment' : previous.requestedActions?.like ? 'like' : 'collect'}`
    return previousKey !== resultKey
  })
  nextResults.push(result)
  await chrome.storage.local.set({ lastSupplementResults: nextResults.slice(-200) })
  await appendCommentHistory(result, item.actions)
  const updatedRecord: Omit<CommentRecord, 'id'> = {
    platform: result.platform,
    url: result.url,
    title: result.title,
    commentCount: result.afterCommentCount,
    checkTime: new Date().toISOString(),
    username: result.username,
    linkStatus: result.errorCode === 'PAGE_INVALID' ? 'invalid' : 'active',
    targetCommentCount: result.targetCommentCount,
    actionStatus: result.status,
    lastActionTime: new Date().toISOString(),
    lastErrorCode: result.errorCode,
  }
  if (typeof result.liked === 'boolean') updatedRecord.liked = result.liked
  if (typeof result.collected === 'boolean') updatedRecord.collected = result.collected
  await saveRecord(updatedRecord)
  await writeClientLog(result.error ? 'error' : 'operation', {
    taskId: `${item.platform}:${item.url}`,
    platform: result.platform,
    url: result.url,
    username: result.username,
    stage: 'supplement',
    targetCommentCount: result.targetCommentCount,
    beforeCommentCount: result.beforeCommentCount,
    afterCommentCount: result.afterCommentCount,
    commentPosted: result.commentPosted,
    likePerformed: result.likePerformed,
    collectPerformed: result.collectPerformed,
    liked: result.liked,
    collected: result.collected,
    status: result.status,
    code: result.errorCode,
    message: result.error || '本轮操作完成',
  })
}

async function handleSupplementTasks(
  rawItems: SupplementQueueItem[],
  port: chrome.runtime.Port,
  controller: BatchScanController,
) {
  // 纯插件模式下所有配置、日志、AI 请求和任务状态都由扩展 Service Worker 处理。
  await nativeCommand('HELLO')

  const normalizedItems = rawItems
    .map(item => ({
      ...item,
      platform: item.platform || detectPlatform(item.url) || undefined,
      url: normalizeArticleUrl(item.url, item.platform || detectPlatform(item.url)),
      targetCommentCount: Math.max(0, Math.min(10, Math.floor(Number(item.targetCommentCount) || 0))),
      currentCommentCount: Math.max(0, Math.floor(Number(item.currentCommentCount) || 0)),
      actions: {
        comment: item.actions?.comment !== false,
        like: item.actions?.like !== false,
        collect: item.actions?.collect !== false,
        screenshot: item.actions?.screenshot === true,
      },
      attempt: 0,
    }))
    .filter(item => item.platform)
  const uniqueItems = [...new Map(normalizedItems.map(item => [`${item.platform}:${item.url}`, item])).values()]
  // 只要包含非评论任务（如点赞、收藏、截图），或者评论数尚未达标，均入队执行
  const queue = uniqueItems.filter(item => item.actions.comment === false
    || item.actions.like === true
    || item.actions.collect === true
    || item.actions.screenshot === true
    || item.targetCommentCount > item.currentCommentCount)
  const results: SupplementResult[] = []
  let total = queue.length
  let completedActions = 0
  const lastPlatformActionAt = new Map<Platform, number>()
  let lastGlobalActionAt = 0
  let riskPaused = false
  const operationSurface: SupplementOperationSurface = {}

  await nativeCommand('SAVE_TASK_STATE', {
    status: 'running', items: queue, startedAt: new Date().toISOString(), completedActions: 0,
  })
  safePost(port, { type: 'SUPPLEMENT_PREPARED', total })

  while (queue.length && !controller.cancelled) {
    const item = queue.shift()!
    const key = `${item.platform}:${item.url}`
    const platform = item.platform!
    const isCommentTask = item.actions?.comment !== false
    const current = completedActions + 1
    const reportProgress = (status: string, stagePercent: number, etaSeconds?: number) => {
      const normalizedStage = Math.max(0, Math.min(99, Math.round(stagePercent)))
      const percent = total > 0
        ? Math.min(99, Math.round(((completedActions + normalizedStage / 100) / total) * 100))
        : 0
      const progress = {
        type: 'SUPPLEMENT_PROGRESS', completed: completedActions, pending: queue.length + 1,
        current, total, percent, stagePercent: normalizedStage, etaSeconds,
        url: item.url, platform, status,
      }
      safePost(port, progress)
      return progress
    }
    const now = Date.now()
    // 连续补齐加速：评论之间随机等待 1.5-4 秒；点赞和收藏继续使用原有冷却节奏。
    const commentGap = randomDelay(1500, 4001)
    const platformGap = isCommentTask ? commentGap : randomDelay(12000, 22000)
    const globalGap = isCommentTask ? commentGap : randomDelay(7000, 13000)
    const cooldownDelay = Math.max(
      0,
      (lastPlatformActionAt.get(platform) || 0) + platformGap - now,
      lastGlobalActionAt + globalGap - now,
    )
    if (cooldownDelay > 0) {
      const cooldownEndsAt = Date.now() + cooldownDelay
      while (!controller.cancelled) {
        const remaining = cooldownEndsAt - Date.now()
        if (remaining <= 0) break
        const progress = reportProgress(isCommentTask ? '随机间隔中，可随时停止' : '安全冷却中，任务仍在运行', 0, Math.ceil(remaining / 1000))
        await nativeCommand('SAVE_TASK_STATE', {
          status: 'running', progress, updatedAt: new Date().toISOString(), completedActions,
        })
        await cancellableDelay(Math.min(5000, remaining), controller).catch(() => {})
      }
    }
    if (controller.cancelled) break

    reportProgress('正在打开文章并执行安全预检', 5, isCommentTask ? 45 : 22)
    const result = await supplementUrlInTab(item, controller, operationSurface, reportProgress)
    if (!result) break
    const finishedAt = Date.now()
    lastPlatformActionAt.set(platform, finishedAt)
    lastGlobalActionAt = finishedAt
    results.push(result)
    completedActions++
    result.requestedActions = item.actions
    const storedResults = await chrome.storage.local.get('lastSupplementResults')
    const previousResults = Array.isArray(storedResults.lastSupplementResults)
      ? storedResults.lastSupplementResults as SupplementResult[]
      : []
    const resultKey = `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}:${item.actions.comment ? 'comment' : item.actions.like ? 'like' : 'collect'}`
    const nextResults = previousResults.filter(previous => {
      const previousKey = `${previous.platform}:${normalizeArticleUrl(previous.url, previous.platform)}:${previous.requestedActions?.comment ? 'comment' : previous.requestedActions?.like ? 'like' : 'collect'}`
      return previousKey !== resultKey
    })
    nextResults.push(result)
    await chrome.storage.local.set({ lastSupplementResults: nextResults.slice(-200) })
    await appendCommentHistory(result, item.actions)
    const updatedRecord: Omit<CommentRecord, 'id'> = {
      platform: result.platform,
      url: result.url,
      title: result.title,
      commentCount: result.afterCommentCount,
      checkTime: new Date().toISOString(),
      username: result.username,
      linkStatus: result.errorCode === 'PAGE_INVALID' ? 'invalid' : 'active',
      targetCommentCount: result.targetCommentCount,
      actionStatus: result.status,
      lastActionTime: new Date().toISOString(),
      lastErrorCode: result.errorCode,
    }
    if (typeof result.liked === 'boolean') updatedRecord.liked = result.liked
    if (typeof result.collected === 'boolean') updatedRecord.collected = result.collected
    await saveRecord(updatedRecord)

    const logEntry = {
      taskId: key,
      platform: result.platform,
      url: result.url,
      username: result.username,
      stage: 'supplement',
      targetCommentCount: result.targetCommentCount,
      beforeCommentCount: result.beforeCommentCount,
      afterCommentCount: result.afterCommentCount,
      commentPosted: result.commentPosted,
      likePerformed: result.likePerformed,
      collectPerformed: result.collectPerformed,
      liked: result.liked,
      collected: result.collected,
      status: result.status,
      code: result.errorCode,
      message: result.error || '本轮操作完成',
    }
    writeClientLog(result.error ? 'error' : 'operation', logEntry)

    if (result.errorCode === 'AUTH_REQUIRED' || result.errorCode === 'ACCOUNT_MISMATCH') {
      notifyAttention('智能补齐已暂停', `${PlatformLabelSafe(result.platform)}：${result.error}`)
    }
    if (result.errorCode === 'RISK_CONTROL_BLOCKED') {
      riskPaused = true
      queue.splice(0)
      notifyAttention('检测到平台风控，任务已暂停', `${PlatformLabelSafe(result.platform)}：${result.error}`)
      safePost(port, { type: 'SUPPLEMENT_RISK_PAUSED', result })
    }
    if (isCommentTask && !riskPaused) {
      const commentConfirmed = result.commentPosted
        && result.afterCommentCount > result.beforeCommentCount
        && !result.errorCode
      const targetReached = result.afterCommentCount >= item.targetCommentCount
      if (!commentConfirmed || targetReached) {
        const queueLengthBefore = queue.length
        for (let index = queue.length - 1; index >= 0; index--) {
          const queued = queue[index]
          if (queued.platform === item.platform && queued.url === item.url && queued.actions?.comment !== false) {
            queue.splice(index, 1)
          }
        }
        total -= queueLengthBefore - queue.length
      }
    }
    safePost(port, {
      type: 'SUPPLEMENT_ITEM_COMPLETE', completed: completedActions, current: completedActions,
      total, percent: total > 0 ? Math.round((completedActions / total) * 100) : 100, result,
    })

    await nativeCommand('SAVE_TASK_STATE', {
      status: 'running', pending: queue, latestResult: result,
      updatedAt: new Date().toISOString(), completedActions,
    })
    if (riskPaused) break
  }

  let finalVerificationResults: BatchResultItem[] = []
  const runFinalRescan = async (phase: 'before_retry' | 'after_retry') => {
    safePost(port, { type: 'SUPPLEMENT_FINAL_RESCAN_START', total: uniqueItems.length, phase })
    const scanned: BatchResultItem[] = []
    for (const item of uniqueItems) {
      if (controller.cancelled) break
      const verified = await scanUrlInSupplementSurface(item, controller, operationSurface)
      scanned.push(verified)
      if (!verified.error) {
        await saveRecord({
          platform: verified.platform,
          url: normalizeArticleUrl(verified.url, verified.platform),
          title: verified.title,
          commentCount: verified.commentCount,
          checkTime: new Date().toISOString(),
          username: verified.username || '',
          linkStatus: verified.linkStatus || 'active',
          liked: verified.liked,
          collected: verified.collected,
        })
      }
      safePost(port, { type: 'SUPPLEMENT_FINAL_RESCAN_ITEM', result: verified, phase })
    }
    safePost(port, { type: 'SUPPLEMENT_FINAL_RESCAN_COMPLETE', results: scanned, phase })
    return scanned
  }

  // 所有动作结束后统一复扫；仅对页面明确返回的缺项补做一次，再做最终复扫。
  // 评论仍逐条发布并逐条确认，任一次未确认会停止该链接的后续重试。
  if (!controller.cancelled && !riskPaused && uniqueItems.length > 0) {
    const firstVerification = await runFinalRescan('before_retry')
    const requestedByKey = new Map(uniqueItems.map(item => [`${item.platform}:${item.url}`, item]))
    // 本轮已在本链接点过“发表”的，无论平台列表是否已同步，都不能再自动补发评论：
    // 复扫数量落后于页面（接口同步慢、账号昵称识别偏差）时重复补发会变成刷屏评论。
    const postedCommentKeys = new Set(
      results
        .filter(result => result.commentPosted)
        .map(result => `${result.platform}:${normalizeArticleUrl(result.url, result.platform)}`),
    )
    const retryQueue: SupplementQueueItem[] = []
    for (const verified of firstVerification) {
      if (verified.error || verified.linkStatus === 'invalid' || verified.accountStatus !== 'logged_in') continue
      const key = `${verified.platform}:${normalizeArticleUrl(verified.url, verified.platform)}`
      const requested = requestedByKey.get(key)
      if (!requested) continue
      const missingComments = requested.actions?.comment === false
        ? 0
        : Math.max(0, requested.targetCommentCount - verified.commentCount)
      const missingLike = verified.platform !== 'netease' && requested.actions?.like !== false && verified.liked === false
      const missingCollect = verified.platform !== 'netease' && requested.actions?.collect !== false && verified.collected === false
      const commentsAlreadyPosted = postedCommentKeys.has(key)
      if (missingComments > 0 && commentsAlreadyPosted) {
        safePost(port, {
          type: 'SUPPLEMENT_RETRY_PROGRESS', url: requested.url, platform: requested.platform,
          status: '本轮已发表评论，复扫数量暂未同步；已跳过重复发布',
        })
        await writeClientLog('operation', {
          stage: 'supplement', action: 'supplement-comment-retry-skipped', platform: verified.platform,
          url: requested.url, commentCount: verified.commentCount, targetCommentCount: requested.targetCommentCount,
          message: '本轮已提交过评论但复扫数量未同步，为避免重复评论已跳过自动补发；请稍后重新扫描确认',
        })
      }
      if (missingComments > 0 && !commentsAlreadyPosted) {
        retryQueue.push({
          ...requested,
          currentCommentCount: verified.commentCount,
          attempt: 1,
          actions: { comment: true, like: missingLike, collect: missingCollect },
        })
      } else if (missingLike || missingCollect) {
        retryQueue.push({
          ...requested,
          currentCommentCount: verified.commentCount,
          actions: { comment: false, like: missingLike, collect: missingCollect },
        })
      }
    }

    const stoppedRetryUrls = new Set<string>()
    for (const item of retryQueue) {
      if (controller.cancelled || riskPaused) break
      const key = `${item.platform}:${item.url}`
      if (stoppedRetryUrls.has(key)) continue
      safePost(port, { type: 'SUPPLEMENT_RETRY_PROGRESS', url: item.url, platform: item.platform, status: '统一复扫确认缺项，正在补做' })
      await cancellableDelay(item.actions?.comment === false ? 1000 : randomDelay(1500, 4001), controller)
      const retryResult = await supplementUrlInTab(item, controller, operationSurface)
      if (!retryResult) break
      results.push(retryResult)
      completedActions++
      await persistSupplementOutcome(retryResult, item)
      safePost(port, { type: 'SUPPLEMENT_ITEM_COMPLETE', completed: completedActions, result: retryResult, retry: true })
      if (retryResult.errorCode === 'RISK_CONTROL_BLOCKED') {
        riskPaused = true
        notifyAttention('检测到平台风控，任务已暂停', `${PlatformLabelSafe(retryResult.platform)}：${retryResult.error}`)
        break
      }
      if (item.actions?.comment !== false) {
        const confirmed = retryResult.commentPosted
          && retryResult.afterCommentCount > retryResult.beforeCommentCount
          && !retryResult.errorCode
        if (!confirmed || retryResult.afterCommentCount >= item.targetCommentCount) stoppedRetryUrls.add(key)
      }
    }

    finalVerificationResults = retryQueue.length > 0 && !controller.cancelled && !riskPaused
      ? await runFinalRescan('after_retry')
      : firstVerification
    await nativeCommand('SAVE_TASK_STATE', {
      status: riskPaused ? 'attention_required' : 'verified',
      finalResults: finalVerificationResults,
      updatedAt: new Date().toISOString(),
      completedActions,
    })
    await writeClientLog('operation', {
      stage: 'supplement', action: 'final-rescan-finished', count: finalVerificationResults.length,
      retryCount: retryQueue.length,
      message: '全部互动完成后已统一复扫、补做明确缺项并完成最终复扫',
    })
  }

  const finalStatus = controller.cancelled ? 'cancelled' : riskPaused ? 'attention_required' : 'complete'
  await closeSupplementOperationSurface(operationSurface, controller)
  await nativeCommand('SAVE_TASK_STATE', {
    status: finalStatus, results, finalResults: finalVerificationResults,
    updatedAt: new Date().toISOString(), completedActions,
  })
  safePost(port, { type: controller.cancelled ? 'SUPPLEMENT_CANCELLED' : 'SUPPLEMENT_COMPLETE', results })
}

function PlatformLabelSafe(platform: Platform): string {
  const labels: Record<Platform, string> = {
    csdn: 'CSDN', zhihu: '知乎', toutiao: '今日头条', baijiahao: '百家号', netease: '网易', sohu: '搜狐', third_party: '第三方平台',
  }
  return labels[platform]
}

function validViewportPoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y)
    && point.x >= 0 && point.y >= 0 && point.x <= 10000 && point.y <= 10000
}

async function sendDebuggerCommand<T = unknown>(
  target: chrome.debugger.Debuggee,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  return await chrome.debugger.sendCommand(target, method, params) as T
}

/**
 * 独立操作窗口不抢用户焦点时，部分受控编辑器会忽略滚动、focus 或真实输入。
 * CDP 焦点模拟只影响当前操作页，不会把窗口切到用户面前。
 */
async function enableTrustedPageInteraction(target: chrome.debugger.Debuggee): Promise<void> {
  await sendDebuggerCommand(target, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  await sendDebuggerCommand(target, 'Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
}

interface ToutiaoControlSnapshot {
  editorPoint?: { x: number; y: number }
  buttonPoint?: { x: number; y: number }
  editorLength: number
  buttonDisabled: boolean
  buttonClass: string
  viewportWidth: number
  viewportHeight: number
}

function pointInsideToutiaoViewport(
  point: { x: number; y: number } | undefined,
  snapshot: ToutiaoControlSnapshot,
): point is { x: number; y: number } {
  return Boolean(point && validViewportPoint(point)
    && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight)
}

async function readToutiaoControls(target: chrome.debugger.Debuggee): Promise<ToutiaoControlSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: ToutiaoControlSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="评论"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttonRoot = mainInput || root;
      const buttons = Array.from(buttonRoot.querySelectorAll('button.submit-btn, button')).filter(isVisible);
      const button = buttons.find(item => /^(评论|发布|发表|发送)$/.test((item.textContent || '').trim())) || buttons[0];
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      const buttonClass = button instanceof HTMLElement ? String(button.className || '') : '';
      return {
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorLength: editor ? (editor.textContent || '').trim().length : 0,
        buttonDisabled: button instanceof HTMLButtonElement
          ? button.disabled || /(^|\\s)disable(?:d)?(\\s|$)/i.test(buttonClass) || button.getAttribute('aria-disabled') === 'true'
          : true,
        buttonClass,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取今日头条评论控件失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || {
    editorLength: 0, buttonDisabled: true, buttonClass: '', viewportWidth: 0, viewportHeight: 0,
  }
}

async function prepareToutiaoEditor(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    // 与 Playwright locator.fill() 对 contenteditable 的准备步骤一致：先 focus，
    // 再选中编辑器全部内容，随后由浏览器 Input.insertText 写入。
    expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="评论"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      if (!(editor instanceof HTMLElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      const selection = editor.ownerDocument.defaultView.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return editor.ownerDocument.activeElement === editor;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`准备今日头条评论输入框失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function scrollToutiaoSubmitButtonIntoView(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="评论"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttons = mainInput ? Array.from(mainInput.querySelectorAll('button.submit-btn, button')).filter(isVisible) : [];
      const button = buttons.find(item => /^(评论|发布|发表|发送)$/.test((item.textContent || '').trim())) || buttons[0];
      if (!(button instanceof HTMLButtonElement)) return false;
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return true;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`滚动到今日头条评论按钮失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function typeTrustedCommentByKey(
  target: chrome.debugger.Debuggee,
  comment: string,
): Promise<void> {
  for (const character of Array.from(comment)) {
    await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: character, text: character, unmodifiedText: character,
    })
    await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: character,
    })
    await new Promise(resolve => setTimeout(resolve, 24 + Math.floor(Math.random() * 28)))
  }
}

async function nudgeControlledInput(target: chrome.debugger.Debuggee): Promise<void> {
  // Playwright 实测：整段 insertText 虽会显示中文，但今日头条不会更新受控状态；
  // 一个带完整 code/keyCode 的标准键盘输入会触发页面状态同步。随后立即退格，
  // 保证最终评论内容不被修改。
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a',
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
  })
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA',
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
  })
  await new Promise(resolve => setTimeout(resolve, 120))
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Backspace', code: 'Backspace',
    windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
  })
  await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Backspace', code: 'Backspace',
    windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
  })
}

async function operateToutiaoSubmitButton(
  target: chrome.debugger.Debuggee,
  operation: 'click' | 'focus',
): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const roots = Array.from(document.querySelectorAll('[role="dialog"][aria-label="评论"], div.ttp-portal-wrapper, .ttp-drawer[role="dialog"], .ttp-drawer')).filter(isVisible);
      const root = roots.at(-1) || document;
      const editor = Array.from(root.querySelectorAll('.ttp-comment-wrapper.small > .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], .main-input > .ttp-comment-input > .comment-textarea[contenteditable="true"], div.comment-textarea[contenteditable="true"]')).find(isVisible);
      const mainInput = editor ? editor.closest('.main-input') : null;
      const buttons = mainInput ? Array.from(mainInput.querySelectorAll('button.submit-btn, button')).filter(isVisible) : [];
      const button = buttons.find(item => /^(评论|发布|发表|发送)$/.test((item.textContent || '').trim())) || buttons[0];
      if (!(button instanceof HTMLButtonElement)) return false;
      ${operation === 'click' ? 'button.click();' : 'button.focus();'}
      return true;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`操作今日头条评论按钮失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function dispatchTrustedClick(
  target: chrome.debugger.Debuggee,
  point: { x: number; y: number },
): Promise<void> {
  await sendDebuggerCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y,
  })
  await sendDebuggerCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y,
    button: 'left', buttons: 1, clickCount: 1,
  })
  await new Promise(resolve => setTimeout(resolve, 90))
  await sendDebuggerCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y,
    button: 'left', buttons: 0, clickCount: 1,
  })
}

/**
 * 今日头条会忽略非受信任的 contenteditable 输入事件。仅对当前 Toutiao 文章页
 * 临时附加调试通道，发送一次真实点击、文本输入和发布点击，完成后立即断开。
 */
async function trustedToutiaoComment(
  tabId: number,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const comment = String(text || '').trim()
  if (!comment || comment.length > 500) return { success: false, error: '评论内容为空或超过 500 字' }

  const tab = await chrome.tabs.get(tabId)
  let pageUrl: URL
  try {
    pageUrl = new URL(tab.url || '')
  } catch {
    return { success: false, error: '无法确认今日头条页面地址' }
  }
  if (!/(^|\.)toutiao\.com$/i.test(pageUrl.hostname) || !/\/(?:article|item)\//.test(pageUrl.pathname)) {
    return { success: false, error: '受信任输入只允许用于今日头条文章页' }
  }

  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    await enableTrustedPageInteraction(target)

    // 今日头条既有固定抽屉评论框，也有正文下方的离屏评论框。先滚动到当前
    // 编辑器，再读取视口坐标；不能把页面纵向位置当作可点击的视口坐标。
    let initial: ToutiaoControlSnapshot | undefined
    for (let attempt = 0; attempt < 40; attempt++) {
      await prepareToutiaoEditor(target)
      await new Promise(resolve => setTimeout(resolve, attempt < 4 ? 180 : 300))
      initial = await readToutiaoControls(target)
      // 新版正文评论框必须先收到一次受信任点击，才允许真正获得焦点。
      // 因此初次定位只要求控件进入视口，不能在点击前强制要求 activeElement 已切换。
      if (pointInsideToutiaoViewport(initial.editorPoint, initial)) break
    }
    if (!initial || !pointInsideToutiaoViewport(initial.editorPoint, initial)) {
      await writeClientLog('error', {
        stage: 'page-action', action: 'toutiao-editor-not-found', platform: 'toutiao',
        url: pageUrl.toString(), code: 'TOUTIAO_EDITOR_NOT_FOUND',
        viewportWidth: initial?.viewportWidth, viewportHeight: initial?.viewportHeight,
        message: '今日头条评论输入框未进入当前操作视口',
      })
      return { success: false, error: '今日头条评论输入框未进入当前操作视口' }
    }
    await dispatchTrustedClick(target, initial.editorPoint)
    await new Promise(resolve => setTimeout(resolve, 180))
    if (!await prepareToutiaoEditor(target)) {
      return { success: false, error: '今日头条评论输入框无法获得焦点' }
    }
    await new Promise(resolve => setTimeout(resolve, 120))
    await sendDebuggerCommand(target, 'Input.insertText', { text: comment })
    await new Promise(resolve => setTimeout(resolve, 800))

    // 长评论会让 contenteditable 增高并推动提交按钮移动，因此输入完成后重新
    // 获取 div.main-input button 的最新位置。此前使用旧坐标正是只输入不发布的根因。
    let ready = await readToutiaoControls(target)
    if (ready.editorLength === 0) {
      // 个别 Chromium/页面组合会忽略整段 insertText。保留受信任逐字键盘输入兜底，
      // 不直接修改 textContent，确保页面框架能收到真实键盘输入链路。
      if (!await prepareToutiaoEditor(target)) {
        return { success: false, error: '今日头条评论输入框在重试时失去焦点' }
      }
      await typeTrustedCommentByKey(target, comment)
      await new Promise(resolve => setTimeout(resolve, 650))
      ready = await readToutiaoControls(target)
      if (ready.editorLength === 0) {
        return { success: false, error: '今日头条未接收到评论文字（已尝试 Playwright fill 输入链路）' }
      }
    }
    if (ready.buttonDisabled) {
      const lengthBeforeNudge = ready.editorLength
      await nudgeControlledInput(target)
      await new Promise(resolve => setTimeout(resolve, 350))
      ready = await readToutiaoControls(target)
      if (ready.editorLength !== lengthBeforeNudge) {
        return { success: false, error: '今日头条输入状态同步后评论内容长度发生变化，已停止发布' }
      }
    }
    if (ready.buttonDisabled) {
      return { success: false, error: '今日头条已显示评论文字，但评论按钮仍未启用' }
    }
    if (!await scrollToutiaoSubmitButtonIntoView(target)) {
      return { success: false, error: '找不到当前今日头条评论按钮' }
    }
    await new Promise(resolve => setTimeout(resolve, 180))
    ready = await readToutiaoControls(target)
    if (!pointInsideToutiaoViewport(ready.buttonPoint, ready)) {
      return { success: false, error: '今日头条评论按钮仍在当前视口之外，已停止发布' }
    }
    await writeClientLog('operation', {
      stage: 'page-action', action: 'toutiao-comment-ready', platform: 'toutiao',
      url: pageUrl.toString(), commentLength: comment.length,
      message: '今日头条评论文字已输入，评论按钮已启用',
    })
    await dispatchTrustedClick(target, ready.buttonPoint)
    await writeClientLog('operation', {
      stage: 'page-action', action: 'toutiao-submit-clicked', platform: 'toutiao',
      url: pageUrl.toString(), message: '已点击今日头条评论按钮，等待页面确认',
    })

    let afterClick = ready
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      afterClick = await readToutiaoControls(target)
      if (afterClick.editorLength === 0) {
        await writeClientLog('operation', {
          stage: 'page-action', action: 'toutiao-submit-confirmed', platform: 'toutiao',
          url: pageUrl.toString(), message: '今日头条页面已清空输入框，提交动作已确认',
        })
        return { success: true }
      }
    }

    // 按钮进入禁用状态通常表示请求已经在处理中，此时只等待，不重复触发。
    if (afterClick.buttonDisabled) {
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        if ((await readToutiaoControls(target)).editorLength === 0) return { success: true }
      }
      return { success: false, error: '今日头条已进入提交状态，但页面长时间未返回结果' }
    }

    // 页面浮层可能截获坐标点击。只有输入框未清空且按钮仍可提交时，才调用当前
    // main-input 中按钮自身的处理器，避免对已经开始的请求重复提交。
    await writeClientLog('operation', {
      stage: 'page-action', action: 'toutiao-submit-native-fallback', platform: 'toutiao',
      url: pageUrl.toString(), message: '鼠标点击未触发提交，改用当前评论按钮处理器',
    })
    if (await operateToutiaoSubmitButton(target, 'click')) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        afterClick = await readToutiaoControls(target)
        if (afterClick.editorLength === 0) return { success: true }
      }
    }

    if (!afterClick.buttonDisabled && await operateToutiaoSubmitButton(target, 'focus')) {
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        if ((await readToutiaoControls(target)).editorLength === 0) return { success: true }
      }
    }
    return { success: false, error: '已点击今日头条评论按钮，但页面未确认提交（输入框未清空）' }
  } catch (error) {
    return { success: false, error: `今日头条受信任输入失败：${String((error as Error)?.message || error)}` }
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

interface ZhihuControlSnapshot {
  editorPoint?: { x: number; y: number }
  buttonPoint?: { x: number; y: number }
  editorLength: number
  buttonDisabled: boolean
  viewportWidth: number
  viewportHeight: number
}

function pointInsideZhihuViewport(
  point: { x: number; y: number } | undefined,
  snapshot: { viewportWidth: number; viewportHeight: number },
): point is { x: number; y: number } {
  return Boolean(point && validViewportPoint(point)
    && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight)
}

interface ZhihuOpenerSnapshot {
  point?: { x: number; y: number }
  viewportWidth: number
  viewportHeight: number
}

interface ZhihuEditorSnapshot {
  point?: { x: number; y: number }
  renderedCount: number
  viewportWidth: number
  viewportHeight: number
}

/** Recorder 实测入口：button.BottomActions-CommentBtn。先滚动后读取视口坐标。 */
async function readZhihuCommentOpener(target: chrome.debugger.Debuggee): Promise<ZhihuOpenerSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: ZhihuOpenerSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const candidates = Array.from(document.querySelectorAll('button.BottomActions-CommentBtn, [data-za-detail-view-element_name="Comment"], button[aria-label*="评论"], button')).filter(rendered);
      const opener = candidates.find(item => /评论/.test((item.textContent || item.getAttribute('aria-label') || '').trim())) || candidates[0];
      if (!(opener instanceof HTMLElement)) {
        return { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      }
      opener.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const rect = opener.getBoundingClientRect();
      return {
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取知乎评论入口失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || { viewportWidth: 0, viewportHeight: 0 }
}

/**
 * 知乎首次打开评论区时只挂载 Draft.js 文本框，真实点击文本框后才创建“发布”按钮。
 * 因此这里不能依赖发布按钮来反向查找编辑器，而是优先选择当前视口中的主编辑器。
 */
async function readZhihuEditor(target: chrome.debugger.Debuggee): Promise<ZhihuEditorSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: ZhihuEditorSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const inViewport = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0
          && rect.left < window.innerWidth && rect.top < window.innerHeight;
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      const visibleEditors = editors.filter(inViewport);
      const editor = (visibleEditors.length ? visibleEditors : editors).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return Math.abs(leftRect.top + leftRect.height / 2 - window.innerHeight / 2)
          - Math.abs(rightRect.top + rightRect.height / 2 - window.innerHeight / 2);
      })[0];
      if (editor && !inViewport(editor)) {
        editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const rect = editor?.getBoundingClientRect();
      return {
        point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
        renderedCount: editors.length,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取知乎评论输入框失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || {
    renderedCount: 0, viewportWidth: 0, viewportHeight: 0,
  }
}

async function readZhihuControls(target: chrome.debugger.Debuggee): Promise<ZhihuControlSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: ZhihuControlSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const findContext = () => {
        const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
        for (const editor of editors) {
          let scope = editor.parentElement;
          for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
            const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(发布|发表|发送)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
            if (button) return { editor, button };
          }
        }
        return {};
      };
      const { editor, button } = findContext();
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorLength: editor ? (editor.textContent || '').trim().length : 0,
        buttonDisabled: button instanceof HTMLButtonElement
          ? button.disabled || button.getAttribute('aria-disabled') === 'true'
          : true,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取知乎评论控件失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || {
    editorLength: 0, buttonDisabled: true, viewportWidth: 0, viewportHeight: 0,
  }
}

async function prepareZhihuEditor(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      let editor;
      for (const candidate of editors) {
        let scope = candidate.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(发布|发表|发送)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button) { editor = candidate; break; }
        }
        if (editor) break;
      }
      // 新版知乎会先渲染编辑器，只有真实点击后才挂载发布按钮；此时不能
      // 因为按钮尚未出现而放弃编辑器。后续流程会再次点击并等待按钮。
      editor ||= editors.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0
          && rect.left < window.innerWidth && rect.top < window.innerHeight;
      }) || editors[0];
      if (!(editor instanceof HTMLElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(editor);
      const selection = editor.ownerDocument.defaultView.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      return editor.ownerDocument.activeElement === editor;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`准备知乎评论输入框失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function scrollZhihuSubmitButtonIntoView(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      for (const editor of editors) {
        let scope = editor.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(发布|发表|发送)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button instanceof HTMLButtonElement) {
            button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            return true;
          }
        }
      }
      return false;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`滚动到知乎发布按钮失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function operateZhihuSubmitButton(
  target: chrome.debugger.Debuggee,
  operation: 'click' | 'focus',
): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editors = Array.from(document.querySelectorAll('.DraftEditor-editorContainer > div[role="textbox"][contenteditable="true"], .CommentEditorV2-inputWrap [role="textbox"][contenteditable="true"]')).filter(rendered);
      for (const editor of editors) {
        let scope = editor.parentElement;
        for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
          const button = Array.from(scope.querySelectorAll('button')).find(item => rendered(item) && /^(发布|发表|发送)$/.test((item.textContent || '').replace(/\\s+/g, '').trim()));
          if (button instanceof HTMLButtonElement) {
            ${operation === 'click' ? 'button.click();' : 'button.focus();'}
            return true;
          }
        }
      }
      return false;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`操作知乎发布按钮失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function hasZhihuPublishedComment(
  target: chrome.debugger.Debuggee,
  comment: string,
): Promise<boolean> {
  const expected = JSON.stringify(comment.trim())
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('.CommentContent'))
      .some(element => (element.textContent || '').replace(/\\s+/g, ' ').trim() === ${expected}))()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

/** 使用 Recorder 实测的 Draft.js 编辑器与发布按钮，发送一次受信任输入。 */
async function trustedZhihuComment(
  tabId: number,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const comment = String(text || '').trim()
  if (!comment || comment.length > 1000) return { success: false, error: '评论内容为空或超过 1000 字' }

  const tab = await chrome.tabs.get(tabId)
  let pageUrl: URL
  try {
    pageUrl = new URL(tab.url || '')
  } catch {
    return { success: false, error: '无法确认知乎页面地址' }
  }
  const supportedHost = /(^|\.)zhihu\.com$/i.test(pageUrl.hostname)
  const supportedPath = /\/p\/\d+/.test(pageUrl.pathname) || /\/answer\/\d+/.test(pageUrl.pathname)
  if (!supportedHost || !supportedPath) {
    return { success: false, error: '受信任输入只允许用于知乎文章或回答页面' }
  }

  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    await enableTrustedPageInteraction(target)
    let editorReady = await prepareZhihuEditor(target)
    if (!editorReady) {
      let editorSnapshot: ZhihuEditorSnapshot = {
        renderedCount: 0, viewportWidth: 0, viewportHeight: 0,
      }
      // 新版专栏会直接渲染主评论框，此时评论入口可能不存在。先使用现成编辑器，
      // 只有页面尚未挂载编辑器时才点击底部评论按钮。
      for (let attempt = 0; attempt < 20; attempt++) {
        editorSnapshot = await readZhihuEditor(target)
        if (pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      if (!pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) {
        let opener: ZhihuOpenerSnapshot = { viewportWidth: 0, viewportHeight: 0 }
        for (let attempt = 0; attempt < 32; attempt++) {
          opener = await readZhihuCommentOpener(target)
          if (pointInsideZhihuViewport(opener.point, opener)) break
          await new Promise(resolve => setTimeout(resolve, 250))
        }
        if (!pointInsideZhihuViewport(opener.point, opener)) {
          await writeClientLog('error', {
            stage: 'page-action', action: 'zhihu-comment-controls-not-found', platform: 'zhihu',
            url: pageUrl.toString(), code: 'ZHIHU_COMMENT_CONTROLS_NOT_FOUND',
            renderedEditorCount: editorSnapshot.renderedCount,
            message: '知乎页面既未找到主评论输入框，也未找到评论入口',
          })
          return { success: false, error: '知乎页面未找到主评论输入框或评论入口' }
        }
        await dispatchTrustedClick(target, opener.point)
        await writeClientLog('operation', {
          stage: 'page-action', action: 'zhihu-comment-opened', platform: 'zhihu',
          url: pageUrl.toString(), message: '已点击知乎评论入口，等待 Draft.js 编辑器挂载',
        })
        for (let attempt = 0; attempt < 24; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 300))
          editorSnapshot = await readZhihuEditor(target)
          if (pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) break
        }
      }
      if (!pointInsideZhihuViewport(editorSnapshot.point, editorSnapshot)) {
        return {
          success: false,
          error: editorSnapshot.renderedCount > 0
            ? '知乎评论输入框已出现，但不在当前可操作视口内'
            : '点击知乎评论入口后，主评论输入框未挂载',
        }
      }

      // Recorder 与普通 Chrome 实测均表明：必须真实点击 Draft.js 文本框，知乎才挂载发布按钮。
      await dispatchTrustedClick(target, editorSnapshot.point)
      await writeClientLog('operation', {
        stage: 'page-action', action: 'zhihu-editor-clicked', platform: 'zhihu',
        url: pageUrl.toString(), message: '已点击知乎主评论输入框，等待发布按钮挂载',
      })
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        editorReady = await prepareZhihuEditor(target)
        if (editorReady) break
      }
    }
    if (!editorReady) {
      return { success: false, error: '点击知乎主评论输入框后，发布按钮仍未挂载' }
    }
    await new Promise(resolve => setTimeout(resolve, 180))
    let initial = await readZhihuControls(target)
    if (!pointInsideZhihuViewport(initial.editorPoint, initial)) {
      return { success: false, error: '找不到当前知乎主评论输入框' }
    }
    await dispatchTrustedClick(target, initial.editorPoint)
    await new Promise(resolve => setTimeout(resolve, 180))
    if (!await prepareZhihuEditor(target)) {
      return { success: false, error: '知乎评论输入框无法获得焦点' }
    }
    await sendDebuggerCommand(target, 'Input.insertText', { text: comment })
    await new Promise(resolve => setTimeout(resolve, 700))

    let ready = await readZhihuControls(target)
    if (ready.editorLength === 0) {
      if (!await prepareZhihuEditor(target)) {
        return { success: false, error: '知乎评论输入框在重试时失去焦点' }
      }
      await typeTrustedCommentByKey(target, comment)
      await new Promise(resolve => setTimeout(resolve, 600))
      ready = await readZhihuControls(target)
    }
    if (ready.editorLength === 0) {
      return { success: false, error: '知乎 Draft.js 编辑器未接收到评论文字' }
    }
    if (ready.buttonDisabled) {
      const lengthBeforeNudge = ready.editorLength
      await nudgeControlledInput(target)
      await new Promise(resolve => setTimeout(resolve, 350))
      ready = await readZhihuControls(target)
      if (ready.editorLength !== lengthBeforeNudge) {
        return { success: false, error: '知乎输入状态同步后评论内容长度发生变化，已停止发布' }
      }
    }
    if (ready.buttonDisabled) {
      return { success: false, error: '知乎已显示评论文字，但发布按钮仍未启用' }
    }
    if (!await scrollZhihuSubmitButtonIntoView(target)) {
      return { success: false, error: '找不到当前知乎发布按钮' }
    }
    await new Promise(resolve => setTimeout(resolve, 180))
    ready = await readZhihuControls(target)
    if (!pointInsideZhihuViewport(ready.buttonPoint, ready)) {
      return { success: false, error: '知乎发布按钮仍在当前视口之外，已停止发布' }
    }

    await writeClientLog('operation', {
      stage: 'page-action', action: 'zhihu-comment-ready', platform: 'zhihu',
      url: pageUrl.toString(), commentLength: comment.length,
      message: '知乎评论文字已输入，发布按钮已启用',
    })
    await dispatchTrustedClick(target, ready.buttonPoint)
    await writeClientLog('operation', {
      stage: 'page-action', action: 'zhihu-submit-clicked', platform: 'zhihu',
      url: pageUrl.toString(), message: '已点击知乎发布按钮，等待页面确认',
    })

    let afterClick = ready
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      afterClick = await readZhihuControls(target)
      if (afterClick.editorLength === 0 || await hasZhihuPublishedComment(target, comment)) {
        await writeClientLog('operation', {
          stage: 'page-action', action: 'zhihu-submit-confirmed', platform: 'zhihu',
          url: pageUrl.toString(), message: '知乎页面已确认新评论',
        })
        return { success: true }
      }
    }

    // 页面仍可提交时才使用按钮处理器兜底；按钮已禁用表示请求进行中，禁止重复。
    if (!afterClick.buttonDisabled && await operateZhihuSubmitButton(target, 'click')) {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        afterClick = await readZhihuControls(target)
        if (afterClick.editorLength === 0 || await hasZhihuPublishedComment(target, comment)) return { success: true }
      }
    }
    if (!afterClick.buttonDisabled && await operateZhihuSubmitButton(target, 'focus')) {
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      })
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        if ((await readZhihuControls(target)).editorLength === 0
          || await hasZhihuPublishedComment(target, comment)) return { success: true }
      }
    }
    return { success: false, error: '已点击知乎发布按钮，但页面未确认新评论' }
  } catch (error) {
    return { success: false, error: `知乎受信任输入失败：${String((error as Error)?.message || error)}` }
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

interface CsdnControlSnapshot {
  openerPoint?: { x: number; y: number }
  editorPoint?: { x: number; y: number }
  buttonPoint?: { x: number; y: number }
  editorValue: string
  buttonDisabled: boolean
  openerFound: boolean
  viewportWidth: number
  viewportHeight: number
}

function pointInsideCsdnViewport(
  point: { x: number; y: number } | undefined,
  snapshot: CsdnControlSnapshot,
): point is { x: number; y: number } {
  return Boolean(point && validViewportPoint(point)
    && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight)
}

async function readCsdnControls(
  target: chrome.debugger.Debuggee,
  scrollTarget: 'opener' | 'editor' | 'none' = 'none',
): Promise<CsdnControlSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: CsdnControlSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const openerCandidates = Array.from(document.querySelectorAll('a.tool-item-href.go-side-comment, a.has-comment-bt-right.go-side-comment, li.tool-item-comment a.tool-item-href, a[href="#commentBox"], li.tool-item-comment'));
      const opener = openerCandidates.find(rendered);
      const editor = Array.from(document.querySelectorAll('textarea#comment_content, textarea[id*="comment" i], textarea[name*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], .comment-input-box [contenteditable="true"], .comment-editor [contenteditable="true"], [contenteditable="true"]')).find(rendered);
      const button = Array.from(document.querySelectorAll('input.btn-comment-input[type="submit"], input.btn-comment[type="submit"], button.btn-comment-input, button.btn-comment, button[class*="comment-submit" i], [role="button"][class*="comment-submit" i]')).find(rendered);
      if (${JSON.stringify(scrollTarget)} === 'opener' && opener) opener.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      if (${JSON.stringify(scrollTarget)} === 'editor' && editor) editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        openerPoint: point(opener), editorPoint: point(editor), buttonPoint: point(button),
        editorValue: editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : (editor?.textContent || ''),
        buttonDisabled: button instanceof HTMLButtonElement || button instanceof HTMLInputElement
          ? button.disabled || button.getAttribute('aria-disabled') === 'true'
          : button?.getAttribute('aria-disabled') === 'true',
        openerFound: openerCandidates.length > 0,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取CSDN评论控件失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || {
    editorValue: '', buttonDisabled: true, openerFound: false, viewportWidth: 0, viewportHeight: 0,
  }
}

async function openCsdnCommentPanel(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const opener = document.querySelector('a.tool-item-href.go-side-comment, a.has-comment-bt-right.go-side-comment, li.tool-item-comment a.tool-item-href, a[href="#commentBox"], li.tool-item-comment');
      if (!(opener instanceof HTMLElement)) return false;
      opener.click();
      return true;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

async function clickCsdnSubmitHandler(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editor = Array.from(document.querySelectorAll('textarea#comment_content, textarea[id*="comment" i], textarea[name*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], .comment-input-box [contenteditable="true"], .comment-editor [contenteditable="true"], [contenteditable="true"]')).find(rendered);
      const button = Array.from(document.querySelectorAll('input.btn-comment-input[type="submit"], input.btn-comment[type="submit"], button.btn-comment-input, button.btn-comment, button[class*="comment-submit" i], [role="button"][class*="comment-submit" i]')).find(rendered);
      if (!(editor instanceof HTMLElement) || !(button instanceof HTMLElement)
        || !((editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) ? editor.value.trim() : (editor.textContent || '').trim())
        || (button instanceof HTMLInputElement || button instanceof HTMLButtonElement) && button.disabled
        || button.getAttribute('aria-disabled') === 'true') return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

async function prepareCsdnEditor(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const editor = Array.from(document.querySelectorAll('textarea#comment_content, textarea[id*="comment" i], textarea[name*="comment" i], textarea[placeholder*="评论" i], textarea[placeholder*="留言" i], .comment-input-box [contenteditable="true"], .comment-editor [contenteditable="true"], [contenteditable="true"]')).find(element => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (!(editor instanceof HTMLTextAreaElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) editor.setSelectionRange(0, editor.value.length);
      else {
        const range = editor.ownerDocument.createRange();
        range.selectNodeContents(editor);
        const selection = editor.ownerDocument.defaultView?.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return editor.ownerDocument.activeElement === editor;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`准备CSDN评论输入框失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function hasCsdnPublishedComment(
  target: chrome.debugger.Debuggee,
  comment: string,
): Promise<boolean> {
  const expected = JSON.stringify(normalizeTrustedInputValue(comment))
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('.comment-list-box .new-comment, .comment-list-box .comment-content, .comment-box .new-comment, .comment-box .comment-content'))
      .some(element => (element.textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, '').trim() === ${expected}))()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

async function trustedCsdnComment(
  tabId: number,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const comment = String(text || '').trim()
  if (!comment || comment.length > 1000) return { success: false, error: '评论内容为空或超过 1000 字' }

  const tab = await chrome.tabs.get(tabId)
  let pageUrl: URL
  try {
    pageUrl = new URL(tab.url || '')
  } catch {
    return { success: false, error: '无法确认CSDN页面地址' }
  }
  if (!/(^|\.)csdn\.net$/i.test(pageUrl.hostname) || !/\/article\/details\/\d+/.test(pageUrl.pathname)) {
    return { success: false, error: '受信任输入只允许用于CSDN文章页面' }
  }

  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    await enableTrustedPageInteraction(target)

    let controls = await readCsdnControls(target, 'editor')
    if (!pointInsideCsdnViewport(controls.editorPoint, controls)) {
      for (let attempt = 0; attempt < 24; attempt++) {
        controls = await readCsdnControls(target, 'opener')
        if (pointInsideCsdnViewport(controls.openerPoint, controls)) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      const opened = pointInsideCsdnViewport(controls.openerPoint, controls)
        ? (await dispatchTrustedClick(target, controls.openerPoint), true)
        : controls.openerFound && await openCsdnCommentPanel(target)
      if (!opened) {
        await writeClientLog('error', {
          stage: 'page-action', action: 'csdn-comment-opener-not-found', platform: 'csdn',
          url: pageUrl.toString(), code: 'CSDN_COMMENT_OPENER_NOT_FOUND',
          openerFound: controls.openerFound,
          viewportWidth: controls.viewportWidth, viewportHeight: controls.viewportHeight,
          message: 'CSDN评论入口未找到或无法触发',
        })
        return { success: false, error: '找不到CSDN评论入口' }
      }
      await writeClientLog('operation', {
        stage: 'page-action', action: 'csdn-comment-opened', platform: 'csdn',
        url: pageUrl.toString(), openerFound: controls.openerFound,
        viewportWidth: controls.viewportWidth, viewportHeight: controls.viewportHeight,
        message: '已触发CSDN评论入口，等待评论输入框',
      })
    }

    for (let attempt = 0; attempt < 32; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      controls = await readCsdnControls(target, 'editor')
      if (pointInsideCsdnViewport(controls.editorPoint, controls)
        && pointInsideCsdnViewport(controls.buttonPoint, controls)) break
    }
    if (!pointInsideCsdnViewport(controls.editorPoint, controls)) {
      return { success: false, error: '找不到CSDN评论输入框' }
    }
    if (!pointInsideCsdnViewport(controls.buttonPoint, controls)) {
      return { success: false, error: '找不到CSDN评论发布按钮' }
    }

    await dispatchTrustedClick(target, controls.editorPoint)
    await new Promise(resolve => setTimeout(resolve, 150))
    if (!await prepareCsdnEditor(target)) {
      return { success: false, error: 'CSDN评论输入框无法获得焦点' }
    }
    await sendDebuggerCommand(target, 'Input.insertText', { text: comment })
    await new Promise(resolve => setTimeout(resolve, 500))
    controls = await readCsdnControls(target, 'none')

    if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
      if (!await prepareCsdnEditor(target)) {
        return { success: false, error: 'CSDN评论输入框在重试时失去焦点' }
      }
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
      })
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
      })
      await typeTrustedCommentByKey(target, comment)
      await new Promise(resolve => setTimeout(resolve, 650))
      controls = await readCsdnControls(target, 'none')
    }
    if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
      return { success: false, error: 'CSDN评论输入框未接收到完整文字' }
    }
    if (controls.buttonDisabled || !pointInsideCsdnViewport(controls.buttonPoint, controls)) {
      return { success: false, error: 'CSDN评论按钮未启用或不在当前视口内' }
    }

    await writeClientLog('operation', {
      stage: 'page-action', action: 'csdn-comment-ready', platform: 'csdn',
      url: pageUrl.toString(), commentLength: comment.length,
      message: 'CSDN评论文字已完整输入，评论按钮已启用',
    })
    await dispatchTrustedClick(target, controls.buttonPoint)
    await writeClientLog('operation', {
      stage: 'page-action', action: 'csdn-submit-clicked', platform: 'csdn',
      url: pageUrl.toString(), message: '已点击CSDN评论按钮，等待页面确认',
    })

    let afterClick = controls
    let enteredProcessingState = false
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      afterClick = await readCsdnControls(target, 'none')
      if (!afterClick.editorValue || await hasCsdnPublishedComment(target, comment)) {
        await writeClientLog('operation', {
          stage: 'page-action', action: 'csdn-submit-confirmed', platform: 'csdn',
          url: pageUrl.toString(), message: 'CSDN页面已确认新评论',
        })
        return { success: true }
      }
      if (afterClick.buttonDisabled) enteredProcessingState = true
    }

    // 鼠标坐标可能被 CSDN 右侧浮层截获。只有等待 10 秒后输入框仍是完整原文、
    // 按钮从未进入提交状态且列表无目标正文，才调用当前 submit 控件处理器一次。
    if (!enteredProcessingState
      && !afterClick.buttonDisabled
      && normalizeTrustedInputValue(afterClick.editorValue) === normalizeTrustedInputValue(comment)
      && await clickCsdnSubmitHandler(target)) {
      await writeClientLog('operation', {
        stage: 'page-action', action: 'csdn-submit-handler-fallback', platform: 'csdn',
        url: pageUrl.toString(),
        message: 'CSDN鼠标点击未触发提交，已调用当前评论按钮处理器一次',
      })
      for (let attempt = 0; attempt < 32; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        afterClick = await readCsdnControls(target, 'none')
        if (!afterClick.editorValue || await hasCsdnPublishedComment(target, comment)) {
          await writeClientLog('operation', {
            stage: 'page-action', action: 'csdn-submit-confirmed', platform: 'csdn',
            url: pageUrl.toString(), message: 'CSDN页面已确认新评论（评论处理器兜底）',
          })
          return { success: true }
        }
      }
    }
    return { success: false, error: '已点击CSDN评论按钮，但页面未确认新评论' }
  } catch (error) {
    return { success: false, error: `CSDN受信任输入失败：${String((error as Error)?.message || error)}` }
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

interface BaijiahaoControlSnapshot {
  openerPoint?: { x: number; y: number }
  editorPoint?: { x: number; y: number }
  buttonPoint?: { x: number; y: number }
  editorValue: string
  buttonDisabled: boolean
  buttonClass: string
  viewportWidth: number
  viewportHeight: number
}

function normalizeTrustedInputValue(value: string): string {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function pointInsideBaijiahaoViewport(
  point: { x: number; y: number } | undefined,
  snapshot: BaijiahaoControlSnapshot,
): point is { x: number; y: number } {
  return Boolean(point && validViewportPoint(point)
    && point.x <= snapshot.viewportWidth && point.y <= snapshot.viewportHeight)
}

async function readBaijiahaoControls(
  target: chrome.debugger.Debuggee,
  scrollTarget: 'opener' | 'editor' | 'none' = 'none',
): Promise<BaijiahaoControlSnapshot> {
  const response = await sendDebuggerCommand<{
    result?: { value?: BaijiahaoControlSnapshot }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const opener = Array.from(document.querySelectorAll('[data-testid="comment-btn"]')).find(rendered);
      const editor = Array.from(document.querySelectorAll('textarea[placeholder="发表神评妙论"], textarea.text-area')).find(rendered);
      if (${JSON.stringify(scrollTarget)} === 'opener' && opener) {
        opener.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      if (${JSON.stringify(scrollTarget)} === 'editor' && editor) {
        editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const scope = editor?.closest('.x-interact-publish, .x-interact-publish-content, .xcp-publish-main') || document;
      const button = Array.from(scope.querySelectorAll('span.send')).find(rendered)
        || Array.from(document.querySelectorAll('span.send')).find(rendered);
      const point = (element) => {
        if (!element) return undefined;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      const buttonClass = button instanceof HTMLElement ? String(button.className || '') : '';
      const buttonStyle = button instanceof HTMLElement ? getComputedStyle(button) : undefined;
      return {
        openerPoint: point(opener),
        editorPoint: point(editor),
        buttonPoint: point(button),
        editorValue: editor instanceof HTMLTextAreaElement ? editor.value : '',
        buttonDisabled: !(button instanceof HTMLElement)
          || /(^|\\s)disabled?(\\s|$)/i.test(buttonClass)
          || Number(buttonStyle?.opacity || 1) < 0.5
          || button.getAttribute('aria-disabled') === 'true',
        buttonClass,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`读取百家号评论控件失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value || {
    editorValue: '', buttonDisabled: true, buttonClass: '', viewportWidth: 0, viewportHeight: 0,
  }
}

async function hasBaijiahaoPublishedComment(
  target: chrome.debugger.Debuggee,
  comment: string,
): Promise<boolean> {
  const expected = JSON.stringify(comment.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, '').trim())
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('.xcp-item[data-reply-id] .x-interact-rich-text, .xcp-item .rich-text'))
      .some(element => (element.textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, '').trim() === ${expected}))()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

async function prepareBaijiahaoEditor(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const editor = Array.from(document.querySelectorAll('textarea[placeholder="发表神评妙论"], textarea.text-area'))
        .find(element => {
          if (!(element instanceof HTMLTextAreaElement)) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
      if (!(editor instanceof HTMLTextAreaElement)) return false;
      editor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      editor.focus();
      editor.setSelectionRange(0, editor.value.length);
      return editor.ownerDocument.activeElement === editor;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) {
    throw new Error(`准备百家号评论输入框失败：${response.exceptionDetails.text || '页面脚本异常'}`)
  }
  return response.result?.value === true
}

async function clickBaijiahaoSubmitHandler(target: chrome.debugger.Debuggee): Promise<boolean> {
  const response = await sendDebuggerCommand<{
    result?: { value?: boolean }
    exceptionDetails?: { text?: string }
  }>(target, 'Runtime.evaluate', {
    expression: `(() => {
      const rendered = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      };
      const editor = Array.from(document.querySelectorAll('textarea[placeholder="发表神评妙论"], textarea.text-area')).find(rendered);
      const scope = editor?.closest('.x-interact-publish, .x-interact-publish-content, .xcp-publish-main') || document;
      const button = Array.from(scope.querySelectorAll('span.send')).find(rendered)
        || Array.from(document.querySelectorAll('span.send')).find(rendered);
      if (!(button instanceof HTMLElement)
        || /(^|\\s)disabled?(\\s|$)/i.test(String(button.className || ''))
        || button.getAttribute('aria-disabled') === 'true') return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  })
  if (response.exceptionDetails) return false
  return response.result?.value === true
}

/**
 * Recorder 与普通 Chrome 实测：百家号 textarea 接收整段中文后，span.send 仍为 disabled。
 * 再产生一次真实普通按键并立即退格，内部输入状态才同步，且最终正文保持不变。
 */
async function trustedBaijiahaoComment(
  tabId: number,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  const comment = String(text || '').trim()
  if (!comment || comment.length > 1000) return { success: false, error: '评论内容为空或超过 1000 字' }

  const tab = await chrome.tabs.get(tabId)
  let pageUrl: URL
  try {
    pageUrl = new URL(tab.url || '')
  } catch {
    return { success: false, error: '无法确认百家号页面地址' }
  }
  if (!/(^|\.)baijiahao\.baidu\.com$/i.test(pageUrl.hostname) || pageUrl.pathname !== '/s') {
    return { success: false, error: '受信任输入只允许用于百家号文章页面' }
  }

  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await chrome.debugger.attach(target, '1.3')
    await enableTrustedPageInteraction(target)

    // 新版百家号文章页直接显示 textarea，不再提供 data-testid="comment-btn"。
    // 兼容旧版：只有输入框尚未出现时才查找并点击评论入口。
    let controls = await readBaijiahaoControls(target, 'editor')
    for (let attempt = 0; attempt < 32
      && !pointInsideBaijiahaoViewport(controls.editorPoint, controls); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      controls = await readBaijiahaoControls(target, 'editor')
    }
    if (!pointInsideBaijiahaoViewport(controls.editorPoint, controls)) {
      for (let attempt = 0; attempt < 32; attempt++) {
        controls = await readBaijiahaoControls(target, 'opener')
        if (pointInsideBaijiahaoViewport(controls.openerPoint, controls)) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      if (!pointInsideBaijiahaoViewport(controls.openerPoint, controls)) {
        await writeClientLog('error', {
          stage: 'page-action', action: 'baijiahao-comment-controls-not-found', platform: 'baijiahao',
          url: pageUrl.toString(), code: 'BAIJIAHAO_COMMENT_CONTROLS_NOT_FOUND',
          message: '百家号页面既未找到评论输入框，也未找到旧版评论入口',
        })
        return { success: false, error: '百家号页面未找到评论输入框或评论入口' }
      }
      await dispatchTrustedClick(target, controls.openerPoint)
      await writeClientLog('operation', {
        stage: 'page-action', action: 'baijiahao-comment-opened', platform: 'baijiahao',
        url: pageUrl.toString(), message: '已点击百家号评论入口，等待评论输入框',
      })
    }

    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      controls = await readBaijiahaoControls(target, 'editor')
      if (pointInsideBaijiahaoViewport(controls.editorPoint, controls)
        && pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) break
    }
    if (!pointInsideBaijiahaoViewport(controls.editorPoint, controls)) {
      return { success: false, error: '找不到百家号评论输入框 textarea[placeholder="发表神评妙论"]' }
    }
    if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
      return { success: false, error: '找不到百家号发表按钮 span.send' }
    }

    await dispatchTrustedClick(target, controls.editorPoint)
    await new Promise(resolve => setTimeout(resolve, 160))
    if (!await prepareBaijiahaoEditor(target)) {
      return { success: false, error: '百家号评论输入框无法获得焦点' }
    }
    await sendDebuggerCommand(target, 'Input.insertText', { text: comment })
    await new Promise(resolve => setTimeout(resolve, 500))

    controls = await readBaijiahaoControls(target, 'none')
    if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
      // 非聚焦窗口中 Chromium 偶尔只提交整段文本的一部分。重新全选清空后改用
      // 逐字受信任键盘事件，且只有最终内容完整一致时才允许点击发表。
      if (!await prepareBaijiahaoEditor(target)) {
        return { success: false, error: '百家号评论输入框在重试时失去焦点' }
      }
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Backspace', code: 'Backspace',
        windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
      })
      await sendDebuggerCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Backspace', code: 'Backspace',
        windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
      })
      await typeTrustedCommentByKey(target, comment)
      await new Promise(resolve => setTimeout(resolve, 650))
      controls = await readBaijiahaoControls(target, 'none')
    }
    if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(comment)) {
      return {
        success: false,
        error: `百家号评论输入框未接收到完整文字（期望 ${comment.length} 字，实际 ${controls.editorValue.length} 字）`,
      }
    }
    if (controls.buttonDisabled) {
      const valueBeforeNudge = controls.editorValue
      await nudgeControlledInput(target)
      await new Promise(resolve => setTimeout(resolve, 350))
      controls = await readBaijiahaoControls(target, 'none')
      if (normalizeTrustedInputValue(controls.editorValue) !== normalizeTrustedInputValue(valueBeforeNudge)) {
        return { success: false, error: '百家号输入状态同步后评论内容发生变化，已停止发表' }
      }
    }
    if (controls.buttonDisabled) {
      return { success: false, error: '百家号已显示评论文字，但发表按钮仍未启用' }
    }
    if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
      controls = await readBaijiahaoControls(target, 'editor')
    }
    if (!pointInsideBaijiahaoViewport(controls.buttonPoint, controls)) {
      return { success: false, error: '百家号发表按钮不在当前视口内' }
    }

    await writeClientLog('operation', {
      stage: 'page-action', action: 'baijiahao-comment-ready', platform: 'baijiahao',
      url: pageUrl.toString(), commentLength: comment.length,
      message: '百家号评论文字已输入，发表按钮已启用',
    })
    await dispatchTrustedClick(target, controls.buttonPoint)
    await writeClientLog('operation', {
      stage: 'page-action', action: 'baijiahao-submit-clicked', platform: 'baijiahao',
      url: pageUrl.toString(), message: '已点击百家号发表按钮，等待页面确认',
    })

    let afterClick = controls
    let enteredProcessingState = false
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      afterClick = await readBaijiahaoControls(target, 'none')
      if (!afterClick.editorValue || await hasBaijiahaoPublishedComment(target, comment)) {
        await writeClientLog('operation', {
          stage: 'page-action', action: 'baijiahao-submit-confirmed', platform: 'baijiahao',
          url: pageUrl.toString(), message: '百家号页面已确认新评论',
        })
        return { success: true }
      }
      if (afterClick.buttonDisabled) enteredProcessingState = true
    }

    // 坐标点击可能被浮层截获。只有等待 10 秒后输入框仍是完整原文、按钮从未
    // 进入提交状态且评论列表没有目标正文，才调用当前 span.send 的 Vue 处理器一次。
    // 一旦页面表现出正在提交，绝不兜底重复点击。
    if (!enteredProcessingState
      && !afterClick.buttonDisabled
      && normalizeTrustedInputValue(afterClick.editorValue) === normalizeTrustedInputValue(comment)
      && await clickBaijiahaoSubmitHandler(target)) {
      await writeClientLog('operation', {
        stage: 'page-action', action: 'baijiahao-submit-handler-fallback', platform: 'baijiahao',
        url: pageUrl.toString(),
        message: '百家号鼠标点击未触发提交，已调用当前发表按钮处理器一次',
      })
      for (let attempt = 0; attempt < 32; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250))
        afterClick = await readBaijiahaoControls(target, 'none')
        if (!afterClick.editorValue || await hasBaijiahaoPublishedComment(target, comment)) {
          await writeClientLog('operation', {
            stage: 'page-action', action: 'baijiahao-submit-confirmed', platform: 'baijiahao',
            url: pageUrl.toString(), message: '百家号页面已确认新评论（发表处理器兜底）',
          })
          return { success: true }
        }
      }
    }
    return { success: false, error: '已点击百家号发表按钮，但页面未确认新评论' }
  } catch (error) {
    return { success: false, error: `百家号受信任输入失败：${String((error as Error)?.message || error)}` }
  } finally {
    await chrome.debugger.detach(target).catch(() => {})
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type !== 'UPDATE_BADGE') {
    const auditMessage = message as any
    writeClientLog('operation', {
      stage: 'extension-message',
      action: message.type,
      command: auditMessage.command,
      platform: auditMessage.platform,
      url: auditMessage.url,
      tabId: sender.tab?.id,
      message: `插件操作：${message.type}`,
    })
  }
  switch (message.type) {
    case 'UPDATE_BADGE':
      updateBadge(message.count, sender.tab?.id)
      sendResponse({ success: true })
      break

    case 'SAVE_SCAN_RESULT':
      // 内容脚本扫描完成，在扩展上下文保存到 IndexedDB
      {
      const normalizedUrl = normalizeArticleUrl(message.url, message.platform)
      saveRecord({
        platform: message.platform,
        url: normalizedUrl,
        title: message.title,
        commentCount: message.commentCount,
        totalCommentCount: message.totalCommentCount,
        checkTime: new Date().toISOString(),
        username: message.username,
        linkStatus: message.linkStatus || 'active',
        liked: message.liked,
        collected: message.collected,
      }).then(async () => {
        updateBadge(message.commentCount, sender.tab?.id)
        writeClientLog('operation', {
          stage: 'scan-saved', action: 'SAVE_SCAN_RESULT', platform: message.platform,
          url: normalizedUrl, commentCount: message.commentCount,
          totalCommentCount: message.totalCommentCount,
          liked: message.liked, collected: message.collected,
          message: '扫描结果已保存',
        })
        sendResponse({ success: true, url: normalizedUrl })
      }).catch(e => {
        console.error('[背景] 保存失败:', e)
        writeClientLog('error', {
          stage: 'scan-save-failed', action: 'SAVE_SCAN_RESULT', platform: message.platform,
          url: normalizedUrl, code: 'SCAN_SAVE_FAILED', message: String(e),
        })
        sendResponse({ success: false, error: String(e) })
      })
      break
      }

    case 'FETCH_NETEASE_COMMENTS':
      {
        let url: URL
        try {
          url = new URL(message.url)
          const isAllowed = url.origin === 'https://comment.api.163.com'
            && /\/api\/v1\/products\/[^/]+\/threads\/[^/]+\/comments\/(?:newList|hotList)$/.test(url.pathname)
          if (!isAllowed) throw new Error('评论接口地址不在允许范围内')
        } catch (error) {
          sendResponse({ success: false, error: String(error) })
          break
        }

        fetch(url.toString(), { headers: { Accept: 'text/javascript, application/json' } })
          .then(async response => {
            if (!response.ok) throw new Error(`评论接口返回 HTTP ${response.status}`)
            sendResponse({ success: true, text: await response.text() })
          })
          .catch(error => sendResponse({ success: false, error: String(error) }))
        break
      }

    case 'FETCH_BAIJIAHAO_COMMENTS':
      {
        const tid = String(message.threadId || '').trim()
        if (!/^\d+$/.test(tid)) {
          sendResponse({ success: false, error: '无效的百家号 thread_id' })
          break
        }
        const start = Math.max(0, Number(message.start) || 0)
        const num = Math.min(50, Math.max(10, Number(message.num) || 20))
        const apiUrl = `https://ext.baidu.com/api/comment/v2/comment/list?thread_id=${tid}&start=${start}&num=${num}&appid=22862035&order=12&inner_order=9&use_list=1&source=feed&out_reply_id=&use_uk=1`

        fetch(apiUrl, { headers: { Accept: 'application/json, text/plain, */*' } })
          .then(async response => {
            if (!response.ok) throw new Error(`百家号评论接口返回 HTTP ${response.status}`)
            const json = await response.json()
            sendResponse({ success: true, data: json })
          })
          .catch(error => sendResponse({ success: false, error: String(error) }))
        break
      }

    case 'VERIFY_COMMENT_ONLINE':
      verifyCommentOnline(message).then(sendResponse)
      break

    case 'CAPTURE_URL_ARCHIVE':
      captureUrlArchive(message).then(sendResponse)
      break

    case 'GENERATE_AI_COMMENT':
      generateComment(message).then(sendResponse)
      break

    case 'TRUSTED_TOUTIAO_COMMENT':
      if (sender.tab?.id == null) {
        sendResponse({ success: false, error: '无法取得今日头条操作标签页' })
      } else {
        trustedToutiaoComment(
          sender.tab.id,
          message.text,
        ).then(sendResponse)
      }
      break

    case 'TRUSTED_ZHIHU_COMMENT':
      if (sender.tab?.id == null) {
        sendResponse({ success: false, error: '无法取得知乎操作标签页' })
      } else {
        trustedZhihuComment(sender.tab.id, message.text).then(sendResponse)
      }
      break

    case 'TRUSTED_BAIJIAHAO_COMMENT':
      if (sender.tab?.id == null) {
        sendResponse({ success: false, error: '无法取得百家号操作标签页' })
      } else {
        trustedBaijiahaoComment(sender.tab.id, message.text).then(sendResponse)
      }
      break

    case 'TRUSTED_CSDN_COMMENT':
      if (sender.tab?.id == null) {
        sendResponse({ success: false, error: '无法取得CSDN操作标签页' })
      } else {
        trustedCsdnComment(sender.tab.id, message.text).then(sendResponse)
      }
      break

    case 'CLIENT_COMMAND':
      if (!CLIENT_COMMANDS.has(message.command)) {
        sendResponse({ success: false, error: '不允许的插件命令' })
      } else {
        nativeCommand(message.command, message.payload).then(sendResponse)
      }
      break

  }
  return true
})

chrome.runtime.onInstalled.addListener(() => {
  console.log('DL评论助手已安装')
})
