// Builds the relay into one file and ships it to the VM through its metadata (no SSH):
//   node relay/deploy.mjs          build + deploy
//   node relay/deploy.mjs --build  build only (relay/dist/relay.mjs)
// The VM's watcher (relay/vm-startup.sh) sees the new code within seconds and restarts the relay.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist', 'relay.mjs')

await build({
  entryPoints: [join(here, 'server.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'none'
})
console.log(`built ${out}`)

if (!process.argv.includes('--build')) {
  const project = process.env.DREAMWALKER_GCP_PROJECT || 'dreamwalker-softablitz'
  const gcloud = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud'
  execFileSync(
    gcloud,
    ['compute', 'instances', 'add-metadata', 'dw-relay', '--zone', 'us-central1-a', `--project=${project}`, `--metadata-from-file=relay-js=${out}`],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  )
  console.log('deployed: the relay restarts with it in a few seconds')
}
