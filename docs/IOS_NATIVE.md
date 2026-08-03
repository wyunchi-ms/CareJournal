# CareJournal iOS 原生接入规划

## 当前状态

仓库当前没有 `ios/` 原生工程，也没有生成 `.ipa`。共享 React/TypeScript UI 与数据逻辑可由 Capacitor 复用，但 iOS 工程必须在 macOS + Xcode 上创建和签名。

## 环境要求

- macOS；
- Xcode 和 Xcode Command Line Tools；
- Apple Developer Program 账号；
- 与 `com.carejournal.app` 对应的 App ID；
- Development/Distribution Certificate 与 Provisioning Profile；
- CocoaPods（若 Capacitor 依赖需要）。

## 初始化

将仓库复制到 macOS 后运行：

```bash
bash scripts/init-ios.sh
```

脚本会：

1. 安装 npm 依赖；
2. 构建 Web 资源；
3. 首次运行 `npx cap add ios`；
4. 执行 `npx cap sync ios`；
5. 提示打开 `ios/App/App.xcworkspace`。

## 原生能力待实现

Android 与 Harmony 已有的能力需要 iOS 插件实现：

- SQLite 与应用私有素材存储；
- 相机、图片/PDF 选择和文档导出；
- 原生 HTTP 请求；
- 局域网服务发现与同步；
- 后台素材传输；
- 本地网络权限说明 `NSLocalNetworkUsageDescription`；
- Bonjour service type（若 iOS 使用 Bonjour/mDNS）。

建议 iOS 局域网同步继续复用共享 TypeScript 合并逻辑，只把 discovery、HTTP server/client、后台传输下沉 Swift。

## 签名与打包

1. Xcode 中选择 `App` target；
2. `Signing & Capabilities` 选择 Team；
3. 确认 Bundle Identifier；
4. 添加相机、相册、本地网络等 usage description；
5. `Product > Archive`；
6. 在 Organizer 导出 TestFlight/App Store 或 Ad Hoc `.ipa`。

Windows 无法合法生成或签名 iOS `.ipa`，因此当前发布工具会明确跳过 iOS。

`scripts/init-ios.sh` 目前是 macOS 初始化计划，尚未在真实 macOS/Xcode 环境执行；首次使用前应在 macOS 上验证。
