# 病程记 CareJournal

面向单一肿瘤患者的本地病程记录、检查报告整理与指标可视化工具。第一版支持 Android 和 Web，共用 React/TypeScript 界面。

## 功能

- 月历病程：手术、住院、化疗、放疗、用药、检查等单日或跨日事件。
- 检查记录：原始图片、结构化指标、异常标记、类型筛选和内容去重。
- Azure OpenAI OCR：文件数量不限，每张图片一个独立请求；提供持久化后台队列、逐项/总体进度和失败重试，成功后直接入库。
- 指标图表：多指标日期趋势、治疗事件标记、化疗周期 Day 1 对齐叠加、图表固定。
- 本地数据：Web 使用 IndexedDB，Android 使用 SQLite。
- 家属共享：包含图片的 AES-256-GCM 加密备份；Azure API Key 不进入备份。

本应用只做资料记录、整理和可视化，不提供诊断、治疗建议或预测。

OCR 队列在切换应用页面后会继续运行。如果操作系统终止应用或浏览器标签页，任务会暂停，并在下次打开应用时从未完成项继续。

## 设计规范

页面标题、新建入口、Card、列表交互、弹层、图表和移动端布局统一遵循 [CareJournal 设计报告](design-system/carejournal/MASTER.md)。

## 本地运行

```powershell
npm install
npm run serve:web
```

打开 `http://127.0.0.1:8087`。请使用该命令启动 Web 版，不要使用简单静态文件服务器；内置的同源兼容层用于解决 Azure OpenAI 不允许浏览器直接跨域调用的问题。

需要热更新时分别运行：

```powershell
npm run serve:proxy
npm run dev
```

Vite 会把 `/api/azure-openai` 转发到本地兼容层。

## Azure OpenAI 配置

Endpoint 支持两种格式：

- `https://<resource>.openai.azure.com`
- `https://<resource>.openai.azure.com/openai/v1`

同时填写 Deployment Name、API Version 和 API Key。Android 使用原生 HTTP 直连 Azure；Web 请求通过应用同源接口即时转发，同源接口不写入日志或数据库。

## Android

```powershell
npm run android:sync
```

原生工程位于 `android/`。版本号维护在 `android/app/build.gradle`。

## 验证

```powershell
npm run test
npm run lint
npm run build
```
