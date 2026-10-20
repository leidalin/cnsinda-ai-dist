 import type { ExtensionMessage } from './types'
 
 /** 向当前标签页的 content script 发送消息 */
 export function sendToContentScript<T>(tabId: number, message: ExtensionMessage): Promise<T> {
   return chrome.tabs.sendMessage(tabId, message) as Promise<T>
 }
 
 /** 向 background (service worker) 发送消息 */
 export function sendToBackground<T>(message: ExtensionMessage): Promise<T> {
   return chrome.runtime.sendMessage(message) as Promise<T>
 }
