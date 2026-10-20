/**
 * 生成用于外发的生产版本。
 * UI 由 Vite 默认压缩；content scripts 与 service worker 通过 RELEASE_BUILD
 * 开启 esbuild 压缩、移除 console/debugger，并始终关闭 Source Map。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'release-dist')
if (dirname(dist) !== root || basename(dist) !== 'release-dist') {
  console.error('发布失败：release-dist 目录安全检查未通过。')
  process.exit(1)
}
// release-dist 完全由正式构建生成，不与 Chrome 当前加载的开发版 dist 共用。
for (let i = 0; i < 10; i++) {
  try { rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  if (!existsSync(dist)) break
  spawnSync('node', ['-e', 'setTimeout(()=>{}, 150)'])
}
if (existsSync(dist)) {
  console.error('发布失败：旧 release-dist 目录未能清理。')
  process.exit(1)
}

const isWindows = process.platform === 'win32'
const command = isWindows ? process.env.ComSpec || 'cmd.exe' : 'npm'
const args = isWindows ? ['/d', '/s', '/c', 'npm.cmd run build'] : ['run', 'build']
const result = spawnSync(command, args, {
  cwd: root,
  env: { ...process.env, RELEASE_BUILD: '1' },
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
})

if (result.status !== 0) process.exit(result.status || 1)

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath]
  })
}

/** 只保留当前 HTML/JS/CSS 依赖图真正引用的哈希资源，清除历史构建残留。 */
function pruneUnreferencedAssets() {
  const assetsDir = resolve(dist, 'assets')
  if (!existsSync(assetsDir)) return

  const referenced = new Set()
  const queue = []
  const addAsset = name => {
    const normalized = name.replace(/^assets\//, '')
    const fullPath = resolve(assetsDir, normalized)
    if (!existsSync(fullPath) || referenced.has(normalized)) return
    referenced.add(normalized)
    queue.push(fullPath)
  }

  for (const html of listFiles(resolve(dist, 'src')).filter(file => file.endsWith('.html'))) {
    const content = readFileSync(html, 'utf8')
    for (const match of content.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?))/g)) {
      addAsset(match[1])
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()
    if (!/\.(?:js|css)$/.test(file)) continue
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(/(?:\.\/|\/assets\/|["'`]assets\/)([A-Za-z0-9_.-]+\.(?:js|css|png|svg|woff2?))/g)) {
      addAsset(match[1])
    }
  }

  let removed = 0
  for (const file of listFiles(assetsDir)) {
    if (!referenced.has(basename(file))) {
      rmSync(file, { force: true })
      removed += 1
    }
  }
  console.log(`Release assets verified: kept ${referenced.size}, removed ${removed} stale files.`)
}

pruneUnreferencedAssets()

const sourceMaps = listFiles(dist).filter(file => file.endsWith('.map'))
if (sourceMaps.length > 0) {
  console.error('发布失败：dist 中发现 Source Map。')
  process.exit(1)
}

const sourceFiles = listFiles(dist).filter(file => /\.(?:ts|tsx|vue)$/.test(file))
if (sourceFiles.length > 0) {
  console.error('发布失败：dist 中发现源码文件。')
  process.exit(1)
}

const oldProductNameFiles = listFiles(dist).filter(file => {
  if (!/\.(?:js|html|json|txt)$/.test(file)) return false
  return readFileSync(file, 'utf8').includes('AI内容运营助手')
})
if (oldProductNameFiles.length > 0) {
  console.error('发布失败：dist 中发现旧产品名称残留。')
  process.exit(1)
}

const requiredFiles = ['manifest.json', 'background.js', 'content/index.js']
for (const file of requiredFiles) {
  const fullPath = resolve(dist, file)
  if (!statSync(fullPath).isFile()) {
    console.error(`发布失败：缺少 ${file}`)
    process.exit(1)
  }
}

const protectedScripts = listFiles(resolve(dist, 'content')).concat(resolve(dist, 'background.js'))
for (const file of protectedScripts) {
  const code = readFileSync(file, 'utf8')
  // 只拦截真正的 debugger 语句；chrome.debugger 是今日头条受信任输入所需的合法 API。
  if (/\bconsole\.|\bdebugger\s*;/.test(code)) {
    console.error(`发布失败：${file} 中仍包含调试代码。`)
    process.exit(1)
  }
}

console.log('Release build verified: minified scripts, no source files/maps/debug output.')

// 自动同步到 01_客户使用/浏览器插件
const clientPluginDir = resolve(root, '../../01_客户使用/浏览器插件')
if (existsSync(clientPluginDir)) {
  for (const f of readdirSync(clientPluginDir)) {
    rmSync(resolve(clientPluginDir, f), { recursive: true, force: true })
  }
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    const srcPath = resolve(dist, entry.name)
    const destPath = resolve(clientPluginDir, entry.name)
    if (entry.isDirectory()) {
      function copyRecursive(src, dest) {
        if (!existsSync(dest)) rmSync(dest, { force: true }), readdirSync;
        spawnSync('cmd.exe', ['/c', 'xcopy', '/E', '/I', '/Y', src, dest])
      }
      copyRecursive(srcPath, destPath)
    } else {
      spawnSync('cmd.exe', ['/c', 'copy', '/Y', srcPath, destPath])
    }
  }
  console.log('Successfully synchronized to 01_客户使用/浏览器插件')
}

