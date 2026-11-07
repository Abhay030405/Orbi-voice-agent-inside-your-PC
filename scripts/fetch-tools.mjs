// Downloads Google's Android platform-tools (adb) for phone control (M4). Run once: npm run tools
// Source: Google's official download (https://developer.android.com/tools/releases/platform-tools).
// We keep only what adb needs on Windows: adb.exe and its two DLLs. (macOS/Linux: install adb from the
// system's package manager; Dreamwalker also looks for adb on PATH.)

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
const KEEP = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll']
const target = join(import.meta.dirname, '..', 'resources', 'platform-tools')

if (process.platform !== 'win32') {
  console.log('Not Windows: install adb with your package manager (e.g. `brew install android-platform-tools`).')
  process.exit(0)
}
if (KEEP.every((f) => existsSync(join(target, f)))) {
  console.log(`adb is already in ${target}`)
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'dw-tools-'))
try {
  console.log(`Downloading ${URL} …`)
  const res = await fetch(URL)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  writeFileSync(join(work, 'pt.zip'), Buffer.from(await res.arrayBuffer()))
  // Windows' own tar reads .zip files. Relative names + cwd: GNU tar (Git Bash) misreads "C:\…".
  const members = KEEP.map((f) => `platform-tools/${f}`)
  const tar = spawnSync('tar', ['-xf', 'pt.zip', ...members], { cwd: work, stdio: 'inherit' })
  if (tar.status !== 0) throw new Error('could not unpack the zip')
  mkdirSync(target, { recursive: true })
  for (const f of KEEP) copyFileSync(join(work, 'platform-tools', f), join(target, f))
  console.log(`adb is ready in ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
