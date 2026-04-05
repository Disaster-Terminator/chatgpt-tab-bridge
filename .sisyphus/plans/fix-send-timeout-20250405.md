# Fix send_message_timeout and Enhance Debug Snapshot

## 目标概述

修复 A→B 第一次发送时的 `send_message_timeout` 问题，防止页面冻结，并增强 `copyDebugSnapshot` 的诊断信息，以便快速定位失败原因。

**核心改动：**
- 将 `waitForSubmissionAcknowledgement` 超时从 5000ms → 10000ms
- 移除 `characterData: true` 避免冻结
- 扩大 `isGenerationInProgress` 选择器覆盖（"Pause"/"Cancel"/"暂停"/"取消"）
- 新增 `GET_LAST_ACK_DEBUG` 消息，暴露最后一次发送的明细数据
- `popup` 的 `buildDebugSnapshot` 包含这些数据

**成功标准：**
- 单元测试全部通过（30/30）
- 构建无错误
- 在真实 ChatGPT 标签页中，第一次发送成功，不再立即超时
- 复制的调试快照包含 `Ack Debug:` 区块，显示 `baseline`/`latest` 哈希、`signal`、`timedOut` 等

---

## 任务分解（并行）

### Wave 0: 准备
无需。

---

### Wave 1: Content Script 核心修复

#### Task 1.1 延长确认超时 & 移除冻结源
- **范围**: `src/extension/content-script.ts` 函数 `waitForSubmissionAcknowledgement` (lines 564-611)
- **改动**:
  - 将 `setTimeout(..., 5000)` 改为 `setTimeout(..., 10000)`
  - 将 `observer.observe` 的 `characterData: true` 移除
- **原因**: 给 ChatGPT 更多响应时间；`characterData` 导致页面冻结
- **验证**: 阅读修改后的代码，确认超时为 10000、`characterData` 不再出现

#### Task 1.2 强化生成中检测
- **范围**: `src/extension/content-script.ts` 函数 `isGenerationInProgress` (lines 646-651)
- **改动**: 选择器扩展为：
  ```ts
  document.querySelector('button[aria-label*="停止"], button[aria-label*="Stop"], button[aria-label*="暂停"], button[aria-label*="Pause"], button[aria-label*="取消"], button[aria-label*="Cancel"]')
  ```
- **原因**: 覆盖更多生成控制按钮状态
- **验证**: 确认选择器包含上述六个关键词（英文+中文）

#### Task 1.3 添加 lastAckDebug 存储
- **范围**: `src/extension/content-script.ts` 模块顶层
- **改动**: 声明 `let lastAckDebug: AckDebug | null = null;`，并定义 `interface AckDebug { ok: boolean; signal: string | null; error: string | null; timedOut: boolean; baseline: { userHash: string | null; composerText: string; generating: boolean; expectedHash: string }; after: { latestUserHash: string | null; composerText: string; generating: boolean; }; timestamp: number; }`
- **位置**: 在 `overlaySnapshot` 声明附近添加
- **验证**: 代码编译通过，类型正确

#### Task 1.4 新增消息处理 & 数据收集
- **范围**:
  - `src/extension/core/constants.ts`: 在 `MESSAGE_TYPES` 添加 `GET_LAST_ACK_DEBUG` (lines 36-57)
  - `src/extension/content-script.ts`: 添加 `chrome.runtime.onMessage` 监听（在现有监听器内新增 `case`），并修改 `sendRelayMessage` 在 `waitForSubmissionAcknowledgement` 完成后更新 `lastAckDebug`（包含所有相关值：baseline、latestUserHash、after composerText、generating 变化、signal、error、timedOut）
- **改动细节**:
  - `constants.ts`: 插入 `GET_LAST_ACK_DEBUG: "GET_LAST_ACK_DEBUG"`
  - `content-script.ts`: 
    - 扩展 `onMessage` listener: `if (message?.type === MESSAGE_TYPES.GET_LAST_ACK_DEBUG) { sendResponse(lastAckDebug ?? { ok: false, error: "no_ack_debug" }); return true; }`
    - 在 `sendRelayMessage` 内，`waitForSubmissionAcknowledgement` 完成后（成功或失败），执行 `lastAckDebug = { ... }` 包含 `baseline`（从 `submissionBaseline` 取）、`after`（从当前 composer text + `readLatestUserHash()` + `isGenerationInProgress()` 取）、`signal`/`error`/`timedOut`（由 `acknowledgement` 结果推导）、`timestamp: Date.now()`
- **验证**: 
  - 编译通过
  - `GET_LAST_ACK_DEBUG` 可被 background/popup 发送并返回对象
  - 发送消息后 `lastAckDebug` 非空

---

### Wave 2: Popup 诊断增强

#### Task 2.1 获取并包含 Ack 调试信息
- **范围**: `src/extension/popup.ts` (`copyDebugSnapshot` lines 328-351, `buildDebugSnapshot` lines 353-378)
- **改动**:
  - 在 `copyDebugSnapshot` 中，在 `refresh()` 获得 `latestModel` 后，额外发送消息到当前活动标签页获取 `lastAckDebug`：
    ```ts
    const ackDebug = await chrome.tabs.sendMessage(currentTabId, { type: MESSAGE_TYPES.GET_LAST_ACK_DEBUG }).catch(() => null);
    ```
  - 将 `ackDebug` 传给 `buildDebugSnapshot`，修改其签名为 `buildDebugSnapshot(model: PopupModel, ackDebug: AckDebug | null): string`
  - 在返回的字符串中，`lastIssue` 之后追加一个区块，例如：
    ```
    Ack Debug:
      Timestamp: <date>
      Expected (hash): <expectedHash>
      Baseline:
        userHash: ...
        composerText: <preview>
        generating: ...
      After:
        latestUserHash: ...
        composerText: <preview>
        generating: ...
      Signal: <signal or none>
      Timed out: <true/false>
      Error: <error or "none">
    ```
  - 注意截断长文本预览（最多 60 字符）
- **依赖**: 需要 `MESSAGE_TYPES` 导入已在 popup.ts 中存在（第1行），无需修改；但需要引入 `AckDebug` 类型（可从 `shared/types` 新增，或在此临时使用 `any`）。建议在 `src/extension/shared/types.ts` 中增加 `AckDebug` 接口，然后两边导入。若暂时避免跨文件改动，可在 popup.ts 内使用 `any` 类型注释并依赖运行时结构。为稳妥，建议仅在输出时使用 `any` 避免新增类型依赖。
- **验证**: 
  - 编译通过
  - 复制快照中包含 Ack Debug 区块，内容非空
  - 若当前标签页不支持或无数据，区块显示为 "No ack debug info"

---

### Wave 3: 验证与质量

#### Task 3.1 运行单元测试
- **命令**: `pnpm test`
- **预期**: 全部通过
- **失败处理**: 分析失败，修改代码直到通过

#### Task 3.2 运行构建
- **命令**: `pnpm run build`
- **预期**: 退出码 0，无错误
- **失败处理**: 修复类型错误或文件缺失

---

### Wave 4: 提交与推送

#### Task 4.1 创建提交并推送
- **工具**: `git-master` 技能
- **动作**: 
  - `git add -A`
  - `git commit -m "fix(send): increase ack timeout to 10s, remove characterData, harden generation detection; enhance popup debug snapshot with ack details"`
  - `git push`
- **验证**: `git status` 显示无未提交更改；远程分支已更新

---

## 执行顺序与依赖

```
Wave 1 (Tasks 1.1-1.4) 可并行，无代码依赖
  ↓
Wave 2 (Task 2.1) 依赖 Wave 1 的接口实现
  ↓
Wave 3 (Tasks 3.1-3.2) 依赖 Wave 2 完成
  ↓
Wave 4 (Task 4.1) 所有验证通过后执行
```

---

## 工具与技能

- **默认分类**: `deep` (复杂逻辑修改)
- **Git 操作**: `category="quick" load_skills=["git-master"]`
- **测试/构建**: `quick` 或直接命令

---

## 检查清单 (Pre-Commit)

- [ ] 修改文件列表:
  - `src/extension/content-script.ts`
  - `src/extension/core/constants.ts`
  - `src/extension/popup.ts`
  - (可选) `src/extension/shared/types.ts` 如新增 `AckDebug`
- [ ] 无 `as any` 或 `@ts-ignore` (除非完全必要)
- [ ] 单元测试通过
- [ ] 构建通过
- [ ] 手动验证（建议）: 在两个 ChatGPT 标签页模拟一次中继，检查无冻结、无 timeout，复制调试信息包含 Ack Debug

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 10s 仍不足导致 timeout | 可后续调大，本次先验证 |
| `isGenerationInProgress` 选择器遗漏新 UI | 使用 broad 匹配（部分匹配）且覆盖中英文，降低风险 |
| 新增消息类型导致其他文件编译错误 | 仅修改 content-script 和 constants，影响面小 |
| popup 调用 `chrome.tabs.sendMessage` 失败（无目标 tab）| 用 `try/catch` 忽略，不影响正常操作 |

---

## 备注

- 保持原子提交：所有改动一次性推出，便于回滚。
- 用户要求“不要原子化改动”，意在不零散提交，而是完整方案后一并提交。
- 完成后可进行真实场景的半自动联调（`pnpm run test:semi`）进一步验证。

---

**计划批准后**，运行 `startwork` 或让 Sisyphus 开始执行。
