# 开发指南 · Development guide

[文档首页 / Documentation](README.md) · [贡献指南 / Contributing](../CONTRIBUTING.md)

CareJournal uses a shared React/TypeScript interface with native storage and networking bridges. The supported development path for the Windows app is Tauri; the browser preview is for UI work only.

CareJournal 共用 React/TypeScript 界面，存储与网络由各平台桥接完成。Windows 应用使用 Tauri 开发；浏览器预览仅用于界面开发。

## 环境 · Prerequisites

| 工具 / Tool | 要求 / Requirement |
| --- | --- |
| Git | 克隆仓库 / Clone the repository |
| Node.js + npm | 建议 Node.js 22.12+；Vite 要求 `^20.19.0` 或 `>=22.12.0` / Use Node.js 22.12+; Vite also accepts 20.19+ within Node 20 |
| Windows desktop | Rust stable with the MSVC toolchain; Visual Studio C++ Build Tools with the Windows SDK; Microsoft Edge WebView2 Runtime |
| Portable ZIP script | PowerShell 7 (`pwsh`), Python and Pillow for icon generation |
| Android | Android Studio, JDK 21, Android SDK 35; Gradle wrapper is in `android/` |
| HarmonyOS NEXT | DevEco Studio and SDK; see [self-build guide](HARMONY_SELF_BUILD.zh-CN.md) |
| iOS | macOS, Xcode, CocoaPods; see [native status and verification](IOS_NATIVE.md) |

仅开发共享界面时不需要全部原生工具链。Install native tools only for the platform you are working on.

## Windows 开发 · Run the Windows app

```powershell
git clone https://github.com/wyunchi-ms/CareJournal.git
cd CareJournal
npm ci
npm run tauri dev
```

Tauri starts Vite at `127.0.0.1:14207` and opens the desktop window. Keep that port available. Native HTTP and LAN sync are available through the desktop host. Use fictional records when developing or testing.

Tauri 会启动 Vite 并打开桌面窗口，请确保端口 `14207` 未被占用。开发和测试请使用虚构数据。

## 常用命令 · Commands

Run these from the repository root. 以下命令均在仓库根目录执行。

| 命令 / Command | 用途 / Purpose |
| --- | --- |
| `npm run dev` | Shared UI preview; browser OCR and LAN sync are unsupported |
| `npm run tauri dev` | Windows desktop development with native bridges |
| `npm run android:sync` | Build frontend assets and sync the Android project; does not build an APK |
| `npm run ios:sync` | Build frontend assets and sync the iOS project on macOS |
| `npm run ios:verify` | Static iOS project checks; does not compile Swift |
| `npm run harmony:sync` | Build and copy frontend assets for HarmonyOS |
| `npm run harmony:build` | Build using the local DevEco toolchain; device installation requires your own signing setup |
| `npm run tauri:build:portable` | Build Windows executable and create a portable ZIP in `release/` |
| `npm run test` | Run the Vitest test suite once |
| `npm run lint` | Run ESLint |
| `npm run build` | TypeScript checks and Vite production build; does not package native apps |

For an Android development APK, configure the SDK in Android Studio (or local `android/local.properties`), then run:

Android 调试 APK：先在 Android Studio 配置 SDK（或设置本机 `android/local.properties`），然后运行：

```powershell
npm run android:sync
cd android
.\gradlew.bat assembleDebug
cd ..
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. This uses a development signature and cannot update an official release installation with a different signature. Use a separate test device or emulator.

调试签名不能覆盖不同签名的正式版，请使用独立测试设备或模拟器。正式签名和发布由维护者按[发布指南](RELEASE_MAINTENANCE.md)处理；日常开发无需 Azure 凭据。

## 代码导航 · Code map

| 目录 / Directory | 内容 / Responsibility |
| --- | --- |
| `src/pages/`, `src/components/` | Screens and shared UI components |
| `src/store/AppContext.tsx` | Application state, OCR queue, and persistence coordination |
| `src/db/repository.ts` | Repository abstraction over local databases |
| `src/services/` | OCR, backup, charts, media handling, and LAN sync |
| `src/platform/` | HarmonyOS and Tauri bridge entry points |
| `src/test/` | Unit and component tests |
| `android/`, `ios/` | Capacitor hosts and native plugins |
| `harmony/` | ArkWeb host and ArkTS services |
| `src-tauri/` | Windows desktop host and Rust services |
| `scripts/` | Build, signing, and release helpers |

## 验证修改 · Validate changes

For code changes, run the relevant tests, lint, and build:

```powershell
npm run test
npm run lint
npm run build
```

For native changes, also build and exercise the affected platform. A passing frontend build or `ios:verify` does not establish native compatibility. Document the devices and flows you actually checked in the pull request.

原生修改还需对应平台构建与运行验证。纯文档修改检查链接、命令和渲染即可；截图应来自实际界面并使用虚构数据，注明语言与预览环境。

For documentation-only changes, check links, commands, and rendered layout. Screenshots should use the actual interface with fictional data and identify their language and preview environment.
