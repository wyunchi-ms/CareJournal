# CareJournal

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md)

CareJournal is a local-first health journal for one cancer patient and their family. It records treatment events, organizes test reports, and visualizes lab trends. Android and Windows are supported; HarmonyOS NEXT and iOS projects share the same React/TypeScript interface.

## Features

- Calendar journal for surgery, admissions, chemotherapy, radiotherapy, medication, examinations, symptoms, and notes.
- Test reports with source images/PDFs, structured indicators, abnormal flags, filtering, and duplicate detection.
- OCR using your own Azure OpenAI, OpenAI, DeepSeek, Kimi, Doubao, Qwen, Gemini, MiniMax, GLM, OpenRouter, or OpenAI-compatible provider.
- Region and language setup on first launch. OCR unit instructions are generated from the chosen region instead of always using Mainland China conventions.
- Trend charts, treatment-cycle comparison, reimbursement material lists, local backup, and trusted-LAN device sync.

CareJournal is for recording, organizing, and visualizing information only. It does not provide diagnosis, treatment advice, or predictions.

## Privacy

There are no accounts, ads, or developer-operated cloud services. Health records and attachments stay on the current device by default. Data only leaves the device when you explicitly run OCR or confirm LAN sync.

Read the [privacy notice](PRIVACY.en.md) before use. Never post medical records, report images, API keys, or other personal information in public issues.

## Documentation

- [English user guide](docs/USER_GUIDE.en.md)
- [简体中文用户手册](docs/USER_GUIDE.zh-CN.md)
- [繁體中文使用手冊](docs/USER_GUIDE.zh-TW.md)
- [English privacy notice](PRIVACY.en.md)
- [Windows portable edition](docs/WINDOWS_DESKTOP.md)
- [iOS native support](docs/IOS_NATIVE.md)

## Local development

```powershell
npm install
npm run tauri dev
```

## Verification

```powershell
npm run test
npm run lint
npm run build
```
