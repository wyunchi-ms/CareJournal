# 病程記 CareJournal

[简体中文](README.md) · [繁體中文](README.zh-TW.md) · [English](README.en.md)

病程記是一個以本機資料為優先的個人病程工具，協助腫瘤患者與家屬記錄治療、整理檢查報告及檢視指標趨勢。支援 Android 和 Windows；HarmonyOS NEXT 與 iOS 工程共用 React/TypeScript 介面。

## 功能

- 月曆病程：手術、住院、化療、放療、用藥、檢查、身體指標與日記。
- 檢查報告：原始圖片/PDF、結構化指標、異常標記、篩選及重複素材偵測。
- 使用自行設定的 Azure OpenAI、OpenAI、DeepSeek、Kimi、豆包、Qwen、Gemini、MiniMax、GLM、OpenRouter 或 OpenAI 相容服務進行 OCR。
- 首次開啟選擇地區與語言；OCR 會依所選地區建立檢驗單位規則，不會一律使用中國大陸指標。
- 指標趨勢圖、治療週期比較、報銷材料、本機備份及可信任區網同步。

本應用只用於記錄、整理及視覺化資料，不提供診斷、治療建議或預測。

## 隱私

沒有帳號、廣告或由專案維護者營運的雲端服務。病程與素材預設保留在目前裝置；只有你主動執行 OCR 或確認區網同步時，資料才會依你的設定流轉。

使用前請閱讀[隱私說明](PRIVACY.zh-TW.md)，不要在公開 Issue 上傳病歷、報告圖片、API Key 或其他個人資料。

## 文件

- [繁體中文使用手冊](docs/USER_GUIDE.zh-TW.md)
- [简体中文用户手册](docs/USER_GUIDE.zh-CN.md)
- [English user guide](docs/USER_GUIDE.en.md)
- [繁體中文隱私說明](PRIVACY.zh-TW.md)
- [Windows 綠色桌面版說明](docs/WINDOWS_DESKTOP.md)
- [iOS 原生支援說明](docs/IOS_NATIVE.md)

## 本機開發

```powershell
npm install
npm run tauri dev
```

## 驗證

```powershell
npm run test
npm run lint
npm run build
```
