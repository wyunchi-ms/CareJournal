# CareJournal User Guide

> Applies to v0.20.0 and later. CareJournal records, organizes, and visualizes information; it does not provide diagnosis, treatment advice, or risk prediction.

## 1. First launch: region and language

On first launch, and once after upgrading from an older version, choose a **region** and **language**.

- The region determines the clinical unit conventions sent to OCR.
- The language controls the setup flow, main navigation, and natural-language OCR fields.
- Change either setting later in **Settings → Region & language**.
- If you choose **Other region**, OCR preserves the source report units rather than attempting an unreliable conversion.

Regions include Mainland China, Hong Kong, Macao, Taiwan, Singapore, the United States, the United Kingdom, Canada, Australia, and Other. Available languages are Simplified Chinese, Traditional Chinese, and English.

## 2. Installation and data storage

Install the Android APK from the project release. When updating, install over the existing app without uninstalling it, or local data may be removed. Android stores data in local SQLite and private app storage; the Windows portable edition stores data beside the executable in `CareJournalData/`.

## 3. Journal and treatment plans

Open **Journal** to add surgery, admission, chemotherapy, radiotherapy, maintenance treatment, targeted therapy, immunotherapy, medication, examination, body metrics, or diary events.

Open **Plans** to create reusable treatment plans. You can set cycle length, treatment days, medicines, doses, units, and administration routes. A selected plan and Day 1 can create later treatment days in bulk; each generated event remains editable.

## 4. Reports and OCR

Open **Reports → Import report** to take a photo, select images or PDFs, or batch-import an Android folder. OCR runs in a background queue and can be retried after failure.

After recognition, a report includes its type, collection date, hospital, structured indicators, abnormal flags, and source material. OCR treats a value, its reference range, and its unit as one group. For configured regions it converts all related values together; it never changes unit text alone. Always compare the structured result with the original report.

### Privacy option

When local PaddleOCR redaction is enabled, the app extracts text locally and attempts to remove names, ID numbers, admission numbers, and phone numbers before sending text to your configured LLM. Automatic redaction can miss information, so review sensitive material yourself.

## 5. Charts and reimbursement

Open **Charts** for date-based indicator trends and treatment-cycle comparison aligned to Day 1. Save commonly used chart setups.

Open **Claims** to create a reimbursement plan from relevant treatment events, keep documents such as reports and invoices, and mark work as complete.

## 6. Smart-recognition service

Open **Settings → Smart recognition service**. Choose a provider, then enter its API key, endpoint, and model; use **Test connection** before import. API keys stay on this device and are excluded from LAN sync and backups.

## 7. LAN sync

On trusted Wi-Fi, enable LAN sync on both devices, select a discovered device, review the preview, choose which categories to include, and confirm. Sync does not pass through a developer server, but it has no additional application-layer encryption. Do not use it on public Wi-Fi or with unknown devices. LLM settings and OCR queues are not synced.

## 8. Backup and recovery

Use **Settings → Backup & recovery** to export a ZIP containing `backup.json` and deduplicated image/PDF attachments. The ZIP is not encrypted; keep it only in a trusted location. API keys and local file paths are excluded. Import shows a confirmation before it replaces data on the current device.

## 9. Important limitations

- The app is not a medical device or emergency service.
- OCR and local redaction can be incomplete or incorrect.
- Keep original materials and confirm important information with your care team.
- Do not share health records, API keys, or other personal information in public project channels.
