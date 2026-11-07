import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite builds THREE kinds of bundles, one per process type:
//   main     src/main/index.ts        → out/main      (Node.js, full OS access)
//   preload  src/preload/*.ts         → out/preload   (one bridge per window type)
//   renderer src/renderer/*.html      → out/renderer  (Chromium pages)
//
// Four windows, four pages, four preloads:
//   index   the main app window (React UI)
//   overlay   the full-screen edge glow (plain TS, receives state + voice level only)
//   companion the floating orb (plain TS, receives state + level, can ask to open/show menu)
//   confirm   the "Allow?" window (plain TS, shows one question, can send one answer)
export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          overlay: resolve('src/preload/overlay.ts'),
          companion: resolve('src/preload/companion.ts'),
          confirm: resolve('src/preload/confirm.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html'),
          companion: resolve('src/renderer/companion.html'),
          confirm: resolve('src/renderer/confirm.html')
        }
      }
    }
  }
})
