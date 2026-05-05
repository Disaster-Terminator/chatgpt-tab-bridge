# RelayKit for ChatGPT

RelayKit for ChatGPT 是一个浏览器扩展，用来在两个你手动选定的 ChatGPT Web 会话之间建立可控、可观察、可暂停的中继流程。

它不是新的模型、不是 API 网关，也不是面向大众用户的一键自动化插件。它解决的是一个更具体的问题：当你已经打开两个 ChatGPT 页面，并希望它们围绕同一任务接力讨论时，如何让这个过程可启动、可暂停、可恢复、可观察，并尽量避免发错页面、重复发送、状态失真。

当前阶段：**可运行原型**。适合工作流实验、真实页面联调和 relay 链路探索，不适合当作长期无人值守的生产自动化工具。

---

## 它是什么

RelayKit 会把两个 ChatGPT 页面分别绑定为 `A` 和 `B`，然后按你选择的起始侧进行 relay：

1. 从当前源页面读取最新 assistant 回复；
2. 生成带有中继指令和 hop 标记的 payload；
3. 发送到目标页面；
4. 等待目标页面生成回复；
5. 再反向继续下一跳。

整个过程不是盲目填框发送。扩展会维护运行状态、当前轮次、下一跳、最近错误和运行事件，并通过页内悬浮窗与 popup 展示出来。

---

## 适合什么场景

适合：

- 试验两个 ChatGPT 会话之间的接力工作流；
- 做 tab-to-tab relay 原型；
- 观察 ChatGPT Web 页面联调中的真实边界；
- 调试“读取、发送、等待、确认、继续”这一类浏览器扩展控制链路；
- 研究如何把现有网页会话纳入半自动工作流。

不适合：

- 普通用户一键安装即用；
- 长时间无人值守运行；
- 对稳定性要求很高的生产自动化；
- 替代正式的 API agent runtime；
- 处理敏感、私密或不可出错的会话内容。

---

## 核心能力

- 手动绑定两个 ChatGPT 页面为 `A / B`
- 选择 `A` 或 `B` 作为 starter
- 支持 `Start / Pause / Resume / Stop / Clear`
- 页内悬浮窗作为主要操作面
- popup 作为状态总览、设置和调试入口
- 显示 phase、round、next hop、current step、last issue
- 支持普通 ChatGPT 线程页面
- 支持项目内 ChatGPT 线程页面
- 对 relay payload 注入紧凑的 hop metadata
- 用 `[BRIDGE_STATE] CONTINUE` / `[BRIDGE_STATE] FREEZE` 控制继续或停止
- 对重复输出、错误目标、陈旧页面、目标不可达等情况做防护
- 提供本地开发、Playwright smoke、CDP attach 等测试辅助脚本

---

## 当前交互方式

### 页内悬浮窗

这是主要操作入口。在 ChatGPT 页面内，你可以直接完成：

- 绑定当前页为 `A`
- 绑定当前页为 `B`
- 选择 starter
- 启动、暂停、恢复、停止 relay
- 清空当前运行状态
- 查看当前 phase、round、next hop、step 和 last issue
- 拖动或折叠悬浮窗

### Popup

Popup 更适合低频操作和调试：

- 查看全局运行状态
- 查看当前绑定关系
- 切换语言
- 控制悬浮窗显示
- 重置悬浮窗位置
- 查看调试信息和运行快照

---

## 支持的页面

优先支持：

```text
https://chatgpt.com/c/<conversation-id>
https://chatgpt.com/g/<project-id>/c/<conversation-id>
```

部分尚未形成持久线程 URL 的 ChatGPT 页面也可以作为 live session 绑定，但首次使用时更建议：

1. 先打开两个稳定的 ChatGPT 线程页面；
2. 每个页面至少完成一轮正常对话；
3. 再绑定为 `A / B`；
4. 最后启动 relay。

这样更符合当前原型阶段的稳定性预期。

---

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建扩展

```bash
pnpm run build
```

构建产物会输出到：

```text
dist/extension
```

### 3. 加载扩展

当前推荐使用 Microsoft Edge 以“已解压扩展”的方式加载。

1. 打开 `edge://extensions`
2. 开启“开发人员模式”
3. 点击“加载已解压的扩展”
4. 选择 `dist/extension`

Chrome 或其他 Chromium 浏览器也可以作为后续兼容目标，但当前 README 以 Edge 本地加载为默认路径。

### 4. 打开两个 ChatGPT 页面

手动打开两个你要参与 relay 的 ChatGPT 页面。

建议：

- 两个页面都属于 `chatgpt.com`
- 不要把 `A` 和 `B` 绑定到同一个线程
- 页面处于可正常输入、发送和生成回复的状态

### 5. 绑定 A / B

在两个页面里分别使用悬浮窗，把它们绑定为 `A` 和 `B`。

### 6. 选择 starter 并启动

选择 `A` 或 `B` 作为起始侧，然后点击 `Start`。

RelayKit 会从起始侧读取最新 assistant 回复，发送到另一侧，并在两侧之间持续接力，直到你暂停、停止，达到轮次限制，或模型输出停止标记。

---

## 运行状态

常见 phase：

- `ready`
- `running`
- `paused`
- `stopped`
- `error`

常见 step：

- `reading A`
- `sending A -> B`
- `verifying A submission`
- `waiting A reply`
- `reading B`
- `sending B -> A`
- `waiting B reply`

这些状态的价值在于：当 relay 卡住时，你能知道它卡在读取、发送、确认、等待回复，还是目标页面识别上，而不是只能看到“扩展没反应”。

---

## Relay 协议

RelayKit 会把源页面的最新 assistant 回复包装成 relay payload，并在其中加入少量机器可读信息。

典型结构类似：

```text
<source assistant message>

[BRIDGE_META hop=<hop-id>]

[BRIDGE_INSTRUCTION]
继续上方桥接内容的讨论。
请在回复最后单独输出一行状态:
[BRIDGE_STATE] CONTINUE
或
[BRIDGE_STATE] FREEZE
```

其中：

- `hop` 用来区分当前中继跳转，减少重复发送和错误页面判断；
- `[BRIDGE_STATE] CONTINUE` 表示继续 relay；
- `[BRIDGE_STATE] FREEZE` 表示停止 relay；
- 自然语言指令可以本地化，但机器状态行保持稳定。

---

## 当前边界

RelayKit 通过浏览器内容脚本读取和操作 ChatGPT 网页。因此，如果 ChatGPT 前端结构、输入框行为、消息 DOM 或发送流程发生变化，扩展行为可能受到影响。

扩展会对你绑定的页面做真实读写操作，包括读取页面消息、写入输入框、观察生成状态和判断最新回复。它更接近“受控的页面联调工具”，而不是不可见的后台 API 流程。

可能影响运行的因素包括：MV3 service worker 挂起、标签页被浏览器回收、ChatGPT 页面状态陈化、页面仍在生成、网络或登录状态变化。

遇到异常时，优先尝试：

1. 刷新相关 ChatGPT 页面；
2. 重新绑定 `A / B`；
3. 清空状态；
4. 重新启动 relay。

当前默认路径是本地构建、本地加载、本地调试。如果你期待的是正式上架、自动更新、普通用户可直接使用的产品形态，这个项目还没有到那个阶段。

---

## 权限与隐私

RelayKit 的核心行为发生在你明确绑定的 ChatGPT 页面里。

这意味着扩展会接触这些页面中的对话内容，并会把一侧的内容发送到另一侧。请不要把它用于你不愿意让扩展脚本读取、转发或处理的敏感会话。

---

## 开发与测试

常用命令：

```bash
pnpm run build
pnpm run typecheck
pnpm run test
```

浏览器认证和真实页面测试请看：

```text
docs/auth.md
docs/testing.md
```

当前测试体系区分几类路径：

- 基础单元测试；
- popup / overlay / state machine 测试；
- Playwright persistent profile smoke；
- CDP attach smoke；
- real-hop / semi / e2e 高层链路。

真实 ChatGPT 页面联调受登录态、浏览器 profile 和 UI 变化影响较大，所以项目保留了多个测试 lane，但不把 `storageState` replay 当作唯一可信认证基线。

---

## 项目状态

当前重点不是扩展功能堆叠，而是把核心 relay 链路做稳：

- 减少错误绑定；
- 减少误判发送成功；
- 减少 stale target / wrong target；
- 改善 verification 和 waiting reply 的状态推进；
- 让悬浮窗成为真正可用的主操作面；
- 让 popup 和 debug snapshot 能帮助定位问题；
- 把用户文档、测试文档、认证文档和内部开发记录分离。

---

## Roadmap

短期优先级：

- 稳定 `A -> B -> A` 主链路；
- 改善 stuck verification 的诊断信息；
- 优化 overlay 的状态呈现；
- 继续压缩 relay metadata；
- 完善 debug snapshot；
- 明确哪些测试是 smoke，哪些测试是业务回归；
- 准备更清晰的 architecture 文档。

暂不优先：

- 商店发布；
- 大众用户安装体验；
- 多标签页复杂编排；
- 完全无人值守；
- 跨站点通用自动化；
- 替代 Codex、OpenCode、Claude Code 等成熟 agent runtime。

---

## English summary

RelayKit for ChatGPT is a browser extension that creates a controlled relay workflow between two manually selected ChatGPT Web conversations.

It is designed for workflow experiments, browser extension research, and tab-to-tab relay prototyping on top of existing ChatGPT Web sessions. It is not a production-grade unattended automation tool.

---

## License

No license file is currently included in this repository.
