# 病程记 HarmonyOS 工程

该目录是面向 HarmonyOS NEXT 的 Stage 模型工程。界面继续复用仓库中的
React/Vite 应用，ArkWeb 只承担渲染；ArkTS 桥接负责关系型数据库、私有素材
目录、系统文件选择和不受 CORS 限制的 LLM 网络请求。

## 环境

- DevEco Studio 6.1.3 或更新版本（当前工程按已安装的 HarmonyOS 6.1.1 / API 24 编译）
- HarmonyOS SDK；最低兼容版本 6.0.0（API 20）
- Node.js 20 或更高版本

## 构建

1. 在仓库根目录运行 `npm install`。
2. 运行 `npm run harmony:build`，构建共享前端、同步 Web 资源并生成
   `entry-default.hap`。
3. 如需 IDE 调试，使用 DevEco Studio 打开本目录；真机安装前配置自动签名或发布签名。

生成的 Web 产物、签名和构建目录均不会提交到 Git。

## 数据与迁移

鸿蒙端使用 `carejournal.db` 和应用沙箱 `files/assets`，不会把病历素材留在
相册或下载目录。Android/Web 的已有数据可继续通过局域网同步的可携带快照
导入；LLM 密钥和服务商配置仍按既有规则不参与同步。

## 已接入能力

- ArkData RDB 保存病程、检查、图表、报销、设置和同步墓碑等结构化数据。
- 图片与 PDF 统一保存在应用私有素材目录，OCR、预览、备份和局域网同步按需读取。
- 系统文件选择、拍照入口、图片全屏预览、PDF 分页预览和备份文件保存。
- PDF 文本提取；扫描件与图片可先经本地 PaddleOCR 脱敏，再发送给 LLM。
- Azure OpenAI、DeepSeek 及其他 OpenAI-compatible 服务由 ArkTS 原生 HTTP 请求。
- 与 Android/Web 使用相同的端到端加密局域网同步协议，无配对码。
- 系统返回键关闭最上层弹窗或返回上一页，根页面再次返回时退出应用。
- 手机、平板和 2in1 共用响应式布局。

## 真机回归清单

签名安装后，建议依次验证：首次启动建库、图片/PDF 导入与预览、PDF 文字版和
扫描版识别、本地脱敏、各自使用的 LLM 服务、备份导出/恢复、前后台切换与返回键，
以及与 Android/Web 双向发现和同步。局域网同步需要设备处于同一 Wi-Fi，且网络
未开启客户端隔离。

当前工程已使用 `C:\Program Files\Huawei\DevEco Studio` 中的 DevEco Studio
与 HarmonyOS 6.1.1 SDK 验证构建。若安装在其他目录，可在运行构建命令前设置
`DEVECO_STUDIO_HOME`。
