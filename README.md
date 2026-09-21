<div align="center">
  <img src="src-tauri/icons/128x128.png" width="88" height="88" alt="病程记图标" />
  <h1>病程记 CareJournal</h1>
  <p><strong>把治疗经过、检查报告和每一天的变化，记在一起。</strong></p>
  <p>为肿瘤患者与家属设计的本地病程记录工具。</p>
  <p>
    <a href="https://github.com/wyunchi-ms/CareJournal/releases">下载应用</a> ·
    <a href="docs/USER_GUIDE.zh-CN.md">使用手册</a> ·
    <a href="docs/README.md">项目文档</a> ·
    <a href="https://github.com/wyunchi-ms/CareJournal/issues">问题反馈</a>
  </p>
  <p>简体中文 · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.en.md">English</a></p>
</div>

治疗期间，报告、用药记录和复查日期往往散落在相册、纸张与聊天记录里。病程记把它们放回同一条时间线：记录治疗经过，整理检查结果，查看指标变化，也为报销准备好材料。

每份本地资料库围绕一位患者组织。无需注册账号；日常记录保存在设备上，报告智能识别使用你自行配置的 AI 服务。

## 看看病程记

![病程日历：按日期查看治疗、复查和身体指标](docs/images/calendar.png)

<table>
  <tr>
    <td width="50%"><img src="docs/images/records.png" alt="检查记录：按日期整理报告和数值指标" /></td>
    <td width="50%"><img src="docs/images/charts.png" alt="指标图表：查看变化趋势并保存常用图表" /></td>
  </tr>
  <tr><td align="center">检查报告，集中整理</td><td align="center">指标变化，随时回看</td></tr>
</table>

截图来自共享界面的桌面尺寸开发预览，使用虚构示例数据，不代表医疗建议。原生功能与可用平台见下文。

## 能帮你做什么

### 记录一段完整的治疗经过

在月历中记录手术、住院、化疗、放疗、用药、复查与日记，支持单日和跨日事件。把已有治疗方案整理成模板，按周期生成治疗日，再按实际执行情况修改。体重、体温、血压等身体指标也能一起记录。

### 把报告变成可查找的记录

拍照或导入图片、PDF，通过你配置的 LLM 服务提取报告类型、采样日期和检查指标，并保留原始素材供核对。支持批量识别、失败重试和重复素材检测；Android 还支持文件夹导入。

### 看清指标随时间的变化

查看检验指标与身体指标的日期趋势，在图表中叠加治疗事件，或将多个化疗周期按 Day 1 对齐比较。常看的图表可以收藏，复查前不必重新选择指标。

### 整理报销材料

围绕治疗事件建立报销计划，按清单收集报告、发票等附件，标记完成情况，并将选中的计划导出为 ZIP。

### 在自己的设备之间保存和迁移

导出包含记录和原始素材的 ZIP 备份；在可信的同一 Wi-Fi 下，与另一台设备预览并确认同步变化。备份和局域网同步都不经过项目维护者的服务器。

## 下载与平台支持

**[GitHub Releases](https://github.com/wyunchi-ms/CareJournal/releases)** · **[Gitee 下载镜像](https://gitee.com/wyunchi/care-journal/releases)** · [更新记录](ChangeLog.md)

| 平台 | 当前状态 | 安装方式 |
| --- | --- | --- |
| Android | 提供 APK | 下载 `carejournal-vX.Y.Z-android.apk`，升级时覆盖安装 |
| Windows 10/11 x64 | 提供绿色 ZIP | 解压后运行 `CareJournal.exe`；[详细说明](docs/WINDOWS_DESKTOP.md) |
| HarmonyOS NEXT | 支持自行构建 | 使用 DevEco Studio 为自己的设备签名安装；[安装指南](docs/HARMONY_SELF_BUILD.zh-CN.md) |
| iOS | 开发候选 | 已有原生工程，尚未经过 macOS/Xcode 编译及真机验证；[当前状态](docs/IOS_NATIVE.md) |

公开 Release 提供 Android 和 Windows 安装包。项目目前不提供独立浏览器版或 Node 服务端。

## 第一次使用

1. **选择地区和语言。** 地区用于 OCR 单位规则，语言用于首次引导、主导航和识别文本；两者可独立设置。
2. **记下第一条病程。** 在“病程”中添加已有的治疗、复查或身体记录。
3. **需要识别报告时，再配置服务。** 在“设置 → 智能识别服务”填写服务商、API Key、API 地址和模型，测试连接后导入报告。
4. **核对并备份。** 对照原始报告检查日期、数值、单位和参考范围，再定期导出完整备份。

无需 API Key 即可手动记录病程、整理材料及使用本地备份。识别服务的模型能力、可用性和费用由你选择的服务商决定。详细操作见[用户手册](docs/USER_GUIDE.zh-CN.md)。

<details>
<summary>可配置的智能识别服务</summary>

Azure OpenAI、OpenAI、DeepSeek、月之暗面 Kimi、火山方舟、阿里云百炼、硅基流动、腾讯混元、阶跃星辰、百川智能、讯飞星火、Gemini、MiniMax 稀宇科技、智谱 GLM、OpenRouter，以及自定义 OpenAI 兼容服务。

每个服务商保存一组本机配置；直接识别图片需要模型支持图片输入。也可开启 PaddleOCR 本地脱敏，先提取和处理文字，再交由 LLM 整理。配置方法见[智能识别服务](docs/USER_GUIDE.zh-CN.md#8-智能识别服务)。

</details>

## 数据与隐私

没有账号、广告或开发者运营的云端病历服务。病程与素材默认保存在当前设备：Android 使用 SQLite 和私有素材目录；Windows 数据保存在程序旁的 `CareJournalData/`。

- **报告识别：** 执行 OCR 时，图片或提取后的文字会发送给你配置的服务商。本地脱敏可能遗漏信息。
- **备份：** ZIP 未加密，包含记录和素材；API Key 不进入备份。
- **同步：** 仅用于可信局域网，当前没有额外的应用层加密；LLM 配置和 OCR 队列不会同步。

详见[隐私说明](PRIVACY.md)。病程记只用于资料记录、整理与可视化，不提供诊断、治疗建议或风险预测；识别结果请与原始材料核对。

## 本地开发

共享界面使用 React、TypeScript 和 Vite；Android/iOS 使用 Capacitor，Windows 使用 Tauri，HarmonyOS 使用 ArkWeb 与 ArkTS 桥接。

安装 Node.js 22.12+、Rust 和 Windows C++ 构建工具后，在 Windows 上运行：

```powershell
git clone https://github.com/wyunchi-ms/CareJournal.git
cd CareJournal
npm ci
npm run tauri dev
```

环境依赖、各平台构建入口与验证命令见[开发指南](docs/DEVELOPMENT.md)。

## 参与项目

欢迎提交问题、改进文档与翻译，或通过 Pull Request 贡献代码。反馈时附上应用版本、平台、复现步骤与预期行为；示例和截图请使用虚构数据。

[贡献指南](CONTRIBUTING.md) · [设计规范](design-system/carejournal/MASTER.md) · [发布维护](docs/RELEASE_MAINTENANCE.md)

---

愿每一次记录，都让下一次回看更从容。祝早日康复。
