import { getCommentEvidence } from '@db/index'
import { PlatformLabel } from '@shared/types'

function fileSafe(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || '评论区存档'
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function showError(message: string) {
  const empty = document.getElementById('empty')!
  empty.hidden = false
  empty.textContent = message
  document.getElementById('archive-frame')!.hidden = true
  document.getElementById('image-stage')!.hidden = true
  const status = document.getElementById('integrity-status')!
  status.classList.add('error')
  status.textContent = message
}

async function init() {
  const id = new URLSearchParams(location.search).get('id') || ''
  if (!id) {
    showError('缺少存档编号，无法打开。')
    return
  }
  const snapshot = await getCommentEvidence(id)
  if (!snapshot) {
    showError('该评论区存档不存在或已经被删除。')
    return
  }

  const isImage = snapshot.archiveFormat === 'image' && Boolean(snapshot.imageDataUrl)
  const payload = isImage ? snapshot.imageDataUrl || '' : snapshot.htmlDocument || ''
  if (!payload) {
    showError('该存档没有可显示的内容。')
    return
  }

  document.title = `${isImage ? '评论截图' : '旧版评论区存档'} - ${snapshot.title || PlatformLabel[snapshot.platform]}`
  document.getElementById('archive-title')!.textContent = snapshot.title || (isImage ? '评论截图' : '评论区存档')
  document.getElementById('archive-meta')!.textContent = `${PlatformLabel[snapshot.platform]} · ${new Date(snapshot.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${snapshot.username || '未记录账号'}`
  const frame = document.getElementById('archive-frame') as HTMLIFrameElement
  const imageStage = document.getElementById('image-stage')!
  const image = document.getElementById('archive-image') as HTMLImageElement
  if (isImage) {
    frame.hidden = true
    imageStage.hidden = false
    image.src = snapshot.imageDataUrl || ''
    image.alt = snapshot.comment ? `评论截图：${snapshot.comment}` : '评论截图'
    const closeZoom = () => imageStage.classList.remove('zoomed')
    image.addEventListener('click', (event) => {
      event.stopPropagation()
      imageStage.classList.toggle('zoomed')
    })
    imageStage.addEventListener('click', closeZoom)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeZoom()
    })
  } else {
    imageStage.hidden = true
    frame.hidden = false
    frame.srcdoc = snapshot.htmlDocument || ''
  }

  const actualHash = await sha256Hex(payload)
  const status = document.getElementById('integrity-status')!
  if (actualHash === snapshot.sha256) {
    status.textContent = `完整性校验通过 · SHA-256 ${snapshot.sha256}`
  } else {
    status.classList.add('error')
    status.textContent = '完整性校验失败：本地存档内容与保存时的校验值不一致。'
  }

  document.getElementById('open-source')!.addEventListener('click', () => {
    chrome.tabs.create({ url: snapshot.url })
  })
  const exportButton = document.getElementById('export-archive') as HTMLButtonElement
  exportButton.textContent = isImage ? '导出图片' : '导出 HTML'
  exportButton.addEventListener('click', () => {
    const anchor = document.createElement('a')
    let objectUrl = ''
    if (isImage) {
      anchor.href = snapshot.imageDataUrl || ''
      anchor.download = `${fileSafe(snapshot.title)}_${snapshot.createdAt.slice(0, 10)}_${fileSafe(snapshot.commentId || snapshot.sha256.slice(0, 10))}.webp`
    } else {
      objectUrl = URL.createObjectURL(new Blob([snapshot.htmlDocument || ''], { type: 'text/html;charset=utf-8' }))
      anchor.href = objectUrl
      anchor.download = `${fileSafe(snapshot.title)}_${snapshot.createdAt.slice(0, 10)}.html`
    }
    anchor.click()
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  })
}

init().catch(error => showError(`读取存档失败：${String((error as Error)?.message || error)}`))
