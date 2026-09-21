# 参与 CareJournal · Contributing

[项目首页](README.md) · [English overview](README.en.md) · [开发指南 / Development](docs/DEVELOPMENT.md)

欢迎帮助病程记变得更易用：反馈问题、改进操作说明、完善翻译或提交代码都可以。

Help make CareJournal easier to use through bug reports, documentation, translations, or code.

## 反馈问题 · Report a problem

在 [GitHub Issues](https://github.com/wyunchi-ms/CareJournal/issues) 中先查找是否已有相同问题，再提供：

Search existing issues first, then include:

- 应用版本、操作系统和设备型号 / App version, OS, and device.
- 重现步骤 / Steps to reproduce.
- 预期行为与实际结果 / Expected and actual behavior.
- 使用虚构数据的截图或最小示例 / Screenshots or a minimal example using fictional data.

请勿上传真实病历、报告图片、备份文件、API Key 或签名材料。提交日志前检查其中的文件路径、请求内容及密钥。

Do not upload real medical records, report images, backups, API keys, or signing material. Check logs for personal paths, request content, and credentials before sharing.

## 文档与翻译 · Documentation and translation

README 用于介绍产品、下载和首次上手；操作细节放入用户手册，开发与发布细节放入对应指南。修改前可通过[文档目录](docs/README.md)找到合适的位置。

Keep the README focused on the product, downloads, and getting started. Put detailed workflows in user guides and engineering instructions in development guides.

修改功能、平台状态或数据流向时，同步检查简体中文、繁體中文和 English 版本。截图使用虚构资料，注明实际运行环境；不要用设计稿或占位图代替产品截图。

When changing features, platform status, or data-flow descriptions, check all three language versions. Use fictional data for screenshots and state the capture environment. Do not present mockups or placeholders as product screenshots.

## 提交代码 · Submit code

1. Fork 仓库并创建工作分支 / Fork the repository and create a working branch.
2. 按[开发指南](docs/DEVELOPMENT.md)运行应用 / Set up the app with the development guide.
3. 围绕一个具体问题修改；界面变更参照[设计规范](design-system/carejournal/MASTER.md) / Keep the change focused; follow the design guidelines for UI work.
4. 运行相关测试、lint 和 build；原生变更追加平台验证 / Run relevant tests, lint, and build, plus platform checks for native changes.
5. 提交 Pull Request，说明解决的问题、行为变化、验证结果与已知限制 / Open a pull request describing the problem, behavior change, validation, and remaining limitations.

不要提交本机数据、生成的安装包、依赖目录、凭据或签名文件。涉及数据迁移、备份或同步时，说明对已有资料的影响，并用虚构数据验证。

Do not commit local app data, generated installers, dependency directories, credentials, or signing files. For migration, backup, or sync changes, explain effects on existing records and validate with fictional data.

维护者的双远端推送和正式发布流程见[发布维护](docs/RELEASE_MAINTENANCE.md)，普通贡献者无需配置发布基础设施。

Maintainers follow the [release guide](docs/RELEASE_MAINTENANCE.md) for dual-remote publishing. Contributors do not need release infrastructure credentials.
