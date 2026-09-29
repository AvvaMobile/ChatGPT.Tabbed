// Builds Developer ID signed + Apple notarized macOS DMGs (Apple Silicon and Intel) on this Mac.
//
// The signing certificate stays in the local keychain and the App Store Connect API key stays on
// disk; nothing is uploaded anywhere except to Apple's notary service.
//
// Configuration (environment variables, or KEY=VALUE lines in the git-ignored .env.signing.local):
//   APPLE_API_KEY_ID        App Store Connect API key id (required)
//   APPLE_API_ISSUER        App Store Connect issuer id (required)
//   APPLE_API_KEY           path to AuthKey_<id>.p8 (default: ~/.appstoreconnect/private_keys/AuthKey_<id>.p8)
//   MAC_SIGNING_IDENTITY    "Developer ID Application: …" name (default: first one found in the keychain)
//
// Usage: npm run package:mac:signed
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Arch, build, Platform } from 'electron-builder'
import yaml from 'js-yaml'

const root = resolve(import.meta.dirname, '..')

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function loadLocalEnv() {
  const file = join(root, '.env.signing.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2]
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

function findSigningIdentity() {
  if (process.env.MAC_SIGNING_IDENTITY) return process.env.MAC_SIGNING_IDENTITY
  const output = run('security', ['find-identity', '-v', '-p', 'codesigning'])
  const match = output.match(/"(Developer ID Application: [^"]+)"/)
  if (!match) fail('No "Developer ID Application" certificate found in the keychain.')
  return match[1]
}

if (process.platform !== 'darwin') fail('Signed macOS builds can only be created on macOS.')
loadLocalEnv()

const keyId = process.env.APPLE_API_KEY_ID
const issuer = process.env.APPLE_API_ISSUER
if (!keyId || !issuer) fail('APPLE_API_KEY_ID and APPLE_API_ISSUER must be set (see the header of this script).')
const keyPath = process.env.APPLE_API_KEY || join(homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${keyId}.p8`)
if (!existsSync(keyPath)) fail(`App Store Connect API key not found at ${keyPath}`)
process.env.APPLE_API_KEY = keyPath

const identity = findSigningIdentity()
console.log(`• signing identity: ${identity}`)

const baseConfig = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
const config = {
  ...baseConfig,
  mac: {
    ...baseConfig.mac,
    identity: identity.replace(/^Developer ID Application:\s*/, ''),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: true
  },
  dmg: { ...baseConfig.dmg, sign: true }
}

const artifacts = await build({
  projectDir: root,
  targets: Platform.MAC.createTarget(['dmg'], Arch.arm64, Arch.x64),
  config,
  publish: 'never'
})
const dmgs = artifacts.filter((file) => file.endsWith('.dmg'))
if (dmgs.length === 0) fail('electron-builder produced no DMG files.')

const notaryAuth = ['--key', keyPath, '--key-id', keyId, '--issuer', issuer]

// The apps inside were notarized and stapled by electron-builder. Notarize and staple the DMG
// containers as well, so the downloaded file itself passes Gatekeeper offline.
for (const dmg of dmgs) {
  console.log(`• notarizing ${dmg}`)
  const result = run('xcrun', ['notarytool', 'submit', dmg, ...notaryAuth, '--wait', '--output-format', 'json'], {
    maxBuffer: 16 * 1024 * 1024
  })
  const status = JSON.parse(result).status
  if (status !== 'Accepted') fail(`Notarization of ${dmg} finished with status ${status}`)
  run('xcrun', ['stapler', 'staple', dmg])
}

console.log('\n• verifying')
const releaseDir = join(root, 'release')
const apps = readdirSync(releaseDir)
  .filter((dir) => dir.startsWith('mac'))
  .map((dir) => join(releaseDir, dir, 'ChatGPT Tabs.app'))
  .filter((app) => existsSync(app))

for (const app of apps) {
  run('codesign', ['--verify', '--deep', '--strict', app])
  // Throws unless Gatekeeper accepts the app.
  run('spctl', ['--assess', '--type', 'execute', app])
  run('xcrun', ['stapler', 'validate', app])
  console.log(`  ok  ${app.replace(root + '/', '')} (signed, notarized, stapled, accepted by Gatekeeper)`)
}
for (const dmg of dmgs) {
  run('xcrun', ['stapler', 'validate', dmg])
  const sha = createHash('sha256').update(readFileSync(dmg)).digest('hex')
  console.log(`  ok  ${dmg.replace(root + '/', '')}\n      sha256 ${sha}`)
}
console.log('\n✔ signed and notarized macOS packages are ready in release/')
