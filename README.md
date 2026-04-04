# ChatGPT Tab Bridge

这是一个面向 Microsoft Edge 的浏览器扩展原型，用来在两个已经打开的 ChatGPT 线程之间做消息中继。

## 目标

第一版只做一个收窄后的可用原型：

- 复用你已经在浏览器里打开的两个 ChatGPT 页面
- 用户手动把其中一个标记为 `A`，另一个标记为 `B`
- 在 popup 里选择由哪一边先开始
- 扩展读取一边最近一条 assistant 回复，包装后发送给另一边
- 在达到停止条件时结束运行

## 当前预期行为

### 绑定

- 你先手动打开两个 ChatGPT 线程页面
- 在页面上的悬浮控件里把它们分别标记为 `A` 和 `B`
- 也可以在扩展 popup 里完成绑定
- `A` 和 `B` 必须是两个不同的线程

### 启动

- 悬浮窗现在是日常主操作面
- 当 `A` 和 `B` 都绑定完成后，状态会进入 `ready`
- 这时 `Start` 才应该可点击
- 点击 `Start` 后进入 `running`
- `running` 只表示中继循环已经启动，不代表已经成功完成了一轮发送
- 运行时可以在悬浮窗或 popup 里看到当前步骤，例如：
  - `reading A`
  - `sending A -> B`
  - `waiting B reply`

### 暂停 / 恢复 / 停止

- `Pause` 只在 `running` 时可用
- `Resume` 只在 `paused` 时可用
- `Stop` 只在 `running` 或 `paused` 时可用
- `round` 在 `Pause` / `Resume` 之间不能重置

### Override

- `nextHopOverride` 只允许在 `paused` 时修改
- 在 `running` 时不能修改
- 恢复后只消费一次，然后自动清空

### 结束状态

- 正常停止进入 `stopped`
- 运行时正确性问题进入 `error`
- `clearTerminal -> ready -> start` 是唯一的新会话入口

## 支持的页面 URL

- 普通线程：
  - `https://chatgpt.com/c/<conversation-id>`
- 项目内线程：
  - `https://chatgpt.com/g/<project-id>/c/<conversation-id>`

不支持把根页面 `https://chatgpt.com/` 直接当成已绑定线程。

## 交互形态

- **页内悬浮窗**：主操作面
- **Popup**：设置、调试、完整状态与低频控制

页内悬浮窗目前支持：

- 绑定当前页为 `A`
- 绑定当前页为 `B`
- 解绑当前页
- 选择 starter
- `Start / Pause / Resume / Stop / Clear`
- 显示 `phase / round / next hop / current step / last issue`
- 拖动
- 折叠
- 打开 popup

## 是否需要前台焦点

当前实现目标是：

- **不要求两个被控页面一直保持前台焦点**
- 扩展不会主动把标签页切到前台
- 但被控页面本身会被脚本读写 DOM、填写输入框、点击发送

换句话说：

- 设计上是“后台自动运行”
- 不是“前台无变化”
- 如果 ChatGPT 页面本身对后台标签页的行为有限制，仍可能影响实际效果

## 停止条件

- assistant 回复中出现 `[FREEZE]`
- 超时
- 重复输出
- 达到最大轮数

发送给另一边的内容会带上：

- 来源侧
- round 编号
- 原始 assistant 输出
- 明确的机器可读尾部协议

当前协议要求模型在回复最后一行输出：

- `[BRIDGE_STATE] CONTINUE`
- 或 `[BRIDGE_STATE] FREEZE`

## 已知限制

- 目前主要验证的是 popup / overlay / 状态机 / 控制逻辑
- 真实 ChatGPT 页面 DOM 仍可能变化，selector 还需要按实际页面微调
- 未登录匿名根页虽然可能允许输入，但不稳定进入可绑定线程 URL，因此不能作为正式联调基线
- 更适合用真实线程 URL 做半自动联调

## 目录说明

- 扩展入口：
  - [`dist/extension/manifest.json`](/home/raystorm/projects/meta/dist/extension/manifest.json)
- 后台逻辑：
  - [`dist/extension/background.mjs`](/home/raystorm/projects/meta/dist/extension/background.mjs)
- 页面注入：
  - [`dist/extension/content-script.js`](/home/raystorm/projects/meta/dist/extension/content-script.js)
- Popup：
  - [`dist/extension/popup.html`](/home/raystorm/projects/meta/dist/extension/popup.html)
  - [`dist/extension/popup.mjs`](/home/raystorm/projects/meta/dist/extension/popup.mjs)
- 核心状态与协议：
  - [`dist/extension/core/state-machine.mjs`](/home/raystorm/projects/meta/dist/extension/core/state-machine.mjs)
  - [`dist/extension/core/popup-model.mjs`](/home/raystorm/projects/meta/dist/extension/core/popup-model.mjs)
  - [`dist/extension/core/relay-core.mjs`](/home/raystorm/projects/meta/dist/extension/core/relay-core.mjs)
  - [`dist/extension/core/chatgpt-url.mjs`](/home/raystorm/projects/meta/dist/extension/core/chatgpt-url.mjs)

## 本地命令

```bash
pnpm run build
pnpm test
pnpm run test:smoke
pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>
```

### `pnpm run build`

本地扩展校验：

- `manifest.json` 可读
- 被引用文件存在
- 扩展脚本通过语法检查

### `pnpm test`

本地单元测试，当前重点覆盖：

- 状态机
- popup controls 的 enable / disable
- URL 识别
- 中继协议
- content-script 输入 / 发送辅助逻辑

### `pnpm run test:smoke`

启动 Playwright Chromium，验证：

- 扩展成功加载
- `chatgpt.com` 页面注入 overlay
- popup 能通过扩展 id 打开

### `pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>`

半自动联调脚本，建议只传真实线程 URL。它主要验证：

- 两个页面都注入 overlay
- A/B 绑定是否成功
- popup 中 `bindingA` / `bindingB` 是否正确显示
- `Start` 在 `ready` 是否可点
- `Pause / Resume / Stop` 的启停逻辑是否正确
- `paused` 时 override 是否可写
- `running` 时 override 是否不可写

## 在 Edge 里加载

1. 打开 `edge://extensions`
2. 开启"开发人员模式"
3. 点击"加载已解压的扩展"
4. 选择目录 [`dist/extension`](/home/raystorm/projects/meta/dist/extension)
