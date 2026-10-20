/** 支持的平台 */
export type Platform = 'csdn' | 'zhihu' | 'toutiao' | 'baijiahao' | 'netease' | 'sohu' | 'third_party'

/** 文章链接当前是否仍然有效 */
export type LinkStatus = 'active' | 'invalid'

/** 平台显示名 */
export const PlatformLabel: Record<Platform, string> = {
  csdn: 'CSDN',
  zhihu: '知乎',
  toutiao: '今日头条',
  baijiahao: '百家号',
  netease: '网易',
  sohu: '搜狐',
  third_party: '第三方平台',
}

export type AccountStatus = 'logged_in' | 'auth_required' | 'account_mismatch' | 'unknown'
export type ActionStatus = 'idle' | 'satisfied' | 'partial' | 'verified' | 'failed' | 'needs_attention'

export interface SupplementActions {
  comment: boolean
  like: boolean
  collect: boolean
  screenshot?: boolean
}

export interface DashboardLogEntry {
  id: string
  time: string
  level: 'info' | 'success' | 'warning' | 'error'
  platform?: Platform
  url?: string
  action: string
  message: string
  detail?: string
  diagnostics?: string
}

/** 评论记录 */
export interface CommentRecord {
  id?: number
  platform: Platform
  url: string
  title: string
  commentCount: number
  /** 页面评论总数（平台可提供时），commentCount 仍表示当前账号评论数。 */
  totalCommentCount?: number
  checkTime: string   // ISO date string
  username: string
  linkStatus?: LinkStatus
  liked?: boolean
  collected?: boolean
  targetCommentCount?: number
  actionStatus?: ActionStatus
  lastActionTime?: string
  lastErrorCode?: string
}

/** 当日统计汇总 */
export interface DailySummary {
  date: string
  byPlatform: Record<Platform, number>
  total: number
}

/** 批量检测结果项 */
export interface BatchResultItem {
  platform: Platform
  url: string
  commentCount: number
  totalCommentCount?: number
  title: string
  error?: string
  linkStatus?: LinkStatus
  username?: string
  accountStatus?: AccountStatus
  liked?: boolean
  collected?: boolean
  diagnostics?: string
}

/** 页面通知浮层数据 */
export interface NotificationData {
  platform: string
  title: string
  commentCount: number
  totalCommentCount?: number
  checkTime: string
  username: string
}

/** AI 分析结果 */
export interface AIAnalysisResult {
  totalComments: number
  byPlatform: Record<string, number>
  domainDistribution: Record<string, number>
  suggestion: string
}

/** Content script 向 background 请求统计数据 */
export interface ScanRequest {
  type: 'SCAN_PAGE'
  platform: Platform
  url: string
}

/** 存档任务只读取账号、标题和评论数，不提前滚动评论列表。 */
export interface ScanArchiveMetadataRequest {
  type: 'SCAN_ARCHIVE_METADATA'
  platform: Platform
  url: string
}

/** Background 返回统计数据给 popup */
export interface ScanResponse {
  type: 'SCAN_RESULT'
  platform: Platform
  url: string
  title: string
  commentCount: number
  totalCommentCount?: number
  username: string
  error?: string
  linkStatus?: LinkStatus
  accountStatus?: AccountStatus
  liked?: boolean
  collected?: boolean
  diagnostics?: string
}

export interface SupplementPageRequest {
  type: 'SUPPLEMENT_PAGE'
  platform: Platform
  url: string
  targetCommentCount: number
  actions?: Partial<SupplementActions>
}

export interface SupplementResult {
  type: 'SUPPLEMENT_RESULT'
  platform: Platform
  url: string
  title: string
  username: string
  targetCommentCount: number
  beforeCommentCount: number
  afterCommentCount: number
  commentPosted: boolean
  commentText?: string
  commentTexts?: string[]
  commentPostedCount?: number
  likePerformed?: boolean
  collectPerformed?: boolean
  liked: boolean | null
  collected: boolean | null
  accountStatus: AccountStatus
  status: ActionStatus
  requestedActions?: Partial<SupplementActions>
  error?: string
  errorCode?: string
  evidenceId?: string
  evidenceSha256?: string
  evidenceCapturedAt?: string
  evidenceTargetFound?: boolean
  evidenceError?: string
}

/** 评论任务历史：记录成功、待平台同步和失败，便于统计与排查。 */
export interface CommentPublishHistoryItem {
  id: string
  time: string
  platform: Platform
  url: string
  title: string
  username: string
  comment: string
  verificationStatus: 'verified' | 'pending' | 'failed'
  failureReason?: string
  errorCode?: string
  evidenceId?: string
  evidenceSha256?: string
  evidenceCapturedAt?: string
  evidenceTargetFound?: boolean
  evidenceError?: string
  currentPresence?: 'present' | 'suspected_deleted' | 'unknown'
  lastVerifiedAt?: string
  lastConfirmedPresentAt?: string
  firstMissingAt?: string
  lastKnownCommentCount?: number
}

/** 独立存放在 IndexedDB 中的评论截图或旧版静态 HTML 存档。 */
export interface CommentEvidenceSnapshot {
  id: string
  createdAt: string
  platform: Platform
  url: string
  articleId: string
  title: string
  username: string
  comment: string
  commentId?: string
  platformDisplayedTime?: string
  beforeCommentCount: number
  afterCommentCount: number
  declaredTotalCount?: number
  capturedItemCount: number
  targetFoundInDom: boolean
  verificationBasis: 'page_dom' | 'comment_count_increase' | 'page_scan'
  source?: 'automatic_comment' | 'manual_scan'
  sha256: string
  archiveFormat?: 'html' | 'image'
  htmlDocument?: string
  imageDataUrl?: string
  imageMimeType?: 'image/png' | 'image/webp'
  commentKey?: string
  archiveRunId?: string
}

export interface CommentArchiveRunSummary {
  id: string
  createdAt: string
  platform: Platform
  url: string
  title: string
  username: string
  detectedCommentCount: number
  locatedCommentCount: number
  capturedCommentCount: number
  capturedNewCount: number
  reusedCount: number
  failedCount: number
  missingCount: number
  evidenceIds: string[]
  status: 'complete' | 'incomplete' | 'failed'
  error?: string
}

export const COMMENT_ARCHIVE_RUNS_KEY = 'commentScreenshotArchiveRuns'
export const COMMENT_ARCHIVE_RUN_HISTORY_KEY = 'commentScreenshotArchiveRunHistory'

export interface CaptureCommentEvidenceRequest {
  type: 'CAPTURE_COMMENT_EVIDENCE'
  platform: Platform
  url: string
  title: string
  username: string
  comment: string
  beforeCommentCount: number
  afterCommentCount: number
  capturedAt: string
}

export interface CommentEvidenceCaptureResult {
  success: boolean
  htmlDocument?: string
  articleId?: string
  commentId?: string
  platformDisplayedTime?: string
  declaredTotalCount?: number
  capturedItemCount?: number
  targetFoundInDom?: boolean
  error?: string
}

export interface VerifyCommentEvidenceRequest {
  type: 'VERIFY_COMMENT_EVIDENCE'
  platform: Platform
  url: string
  comment: string
  archivedAfterCommentCount: number
}

export interface VerifyCommentOnlineRequest {
  type: 'VERIFY_COMMENT_ONLINE'
  historyId: string
  platform: Platform
  url: string
  comment: string
  archivedAfterCommentCount: number
}

export interface VerifyCommentOnlineResult {
  success: boolean
  presence: 'present' | 'suspected_deleted' | 'unknown'
  checkedAt: string
  currentCommentCount?: number
  linkStatus?: LinkStatus
  reason: string
  error?: string
}

export interface CaptureUrlArchiveRequest {
  type: 'CAPTURE_URL_ARCHIVE'
  platform: Platform
  url: string
  expectedComment?: string
}

export interface CaptureUrlArchiveResult {
  success: boolean
  evidenceId?: string
  evidenceIds?: string[]
  capturedAt?: string
  commentCount?: number
  targetFoundInDom?: boolean
  detectedCommentCount?: number
  locatedCommentCount?: number
  capturedCommentCount?: number
  capturedNewCount?: number
  reusedCount?: number
  failedCount?: number
  missingCount?: number
  status?: 'complete' | 'incomplete' | 'failed'
  error?: string
}

export interface StartAccountCommentCaptureRequest {
  type: 'START_ACCOUNT_COMMENT_CAPTURE'
  platform: Platform
  username: string
  expectedComment?: string
}

export interface AccountCommentScreenshotTarget {
  commentId?: string
  commentKey: string
  commentText: string
  author: string
  platformDisplayedTime?: string
  clip: { x: number; y: number; width: number; height: number }
}

export interface StartAccountCommentCaptureResult {
  success: boolean
  error?: string
  rootFound?: boolean
  modalFound?: boolean
  candidateCount?: number
  matchingCount?: number
  scrollContainerFound?: boolean
}

export interface NextAccountCommentCaptureRequest {
  type: 'NEXT_ACCOUNT_COMMENT_CAPTURE'
}

export interface NextAccountCommentCaptureResult {
  success: boolean
  done: boolean
  target?: AccountCommentScreenshotTarget
  error?: string
  candidateCount?: number
  matchingCount?: number
  advanceAttempts?: number
}

export interface EndAccountCommentCaptureRequest {
  type: 'END_ACCOUNT_COMMENT_CAPTURE'
}

export interface GenerateAiComment {
  type: 'GENERATE_AI_COMMENT'
  platform: Platform
  url: string
  articleText: string
}

export interface TrustedToutiaoComment {
  type: 'TRUSTED_TOUTIAO_COMMENT'
  text: string
}

export interface TrustedZhihuComment {
  type: 'TRUSTED_ZHIHU_COMMENT'
  text: string
}

export interface TrustedBaijiahaoComment {
  type: 'TRUSTED_BAIJIAHAO_COMMENT'
  text: string
}

export interface TrustedCsdnComment {
  type: 'TRUSTED_CSDN_COMMENT'
  text: string
}

export interface ClientCommand {
  type: 'CLIENT_COMMAND'
  command: string
  payload?: unknown
}

/** Batch scan request from popup */
export interface BatchScanRequest {
  type: 'BATCH_SCAN'
  urls: string[]
}

/** Batch scan progress */
export interface BatchScanProgress {
  type: 'BATCH_PROGRESS'
  current: number
  total: number
  url: string
}

/** 单条批量扫描完成，用于展示准确的已完成进度 */
export interface BatchItemComplete {
  type: 'BATCH_ITEM_COMPLETE'
  current: number
  completed: number
  total: number
  url: string
}

/** 用户主动停止当前批量检测 */
export interface BatchCancelRequest {
  type: 'BATCH_CANCEL'
}

/** 后台确认批量检测已停止，并返回已完成的结果 */
export interface BatchCancelled {
  type: 'BATCH_CANCELLED'
  results: BatchResultItem[]
}

/** Popup 请求当前标签页的扫描结果 */
export interface GetCurrentResult {
  type: 'GET_CURRENT_RESULT'
}

/** 数据中心清空记录后，通知内容脚本丢弃当前页面的旧扫描结果。 */
export interface ClearScanCache {
  type: 'CLEAR_SCAN_CACHE'
}

/** Update badge on toolbar */
export interface UpdateBadgeMessage {
  type: 'UPDATE_BADGE'
  count: number
}

/** Content script → Background: 保存扫描结果 */
export interface SaveScanResult {
  type: 'SAVE_SCAN_RESULT'
  platform: Platform
  url: string
  title: string
  commentCount: number
  totalCommentCount?: number
  username: string
  linkStatus?: LinkStatus
  liked?: boolean
  collected?: boolean
}

/** Content script → Background: 请求网易公开评论接口。 */
export interface FetchNeteaseComments {
  type: 'FETCH_NETEASE_COMMENTS'
  url: string
}

/** Content script → Background: 请求百家号官方评论接口（绕过前台 CORS 与 DOM 节流）。 */
export interface FetchBaijiahaoComments {
  type: 'FETCH_BAIJIAHAO_COMMENTS'
  threadId: string
  start?: number
  num?: number
}

/** Background → Popup: 批量检测完成 */
export interface BatchComplete {
  type: 'BATCH_COMPLETE'
  results: BatchResultItem[]
}

export type ExtensionMessage =
  | ScanRequest
  | ScanArchiveMetadataRequest
  | ScanResponse
  | BatchScanRequest
  | BatchScanProgress
  | BatchItemComplete
  | BatchCancelRequest
  | BatchCancelled
  | GetCurrentResult
  | ClearScanCache
  | UpdateBadgeMessage
  | SaveScanResult
  | FetchNeteaseComments
  | FetchBaijiahaoComments
  | BatchComplete
  | SupplementPageRequest
  | SupplementResult
  | GenerateAiComment
  | TrustedToutiaoComment
  | TrustedZhihuComment
  | TrustedBaijiahaoComment
  | TrustedCsdnComment
  | CaptureCommentEvidenceRequest
  | VerifyCommentEvidenceRequest
  | VerifyCommentOnlineRequest
  | CaptureUrlArchiveRequest
  | StartAccountCommentCaptureRequest
  | NextAccountCommentCaptureRequest
  | EndAccountCommentCaptureRequest
  | ClientCommand
