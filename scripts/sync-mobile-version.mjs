import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(pkg.version)
if (!match) throw new Error(`package.json version is not semver: ${pkg.version}`)
const [, major, minor, patch] = match
const versionCode = Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch)
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
  throw new Error(`Android versionCode out of range: ${versionCode}`)
}
const output = `# Generated from package.json by scripts/sync-mobile-version.mjs\nDONUTCODE_VERSION_NAME=${pkg.version}\nDONUTCODE_VERSION_CODE=${versionCode}\nDONUTCODE_SOURCE_COMMIT=${process.env.GITHUB_SHA ?? process.env.SOURCE_COMMIT ?? 'development'}\n`
writeFileSync(resolve(root, 'android/app/version.properties'), output)
console.log(`Android version ${pkg.version} (${versionCode})`)
