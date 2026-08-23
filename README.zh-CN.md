# DSH 无限画布 MVP

把 DeepSeek Harness（DSH）的会话扩展成原生无限画布视图。

这版的架构边界刻意保持简单：

- **DSH 继续负责执行**：Session、Agent Loop、Tools、Skills、MCP、模型 Provider 和提交语义都不重写。
- **Canvas 负责空间**：节点、连线、选择、上下文组织、本地工作对象和人与 AI 的交互界面。
- MVP **没有第二套 Agent Loop**，也不会再启动另一套浏览器 / HTTP Host Runtime。

## 架构

```text
DSH Session / Agent / Tools / Skills / MCP
                    |
                    v
          DSH conversation.view
                    |
                    v
              无限画布
          (@canvas-harness/*)
            /       |       \
        DSH节点    Note     Link
            \       |       /
              选择即上下文
                    |
                    v
          DSH InputActions.submit()
                    |
                    v
                DSH Agent
```

## 当前 MVP 已实现

- 注册原生 `conversation.view = canvas`
- 当前 DSH Session 的会话节点自动映射成 Canvas Node
- pan / zoom / select / multi-select / drag
- 可创建并直接编辑本地 Note 节点
- Arrow / Link 连线工具
- 使用 canvas-harness Scene Codec 保存完整画布
- 持久化增加防抖，拖动画布和流式回复时不会每帧写 localStorage
- 不会因为 DSH 历史消息分页而误删已经沉淀在画布上的旧节点
- 选中内容通过 canvas-harness `getContext({ selectionOnly: true })` 生成 AI Context，节点与连线关系都可进入上下文
- 送给 Agent 的画布内容会明确标记为“不可信数据”，避免节点内部文字被误当成系统指令
- 画布底部可直接 Ask Agent，调用的是 DSH 公共 `InputActions.setDraft()` + `submit()`
- Agent 仍然运行在原 DSH Session 中，回复通过原会话流产生，再自动同步成新的 Canvas Node
- Host 入口保持空壳，不启动 Chromium、HTTP Route、文件系统能力或第二套 Agent Runtime
- `canvas-harness` 与浏览器安全的传递依赖打进单一 DSH Client Bundle；React / ReactDOM 继续由 DSH 提供
- 打包时自动生成第三方开源许可证清单

## 当前用户闭环

```text
打开 DSH Session
      |
      v
切换 Canvas
      |
      +--> 整理已有对话节点
      +--> 新建 / 编辑 Note
      +--> 用 Link 建立关系
      +--> 选择一个或多个对象
                  |
                  v
              Ask Agent
                  |
                  v
          原 DSH Agent 执行
                  |
                  v
            结果进入 Session
                  |
                  v
           自动成为新画布节点
```

## 这版明确还没做

MVP 不装作成品，免得工程进度又被 PPT 提前上市。

- **Canvas 还不是默认视图**。DSH 当前源码把 `chat` 写成默认 / fallback view，需要下一步对 DSH 做一个很小的默认视图改造。
- Image / File / Web / Code / 更丰富的 Artifact 节点还需要各自的 DSH Context Adapter。
- 图片节点暂时没有接入 DSH 的 draft-image registry，所以当前不会假装“图片选中后模型已经真正看到像素”。
- 多人实时协作、Presence、权限还没有接入。
- 团队共享 Skills 与内部资料还没有成为一等 Canvas Object。
- 当前 Scene 持久化是浏览器本地存储，团队级 / 服务端持久化放到下一阶段。
- 真实 DSH Profile + 真实模型 Provider 的安装和端到端验证仍是发布门。

## 为什么先用 canvas-harness

MVP 使用 `@canvas-harness/core` 与 `@canvas-harness/react`，因为它能提供我们真正需要的空间能力，同时不夺走 DSH 的 Harness 职责：

- MIT License
- React 18+
- Infinite Canvas + Node Graph
- 自定义节点扩展接口
- Scene 序列化
- AI Canvas Context
- Typed Op Log
- Presence / SyncAdapter 协作接口

Dim0 同样使用这套 Canvas Engine，因此 Dim0 适合作为多人协作、Agent Write-back、Mini App 等产品能力的参考实现，但 Agent 执行底座仍然使用 DSH。

## 开发验证

```bash
npm install
npm run build
npm run build:package
npm run test:package
npm run verify:install
```

仓库已经加入 Infinite Canvas MVP 的 GitHub Actions 工作流。只有 CI 变绿并在真实 DSH Profile 中完成模型调用后，这个 Draft PR 才应该进入可合并状态。

## 当前开发位置

- Branch：`feat/infinite-canvas-mvp`
- Issue：`#1 MVP：将 DSH 会话视图升级为无限画布`
- Draft PR：`#2 MVP: DSH Infinite Canvas conversation surface`

## License

项目代码使用 MIT License。打包过程会自动生成 `THIRD_PARTY_NOTICES.txt`，包含实际被打进浏览器 Bundle 的第三方开源声明。
