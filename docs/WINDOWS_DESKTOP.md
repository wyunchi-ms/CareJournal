# CareJournal Windows 绿色版

## 下载与运行

公开 Release 提供 `carejournal-vX.Y.Z-windows-x64-portable.zip`，适用于 64 位 Windows 10/11。

1. 下载 ZIP 后完整解压到可写目录，例如 `D:\CareJournal`；
2. 双击 `CareJournal.exe`；
3. 第一次开启局域网同步时，Windows 防火墙可能询问是否允许访问专用网络，请只勾选可信的专用网络；
4. 应用会在 EXE 同级创建 `CareJournalData/`，其中保存 WebView2 本地数据、图片/PDF 和设备标识。

这是绿色免安装版。迁移电脑时应关闭程序，并把 `CareJournal.exe` 与 `CareJournalData/` 一起复制。不要把程序放在 `Program Files`、只读目录、压缩包内部或其他无写入权限的位置。

## 本地数据与网络

- 病程、配置和队列使用桌面 WebView2 的本地 IndexedDB，位置固定在 `CareJournalData/WebView2/`；
- 图片和 PDF 保存在 `CareJournalData/media/`；
- LLM 请求由应用内 Rust 后端直接发往你配置的服务商，不需要公共 Web 服务或本地 Node server；
- API Key 只保存在当前电脑，不进入 ZIP 备份或局域网同步；
- 桌面版是完整局域网同步节点，兼容现有 UDP v4 和 `_carejournal._tcp` mDNS/Bonjour；同步不经过开发者服务器，但当前没有额外的应用层加密，只能在可信 Wi-Fi 使用；
- 应用关闭后，局域网监听也会停止，不会常驻后台。

## 备份

设置页“备份与恢复”可导出未加密 ZIP，包含 `backup.json` 和去重后的图片/PDF 素材。备份可能包含敏感医疗资料，请只保存在可信位置。旧版 AES-GCM 加密备份仍可导入。

## WebView2

Windows 10/11 通常已经安装 Microsoft Edge WebView2 Runtime。如果 EXE 无法打开，请先从微软官方页面安装 Evergreen WebView2 Runtime 后重试。绿色 ZIP 不内置固定版 WebView2，以避免额外增加约百兆体积。

## 安全提示

当前绿色版若未使用 Windows 代码签名，SmartScreen 可能显示“未知发布者”。请核对下载地址和 `SHA256SUMS.txt`；不要从第三方重新打包站点下载。

## 开发构建

```powershell
npm install
npm run tauri:build:portable
```

输出：`release/carejournal-vX.Y.Z-windows-x64-portable.zip`。
