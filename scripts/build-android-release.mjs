import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const required = ['ANDROID_KEYSTORE_FILE', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
const missing = required.filter(name => !process.env[name])
if (missing.length) {
  console.error(`Release signing inputs missing: ${missing.join(', ')}`)
  process.exit(2)
}
const androidDir = resolve(import.meta.dirname, '..', 'android')
const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const result = spawnSync(executable, ['clean', 'bundleRelease', 'assembleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
