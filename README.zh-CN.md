# dsh-workbench

面向 DeepSeek Harness（DSH）的 **Review-first Artifact / Browser Workbench**。

> 当前状态：**0.4.0-beta.0 候选版**。文件/网页修改控制链、Chromium/CDP 浏览器工作台、Agent 提案、逐 Hunk 审核、Apply/Undo、DSH Bundle 形态以及本地安装/卸载烟测已经实现。真实 DSH Profile + 模型 Provider、正常 HTTP/HTTPS 导航、视觉回归和更高强度的文件系统安全仍是发布门。

## 核心工作流

```text
Artifact + 精确且带版本的 Selection + 用户要求
                 -> Agent
                 -> proposed ChangeSet
                 -> Hunk Review
                 -> Checkpoint + Version Recheck
                 -> Apply -> Verify -> Undo
```

Agent 在 Workbench 任务中默认只能**提出修改**，不能绕过审核直接写文件。

## 已实现

- Artifact / Selection / ChangeSet / Checkpoint 核心协议
- SHA-256 版本保护与每个 Patch 落盘前的二次版本检查
- 路径穿越、绝对路径和越界 symlink 防护
- Hunk 级 Accept / Reject / Comment / revise
- `workbench_propose` Agent Bridge
- Workbench 任务期间对 `write/edit/bash/str_replace_editor/terminal_*` 的单 Agent 强制 Guard
- Code Mode 嵌套 mutation 仍经过同一 Guard
- 真 Chromium + CDP：Tabs、Screenshot、DOM、Console、Network
- 截图点击 -> DOM Selection -> Annotation -> Agent -> ChangeSet
- DOM Selection 带版本，页面变化后旧 Selection 直接冲突
- DSH Session 级 Browser 隔离，Profile 默认临时
- UI 使用 `conversation.session.header.utilities` + `shell.overlay`，不替换官方 `details`
- DSH Bundle：`dsh.bundle.patch` + `cordis.patch.yml`
- DSH Client Loader 兼容的自注册 `lib/client.js`
- Host 使用 DSH `webServer.register()`；HTTP RPC 强制 loopback + same-origin + JSON + body cap
- 网页/源码选择内容明确作为未受信任数据，转义并限制 32 KiB

## 候选安装方式

在真实 DSH 环境中：

```bash
dsh plugin --profile workbench-beta add ./dsh-workbench-0.4.0-beta.0.tgz
dsh --profile workbench-beta --dump-config
dsh --profile workbench-beta
```

卸载：

```bash
dsh plugin --profile workbench-beta remove dsh-workbench
```

当前执行环境没有可运行的 DSH CLI 和真实模型 Provider，因此上面的真实 DSH Profile E2E 仍明确标记为待验证，并未假装通过。

## 当前验证结果

```text
npm run check          21 / 21 PASS
Golden file workflow  PASS
Golden Browser UX     PASS
Package contract      PASS
Tarball install smoke PASS
Host lifecycle        PASS
Uninstall cleanup     PASS
```

本地 tarball 安装烟测使用最小 fake runtime peer 来验证“发出去的 Host 入口能够加载和卸载”，它不等于真实 DSH 运行时测试。

## 环境限制

当前容器的 Chromium 被系统策略设置为 `URLBlocklist: ["*"]`，正常 HTTP/HTTPS 导航会返回 `ERR_BLOCKED_BY_ADMINISTRATOR`。因此真 Chromium E2E 使用 `about:blank + Page.setDocumentContent` 验证 CDP/DOM/Selection/Screenshot/Apply/Refresh/Undo。正常网络导航仍需在未被管理策略封锁的环境完成。

## 尚未关闭的安全边界

当前文件系统实现已经做 canonical path、symlink、版本和事务保护，但最终仍是 Node 的普通 path-based I/O。面对能够恶意并发替换父目录的本地进程，仍存在更高强度的 path-component TOCTOU 风险。稳定版应迁移到 DSH `ctx.fs`/sandbox policy 或等价的 no-follow descriptor 后端。

详见 [SECURITY.md](./SECURITY.md)。
