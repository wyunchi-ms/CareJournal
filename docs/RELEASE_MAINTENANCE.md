# CareJournal 发布与双远端维护方案

## 远端角色

- `origin`：GitHub，主要代码托管和英文/国际下载入口；
- `gitee`：Gitee，中国大陆镜像和下载入口；
- `main` 必须在两个远端指向同一 commit；
- Tag 和 Release 版本必须完全一致。

## 日常提交

提交仍按正常 Git 流程完成。推送统一使用：

```powershell
pwsh scripts/push-all.ps1
```

脚本先推 GitHub，再推 Gitee；任一失败会退出非零。请不要只运行 `git push`。

## 发布前检查

1. `package.json`、Android、Harmony 版本一致；
2. ChangeLog 有对应版本；
3. 工作树干净；
4. `main` 已通过 `push-all.ps1` 同步两个远端；
5. GitHub CLI 已登录，Gitee Token 已存入 Azure Key Vault（或临时环境变量）；
6. Azure 登录和签名材料可读；
7. Harmony 正式签名材料齐全，否则只能 `-AllowUnsignedHarmony -BuildOnly`。

## 本地一键构建

```powershell
# 只构建，不创建 tag/release
pwsh scripts/publish-release.ps1 -BuildOnly

# 正式双站发布（Harmony 必须已配置正式签名）
pwsh scripts/publish-release.ps1
```

输出目录 `release/` 不提交 Git，包括：

- Android signed APK；
- Harmony signed HAP（unsigned 调试模式会明确标注）；
- `SHA256SUMS.txt`；
- Release notes 临时文件。

## Token

GitHub 优先使用已登录的 GitHub CLI：

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login
```

Gitee 推荐存入 Azure Key Vault：

```powershell
pwsh scripts/init-release-infra.ps1 -StoreGiteeToken
```

也可以使用临时环境变量，不写进仓库：

```powershell
[Environment]::SetEnvironmentVariable('GITHUB_TOKEN', '...', 'User')
[Environment]::SetEnvironmentVariable('GITEE_TOKEN', '...', 'User')
```

- GitHub token：脚本优先读取 `gh auth token`；
- Gitee token：需要 `projects` 权限；脚本优先环境变量，否则读取 Key Vault；
- 发布脚本在创建 tag 前检查 token，避免无凭据半发布。

## Azure

- Resource Group：`rg-carejournal-release`
- Storage：`stcarejournal60f52ccd`
- Container：`signing`（私有）
- Key Vault：`kv-carejournal-60f52ccd`

签名文件放 Storage，密码/alias/hash 放 Key Vault。临时下载到 `.tmp/`，构建后删除。

## 换机器发布

新机器安装工具、登录同一 Azure 订阅、克隆仓库，运行相同脚本即可。Android 发布脚本会校验 keystore SHA-256，避免误用新密钥导致覆盖安装失败。

## 失败恢复

- push 失败：修复网络/权限后重新运行 `push-all.ps1`；
- 构建失败：不会创建 tag；
- tag 或 Release 创建/上传失败：脚本会尝试自动删除已创建的 GitHub/Gitee Release 与双远端 tag；若网络中断导致回滚失败，再按脚本提示人工清理；
- 禁止 force-push `main`；
- 禁止在 GitHub 和 Gitee 分别独立提交，避免历史分叉。
