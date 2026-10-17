

// vite.config.js
import { defineConfig } from 'vite'
import { assetCachePlugin } from './scripts/asset-cache-plugin.mjs'

export default defineConfig({
  plugins: [assetCachePlugin()],
  // GitHub Pages 项目站点路径，与仓库名称保持一致。
  base: '/dontstarve-web/',
  server:'0.0.0.0'
})
