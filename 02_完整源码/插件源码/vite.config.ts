 import { defineConfig } from 'vite'
 import vue from '@vitejs/plugin-vue'
 import { resolve } from 'path'
 
 const root = __dirname
 const srcDir = resolve(root, 'src')
 const releaseBuild = process.env.RELEASE_BUILD === '1'
 
 export default defineConfig({
   plugins: [vue()],
   esbuild: releaseBuild ? { drop: ['console', 'debugger'] } : undefined,
   resolve: {
     alias: {
       '@shared': resolve(srcDir, 'shared'),
       '@db': resolve(srcDir, 'db'),
     }
   },
   build: {
     outDir: releaseBuild ? 'release-dist' : 'dist',
     emptyOutDir: true,
     sourcemap: false,
     minify: 'esbuild',
     rollupOptions: {
       input: {
         popup: resolve(srcDir, 'popup.html'),
         dashboard: resolve(srcDir, 'dashboard.html'),
         options: resolve(srcDir, 'options.html'),
         evidence: resolve(srcDir, 'evidence.html'),
       },
       output: {
         entryFileNames: 'assets/[name]-[hash].js',
         chunkFileNames: 'assets/[name]-[hash].js',
         assetFileNames: 'assets/[name]-[hash][extname]',
       }
     }
   }
 })
