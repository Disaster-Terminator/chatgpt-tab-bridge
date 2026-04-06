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

## 认证状态导出与复用

测试脚本支持使用已导出的 ChatGPT 登录态，避免每次手动登录。

### `pnpm run auth:export`

导出 Chrome 登录状态到本地文件：

1. 复制 Chrome Default profile 到临时目录
2. 启动 Playwright 浏览器加载该 profile
3. 导航到 chatgpt.com 验证登录态
4. 导出 storageState 到 `playwright/.auth/chatgpt.json`
5. 导出 sessionStorage 到 `playwright/.auth/chatgpt.session.json`

**要求**：WSL Chrome 已有登录的 Default profile，或设置 `CHROME_DATA_DIR` 环境变量指向 Chrome profile 目录。

**注意**：`playwright/.auth` 已在 `.gitignore` 中，请勿提交认证文件。

### `pnpm run auth:verify`

验证导出的认证状态可被 Playwright 复用：

- 加载 `playwright/.auth/chatgpt.json` 的 storageState
- 使用 sessionStorage 恢复会话
- 检查页面是否显示已登录状态（account menu、composer 等）
- 输出 PASS/FAIL verdict

### 使用认证状态运行测试

所有测试脚本现在支持 `--auth-state` 和 `--session-state` 参数：

```bash
# 使用默认 auth 文件
pnpm run test:real-hop:auth
pnpm run test:semi:auth
pnpm run test:e2e:auth

# 自定义 auth 文件
pnpm run test:real-hop -- --auth-state /path/to/auth.json --session-state /path/to/session.json
```

### 认证测试参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--auth-state` | storageState 文件路径 | `playwright/.auth/chatgpt.json` |
| `--session-state` | sessionStorage 文件路径 | `playwright/.auth/chatgpt.session.json` |
| `--url-a` | 指定线程 A URL | 自动 bootstrap |
| `--url-b` | 指定线程 B URL | 自动 bootstrap |
| `--skip-bootstrap` | 跳过自动 bootstrap，等待手动导航 | - |

### 验收层级

- **smoke**：扩展加载
- **semi**：控制流辅助验证
- **e2e**：辅助场景脚本
- **real-hop**：**主链路真实性验收（唯一）**

real-hop 是唯一验证真实 first-hop 发送的测试，使用独立页面证据（目标页 user message 变化）而非运行时事件作为通过标准。

## 目录说明

- 扩展入口：
  - [`dist/extension/manifest.json`](/home/raystorm/projects/meta/dist/extension/manifest.json)
- 后台逻辑：
  - [`dist/extension/background.js`](/home/raystorm/projects/meta/dist/extension/background.js)
- 页面注入：
  - [`dist/extension/content-script.js`](/home/raystorm/projects/meta/dist/extension/content-script.js)
- Popup：
  - [`dist/extension/popup.html`](/home/raystorm/projects/meta/dist/extension/popup.html)
  - [`dist/extension/popup.js`](/home/raystorm/projects/meta/dist/extension/popup.js)

## 本地命令

```bash
pnpm run build
pnpm test
pnpm run test:smoke
pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>
pnpm run test:real-hop
pnpm run test:real-hop -- --url-a <thread-a> --url-b <thread-b>
pnpm run test:real-hop -- --skip-bootstrap

# 认证测试（使用已导出的登录态）
pnpm run auth:export    # 导出 ChatGPT 登录态
pnpm run auth:verify    # 验证导出的登录态可用
pnpm run test:real-hop:auth  # 使用 auth 运行 real-hop
pnpm run test:semi:auth      # 使用 auth 运行 semi
pnpm run test:e2e:auth       # 使用 auth 运行 e2e
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

定位：仅做扩展加载与注入冒烟，不验证真实发送。

### `pnpm run test:semi -- --url-a <thread-a> --url-b <thread-b>`

半自动联调脚本，验证控制流正确性（非真实性验证）：

- 两个页面都注入 overlay
- A/B 绑定是否成功
- popup 中 `bindingA` / `bindingB` 是否正确显示
- `Start` 在 `ready` 是否可点
- `Pause / Resume / Stop` 的启停逻辑是否正确
- `paused` 时 override 是否可写
- `running` 时 override 是否不可写

定位：控制流辅助验证，不作为主链路真实性验收。

### `pnpm run test:e2e -- --url-a <thread-a> --url-b <thread-b>`

场景矩阵脚本（happy-path / sync / busy 场景等），用于覆盖更多控制面回归。

定位：辅助场景脚本，不作为主链路真实性验收。

### `pnpm run test:real-hop`

**唯一主链路真实性验收路径**。验证一次真实 first-hop 发送闭环：

- 默认自动 bootstrap 两个线程（A/B 各发送一条 seed message，等待形成可绑定线程 URL）
- 也支持手动线程 URL：`--url-a <thread-a> --url-b <thread-b>`
- 也支持手动导航：`--skip-bootstrap`
- 启动 relay session
- 基于目标页面独立观察验证：
  - latest user message 相对发送前 baseline 发生变化
  - 变化后的 latest user message 与本次 relay payload 相关（例如包含 bridge context）
  - `waiting reply` 前必须已看到独立接受证据
- 运行时事件链（`GET_RECENT_RUNTIME_EVENTS`）仅作为辅助证据导出，不单独决定通过
- 自动导出证据包到 `tmp/real-hop-<timestamp>/`：
  - `acceptance-verdict.json`
  - 关键步骤截图
  - `runtime-events.json`
  - `observation-log.json`
  - `summary.json`
  - `run.log`

结论分层：

- smoke：扩展加载
- semi：控制流辅助
- e2e：辅助场景
- real-hop：主链路真实性验收（唯一）

## 在 Edge 里加载

1. 打开 `edge://extensions`
2. 开启"开发人员模式"
3. 点击"加载已解压的扩展"
4. 选择目录 [`dist/extension`](/home/raystorm/projects/meta/dist/extension)
