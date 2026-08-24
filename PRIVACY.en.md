# CareJournal Privacy Notice

[简体中文](PRIVACY.md) · [繁體中文](PRIVACY.zh-TW.md) · [English](PRIVACY.en.md)

> Version 1.1 · Updated 2026-08-24

CareJournal is a personal, open-source health journal for recording, organizing, and visualizing treatment information, reports, reimbursement materials, and treatment plans. It has no account system, advertising, analytics, or developer-operated cloud data service.

## 1. Data the maintainer does not collect

The project maintainer does not receive, store, or view your treatment events, reports, images, PDFs, reimbursement materials, saved charts, local settings, LLM configuration, API keys, or LAN-sync content.

Do not post medical records, report images, API keys, or other personal information in public GitHub/Gitee issues, discussions, or commits.

## 2. Local storage

Data stays on the current device by default. Android uses private app storage and SQLite; Windows portable builds use `CareJournalData/` beside the executable; other supported platforms use their local app storage. The maintainer cannot remotely access, restore, or delete this data.

You can delete records and attachments in the app. To erase all data, clear app data or uninstall the app; for a web build, clear the site data in the browser.

## 3. LLM and OCR

You choose and configure the LLM provider. The app connects to that provider only when you actively import and recognize material.

- Without local PaddleOCR redaction, image OCR sends the source image to your configured provider. PDFs are first converted to text locally where possible.
- With local PaddleOCR redaction, the app extracts text locally and attempts to remove names, ID numbers, admission numbers, and phone numbers before sending the processed text. This process can miss information.
- API keys stay on the current device and are excluded from LAN sync and backup export.
- Region and language preferences stay on the current device and are included in backups. The region changes the OCR unit instructions; it is not sent to the project maintainer.

Your chosen provider controls its own processing location, retention, and security practices. Confirm that you are authorized to process the material and review that provider’s terms before use.

Backups are ZIP files containing structured records and source attachments. They are not encrypted and can contain sensitive health data; keep them in a trusted location.

## 4. LAN sync

LAN sync occurs only after you enable it, select a device, review the preview, and confirm. Data moves directly over the current LAN and does not pass through a maintainer server. The app currently adds no application-layer encryption, so use trusted Wi-Fi only and select only devices you know. LLM settings and OCR queues are excluded.

## 5. Permissions

CareJournal uses the camera, files, and local network only when you invoke the related feature. It does not use permissions for advertising, profiling, or behavior tracking.

## 6. Medical disclaimer

CareJournal is not a medical device, emergency service, or source of diagnosis, treatment advice, or risk prediction. OCR, LLM output, and redaction can be incomplete or inaccurate. Confirm important information against the original material and with qualified health professionals.

## 7. Contact and updates

For questions about this notice or the implementation, contact the maintainer through [CareJournal GitHub Issues](https://github.com/wyunchi-ms/CareJournal/issues). Issues are public; do not attach medical material, keys, or personal data. Material changes to data flow, third-party services, or storage will be documented in the release notes and in-app privacy information.
