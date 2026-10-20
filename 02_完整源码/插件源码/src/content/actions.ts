import type { Platform, SupplementActions } from '@shared/types'

export interface InteractionResult {
  liked: boolean | null
  collected: boolean | null
  likePerformed: boolean
  collectPerformed: boolean
  warnings: string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanLabel(value: string | null | undefined): string {
  return (value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, '').trim()
}

function visible<T extends HTMLElement>(elements: Iterable<T>): T | null {
  for (const element of elements) {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const hasSize = (rect.width > 0 && rect.height > 0)
      || element.offsetWidth > 0
      || element.offsetHeight > 0
      || element.getClientRects().length > 0
    // position:fixed 元素的 offsetParent 可能为 null，知乎/头条评论弹层因此曾被误判为隐藏。
    if (
      hasSize
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.opacity !== '0'
      && !element.hasAttribute('disabled')
    ) return element
  }
  return null
}

async function waitForVisible<T extends HTMLElement>(
  locate: () => T | null,
  timeoutMs = 10000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  let element = locate()
  while (!element && Date.now() < deadline) {
    await sleep(350)
    element = locate()
  }
  return element
}

function byText(pattern: RegExp, selector = 'button, [role="button"], a, span, div'): HTMLElement | null {
  return visible(Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter(element => pattern.test((element.textContent || '').replace(/\s+/g, ' ').trim())))
}

function stateEvidence(element: HTMLElement): string {
  const visibleDescendants = Array.from(element.querySelectorAll<HTMLElement>('*'))
    .filter(node => {
      const style = window.getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    })
    .slice(0, 40)
  const nodes = [element, ...visibleDescendants]
  return nodes.map(node => [
    node.getAttribute('class') || '',
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.getAttribute('data-state') || '',
    node.getAttribute('data-status') || '',
    node.getAttribute('src') || '',
    node.getAttribute('href') || '',
  ].join(' ')).join(' ')
}

function pressed(element: HTMLElement | null, positive: RegExp, negative?: RegExp): boolean | null {
  if (!element) return null
  const ariaPressed = element.getAttribute('aria-pressed')
  if (ariaPressed === 'true') return true
  if (ariaPressed === 'false') return false
  const ariaChecked = element.getAttribute('aria-checked')
  if (ariaChecked === 'true') return true
  if (ariaChecked === 'false') return false
  const evidence = `${stateEvidence(element)} ${cleanLabel(element.textContent)}`
  if (positive.test(evidence)) return true
  if (negative?.test(evidence)) return false
  // 没有明确的正/负状态证据时不能武断写成“未收藏”，否则会覆盖历史中的真实状态。
  return null
}

async function clickAndConfirm(
  locate: () => HTMLElement | null,
  read: (element: HTMLElement | null) => boolean | null,
  allowClick = true,
): Promise<{ value: boolean | null; performed: boolean }> {
  // 首次定位：若立即命中则 0 延时直接穿透；若由于 SPA 动态渲染尚未挂载，弹性等待至多 1500ms
  let element = locate()
  if (!element && allowClick) {
    element = await waitForVisible(locate, 1500)
  }
  const before = read(element)
  if (before === true || !allowClick) return { value: before, performed: false }
  if (!element) return { value: null, performed: false }
  element.click()
  const deadline = Date.now() + 2000
  let after: boolean | null = before
  do {
    await sleep(150)
    element = locate()
    after = read(element)
    if (after === true) return { value: true, performed: true }
  } while (Date.now() < deadline)
  return { value: after, performed: false }
}

function zhihuLike(): HTMLElement | null {
  return visible(document.querySelectorAll<HTMLElement>('button[aria-label^="赞同"], button[aria-label^="已赞同"]'))
}
function zhihuCollect(): HTMLElement | null {
  return visible(document.querySelectorAll<HTMLElement>('button[aria-label*="收藏"], [role="button"][aria-label*="收藏"]'))
}

async function ensureZhihu(actions: Partial<SupplementActions>): Promise<InteractionResult> {
  const liked = await clickAndConfirm(zhihuLike, element => {
    const label = element?.getAttribute('aria-label') || ''
    return element ? /^已赞同/.test(label) : null
  }, actions.like !== false)
  const collected = await clickAndConfirm(zhihuCollect, element => {
    if (!element) return null
    const label = cleanLabel(element.getAttribute('aria-label'))
    if (/已收藏|取消收藏/.test(label)) return true
    if (label === '收藏') return false
    return pressed(element, /is-active|selected|collected|已收藏|取消收藏/i, /not-collected|uncollected/i)
  }, actions.collect !== false)
  return {
    liked: liked.value,
    collected: collected.value,
    likePerformed: liked.performed,
    collectPerformed: collected.performed,
    warnings: [],
  }
}

async function ensureToutiao(actions: Partial<SupplementActions>): Promise<InteractionResult> {
  const like = () => visible(document.querySelectorAll<HTMLElement>('div.detail-like[role="button"]'))
  const collect = () => visible(document.querySelectorAll<HTMLElement>('div.detail-interaction-collect[role="button"]'))
  const liked = await clickAndConfirm(like, element => pressed(
    element,
    /(?:^|[\s_-])(?:active|liked|selected)(?:$|[\s_-])|cancel(?:-|_)?like|已赞|取消点赞/i,
    /(?:^|[\s_-])(?:inactive|unliked|not-liked)(?:$|[\s_-])|去点赞/i,
  ), actions.like !== false)
  const collected = await clickAndConfirm(collect, element => pressed(
    element,
    /(?:^|[\s_-])(?:active|collected|selected)(?:$|[\s_-])|cancel(?:-|_)?collect|已收藏|取消收藏/i,
    /(?:^|[\s_-])(?:inactive|uncollected|not-collected)(?:$|[\s_-])|去收藏/i,
  ), actions.collect !== false)
  return {
    liked: liked.value,
    collected: collected.value,
    likePerformed: liked.performed,
    collectPerformed: collected.performed,
    warnings: [],
  }
}

async function ensureCsdn(actions: Partial<SupplementActions>): Promise<InteractionResult> {
  const like = () => visible(document.querySelectorAll<HTMLElement>('li#is-like'))
  const collect = () => visible(document.querySelectorAll<HTMLElement>('#blog_detail_zk_collection'))
  const readCollected = (element: HTMLElement | null): boolean | null => {
    if (!element) return null
    // CSDN 已收藏时外层仍可能保留 un-collection；真实状态由两张互斥显示的子图标决定。
    const activeIcon = visible(element.querySelectorAll<HTMLElement>(
      'img.collect-status.isactive, img[src*="CollectionActive"], img[src*="collectionActive"]',
    ))
    if (activeIcon) return true
    const inactiveIcon = visible(element.querySelectorAll<HTMLElement>(
      'img.un-collect-status.isdefault, img[src*="tobarCollect2"]',
    ))
    if (inactiveIcon) return false
    return pressed(
      element,
      /is-collection|has-collection|collected|cancel(?:-|_)?collection|已收藏|取消收藏/i,
      /not-collection|去收藏/i,
    )
  }
  const liked = await clickAndConfirm(like, element => {
    if (!element) return null
    return Boolean(document.querySelector<HTMLElement>('#is-like-imgactive.isactive')?.offsetParent)
      || /cancel-like|liked|已赞|取消点赞/i.test(`${element.className} ${element.getAttribute('title') || ''}`)
  }, actions.like !== false)
  const collectedResult = await clickAndConfirm(collect, readCollected, actions.collect !== false)
  let collected = collectedResult.value
  let collectPerformed = collectedResult.performed
  if (actions.collect !== false && collected === false) {
    const folder = visible(document.querySelectorAll<HTMLElement>('ul.csdn-collection-items li .collect-btn'))
    if (folder) {
      folder.click()
      const deadline = Date.now() + 4500
      do {
        await sleep(450)
        collected = readCollected(collect())
        if (collected === true) break
      } while (Date.now() < deadline)
      collectPerformed = collected === true
    }
  }
  return {
    liked: liked.value,
    collected,
    likePerformed: liked.performed,
    collectPerformed,
    warnings: [],
  }
}

function baiduButton(icon: string): HTMLElement | null {
  const direct = Array.from(document.querySelectorAll<HTMLElement>(
    'div.interact-btn, [class*="interact-btn"], [class*="like-btn"], [class*="collect-btn"], .tool-item, [class*="tool-btn"]',
  )).filter(element => Boolean(element.querySelector(`img[src*="${icon}"]`)))
  const found = visible(direct)
  if (found) return found
  const img = document.querySelector<HTMLImageElement>(`img[src*="${icon}"]`)
  return img ? (img.closest<HTMLElement>('button, [role="button"], div, a') || img) : null
}

async function ensureBaijiahao(actions: Partial<SupplementActions>): Promise<InteractionResult> {
  const read = (element: HTMLElement | null) => {
    if (!element) return null
    const state = pressed(
      element,
      /_on\b|(?:^|[\s_-])(?:active|selected|checked|collected|liked)(?:$|[\s_-])|已收藏|取消收藏|已点赞|取消点赞/i,
      /_off\b|(?:^|[\s_-])(?:inactive|unselected|not-collected|not-liked)(?:$|[\s_-])|去收藏|去点赞/i,
    )
    if (state !== null) return state
    const imageSrc = element.querySelector('img')?.getAttribute('src') || ''
    // 百家号未选中图标长期使用无 _on/active 后缀的基础 icon_great/icon_collect。
    if (/icon_(?:great|collect)/i.test(imageSrc)) return false
    return null
  }
  const liked = await clickAndConfirm(() => baiduButton('icon_great'), read, actions.like !== false)
  const collected = await clickAndConfirm(() => baiduButton('icon_collect'), read, actions.collect !== false)
  return {
    liked: liked.value,
    collected: collected.value,
    likePerformed: liked.performed,
    collectPerformed: collected.performed,
    warnings: [],
  }
}

function sohuLikeElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '.share-interaction-c .wrap.like-c-1',
    '.share-interaction-c .like-c-1',
    '.share-interaction-c .like-c-2',
    '.share-interaction-c .like-c-3',
    '.share-interaction-c [class*="like-c"]',
    '#shareInteraction [class*="like-c"]',
    '.share-interaction [class*="like-c"]',
    '[class*="like-c-1"]',
    '[class*="like-c-2"]',
    '[class*="like-c-3"]',
    '.like-btn-area',
    '.action-item .like-btn-area',
    '[class*="like-btn"]',
    '.share-interaction-c .wrap:first-child',
    '[class*="like-icon"]',
  ].join(', ')))
  const found = visible(candidates)
  if (found) return found
  for (const el of candidates) {
    if (el.querySelector('img, svg, i, span') || el.className) return el
  }
  return null
}

function readSohuLiked(element: HTMLElement | null): boolean | null {
  if (!element) return null

  const ariaPressed = element.getAttribute('aria-pressed')
  if (ariaPressed === 'true') return true
  if (ariaPressed === 'false') return false
  const ariaChecked = element.getAttribute('aria-checked')
  if (ariaChecked === 'true') return true
  if (ariaChecked === 'false') return false

  const hasLikedIcon = Boolean(element.querySelector('.liked-icon, .like-icon.liked-icon, [class*="liked-icon"]'))
  if (hasLikedIcon) return true

  const hasNoLikeIcon = Boolean(element.querySelector('.no-like-icon, [class*="no-like"]'))
  if (hasNoLikeIcon) return false

  const hasLikeIcon = Boolean(element.querySelector('.like-icon, [class*="like-icon"]'))
  if (hasLikeIcon && !element.closest('.like-btn-area')) return true

  const evidence = `${element.className} ${stateEvidence(element)} ${cleanLabel(element.textContent)}`
  if (/(?:^|[\s_-])(?:active|liked|selected|has-liked)(?:$|[\s_-])|已赞|已点赞|取消点赞/i.test(evidence)) return true
  if (/(?:^|[\s_-])(?:inactive|unliked|not-liked)(?:$|[\s_-])|去点赞/i.test(evidence)) return false

  return null
}

function sohuCollectElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '.share-interaction-c .wrap.collection-c-1',
    '.share-interaction-c .collection-c-1',
    '.share-interaction-c .collection-c-2',
    '.share-interaction-c .collection-c-3',
    '.share-interaction-c [class*="collection-c"]',
    '#shareInteraction [class*="collection-c"]',
    '.share-interaction [class*="collection-c"]',
    '[class*="collection-c-1"]',
    '[class*="collection-c-2"]',
    '[class*="collection-c-3"]',
    '.collection-btn-area',
    '.action-item .collection-btn-area',
    '[class*="collection-btn"]',
    '[class*="collect-btn"]',
    '[class*="collection-icon"]',
  ].join(', ')))
  const found = visible(candidates)
  if (found) return found
  for (const el of candidates) {
    if (el.querySelector('img, svg, i, span') || el.className) return el
  }
  return null
}

function readSohuCollected(element: HTMLElement | null): boolean | null {
  if (!element) return null

  const ariaPressed = element.getAttribute('aria-pressed')
  if (ariaPressed === 'true') return true
  if (ariaPressed === 'false') return false
  const ariaChecked = element.getAttribute('aria-checked')
  if (ariaChecked === 'true') return true
  if (ariaChecked === 'false') return false

  const hasNoCollectionIcon = Boolean(element.querySelector('.no-collection-icon, [class*="no-collection"]'))
  if (hasNoCollectionIcon) return false

  const hasCollectionIcon = Boolean(element.querySelector('.collection-icon, .collected-icon, [class*="collection-icon"], [class*="collected-icon"]'))
  if (hasCollectionIcon) return true

  const evidence = `${element.className} ${stateEvidence(element)} ${cleanLabel(element.textContent)}`
  if (/(?:^|[\s_-])(?:active|collected|selected|has-collected)(?:$|[\s_-])|已收藏|取消收藏/i.test(evidence)) return true
  if (/(?:^|[\s_-])(?:inactive|uncollected|not-collected)(?:$|[\s_-])|去收藏/i.test(evidence)) return false

  return null
}

async function ensureSohu(actions: Partial<SupplementActions>): Promise<InteractionResult> {
  const clickTarget = (locate: () => HTMLElement | null) => () => {
    const el = locate()
    if (!el) return null
    return el.querySelector<HTMLElement>('.icon, .wrap, .item') || el
  }

  const liked = await clickAndConfirm(clickTarget(sohuLikeElement), readSohuLiked, actions.like !== false)
  const collected = await clickAndConfirm(clickTarget(sohuCollectElement), readSohuCollected, actions.collect !== false)
  return {
    liked: liked.value,
    collected: collected.value,
    likePerformed: liked.performed,
    collectPerformed: collected.performed,
    warnings: [],
  }
}

export async function ensureInteractions(
  platform: Platform,
  actions: Partial<SupplementActions> = { like: true, collect: true },
): Promise<InteractionResult> {
  switch (platform) {
    case 'zhihu': return ensureZhihu(actions)
    case 'toutiao': return ensureToutiao(actions)
    case 'csdn': return ensureCsdn(actions)
    case 'baijiahao': return ensureBaijiahao(actions)
    case 'sohu': return ensureSohu(actions)
    // 网易文章页没有文章级点赞/收藏。这里直接跳过，避免误识别评论点赞或推荐列表按钮。
    case 'netease': return { liked: null, collected: null, likePerformed: false, collectPerformed: false, warnings: [] }
    default: return { liked: null, collected: null, likePerformed: false, collectPerformed: false, warnings: ['当前平台等待开发'] }
  }
}

/** 只读取点赞/收藏状态，不触发任何点击。 */
export function readInteractions(platform: Platform): Promise<InteractionResult> {
  return ensureInteractions(platform, { like: false, collect: false })
}

export function extractArticleText(): string {
  const selectors = [
    '.Post-RichText', 'article', '#content_views', '.article-content', '.main-text',
    '.post_body', '#endText', '.content-box', 'main',
  ]
  for (const selector of selectors) {
    const text = document.querySelector<HTMLElement>(selector)?.innerText?.trim() || ''
    if (text.length > 80) return text.slice(0, 8000)
  }
  return (document.body.innerText || '').trim().slice(0, 8000)
}

function setNativeValue(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function setContentEditableValue(element: HTMLElement, value: string) {
  element.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(element)
  selection?.removeAllRanges()
  selection?.addRange(range)

  // Draft.js 等受控编辑器依赖真实的 beforeinput/input 链路，直接改 textContent 不会更新框架状态。
  const inserted = document.execCommand('insertText', false, value)
  if (!inserted || cleanLabel(element.textContent) !== cleanLabel(value)) {
    element.textContent = value
  }

  // execCommand 在今日头条的 contenteditable 中会改动 DOM，但不一定把 input
  // 事件交给框架的受控状态，页面因此仍把“评论”按钮保留为 disable。无论浏览器
  // 是否报告插入成功，都补发一次完整事件，让 React/Vue 从当前 DOM 重新取值。
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: value,
  }))
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

function locateToutiaoDrawer(): HTMLElement | null {
  return visible(document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-label="评论"], .ttp-drawer[role="dialog"], .ttp-drawer, .ttp-portal-wrapper.ttp-comment-drawer',
  ))
}

function locateToutiaoEditor(drawerOnly = false): HTMLElement | null {
  const drawer = locateToutiaoDrawer()
  if (drawerOnly && !drawer) return null
  const root: ParentNode = drawer || document
  return visible(root.querySelectorAll<HTMLElement>(
    '.ttp-comment-input .comment-textarea[contenteditable="true"], [contenteditable="true"], textarea[placeholder*="评论"], textarea[placeholder*="友善"]',
  ))
}

async function postZhihu(text: string): Promise<void> {
  // 评论入口、Draft.js 输入和发布全部交给后台受信任通道处理。内容脚本直接
  // element.click() 在后台标签页中可能不会让知乎挂载评论区。
  const response = await chrome.runtime.sendMessage({
    type: 'TRUSTED_ZHIHU_COMMENT',
    text,
  })
  if (!response?.success) throw new Error(response?.error || '知乎评论操作未完成')
}

async function postToutiao(text: string): Promise<void> {
  // 新版文章会直接渲染正文评论框，旧版则需打开右侧抽屉。正文框已经存在时
  // 不再强制打开抽屉，避免入口点击未挂载抽屉后误报“评论面板不存在”。
  let editor = locateToutiaoEditor()
  let drawer = locateToutiaoDrawer()
  if (!editor) {
    const openers = [
      ...Array.from(document.querySelectorAll<HTMLElement>(
        '[aria-label^="打开评论面板"], div.detail-interaction-comment[role="button"], [class*="interaction-comment"][role="button"]',
      )),
      ...Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .filter(element => /^查看全部\d*条评论$/.test(cleanLabel(element.textContent))),
    ].filter((element, index, all) => all.indexOf(element) === index)

    for (const opener of openers) {
      if (visible([opener]) !== opener) continue
      opener.click()
      const surface = await waitForVisible(
        () => locateToutiaoDrawer() || locateToutiaoEditor(),
        3500,
      )
      if (!surface) continue
      drawer = locateToutiaoDrawer()
      editor = await waitForVisible(() => locateToutiaoEditor(Boolean(drawer)), 3500)
      if (editor) break
    }
  }
  editor ||= await waitForVisible(() => locateToutiaoEditor(Boolean(drawer)), 12000)
  if (!editor) throw new Error('找不到今日头条评论输入框')

  const scope = editor.closest<HTMLElement>('.main-input, [role="dialog"], .ttp-drawer, form') || document.body
  const button = visible(Array.from(scope.querySelectorAll<HTMLButtonElement>('div.main-input button, button.submit-btn'))
    .filter(item => /^(发布|发表|发送|评论)$/.test(cleanLabel(item.textContent))))
  if (!button) throw new Error('找不到今日头条评论按钮')

  const response = await chrome.runtime.sendMessage({
    type: 'TRUSTED_TOUTIAO_COMMENT',
    text,
  })
  if (!response?.success) throw new Error(response?.error || '今日头条评论操作未完成')
}

async function postBaijiahao(text: string): Promise<void> {
  // 百家号只响应受信任的真实键盘链路。直接修改 textarea.value 虽能显示文字，
  // 但 span.send 会一直保留 disabled；输入后还需一次真实按键来同步内部状态。
  const response = await chrome.runtime.sendMessage({
    type: 'TRUSTED_BAIJIAHAO_COMMENT',
    text,
  })
  if (!response?.success) throw new Error(response?.error || '百家号评论操作未完成')
}

async function postNetease(text: string): Promise<void> {
  const editor = await waitForVisible(() => visible(document.querySelectorAll<HTMLElement>(
    '#tieArea textarea.js-cnt-box, #tieArea textarea, #tieArea [contenteditable="true"], .tie-input-bar textarea, textarea[placeholder*="跟贴"], textarea[placeholder*="阳光"], textarea',
  )), 10000)
  if (!editor) throw new Error('找不到网易跟帖输入框')
  editor.focus()
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) setNativeValue(editor, text)
  else {
    editor.textContent = text
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
  const button = await waitForVisible(() => visible(document.querySelectorAll<HTMLElement>(
    '#tieArea .submit-btn.js-submit-btn, #tieArea button[type="submit"], #tieArea .submit-btn, .tie-submit, .m-post .submit, button[type="submit"]',
  )) || byText(/^\s*(我要发贴|发布|发表|跟贴)\s*$/), 6000)
  if (!button) throw new Error('找不到网易跟帖发布按钮')
  button.click()
}

async function postSohu(text: string): Promise<void> {
  const editor = await waitForVisible(() => visible(document.querySelectorAll<HTMLTextAreaElement>(
    '#meComment textarea#commentEditor, .comment-submit textarea[placeholder*="搜狐"]',
  )), 10000)
  if (!editor) throw new Error('找不到搜狐评论输入框')
  editor.focus()
  setNativeValue(editor, text)
  const button = await waitForVisible(() => visible(Array.from(document.querySelectorAll<HTMLElement>(
    '#meComment .comment-submit .submit, #meComment button',
  )).filter(element => /^(发布|发表|评论)$/.test(cleanLabel(element.textContent)))), 6000)
  if (!button) throw new Error('找不到搜狐评论发布按钮')
  button.click()
}

async function postCsdn(text: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: 'TRUSTED_CSDN_COMMENT',
    text,
  })
  if (!response?.success) throw new Error(response?.error || 'CSDN评论操作未完成')
}

export async function postComment(platform: Platform, text: string): Promise<void> {
  switch (platform) {
    case 'zhihu': return postZhihu(text)
    case 'toutiao': return postToutiao(text)
    case 'csdn': return postCsdn(text)
    case 'baijiahao':
      return postBaijiahao(text)
    case 'netease': return postNetease(text)
    case 'sohu': return postSohu(text)
    default: throw new Error('当前平台等待开发，暂不支持评论')
  }
}
