# CareJournal iOS 原生支持

## 当前状态

仓库已包含 Capacitor 7 `ios/` 原生工程和核心 Swift 桥接源码，但尚未在 macOS/Xcode 中编译或真机验证，也没有生成 `.ipa`。当前实现定位为“核心可用候选”：代码和工程结构已经准备好，是否能用于实际设备仍以首次 Mac 验证结果为准。

## 环境要求

- macOS；
- Xcode 和 Xcode Command Line Tools；
- Apple ID；真机长期测试、TestFlight 或 App Store 发布需要 Apple Developer Program 账号；
- 与 `com.carejournal.app` 对应的 App ID；
- Development/Distribution Certificate 与 Provisioning Profile；
- CocoaPods（当前工程使用 CocoaPods）。

## 初始化

将仓库复制到 macOS 后运行：

```bash
bash scripts/init-ios.sh
```

脚本会：

1. 安装 npm 依赖；
2. 构建 Web 资源；
3. 缺少 `ios/` 时运行 `npx cap add ios`；
4. 执行 `npx cap sync ios`；
5. 执行 iOS 工程静态校验；
6. 提示打开 `ios/App/App.xcworkspace`。

也可以在仓库根目录运行：

```bash
npm run ios:sync
npm run ios:verify
```

`ios:verify` 只能检查文件、Xcode 引用、权限和插件名称，不能代替 Swift 编译。

## 当前已接入

- Capacitor iOS 工程和 `com.carejournal.app` Bundle Identifier；
- `@capacitor-community/sqlite` 原生 SQLite；
- `NativeImageStorage` Swift 插件，将图片/PDF 放入应用私有目录，启用文件保护并排除 iCloud 自动备份；
- HTML 相机/图片/PDF 选择入口；
- Capacitor Filesystem 文档导出；
- CapacitorHttp LLM 请求；
- `Startup.ready()` 桥接；
- Bonjour `_carejournal._tcp` 设备发现和 `NWListener` 前台 HTTP 同步服务；
- 相机、相册、Files 文档访问说明和 Privacy Manifest。

## 当前限制

- iOS 局域网同步仅在应用保持前台时运行；切到后台后系统可能暂停网络连接，当前不承诺后台继续传输；
- Android 的递归文件夹扫描没有直接搬到 iOS，iOS 使用系统文件/相机选择入口；
- 本地 PaddleOCR/WASM 在 WKWebView 上尚未真机验证；
- CocoaPods workspace 和 `Podfile.lock` 必须在 macOS 首次执行 `npm run ios:sync` 后生成；
- 未经 Xcode 编译、模拟器和 iPhone 回归，不应宣称为可发布版本。

## 后续原生能力

Android 与 Harmony 的后台持续传输能力仍需在 iOS 上单独设计。当前 iOS 已复用共享 TypeScript 合并逻辑，并由 Swift `LanSync` 插件负责 Bonjour discovery 和前台 HTTP server/client；没有启用 Background Modes。

## 签名与打包

1. Xcode 中选择 `App` target；
2. `Signing & Capabilities` 选择 Team；
3. 确认 Bundle Identifier；
4. 核对相机、相册、Files 和本地网络 usage description；
5. `Product > Archive`；
6. 在 Organizer 导出 TestFlight/App Store 或 Ad Hoc `.ipa`。

Windows 无法生成或签名 iOS `.ipa`，因此当前公开发布工具仍只发布 Android APK。

`ios/` 工程由 Windows 上的 Capacitor CLI 生成，Swift/Xcode/CocoaPods 尚未在真实 macOS 环境验证。首次 Mac 验收至少包括：

1. `npm ci && npm run ios:sync`；
2. `npm run ios:verify`；
3. 在模拟器完成启动、SQLite 写入、重启后读取、图片/PDF 导入、素材预览、备份导出和 OCR 请求；
4. 在真机核对相机/相册/本地网络权限、文件保护，以及与 Android/Harmony 的 Bonjour 前台同步；
5. 确认无误后再配置签名和 Archive。
