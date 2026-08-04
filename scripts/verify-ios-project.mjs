import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const requiredFiles = [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/Info.plist',
  'ios/App/App/PrivacyInfo.xcprivacy',
  'ios/App/App/PrivateImageStore.swift',
  'ios/App/App/NativeImageStoragePlugin.swift',
  'ios/App/App/StartupPlugin.swift',
  'ios/App/App/LanSyncPlugin.swift',
  'ios/App/App/CareJournalBridgeViewController.swift',
  'ios/App/App/SQLiteDataProtection.swift',
]

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) throw new Error(`Missing iOS project file: ${file}`)
}

const project = readFileSync(resolve(root, requiredFiles[0]), 'utf8')
for (const source of requiredFiles.slice(3)) {
  const name = source.split('/').at(-1)
  if (!project.includes(`${name} in Sources`)) throw new Error(`${name} is not in the Xcode Sources phase`)
}
if (!project.includes('PrivacyInfo.xcprivacy in Resources')) throw new Error('PrivacyInfo.xcprivacy is not in the Xcode Resources phase')
if (!project.includes('PRODUCT_BUNDLE_IDENTIFIER = com.carejournal.app;')) throw new Error('Unexpected iOS bundle identifier')

const storyboard = readFileSync(resolve(root, 'ios/App/App/Base.lproj/Main.storyboard'), 'utf8')
if (!storyboard.includes('customClass="CareJournalBridgeViewController"')) throw new Error('Custom Capacitor bridge controller is not configured')
if (!storyboard.includes('initialViewController=')) throw new Error('Custom Capacitor bridge controller is not the initial storyboard controller')

const info = readFileSync(resolve(root, 'ios/App/App/Info.plist'), 'utf8')
for (const key of ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSLocalNetworkUsageDescription', 'NSBonjourServices', 'UIFileSharingEnabled']) {
  if (!info.includes(`<key>${key}</key>`)) throw new Error(`Info.plist is missing ${key}`)
}
if (!info.includes('<string>_carejournal._tcp</string>')) throw new Error('Info.plist is missing the CareJournal Bonjour service type')

const privacyManifest = readFileSync(resolve(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8')
if (!privacyManifest.includes('NSPrivacyAccessedAPICategoryUserDefaults') || !privacyManifest.includes('CA92.1')) {
  throw new Error('PrivacyInfo.xcprivacy is missing the UserDefaults required-reason declaration')
}

const bridgeController = readFileSync(resolve(root, 'ios/App/App/CareJournalBridgeViewController.swift'), 'utf8')
for (const registration of ['NativeImageStoragePlugin()', 'StartupPlugin()', 'LanSyncPlugin()']) {
  if (!bridgeController.includes(`bridge?.registerPluginInstance(${registration})`)) {
    throw new Error(`CareJournalBridgeViewController does not register ${registration}`)
  }
}

const storagePlugin = readFileSync(resolve(root, 'ios/App/App/NativeImageStoragePlugin.swift'), 'utf8')
if (!storagePlugin.includes('jsName = "NativeImageStorage"')) throw new Error('NativeImageStorage plugin name mismatch')

const lanSyncPlugin = readFileSync(resolve(root, 'ios/App/App/LanSyncPlugin.swift'), 'utf8')
if (!lanSyncPlugin.includes('jsName = "LanSync"')) throw new Error('LanSync plugin name mismatch')
for (const method of ['start', 'stop', 'refresh', 'listPeers', 'sendSync', 'completeSync', 'rejectSync', 'setTransferActive']) {
  if (!lanSyncPlugin.includes(`CAPPluginMethod(name: "${method}"`)) throw new Error(`LanSync plugin is missing method ${method}`)
  if (!lanSyncPlugin.includes(`@objc func ${method}(`)) throw new Error(`LanSync plugin is missing @objc implementation ${method}`)
}
for (const marker of [
  'import Network',
  'NWBrowser(for: .bonjour(type: Self.serviceType',
  'NWListener(using: .tcp, on: port)',
  'serviceType = "_carejournal._tcp"',
  'port: UInt16 = 53318',
  'NWTXTRecord(values)',
  '"app": Self.app',
  '"v": Self.version',
  '"fp": fingerprint',
  '"pk": publicKey',
  '"dt": "mobile"',
  'values["alias"] = truncateUtf8',
  'maxHeaderBytes = 32 * 1024',
  'maxBodyBytes = 300 * 1024 * 1024',
  'requestTimeout: TimeInterval = 30',
  'sendDeadline: TimeInterval = 120',
  'pendingTtlMs: Int64 = 125_000',
  'notifyListeners("peersChanged"',
  'notifyListeners("syncRequest"',
  '"/carejournal/v1/sync"',
  '"/carejournal/v1/result/"',
  'Access-Control-Allow-Origin: *',
  'Access-Control-Allow-Headers: Content-Type, X-CareJournal-Alias, X-CareJournal-Fingerprint',
  'Access-Control-Allow-Methods: POST, GET, OPTIONS',
  'hostForUrl',
  'Foreground-only on iOS',
]) {
  if (!lanSyncPlugin.includes(marker)) throw new Error(`LanSync plugin is missing required marker: ${marker}`)
}

const privateStore = readFileSync(resolve(root, 'ios/App/App/PrivateImageStore.swift'), 'utf8')
if (!privateStore.includes('.completeFileProtectionUntilFirstUserAuthentication')) throw new Error('iOS private media files are missing data protection')
if (!privateStore.includes('resolvingSymlinksInPath()')) throw new Error('iOS private media path validation does not resolve symlinks')
if (!privateStore.includes('maximumBytes = 30 * 1024 * 1024')) throw new Error('iOS private media storage has no payload size limit')
if (!privateStore.includes('expected != actualSha256')) throw new Error('iOS private media storage does not verify supplied hashes')

const sqliteProtection = readFileSync(resolve(root, 'ios/App/App/SQLiteDataProtection.swift'), 'utf8')
if (!sqliteProtection.includes('isExcludedFromBackup = true')) throw new Error('iOS SQLite directory is not excluded from backup')
if (!sqliteProtection.includes('completeUntilFirstUserAuthentication')) throw new Error('iOS SQLite files are missing data protection')

const workspace = resolve(root, 'ios/App/App.xcworkspace/contents.xcworkspacedata')
const podLock = resolve(root, 'ios/App/Podfile.lock')
if (!existsSync(workspace) || !existsSync(podLock)) {
  console.warn('iOS CocoaPods workspace is pending. Run npm run ios:sync on macOS before opening Xcode.')
}

console.log('iOS project static verification passed. Xcode compilation and device behavior still require macOS.')
