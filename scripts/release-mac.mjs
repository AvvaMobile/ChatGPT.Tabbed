// Uploads the locally signed + notarized macOS DMGs (from `npm run package:mac:signed`) to an
// existing GitHub release, replacing the ad-hoc signed DMGs built by CI, and refreshes the
// macOS lines of SHA256SUMS.txt. Requires the GitHub CLI (`gh`) to be logged in.
//
// Usage: npm run release:mac -- v1.2.0
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tag = process.argv[2]
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

const gh = (...args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) fail('Pass the release tag, e.g. npm run release:mac -- v1.2.0')
if (tag !== `v${pkg.version}`) fail(`Tag ${tag} does not match package.json version ${pkg.version}`)

const releaseDir = join(root, 'release')
const dmgs = readdirSync(releaseDir)
  .filter((file) => file.endsWith('.dmg') && file.includes(`-${pkg.version}-mac-`))
  .map((file) => join(releaseDir, file))
if (dmgs.length === 0) fail('No DMGs for this version in release/. Run "npm run package:mac:signed" first.')

// Refuse to upload anything that is not notarized.
for (const dmg of dmgs) {
  try {
    execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'ignore' })
  } catch {
    fail(`${basename(dmg)} has no notarization ticket; build it with "npm run package:mac:signed".`)
  }
}

gh('release', 'view', tag, '--json', 'tagName')
console.log(`• uploading ${dmgs.map((dmg) => basename(dmg)).join(', ')} to ${tag}`)
gh('release', 'upload', tag, ...dmgs, '--clobber')

const work = mkdtempSync(join(tmpdir(), 'chatgpt-tabs-release-'))
try {
  let lines = []
  try {
    gh('release', 'download', tag, '--pattern', 'SHA256SUMS.txt', '--dir', work)
    lines = readFileSync(join(work, 'SHA256SUMS.txt'), 'utf8').split('\n').filter(Boolean)
  } catch {
    console.log('• release has no SHA256SUMS.txt yet; creating one')
  }
  const names = new Set(dmgs.map((dmg) => basename(dmg)))
  lines = lines.filter((line) => !names.has(line.trim().split(/\s+/).pop()?.replace(/^\*/, '') ?? ''))
  for (const dmg of dmgs) {
    const sha = createHash('sha256').update(readFileSync(dmg)).digest('hex')
    lines.push(`${sha}  ${basename(dmg)}`)
  }
  lines.sort((a, b) => a.split(/\s+/)[1].localeCompare(b.split(/\s+/)[1]))
  const sums = join(work, 'SHA256SUMS.txt')
  writeFileSync(sums, `${lines.join('\n')}\n`)
  gh('release', 'upload', tag, sums, '--clobber')
  console.log(readFileSync(sums, 'utf8'))
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log(`✔ signed macOS packages attached to ${tag}`)
