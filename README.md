# 病程记 CareJournal

面向单一肿瘤患者的本地病程记录、检查报告整理与指标可视化工具。支持 Android、Web，并已加入 HarmonyOS NEXT 工程；三个端共用 React/TypeScript 界面。

## 功能

- 月历病程：手术、住院、化疗、放疗、用药、检查、身体指标和治疗日记等单日或跨日记录。
- 检查记录：原始图片、结构化指标、异常标记、类型筛选和内容去重。
- 多服务商 LLM OCR：支持 Azure OpenAI、OpenAI、DeepSeek、Kimi、豆包、Qwen、Gemini、MiniMax、GLM、OpenRouter 及自定义 OpenAI 兼容服务；文件数量不限，每张图片一个独立请求，成功后直接入库。
- 指标图表：多指标日期趋势、治疗事件标记、化疗周期 Day 1 对齐叠加、图表固定。
- 本地数据：Web 使用 IndexedDB，Android 使用 SQLite，HarmonyOS 使用 ArkData RDB 与应用私有素材目录。
- 局域网同步：同一可信 Wi-Fi 下的手机与网页端可直接发现并同步数据；传输不经过开发者服务器，但应用层不额外加密，LLM 配置不会同步。

本应用只做资料记录、整理和可视化，不提供诊断、治疗建议或预测。

OCR 队列在切换应用页面后会继续运行。如果操作系统终止应用或浏览器标签页，任务会暂停，并在下次打开应用时从未完成项继续。

## 隐私

CareJournal 不提供账号、广告或开发者运营的云端服务，病程与素材默认保存在当前设备。只有在用户主动执行识别或局域网同步时，数据才会按用户的配置和操作流转。

安装和使用前请阅读 [CareJournal 隐私说明](PRIVACY.md)。请勿在公开 Issue 中上传病历、检查图片、API Key 或其他个人信息。

## 设计规范

页面标题、新建入口、Card、列表交互、弹层、图表和移动端布局统一遵循 [CareJournal 设计报告](design-system/carejournal/MASTER.md)。

## 文档

- [中文用户手册](docs/USER_GUIDE.zh-CN.md)
- [iOS 原生接入规划](docs/IOS_NATIVE.md)
- [GitHub/Gitee 双远端与发布维护方案](docs/RELEASE_MAINTENANCE.md)

## 本地运行

```powershell
npm install
npm run serve:web
```

打开 `http://127.0.0.1:8087`。请使用该命令启动 Web 版，不要使用简单静态文件服务器；内置的同源兼容层用于转发所选 LLM 服务商的请求。

需要热更新时分别运行：

```powershell
npm run serve:proxy
npm run dev
```

Vite 会把 `/api/llm` 转发到本地兼容层。

## LLM 配置

设置页先选择服务商，再为该服务商填写一个 API Key、API 地址和模型。每个服务商只绑定一个模型，切换服务商时会保留各自的本机配置。

Azure OpenAI 使用 v1 API，API 地址填写 `https://<resource>.services.ai.azure.com/openai/v1` 或 `https://<resource>.openai.azure.com/openai/v1`，模型字段填写 Deployment Name，不再需要 API Version。Android 使用原生 HTTP 直连服务商；Web 请求通过应用同源接口即时转发，同源接口不写入日志或数据库。

## Android

```powershell
npm run android:sync
```

原生工程位于 `android/`。版本号维护在 `android/app/build.gradle`。

## HarmonyOS NEXT

```powershell
npm run harmony:build
```

原生工程位于 `harmony/`，使用 ArkWeb + ArkTS JSBridge。命令会调用本机
DevEco Studio 工具链生成 HAP；详细环境、签名和迁移说明见
[HarmonyOS README](harmony/README.md)。

## 验证

```powershell
npm run test
npm run lint
npm run build
```
