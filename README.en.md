<div align="center">
  <img src="src-tauri/icons/128x128.png" width="88" height="88" alt="CareJournal icon" />
  <h1>CareJournal · 病程记</h1>
  <p><strong>Treatment, reports, and everyday changes. Together in one journal.</strong></p>
  <p>A local-first journal for cancer patients and their families.</p>
  <p>
    <a href="https://github.com/wyunchi-ms/CareJournal/releases">Download</a> ·
    <a href="docs/USER_GUIDE.en.md">User guide</a> ·
    <a href="docs/README.md">Documentation</a> ·
    <a href="https://github.com/wyunchi-ms/CareJournal/issues">Feedback</a>
  </p>
  <p><a href="README.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · English</p>
</div>

During treatment, reports, medication notes, and appointment dates can end up scattered across photos, paper, and messages. CareJournal brings them into one timeline so you can keep a treatment history, organize results, review trends, and prepare reimbursement documents.

Each local collection is organized around one patient. No account is required. Everyday records stay on your device; AI report recognition uses a provider you configure yourself.

## A look inside

![Calendar with treatment events, follow-up visits, and body measurements](docs/images/calendar.png)

<table>
  <tr>
    <td width="50%"><img src="docs/images/records.png" alt="Reports organized by date with structured indicators" /></td>
    <td width="50%"><img src="docs/images/charts.png" alt="Indicator trends and saved charts" /></td>
  </tr>
  <tr><td align="center">Reports in one place</td><td align="center">Changes over time</td></tr>
</table>

Screenshots show the shared interface in a desktop-size development preview, in Simplified Chinese, with fictional data. They are not medical guidance. See platform availability below for native features.

## What you can do

### Keep a treatment history

Record surgery, admissions, chemotherapy, radiotherapy, medication, examinations, and diary entries on a calendar. Events can span one or several days. Turn an existing treatment plan into a reusable template, generate treatment dates by cycle, and adjust individual events as needed. Keep body measurements such as weight, temperature, and blood pressure alongside them.

### Make reports easier to find

Take a photo or import images and PDFs. Your configured LLM service extracts report types, collection dates, and indicators while source files remain available for checking. Batch recognition, retries, and duplicate-material detection help organize larger collections. Android also supports folder import.

### Follow changes over time

Plot lab results and body measurements by date, overlay treatment events, or compare chemotherapy cycles aligned to Day 1. Save frequently used charts for the next review.

### Prepare reimbursement documents

Create reimbursement plans around treatment events, collect reports and invoices against a checklist, track completion, and export selected plans as a ZIP.

### Back up and move between your devices

Export records and original attachments in a ZIP backup. On the same trusted Wi-Fi network, preview and confirm changes before syncing with another device. Neither backup nor LAN sync passes through a maintainer-operated server.

## Download and availability

**[GitHub Releases](https://github.com/wyunchi-ms/CareJournal/releases)** · **[Gitee mirror](https://gitee.com/wyunchi/care-journal/releases)** · [Changelog](ChangeLog.md) (Chinese)

| Platform | Status | Installation |
| --- | --- | --- |
| Android | APK available | Download `carejournal-vX.Y.Z-android.apk`; update over the existing installation |
| Windows 10/11 x64 | Portable ZIP available | Extract and run `CareJournal.exe`; [details](docs/WINDOWS_DESKTOP.md) (Chinese) |
| HarmonyOS NEXT | Build it yourself | Sign for your own device with DevEco Studio; [guide](docs/HARMONY_SELF_BUILD.zh-CN.md) (Chinese) |
| iOS | Development candidate | Native project exists; macOS/Xcode compilation and device testing are still pending; [status](docs/IOS_NATIVE.md) (Chinese) |

Public releases contain Android and Windows packages. There is currently no standalone browser edition or Node server.

## Get started

1. **Choose your region and language.** Region sets OCR unit guidance; language affects onboarding, navigation, and recognition text. They can be selected independently.
2. **Add your first event.** Record a treatment, follow-up visit, or body measurement in the journal.
3. **Configure recognition when you need it.** In Settings, enter your provider, API key, endpoint, and model. Test the connection before importing reports.
4. **Check and back up.** Compare dates, values, units, and reference ranges with the source report, then export backups regularly.

Manual journaling, document organization, and local backups do not require an API key. Model capabilities, availability, and charges depend on your provider. See the [user guide](docs/USER_GUIDE.en.md) for instructions.

<details>
<summary>Recognition providers you can configure</summary>

Azure OpenAI, OpenAI, DeepSeek, Moonshot Kimi, Volcano Ark, Alibaba Cloud Model Studio, SiliconFlow, Tencent Hunyuan, StepFun, Baichuan AI, iFlytek Spark, Gemini, MiniMax, Zhipu GLM, OpenRouter, and custom OpenAI-compatible services.

Each provider retains its own local configuration. Direct image recognition requires a model that accepts images. Optional local PaddleOCR redaction extracts and processes text before sending it to the LLM. See [recognition setup](docs/USER_GUIDE.en.md#6-smart-recognition-service).

</details>

## Data and privacy

There are no accounts, ads, or developer-operated cloud health-record services. Records and attachments stay on the device by default. Android uses SQLite and private app storage; Windows keeps data in `CareJournalData/` beside the executable.

- **Recognition:** OCR sends images or extracted text to your configured provider. Local redaction can miss information.
- **Backup:** ZIP backups contain records and attachments and are not encrypted. API keys are excluded.
- **Sync:** Use a trusted LAN. There is no additional application-layer encryption; LLM settings and OCR queues are excluded.

Read the [privacy notice](PRIVACY.en.md). CareJournal records, organizes, and visualizes information; it does not provide diagnosis, treatment advice, or risk predictions. Check recognized results against the original material.

## Local development

The shared interface uses React, TypeScript, and Vite. Native hosts use Capacitor on Android/iOS, Tauri on Windows, and ArkWeb with ArkTS bridges on HarmonyOS.

With Node.js 22.12+, Rust, and the Windows C++ build tools installed, run on Windows:

```powershell
git clone https://github.com/wyunchi-ms/CareJournal.git
cd CareJournal
npm ci
npm run tauri dev
```

See the [development guide](docs/DEVELOPMENT.md) for prerequisites, platform commands, and checks.

## Contributing

Bug reports, documentation, translations, and code contributions are welcome. Include your app version, platform, steps to reproduce, and expected behavior. Use fictional data in examples and screenshots.

[Contributing guide](CONTRIBUTING.md) · [Design guidelines](design-system/carejournal/MASTER.md) · [Release maintenance](docs/RELEASE_MAINTENANCE.md) (Chinese)

---

Wishing you a steady recovery, one day at a time.
