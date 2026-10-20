 /**
  * 构建后复制 manifest.json 和图标到 dist 目录
  */
 import { resolve, dirname } from 'path'
 import { fileURLToPath } from 'url'
 import fs from 'fs'
 
 const __dirname = dirname(fileURLToPath(import.meta.url))
 const root = resolve(__dirname, '..')
 const src = resolve(root, 'manifest.json')
 const releaseBuild = process.env.RELEASE_BUILD === '1'
 const outDir = resolve(root, releaseBuild ? 'release-dist' : 'dist')
 // Copy manifest.json
 fs.copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'))
 console.log('Copied manifest.json')
 
 // Copy icons
 const iconDir = resolve(root, 'public/icons')
 const outIconDir = resolve(outDir, 'icons')
 if (fs.existsSync(iconDir)) {
   if (!fs.existsSync(outIconDir)) fs.mkdirSync(outIconDir, { recursive: true })
   for (const f of fs.readdirSync(iconDir)) {
     fs.copyFileSync(resolve(iconDir, f), resolve(outIconDir, f))
   }
   console.log('Copied icons')
 }
 
 // HTML files remain in dist/src/ (Vite output structure)
 // Manifest already references src/popup.html etc.
