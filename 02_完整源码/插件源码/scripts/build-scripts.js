/**
 * 使用 esbuild 构建 content scripts 和 service worker
 * 这些不需要 Vue 处理，直接编译 TypeScript 为独立 JS 文件
 */
import * as esbuild from 'esbuild'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'src')
const releaseBuild = process.env.RELEASE_BUILD === '1'
const outDir = resolve(root, releaseBuild ? 'release-dist' : 'dist')

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
if (!fs.existsSync(resolve(outDir, 'content'))) fs.mkdirSync(resolve(outDir, 'content'), { recursive: true })

const entries = {
  'content/index': resolve(src, 'content/index.ts'),
  'content/csdn': resolve(src, 'content/csdn.ts'),
  'content/zhihu': resolve(src, 'content/zhihu.ts'),
  'content/toutiao': resolve(src, 'content/toutiao.ts'),
  'content/baijiahao': resolve(src, 'content/baijiahao.ts'),
  'content/netease': resolve(src, 'content/netease.ts'),
  background: resolve(src, 'background/index.ts'),
}

async function build() {
  for (const [name, entryPath] of Object.entries(entries)) {
    console.log(`Building ${name}...`)
    await esbuild.build({
      entryPoints: [entryPath],
      outfile: resolve(outDir, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      sourcemap: false,
      minify: releaseBuild,
      legalComments: 'none',
      drop: releaseBuild ? ['console', 'debugger'] : [],
      alias: {
        '@shared': resolve(src, 'shared'),
        '@db': resolve(src, 'db'),
      },
    })
    console.log(`  Done: ${name}.js`)
  }
  console.log('All scripts built successfully.')
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
