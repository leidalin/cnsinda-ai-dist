import type { CommentEvidenceSnapshot, CommentRecord, DailySummary, Platform } from '@shared/types'
import { detectPlatform, normalizeArticleUrl } from '@shared/platform'
 
 const DB_NAME = 'AICommentCounter'
 const DB_VERSION = 3
 const STORE_NAME = 'comments'
 const EVIDENCE_STORE_NAME = 'commentEvidence'
 
 function openDB(): Promise<IDBDatabase> {
   return new Promise((resolve, reject) => {
     const request = indexedDB.open(DB_NAME, DB_VERSION)
     request.onupgradeneeded = (event) => {
       const oldVersion = event.oldVersion
       const db = request.result
       if (!db.objectStoreNames.contains(STORE_NAME)) {
         const store = db.createObjectStore(STORE_NAME, {
           keyPath: 'id',
           autoIncrement: true,
         })
         store.createIndex('url', 'url', { unique: false })
         store.createIndex('platform', 'platform', { unique: false })
         store.createIndex('checkTime', 'checkTime', { unique: false })
         store.createIndex('url_platform', ['url', 'platform'], { unique: true })
       }
       if (!db.objectStoreNames.contains(EVIDENCE_STORE_NAME)) {
         const evidenceStore = db.createObjectStore(EVIDENCE_STORE_NAME, { keyPath: 'id' })
         evidenceStore.createIndex('createdAt', 'createdAt', { unique: false })
         evidenceStore.createIndex('url', 'url', { unique: false })
       }
       if (request.transaction && oldVersion < 3 && db.objectStoreNames.contains(STORE_NAME)) {
         const store = request.transaction.objectStore(STORE_NAME)
         store.openCursor().onsuccess = (event) => {
           const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
           if (!cursor) return
           const record = cursor.value as CommentRecord
           // V1/V2 used `sohu` for every unsupported URL. Keep real Sohu URLs;
           // migrate all other legacy rows to the explicit third-party type.
           if (record.platform === 'sohu' && detectPlatform(record.url) !== 'sohu') {
             cursor.update({ ...record, platform: 'third_party' })
           }
           cursor.continue()
         }
       }
     }
     request.onsuccess = () => resolve(request.result)
     request.onerror = () => reject(request.error)
   })
 }

function waitForTransaction(tx: IDBTransaction, fallbackMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(fallbackMessage))
    tx.onabort = () => reject(tx.error || new Error(fallbackMessage))
  })
}

/** 保存一份不可变的评论截图或旧版静态 HTML 存档。 */
export async function saveCommentEvidence(snapshot: CommentEvidenceSnapshot): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite')
  tx.objectStore(EVIDENCE_STORE_NAME).put(snapshot)
  await waitForTransaction(tx, '保存评论区存档失败')
}

export async function getCommentEvidence(id: string): Promise<CommentEvidenceSnapshot | undefined> {
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readonly')
  const request = tx.objectStore(EVIDENCE_STORE_NAME).get(id)
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as CommentEvidenceSnapshot | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function getAllCommentEvidence(): Promise<CommentEvidenceSnapshot[]> {
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readonly')
  const request = tx.objectStore(EVIDENCE_STORE_NAME).getAll()
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as CommentEvidenceSnapshot[])
    request.onerror = () => reject(request.error)
  })
}

export async function deleteCommentEvidence(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite')
  tx.objectStore(EVIDENCE_STORE_NAME).delete(id)
  await waitForTransaction(tx, '删除评论区存档失败')
}

export async function clearAllCommentEvidence(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite')
  tx.objectStore(EVIDENCE_STORE_NAME).clear()
  await waitForTransaction(tx, '清空评论区存档失败')
}

/** 评论历史最多保留 500 条；图片截图独立保留，只清理失去引用的旧版 HTML。 */
export async function pruneCommentEvidence(keepIds: string[]): Promise<void> {
  const keep = new Set(keepIds.filter(Boolean))
  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite')
  const store = tx.objectStore(EVIDENCE_STORE_NAME)
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const snapshot = cursor.value as CommentEvidenceSnapshot
      if (snapshot.archiveFormat !== 'image' && snapshot.source !== 'manual_scan' && !keep.has(snapshot.id)) cursor.delete()
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
  await waitForTransaction(tx, '清理过期评论区存档失败')
}

/** 旧版手动 HTML 每链接保留 20 份、全局保留 1000 份；图片截图不自动清理。 */
export async function pruneManualCommentEvidence(
  platform: Platform,
  url: string,
  perUrlLimit = 20,
  totalLimit = 1000,
): Promise<void> {
  const normalizedUrl = normalizeArticleUrl(url, platform)
  const snapshots = (await getAllCommentEvidence())
    .filter(snapshot => snapshot.source === 'manual_scan' && snapshot.archiveFormat !== 'image')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const forUrl = snapshots.filter(snapshot => snapshot.platform === platform
    && normalizeArticleUrl(snapshot.url, snapshot.platform) === normalizedUrl)
  const deleteIds = new Set([
    ...forUrl.slice(Math.max(1, perUrlLimit)).map(snapshot => snapshot.id),
    ...snapshots.slice(Math.max(1, totalLimit)).map(snapshot => snapshot.id),
  ])
  if (deleteIds.size === 0) return

  const db = await openDB()
  const tx = db.transaction(EVIDENCE_STORE_NAME, 'readwrite')
  const store = tx.objectStore(EVIDENCE_STORE_NAME)
  for (const id of deleteIds) store.delete(id)
  await waitForTransaction(tx, '清理过期手动快照失败')
}
 
 /** 保存一条评论记录（若同 URL+平台 已存在则更新） */
export async function saveRecord(record: Omit<CommentRecord, 'id'>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)

  // 扫描页可能暂时读不到延迟挂载的互动控件。undefined 代表“本次未知”，
  // 不能覆盖此前已确认的 true/false；明确读取到 false 时仍会正常更新。
  const definedRecord = Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Omit<CommentRecord, 'id'>
  const normalizedRecord = {
    ...definedRecord,
    url: normalizeArticleUrl(record.url, record.platform),
  }
  const records = await new Promise<CommentRecord[]>((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const matches = records
    .filter(item => item.platform === normalizedRecord.platform
      && normalizeArticleUrl(item.url, item.platform) === normalizedRecord.url)
    .sort((a, b) => b.checkTime.localeCompare(a.checkTime))
  const existing = matches[0]

  // 合并历史中同一链接的参数变体，只保留一条记录。
  for (const duplicate of matches.slice(1)) {
    if (duplicate.id != null) store.delete(duplicate.id)
  }

  if (existing) {
    store.put({ ...existing, ...normalizedRecord })
  } else {
    store.add(normalizedRecord)
  }
 
   await new Promise<void>((resolve, reject) => {
     tx.oncomplete = () => resolve()
     tx.onerror = () => reject(tx.error)
   })
 }
 
 /** 批量保存 */
 export async function saveRecords(records: Omit<CommentRecord, 'id'>[]): Promise<void> {
   for (const r of records) {
     await saveRecord(r)
   }
 }
 
 /** 查询今日统计 */
export async function getTodaySummary(): Promise<DailySummary> {
  const now = new Date()
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const db = await openDB()
   const tx = db.transaction(STORE_NAME, 'readonly')
   const store = tx.objectStore(STORE_NAME)
   const index = store.index('checkTime')
  const range = IDBKeyRange.bound(start.toISOString(), end.toISOString())
 
   const records = await new Promise<CommentRecord[]>((resolve, reject) => {
     const req = index.getAll(range)
     req.onsuccess = () => resolve(req.result)
     req.onerror = () => reject(req.error)
   })
 
  const byPlatform: Record<Platform, number> = {
    csdn: 0,
    zhihu: 0,
    toutiao: 0,
    baijiahao: 0,
    netease: 0,
    sohu: 0,
    third_party: 0,
  }
   let total = 0
   for (const r of records) {
     byPlatform[r.platform] = (byPlatform[r.platform] || 0) + r.commentCount
     total += r.commentCount
   }
 
   return { date: today, byPlatform, total }
 }
 
 /** 获取所有历史记录 */
export async function getAllRecords(): Promise<CommentRecord[]> {
   const db = await openDB()
   const tx = db.transaction(STORE_NAME, 'readonly')
   const store = tx.objectStore(STORE_NAME)
   return new Promise((resolve, reject) => {
     const req = store.getAll()
     req.onsuccess = () => resolve(req.result)
     req.onerror = () => reject(req.error)
   })
 }

/** 删除一个平台下同一规范化链接的全部历史参数变体。 */
export async function deleteRecord(platform: Platform, url: string): Promise<void> {
  const normalizedUrl = normalizeArticleUrl(url, platform)
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)

  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const record = cursor.value as CommentRecord
      if (
        record.platform === platform
        && normalizeArticleUrl(record.url, record.platform) === normalizedUrl
      ) cursor.delete()
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('删除扫描记录事务已中止'))
  })
}

/** 永久清空全部扫描记录；今日、历史和 AI 统计会随之归零。 */
export async function clearAllRecords(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction([STORE_NAME, EVIDENCE_STORE_NAME], 'readwrite')
  tx.objectStore(STORE_NAME).clear()
  tx.objectStore(EVIDENCE_STORE_NAME).clear()
  await waitForTransaction(tx, '清空扫描记录事务已中止')
}

/** 按日期统计历史 */
 export async function getHistoryByDate(): Promise<Record<string, { total: number; byPlatform: Record<string, number> }>> {
   const records = await getAllRecords()
   const result: Record<string, { total: number; byPlatform: Record<string, number> }> = {}
   for (const r of records) {
     const day = r.checkTime.slice(0, 10)
     if (!result[day]) result[day] = { total: 0, byPlatform: {} }
     result[day].total += r.commentCount
     result[day].byPlatform[r.platform] = (result[day].byPlatform[r.platform] || 0) + r.commentCount
   }
   return result
 }
