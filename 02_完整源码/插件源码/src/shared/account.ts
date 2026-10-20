import type { Platform } from './types'

export interface PlatformUsernames {
  csdn: string
  zhihu: string
  toutiao: string
  baijiahao: string
  netease: string
  sohu: string
  /** 第三方链接不进行账号检测。 */
  third_party?: string
}

export interface AccountDetectionLog {
  id: string
  time: string
  platform: Platform
  level: 'warning' | 'error' | 'info'
  message: string
  url?: string
}

export const DEFAULT_USERNAMES: PlatformUsernames = {
  csdn: '',
  zhihu: '',
  toutiao: '',
  baijiahao: '',
  netease: '',
  sohu: '',
}

export interface AccountRuntimeState {
  platform: Platform
  status: 'logged_in' | 'auth_required' | 'account_mismatch' | 'unknown'
  configured: string
  detected: string
  time: string
  url: string
}

export function accountStateKey(platform: Platform): string {
  return `accountRuntimeState:${platform}`
}

export const ACCOUNT_LOG_KEY = 'accountDetectionLogs'

function clean(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

/** withSuffix \u662F\u5426\u53EA\u662F base \u8FFD\u52A0\u4E86 1~3 \u4F4D\u5B57\u6BCD\u6570\u5B57\uFF08\u767E\u5EA6\u8D26\u53F7\u91CD\u540D\u65F6\u7CFB\u7EDF\u81EA\u52A8\u8FFD\u52A0\u540E\u7F00\uFF09\u3002 */
function isAccountSuffixVariant(base: string, withSuffix: string): boolean {
  if (!base || !withSuffix.startsWith(base)) return false
  const suffix = withSuffix.slice(base.length)
  return suffix.length > 0 && suffix.length <= 3 && /^[a-zA-Z0-9_-]+$/.test(suffix)
}

/**
 * \u5224\u65AD\u4E24\u4E2A\u8D26\u53F7\u540D\u662F\u5426\u6307\u5411\u540C\u4E00\u4E2A\u4EBA\u3002\u540C\u4E00\u8D26\u53F7\u5728\u4E0D\u540C\u5E73\u53F0\u3001\u4E0D\u540C\u4F4D\u7F6E\u7684\u5C55\u793A\u540D\u53EF\u80FD
 * \u53EA\u5DEE 1~3 \u4F4D\u540E\u7F00\uFF08\u4F8B\u5982\u201C\u5927\u53D4\u7684\u6E29\u67D4\u201D\u4E0E\u201C\u5927\u53D4\u7684\u6E29\u67D4i\u201D\uFF09\uFF0C\u76F4\u63A5\u5168\u7B49\u6BD4\u8F83\u4F1A\u628A
 * \u672C\u4EBA\u5224\u6210\u201C\u8D26\u53F7\u4E0D\u4E00\u81F4\u201D\u5E76\u4E2D\u65AD\u4EFB\u52A1\u3002
 */
export function isSameAccountName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = clean(a)
  const y = clean(b)
  if (!x || !y) return false
  if (x === y || x.toLowerCase() === y.toLowerCase()) return true
  return isAccountSuffixVariant(x, y) || isAccountSuffixVariant(y, x)
}

/** \u8BFB\u53D6\u7528\u6237\u624B\u52A8\u914D\u7F6E\u7684\u5E73\u53F0\u6635\u79F0\uFF08\u672A\u914D\u7F6E\u8FD4\u56DE\u7A7A\u4E32\uFF09\u3002 */
export async function getConfiguredUsername(platform: Platform): Promise<string> {
  try {
    const data = await chrome.storage.sync.get('usernames') as { usernames?: Partial<PlatformUsernames> }
    return clean(data.usernames?.[platform])
  } catch {
    return ''
  }
}

export async function appendAccountLog(
  platform: Platform,
  level: AccountDetectionLog['level'],
  message: string,
): Promise<void> {
  try {
    const data = await chrome.storage.local.get(ACCOUNT_LOG_KEY)
    const existing = Array.isArray(data[ACCOUNT_LOG_KEY])
      ? data[ACCOUNT_LOG_KEY] as AccountDetectionLog[]
      : []
    const entry: AccountDetectionLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      platform,
      level,
      message,
      url: window.location.href,
    }
    await chrome.storage.local.set({
      [ACCOUNT_LOG_KEY]: [entry, ...existing].slice(0, 100),
    })
  } catch (error) {
    console.error('[DL评论助手] 写入账号检测日志失败:', error)
  }
}

/** 手动填写的账号优先；与自动识别不一致时记录警告日志。 */
export async function resolvePlatformUsername(
  platform: Platform,
  detected: string | null,
  detectedAliases: string[] = [],
): Promise<string | null> {
  const data = await chrome.storage.sync.get('usernames') as { usernames?: Partial<PlatformUsernames> }
  const configured = clean(data.usernames?.[platform])
  const detectedName = clean(detected)
  const aliases = [detectedName, ...detectedAliases.map(clean)].filter(Boolean)
  const aliasesMatchConfigured = aliases.some(alias => isSameAccountName(alias, configured))

  const saveState = async (status: AccountRuntimeState['status']) => {
    const state: AccountRuntimeState = {
      platform,
      status,
      configured,
      detected: detectedName || aliases[0] || '',
      time: new Date().toISOString(),
      url: window.location.href,
    }
    await chrome.storage.local.set({ [accountStateKey(platform)]: state })
  }

  if (configured) {
    if (aliases.length > 0 && !aliasesMatchConfigured) {
      const message = `手动账号“${configured}”与自动识别“${detectedName || aliases[0]}”不一致，已按手动账号统计。`
      console.warn(`[DL评论助手-${platform}]`, message)
      await appendAccountLog(platform, 'warning', message)
      await saveState('account_mismatch')
    } else if (aliases.length > 0) {
      await saveState('logged_in')
    } else {
      await saveState('unknown')
    }
    return configured
  }

  await saveState(detectedName ? 'logged_in' : 'auth_required')
  return detectedName || null
}
