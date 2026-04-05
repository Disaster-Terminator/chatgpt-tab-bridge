# ChatGPT Tab Bridge 前端冻结交接稿

## 状态
本稿为 **冻结版 handoff**，用于交给本地 agent 落地实现。
当前结论：

- Overlay：软冻结
- Popup：收口后冻结
- 后续仅允许实现期微调，不再做结构性重构

## 实现边界
只允许改以下部分：

- `src/extension/popup.html`
- `src/extension/popup.css`
- `src/extension/popup.ts`
- `src/extension/overlay.css`
- `src/extension/content-script.ts` 中与 overlay DOM / render / copy 相关的部分
- `src/extension/copy/*`
- `src/extension/ui/*`（若确有需要）

明确禁止改动：

- `src/extension/core/*`
- `src/extension/background.ts`
- bridge protocol
- state machine event semantics
- message types
- relay loop
- content-script 的 DOM 自动化策略本体

## 设计冻结点

### Overlay
定位：高频主操作面。

冻结信息架构：

1. Header
   - 左：`BRIDGE`
   - 左下轻状态：`Role · A/B/Unbound`
   - 右：phase badge + collapse button

2. 状态区
   - 第一行：`Round` + `Next` 的轻量元信息带
   - 第二行：`Step` 状态条
   - 仅在有 issue 时追加 issue 行
   - 不再使用大卡片式状态模块

3. Starter
   - A/B 同级 segmented control
   - 禁止做成开关心智
   - 禁止高饱和绿色开关风格
   - 必须克制、低饱和、低体积

4. 控制区（统一容器）
   - Binding
   - Session
   - Utility
   三层垂直排列，属于同一个控制系统

5. Binding
   - 只保留 A / B 两个槽位按钮
   - 当前绑定态高亮
   - 同一按钮承担绑定 / 解绑语义
   - 不再保留单独“解绑”按钮

6. Session
   - 仅保留当前主操作 + 必要 Stop
   - 只允许一个主按钮显著
   - 禁止回到按钮墙

7. Utility
   - Clear
   - Popup
   - 辅助层级，视觉权重低于 Session

### Popup
定位：低频设置 / 兜底 / 调试面板。

冻结信息架构：

1. 顶部
   - 小标题：`Popup`
   - 中标题：`设置 / Settings`
   - 一行短说明
   - 禁止 hero 式大标题区
   - 禁止 `LOW FREQUENCY` 这种低价值 badge

2. Global status
   - phase
   - round / next
   - step
   - bindings
   - current tab

3. Settings
   - locale
   - enable overlay
   - default expanded
   - reset overlay position

4. Fallback
   - paused next hop override
   - clear terminal
   - open help

5. Debug
   - 默认折叠
   - 折叠态只保留标题行
   - 展开后显示 step / issue / transport / selector / copy snapshot

## 语言规则
只支持两套 locale：

- `zh-CN`
- `en`

禁止 bilingual。
同一 locale 下必须整套统一，不允许标题中文、分组英文、行项再混用。

## 风格规则
整体视觉语言：

- 深色、低饱和、轻描边
- 统一圆角体系
- 减少容器套容器
- 允许少量暖金色作为强调
- phase 用冷色 badge
- 只有一个主操作按钮可以显著
- 其余操作降级为次级或辅助

## 交互与状态语义
必须保留以下语义：

- `Start` 只在 ready 可用
- `Pause` 只在 running 可用
- `Resume` 只在 paused 可用
- `Stop` 只在 running / paused 可用
- `Clear terminal` 只在 stopped / error 可用
- Binding 在 running / paused 时不可乱改
- `nextHopOverride` 仅允许 paused 时编辑
- locale 为全局设置，overlay / popup 共用 copy dictionary

## 冻结验收标准
实现后必须满足：

1. 2 秒可读
   - 当前 phase
   - 当前 step
   - 下一步主操作

2. Overlay 中只有一个主按钮显著

3. 状态区不再显得“设计过头”
   - 不再有明显多余容器
   - 不再一眼让人想继续改结构

4. 下半区是一个控制系统，不是三个散块

5. Popup 与 Overlay 是同一语言体系
   - 但 Popup 明显更低频、更弱主操作感

6. collapsed 态与展开态属于同一设计系统

## 落地优先级
P0：
- 信息架构与交互语义对齐
- enable/disable 逻辑正确
- 绑定状态正确

P1：
- 视觉还原
- 状态区 / starter / 控制区层级还原

P2：
- 实现期微调
- 1~2px 间距、hover、disabled、collapsed 态一致性

## 产物
本包包含：

- `ChatgptTabBridgePreview.tsx`：冻结预览稿
- `FINAL_HANDOFF.md`：本交接说明
