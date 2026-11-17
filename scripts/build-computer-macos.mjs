// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: config/scripts/native-build/macos/build-computer-macos.mjs @ c6b9ac9549b
// modified for Overdeck: async spawn, Overdeck names, dist/ output, ad-hoc default, notarize, zip + sha256
//
// Builds `Overdeck Computer Use.app` from native/computer-use-macos (universal
// arm64 + x86_64), signs it, optionally notarizes it, and zips it into
// native/computer-use-macos/dist/overdeck-computer-use-macos.zip with a
// sibling .sha256 file. The npm tarball ships the zip (PAN-5463 D-1).
//
// Environment:
//   OVERDECK_COMPUTER_MACOS_BUNDLE_ID     bundle id (default com.overdeck.computer-use)
//   OVERDECK_COMPUTER_MACOS_SIGN_IDENTITY codesign identity (default "-", ad-hoc)
//   APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID
//                                         when all three are set, notarize and staple;
//                                         APPLE_API_KEY is the path to the .p8 key file
//
// On any platform other than macOS it prints a skip line and exits 0.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const packagePath = path.join(repoRoot, 'native', 'computer-use-macos')
const distPath = path.join(packagePath, 'dist')
const executableName = 'overdeck-computer-use-macos'
const displayName = 'Overdeck Computer Use'
const binaryPath = path.join(packagePath, '.build', 'release', executableName)
const appPath = path.join(distPath, `${displayName}.app`)
const appExecutablePath = path.join(appPath, 'Contents', 'MacOS', executableName)
const entitlementsPath = path.join(packagePath, '.build', 'entitlements.plist')
const zipPath = path.join(distPath, `${executableName}.zip`)
const notarizeZipPath = path.join(packagePath, '.build', `${executableName}-notarize.zip`)
const bundleId = process.env.OVERDECK_COMPUTER_MACOS_BUNDLE_ID || 'com.overdeck.computer-use'
const signingIdentity = process.env.OVERDECK_COMPUTER_MACOS_SIGN_IDENTITY || '-'
const universalTriples = ['arm64-apple-macosx', 'x86_64-apple-macosx']

if (process.platform !== 'darwin') {
  console.log(`build-computer-macos: skipped (platform ${process.platform})`)
  process.exit(0)
}

await buildUniversalBinary()
await createHelperApp()
await sign()
const credentials = notarizeCredentials()
if (credentials) {
  await notarize(credentials)
}
await zipApp()
console.log(`build-computer-macos: wrote ${path.relative(repoRoot, zipPath)}`)

async function buildUniversalBinary() {
  const builtBinaries = []
  for (const triple of universalTriples) {
    // SwiftPM 6.4+ swiftbuild default skips the .build/<triple>/release layout lipo reads (#21145)
    await run('swift', [
      'build',
      '-c',
      'release',
      '--package-path',
      packagePath,
      '--triple',
      triple,
      '--build-system',
      'native'
    ])
    builtBinaries.push(path.join(packagePath, '.build', triple, 'release', executableName))
  }
  await mkdir(path.dirname(binaryPath), { recursive: true })
  await run('lipo', ['-create', ...builtBinaries, '-output', binaryPath])
  await chmod(binaryPath, 0o755)
}

async function createHelperApp() {
  await rm(appPath, { recursive: true, force: true })
  await mkdir(path.dirname(appExecutablePath), { recursive: true })
  await copyFile(binaryPath, appExecutablePath)
  await chmod(appExecutablePath, 0o755)
  await writeFile(path.join(appPath, 'Contents', 'Info.plist'), infoPlist(), 'utf8')
}

async function sign() {
  const args = ['--force', '--deep', '--sign', signingIdentity]
  if (signingIdentity !== '-') {
    await writeFile(entitlementsPath, emptyEntitlementsPlist(), 'utf8')
    args.push('--options', 'runtime', '--timestamp', '--entitlements', entitlementsPath)
  }
  args.push(appPath)
  await run('codesign', args)
}

function notarizeCredentials() {
  const key = process.env.APPLE_API_KEY
  const keyId = process.env.APPLE_API_KEY_ID
  const issuer = process.env.APPLE_API_ISSUER_ID
  return key && keyId && issuer ? { key, keyId, issuer } : null
}

async function notarize({ key, keyId, issuer }) {
  await rm(notarizeZipPath, { force: true })
  await run('ditto', ['-c', '-k', '--keepParent', appPath, notarizeZipPath])
  await run('xcrun', [
    'notarytool',
    'submit',
    notarizeZipPath,
    '--key',
    key,
    '--key-id',
    keyId,
    '--issuer',
    issuer,
    '--wait'
  ])
  await run('xcrun', ['stapler', 'staple', appPath])
  await rm(notarizeZipPath, { force: true })
}

async function zipApp() {
  await rm(zipPath, { force: true })
  await run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath])
  const digest = createHash('sha256').update(await readFile(zipPath)).digest('hex')
  await writeFile(`${zipPath}.sha256`, `${digest}\n`, 'utf8')
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} killed by ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`${command} exited ${code}`))
      } else {
        resolve()
      }
    })
  })
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlist(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlist(displayName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSAccessibilityUsageDescription</key>
  <string>Overdeck Computer Use needs Accessibility permission to read and interact with app interfaces when you ask Overdeck to use apps.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Overdeck Computer Use needs Screen Recording permission to capture app windows when you ask Overdeck to inspect your screen.</string>
</dict>
</plist>
`
}

function emptyEntitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`
}

function escapePlist(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
