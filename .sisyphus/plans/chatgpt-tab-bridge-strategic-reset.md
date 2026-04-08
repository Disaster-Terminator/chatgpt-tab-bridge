# ChatGPT Tab Bridge 战略重规划

## TL;DR
> **Summary**: 这个项目当前的主问题不是“缺少更多脚本”或“状态机还不够完整”，而是系统能够在没有页面侧真实 first-hop 证据的情况下推进自身状态，导致内部看似成立、页面事实却没有本质变化。后续执行必须围绕 **session-first、URL-later、page-fact-first** 重建。
> **Deliverables**:
> - 一套新的系统真相层级与验收哲学
> - 一份以 first-hop 真实性恢复为中心的执行路线图
> - 一组强制性的架构边界：执行器 / 协调器 / 观察器
> - 一套将 URL 降级为增强身份、将 live session 升为主身份的重构方向
> - 一条被进一步压缩后的 Immediate Focus：只推进任务 4 + 任务 5
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: 任务 1 → 任务 4 → 任务 5 → 任务 7 → 任务 8

## Context
### Original Request
- 站在“系统总设计师 + 技术审查员”视角，重新规划 ChatGPT Tab Bridge 的长期目标、核心架构原则、验证哲学、阶段性路线图，以及下一轮最值得推进的工作重心。
- 输出必须是中文、战略层级、严谨可执行，但不写代码、不下发具体实现补丁。

### Interview Summary
- 用户已明确指出：**行为始终没有本质变化**，并且系统会在页面没有明显真实发送行为的情况下快速进入“等待中”等后续状态。
- 用户已明确推翻旧前提：**URL-first 是错的**。没有 `/c/...` 或 `/g/.../c/...` URL，不等于没有 live session，不等于不能发送、不能取证、不能验收。
- 用户要求重建的系统原则是：
  - **live session 是主身份**
  - **thread URL 是增强身份**
  - **页面事实高于扩展状态，高于测试脚本，高于报告与提交说明**
  - **先恢复真实 first-hop，再谈稳定性、多轮 relay、持久化和复杂测试矩阵**

### Repository Findings
- `src/extension/background.ts` 当前是事实上的总协调器：负责 relay loop、等待逻辑、verification polling、状态发布。
- `src/extension/content-script.ts` 当前承担页面读写：既负责 DOM 侧读取，又负责实际 send 动作，还承载部分页面观察。
- `src/extension/shared/chatgpt-url.ts` 与绑定逻辑说明：仓库已支持 live session fallback，但 URL identity 仍被当作一等身份路径处理。
- `src/extension/core/state-machine.ts` 说明：仓库已经有 phase 语义，但关键问题不是“有没有状态机”，而是**状态推进是否真正被页面事实因果约束**。
- `scripts/real-hop-playwright.mjs` 是当前唯一接近“真实性验收”的脚本；`semi/e2e` 主要仍在验证控制流、自报状态、按钮可用性与 runtime 输出。

### Metis Review (gaps addressed)
- 必须把 **content script reachability / MV3 worker suspension / stale page instance / DOM selector 漂移** 写成显式风险，而不是隐含假设。
- 最终文档必须加入硬性 guardrail：**没有独立页面证据，不允许状态推进到 waiting / accepted / verified 语义**。
- 必须压制 scope creep：不要在 single-session first-hop 未被证明前引入多会话、复杂持久化、指标看板、自动 URL 升级复杂逻辑。
- 必须把“执行器 / 协调器 / 观察器”从口号提升为协议级边界，否则后续执行仍会把 send、判断、验收混成同一层。

## Work Objectives
### Core Objective
把 ChatGPT Tab Bridge 从“内部会自证完成”的系统，重置为“即使不解释，页面行为也明显正确”的系统；其核心是让 first-hop 真实发送成为唯一优先级最高的可证明事实。

### Deliverables
- 一份明确的现状诊断：指出真正主问题、表面问题、历史跑偏点、最危险误区。
- 一套长期架构愿景：session-first、URL-later、page-fact-first、执行器/协调器/观察器分层。
- 一份分阶段路线图：Phase 0 ~ Phase 5。
- 一份下一轮工作的清晰问题定义与目标定义。
- 一套证据层级体系，用于未来所有本地执行的验收与止损。
- 一套未来本地执行边界建议：哪些工作适合大模型规划、哪些适合小步代理、哪些适合长链自治代理。

### Definition of Done (verifiable conditions with commands)
- `Read .sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md` 可见完整六大内容：总判断、现状诊断、核心架构愿景、长期路线图、当前工作重心、验收哲学、执行边界建议。
- 计划中的所有执行任务都以 **页面事实优先** 为前提，且未把 URL 作为核心业务前置条件。
- 计划中的所有执行任务都把 **first-hop 真实性恢复** 放在 multi-round relay 与持久化之前。
- 计划中的所有执行任务都给出 agent-executable acceptance criteria 与 QA scenarios。

### Must Have
- 明确写出：当前真正主问题是 **系统可能在没有真实 first-hop 的情况下推进到后续状态**。
- 明确写出：**页面独立事实** 是最高真相源，runtime/test/log/self-report 都只是辅助证据。
- 明确写出：**live session 是主身份，thread URL 只是升级后的 persistent identity**。
- 明确写出：**执行器 / 协调器 / 观察器** 三层职责与边界。
- 明确写出：Phase 1 和 Phase 2 必须围绕 first-hop 真实发送与真实性验收，而不是 UI、美化测试或 URL bootstrap。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不得继续把 URL 当主业务前提。
- 不得把认证、默认 profile、CDP 限制当成当前主问题。
- 不得优先修补 popup/overlay 展示层来掩盖 page-side 事实缺失。
- 不得把新增脚本数量、日志丰富度、提交说明完整度当成成功证据。
- 不得默认保留现有测试体系原状；所有测试的地位必须按证据层级重新排序。
- 不得在 first-hop 未被证明前启动多轮 relay、复杂恢复、长期持久化或大规模矩阵回归。

### A. 现状诊断
1. **真正主问题**：当前项目的根本故障是“系统真相源错位”。系统内部可以进入 `running / waiting / verification_passed` 等语义，但页面上并没有清晰可见的真实发送与接受事实。
2. **表面问题**：等待过早、URL 不稳定、脚本偶尔 PASS/FAIL、状态描述不清晰，这些都只是表象；它们共同指向的是“系统用内部相关信号替代了页面因果事实”。
3. **历史跑偏方向**：
   - 把 thread URL 当成 relay 的入口前置条件；
   - 过度围绕 bootstrap、认证、profile、脚本参数打转；
   - 在 first-hop 未被证明前就扩展状态机、场景矩阵与解释层；
   - 让 runtime 自报、popup 状态、测试脚本输出逐步凌驾于页面事实之上。
4. **最危险认知误区**：把“内部看起来合理”误判为“页面上真的发生了”。一旦这个误区不纠正，系统只会越来越会解释自己，而不会越来越会工作。
5. **为什么‘行为始终没变’最高优先**：因为这是否定一切内部自证的外部观测。只要用户实测看到“页面没有真实发送”，那么任意 PASS、任意 verification、任意 commit narrative 都必须降级处理。

### B. 核心架构愿景
1. **为什么要 session-first，URL-later**：URL 是持久身份的增强信号，但 live session 才是页面仍然可读、可写、可观察、可验收的真实业务载体。URL 可能缺失、延迟出现、切换形态；session 只要仍活着，核心业务就必须能继续。
2. **live session 与 persistent URL 的职责**：
   - live session：绑定当前页面实例、页面能力、消息收发与第一现场取证；
   - persistent URL：在 URL 出现后提供可恢复、可重连、可追踪的增强身份；
   - 两者关系应是“先有 session，后可升级 URL”，而不是“没有 URL 就没有 session”。
3. **执行器 / 协调器 / 观察器 分层**：
   - 执行器：只负责把 payload 送入页面，并返回动作级确认；
   - 协调器：只负责 hop 顺序、轮次、停止条件、失败分层与状态推进；
   - 观察器/验证器：只负责读取页面事实并判断“是否真的发送/接受/开始生成/结束生成”。
4. **为什么 first-hop 压倒一切**：如果第一跳都不能被独立证明，多轮 relay 只是把错误放大；first-hop 是所有后续轮次、恢复、升级、持久化的因果地基。
5. **为什么页面事实优先必须成为最高准则**：因为只有页面独立事实能否定 runtime 幻觉。只看 popup、runtime event 或脚本输出，系统会不断滑向“看起来完成”的假象。

### C. 长期路线图
#### Phase 0：重新定义真相与目标
- **目标**：重写项目的成功定义、失败分层、证据层级与术语。
- **关键问题**：哪些状态只是内部过程，哪些状态代表页面事实已经成立？
- **不该急着做什么**：不重写大量代码，不扩展测试矩阵，不修 UI 外观。
- **完成标准**：仓库内外对“成功”与“通过”的定义统一为 page-fact-first。
- **衔接关系**：为 Phase 1 的 first-hop 恢复提供唯一评判口径。

#### Phase 1：恢复 first-hop 真实发送
- **目标**：证明系统至少能让一次 payload 被目标页面真实接受。
- **关键问题**：发送四拍链路是否真实成立：payload 注入、composer 接受、send trigger 被吃掉、页面进入真实生成/接收轨迹。
- **不该急着做什么**：不做多轮 relay，不做 URL 升级，不做复杂恢复。
- **完成标准**：存在独立于 runtime 的页面证据，能证明 first-hop 真实发生。
- **衔接关系**：Phase 2 以此为基线建立可重复验收。

#### Phase 2：把 first-hop 变成稳定可重复的真实性验收
- **目标**：把 once-working 变成 repeatedly-provable。
- **关键问题**：如何防止 waiting/verified 在没有独立接受证据时提前出现。
- **不该急着做什么**：不把 semi/e2e 包装成真实性测试，不追求大而全覆盖。
- **完成标准**：真实性验收可稳定复现，且失败时能明确落到因果链中的具体失败层级。
- **衔接关系**：只有 first-hop 稳定后，多轮 relay 才值得恢复。

#### Phase 3：恢复多轮 relay
- **目标**：在 first-hop 已可信的基础上恢复 A↔B 多轮传递。
- **关键问题**：轮次推进是否继续由页面事实驱动，而非由历史状态或推测驱动。
- **不该急着做什么**：不提前引入长期持久化与复杂并发场景。
- **完成标准**：多轮 relay 不再建立在第一跳未证实的沙地上。
- **衔接关系**：为 URL 升级与恢复策略提供稳定运行体。

#### Phase 4：URL 升级、恢复、长期持久化
- **目标**：在已有 live session 主链路可用的前提下，增加 persistent identity、重连、恢复与长期跟踪能力。
- **关键问题**：如何把 URL 作为增强能力，而不反向污染主业务判断。
- **不该急着做什么**：不让 URL availability 回退成业务入口前提。
- **完成标准**：没有 URL 时主链路仍可运行；有 URL 时只是得到增强能力。
- **衔接关系**：为 Phase 5 的成熟化回归体系提供更稳定身份面。

#### Phase 5：测试体系、诊断体系、回归保障成熟化
- **目标**：把测试与诊断体系重建为“以真实性为核心、以控制流为辅”的结构。
- **关键问题**：如何重新排序现有 smoke / semi / e2e / real-hop 的地位。
- **不该急着做什么**：不以“脚本更多、更炫、更复杂”为成熟标志。
- **完成标准**：真实性 gate、控制流辅助验证、诊断导出、回归矩阵分层清晰且互不冒名顶替。
- **衔接关系**：形成长期维护所需的可信回归体系。

### D. 当前这一轮最值得推进的工作重心
1. **下一轮应该聚焦什么**：聚焦“真实发送四拍链路”本身，而不是聚焦 URL 是否出现、bootstrap 是否更顺、runtime 事件是否更像成功。
2. **不该聚焦什么**：不该继续围绕 URL / bootstrap / 自证测试打转，因为这些都可能在 first-hop 未真实发生时继续制造进展幻觉。
3. **为什么先把真实发送四拍链路变成观察对象**：因为只有先把 `payload 进入 composer → composer 接受 → send trigger 被页面吃掉 → 页面出现真实 user/assistant/generation 轨迹` 拆成可观察链，后续才能知道错误究竟发生在哪一拍，而不是笼统地卡在“waiting”。
4. **必须先回答的问题**：
   - 当前 waiting_reply 是否可能在真实接受前出现？
   - 当前 verification_passed 是否只是相关性判断，而非因果证明？
   - 当前 observer 是否独立于 executor 与 coordinator？
   - 当前 live session 在无 URL 时是否已足够表达业务主身份？
5. **可以后放的问题**：自动 URL 升级策略、长期持久化、复杂多轮矩阵、认证导出便利性、UI 漂亮程度。

### Immediate Phase-1 Slice（用户确认后收紧）
- **唯一立即目标**：回答“为什么会在页面没有真实发送行为时仍推进到 waiting/verified”。
- **唯一立即范围**：只做任务 4（四拍链路观察合同）与任务 5（页面证据门控状态推进）。
- **明确不做**：
  - 不扩测试矩阵；
  - 不碰 URL / 登录 / bootstrap / UI；
  - 不追求 semi/e2e/real-hop 全绿；
  - 不提前恢复 multi-round relay。
- **当前最强结论目标**：不是“脚本更好看”，而是“第一跳到底有没有真实发生；如果没有，究竟死在哪一拍”。
- **协议边界（下一轮必须落地）**：
  - content-script：只负责做动作 + 暴露页面可观察事实；
  - background：只负责消费事实后推进状态；
  - popup/overlay：只负责展示，绝不能再当真相源。
- **停止条件**：只要页面事实再次与 runtime 叙述冲突，立即停止继续编码，回到页面事实重新判断。

### E. 真正的验收哲学（证据层级）
1. **L1 最高证据：页面独立事实**
   - 目标页出现新的 user message；
   - 新消息与本次 payload 存在可判定关联；
   - generation 真实开始/停止；
   - 最新 assistant 轨迹发生真实变化。
2. **L2 高价值辅助：页面观察导出**
   - 页面快照、DOM 状态、前后基线 diff、时间序列观察日志；
   - 这些仍以页面为源，只是包装成可复查证据。
3. **L3 中间证据：扩展 runtime 观察**
   - background 事件链、content-script ack、popup phase、overlay step；
   - 可以解释过程，但不能单独判定成功。
4. **L4 辅助证据：脚本日志、诊断导出、截图**
   - 有助于排查，但不能替代页面事实本身。
5. **L5 最低证据：提交说明、自我总结、口头报告**
   - 完全不能作为通过条件，只能作为背景说明。
6. **原则**：任何低层证据都不能推翻高层证据；任何高层证据缺失时，不得用低层证据补位宣布成功。

### F. 对未来本地执行的建议边界
1. **适合本地高级模型规划的任务**：术语重写、状态语义重构、证据层级设计、架构边界梳理、测试体系重新分层。
2. **适合小步本地代理执行的任务**：单文件因果门控调整、小范围 selector/observer 修补、单条验收路径收紧、现有脚本地位重标注。
3. **适合长链自治代理的任务**：跨模块边界重构、first-hop 到 multi-hop 的阶段恢复、测试体系迁移、长链回归与证据整理。
4. **必须停止继续编码、回到页面事实重新判断的情况**：
   - 页面上仍看不到真实 user message / assistant 变化；
   - 系统再次在没有独立接受证据的情况下进入 waiting/verified；
   - 真实性 gate 与 runtime 自报发生冲突；
   - 新增改动只让日志更多，却没有提高页面可见真实性。

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + existing Node/Playwright stack, but with **real-hop-style page evidence** as canonical truth.
- QA policy: Every execution task below must include one happy-path and one failure/edge scenario using concrete commands or Playwright evidence collection.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.

Wave 1: 定义真相源、身份模型、职责边界、first-hop 观察合同、状态推进门控

Wave 2: 真实性 gate 稳定化、first-hop 恢复、multi-round 恢复前置条件、URL/persistence/测试体系成熟化收尾

### Immediate Dispatch Constraint
- 在正式进入 Wave 1 全量执行前，先单独完成 **任务 4 + 任务 5 的具体化与执行**。
- 只有当任务 4/5 已解释清楚“为什么会假推进到 waiting/verified”并建立页面证据硬门控后，才允许继续任务 7。
- 任务 6、8、9 一律后置；它们不得与当前 immediate slice 并行抢占注意力。

### Dependency Matrix (full, all tasks)
- 任务 1 无前置；阻塞 2/4/5/6/7/8
- 任务 2 依赖 1；阻塞 3/8
- 任务 3 依赖 2；阻塞 4/5/7
- 任务 4 依赖 1/3；阻塞 5/6/7
- 任务 5 依赖 1/3/4；阻塞 6/7
- 任务 6 依赖 4/5；阻塞 7/9
- 任务 7 依赖 4/5/6；阻塞 8/9
- 任务 8 依赖 2/7；阻塞 9
- 任务 9 依赖 6/7/8；为成熟化收尾

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → deep / ultrabrain / unspecified-high
- Wave 2 → 4 tasks → deep / unspecified-high / writing

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. 重定义系统真相源与成功语义

  **What to do**: 统一 README、架构说明、状态语义与验收口径，明确“页面事实 > runtime 自报 > 脚本日志 > 口头报告”的证据层级；同步重写 success / verified / waiting / accepted 等术语的定义，使其不再暗含未被页面证实的成功。
  **Must NOT do**: 不得把术语重写停留在文档层而不约束后续实现；不得继续保留含混语义让 waiting/verified 可在无页面证据时出现。

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: 需要高密度、无歧义地重写项目成功定义与验收术语
  - Skills: [`review`] - 用于检查新术语是否与现有仓库表述冲突
  - Omitted: [`test`] - 此任务重点是定义契约，不是先扩测试矩阵

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [2, 4, 5, 6, 7, 8, 9] | Blocked By: []

  **References**:
  - Pattern: `README.md` - 当前已混合“控制流验证”和“真实性验收”，是术语重定义入口
  - Pattern: `src/extension/core/state-machine.ts` - 当前 phase 语义必须重新校准到页面事实
  - Pattern: `src/extension/background.ts` - 当前 waiting/verification 语义由此发布
  - Test: `scripts/real-hop-playwright.mjs` - 当前唯一接近真实性 gate 的参考

  **Acceptance Criteria**:
  - [ ] 仓库主说明与执行计划中明确存在证据层级，且 L1 页面独立事实被定义为唯一主通过标准
  - [ ] `waiting`、`verified`、`accepted` 之类语义被重新定义为必须依赖页面证据或被显式降级为内部状态
  - [ ] 后续任务引用的术语与本任务产出的真相源定义保持一致

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Truth hierarchy documented and referenced consistently
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['页面事实 > runtime', 'L1 最高证据', 'waiting', 'verified']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明计划文本中已包含新的证据层级与关键术语
    Evidence: .sisyphus/evidence/task-1-truth-hierarchy.txt

  Scenario: Low-tier evidence can no longer declare success alone
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
print('不能单独判定成功' in text or '不得用低层证据补位宣布成功' in text)
PY
    Expected: 输出 True，证明计划显式禁止 runtime/self-report 单独宣布成功
    Evidence: .sisyphus/evidence/task-1-truth-hierarchy-error.txt
  ```

  **Commit**: NO | Message: `docs(strategy): redefine truth hierarchy for page-fact-first relay` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [ ] 2. 重置身份模型为 live-session 主体、URL 增强

  **What to do**: 把身份模型从“URL 驱动绑定”改写为“live session 驱动业务、URL 只做升级后的 persistent identity”；明确 tab、page instance、logical session、persistent URL 各自职责与升级关系。
  **Must NOT do**: 不得让 URL availability 回流为 first-hop 前提；不得把 tabId、page instance、logical session 混成同一标识。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 涉及长期身份边界与恢复模型，需要跨模块一致性
  - Skills: [`review`] - 用于核对新身份模型与现有绑定/README 叙述的冲突点
  - Omitted: [`playwright`] - 当前不是浏览器交互实现，而是身份契约重构

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 8] | Blocked By: [1]

  **References**:
  - Pattern: `src/extension/shared/chatgpt-url.ts` - 当前 URL 规范化与识别入口
  - Pattern: `src/extension/background.ts` - 当前 tab binding/session identity 逻辑入口
  - Pattern: `README.md` - 已写明 live session 与 persistent URL 两层模型，但需彻底转为架构主轴

  **Acceptance Criteria**:
  - [ ] 计划与后续实现文档明确区分 logical session、tab/page instance、persistent URL 三类身份
  - [ ] live session 被定义为主链路可运行的充分身份，URL 仅为可选升级
  - [ ] 无 URL 场景被定义为正常工作模式，而非失败或降级失败

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Identity model distinguishes session from URL
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['live session', 'persistent URL', 'logical session', 'page instance']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明身份模型分层已写清楚
    Evidence: .sisyphus/evidence/task-2-identity.txt

  Scenario: URL is not a prerequisite anymore
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
print('不得继续把 URL 当主业务前提' in text and '没有 URL 时主链路仍可运行' in text)
PY
    Expected: 输出 True，证明计划禁止 URL-first 回流
    Evidence: .sisyphus/evidence/task-2-identity-error.txt
  ```

  **Commit**: NO | Message: `design(identity): make live session primary and URL optional` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [ ] 3. 固化执行器 / 协调器 / 观察器 边界

  **What to do**: 把 content-script、background、popup/overlay 的职责重新压实到执行器 / 协调器 / 观察器三层，明确谁能发动作、谁能推进状态、谁有权宣布页面事实成立。
  **Must NOT do**: 不得继续让同一层同时承担“发送动作 + 成功判断 + 用户展示真相”三种职责；不得让 popup/overlay 成为业务真相源。

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: 这是跨边界的核心架构裁决，错误拆层会导致后续所有修复继续漂移
  - Skills: [`review`] - 用于检查边界定义是否与当前模块划分冲突
  - Omitted: [`lint`] - 任务重点是边界决策，不是代码风格

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [4, 5, 7] | Blocked By: [2]

  **References**:
  - Pattern: `src/extension/background.ts` - 当前协调与验证逻辑聚集点
  - Pattern: `src/extension/content-script.ts` - 当前执行与观察混合点
  - Pattern: `src/extension/popup.ts` - 当前用户控制与状态显示入口

  **Acceptance Criteria**:
  - [ ] 每个核心模块都被映射到执行器 / 协调器 / 观察器之一，且职责边界没有重叠的真相判定权
  - [ ] popup/overlay 被明确降级为 intent/status surface，而不是成功判定来源
  - [ ] 后续状态推进规则以协调器消费观察器证据为准，而非执行器自证

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Role split is explicit and non-overlapping
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['执行器', '协调器', '观察器', 'popup/overlay']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明三层边界已写入计划
    Evidence: .sisyphus/evidence/task-3-role-split.txt

  Scenario: Popup cannot be used as truth source
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
print('popup/overlay 成为业务真相源' in text or 'popup/overlay 被明确降级' in text)
PY
    Expected: 输出 True，证明展示层已被从真相源移除
    Evidence: .sisyphus/evidence/task-3-role-split-error.txt
  ```

  **Commit**: NO | Message: `design(boundaries): separate executor coordinator observer roles` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [x] 4. 建立“真实发送四拍链路”的观察合同

  **What to do**: 把 first-hop 拆成明确可观察的四拍链路：payload 注入、composer 接受、send trigger 被页面吃掉、页面出现真实 user/generation/assistant 轨迹；为每一拍定义观察信号、失败层级与证据产物。
  **Must NOT do**: 不得再用“整体感觉像成功”替代链路拆解；不得让 hash 变化、按钮状态、runtime event 在缺乏页面因果链时冒充成功证据。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要把当前混合的发送/验证逻辑重构为可诊断的因果链
  - Skills: [`review`] - 用于对照 `real-hop` 与现有 background/content-script 语义
  - Omitted: [`frontend-design`] - 此任务只关心行为因果，不关心 UI 表现

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [5, 6, 7] | Blocked By: [1, 3]

  **References**:
  - Pattern: `scripts/real-hop-playwright.mjs` - 当前页面独立证据采集的最佳起点
  - Pattern: `src/extension/background.ts` - 当前 send/verify/waiting 流程需要按四拍重新审视
  - Pattern: `src/extension/content-script.ts` - 当前页面动作与页面观察的关键接口层
  - Test: `tests/ack-signal.test.mjs` - 当前 ack 假阳性风险的回归提示

  **Acceptance Criteria**:
  - [ ] 计划中明确存在四拍链路及对应失败层级，且每一拍都能被单独观察与取证
  - [ ] `waiting_reply` 之前所需的最小独立接受证据被写清楚
  - [ ] 当前 ack / hash / runtime event 的证据地位被降级到正确层级

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Four-beat chain is explicitly modeled
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['payload 注入', 'composer 接受', 'send trigger', 'generation']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明 first-hop 已被拆成可观察链路
    Evidence: .sisyphus/evidence/task-4-four-beat.txt

  Scenario: Waiting cannot appear before acceptance evidence
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
print('waiting_reply 是否可能在真实接受前出现' in text and '不得在没有独立接受证据时提前出现' in text)
PY
    Expected: 输出 True，证明计划已锁定关键门控问题
    Evidence: .sisyphus/evidence/task-4-four-beat-error.txt
  ```

  **Commit**: NO | Message: `design(observability): define first-hop four-beat evidence chain` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [x] 5. 用页面证据门控状态推进并消除假进展

  **What to do**: 重写 relay 成功推进的判定规则：协调器只能基于观察器提交的页面证据推进到 accepted / waiting / verified 语义；把当前可能由相关信号触发的假进展路径识别并切断。
  **Must NOT do**: 不得保留“先 waiting、后补证据”的路径；不得让 send dispatch accepted、popup running、runtime verification_passed 单独构成推进依据。

  **Recommended Agent Profile**:
  - Category: `ultrabrain` - Reason: 需要在不破坏整体控制流的前提下，重写状态推进的因果约束
  - Skills: [`review`] - 用于核对 state machine 与 background loop 的新旧冲突
  - Omitted: [`test`] - 此任务的重点是门控设计，不是先扩用例数量

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [6, 7] | Blocked By: [1, 3, 4]

  **References**:
  - Pattern: `src/extension/core/state-machine.ts` - phase 转移必须被重写为 evidence-gated
  - Pattern: `src/extension/background.ts` - 当前 verification/waiting progression 的主要位置
  - Pattern: `README.md` - 需同步修正对 running / waiting / failure layering 的公开定义

  **Acceptance Criteria**:
  - [ ] 计划明确禁止任何无页面独立证据的 accepted / waiting / verified 迁移
  - [ ] 假进展的典型来源（dispatch accepted、ack 假阳性、runtime 自报）被列为辅助信号或失败分层
  - [ ] 状态推进与失败分层之间存在一一对应的因果门槛

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Success states are evidence-gated
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['accepted', 'waiting', 'verified', '页面证据']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明成功状态已被页面证据门控
    Evidence: .sisyphus/evidence/task-5-state-gating.txt

  Scenario: Fake progress sources are explicitly demoted
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['dispatch', 'runtime', 'ack', '不能单独判定成功']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明假进展来源已被显式降级
    Evidence: .sisyphus/evidence/task-5-state-gating-error.txt
  ```

  **Commit**: NO | Message: `design(state): gate relay progression on independent page evidence` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [x] 6. 重新排序测试体系，把真实性 gate 放回中心

  **What to do**: 重建 smoke / semi / e2e / real-hop 的层级说明与责任边界：只有真实性 gate 可以宣布主链路 first-hop 成功；其他脚本全部降级为辅助、诊断、控制流或场景回归。
  **Must NOT do**: 不得继续让 semi/e2e 用 phase/button/runtime 通过来暗示 first-hop 已恢复；不得为了“好看”保留误导性命名或通过口径。

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: 核心是重塑测试体系的官方语义与地位排序
  - Skills: [`review`] - 用于检查现有 README 与脚本命名是否仍误导
  - Omitted: [`lint`] - 这里不是格式问题，而是验收哲学重排

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [7, 9] | Blocked By: [4, 5]

  **References**:
  - Pattern: `README.md` - 当前已声明 real-hop 为唯一真实性验收，但体系仍需整体重排
  - Pattern: `scripts/real-hop-playwright.mjs` - 真实性 gate 核心参考
  - Pattern: `scripts/semi-bridge-playwright.mjs` - 当前控制流验证入口
  - Pattern: `scripts/e2e-bridge-playwright.mjs` - 当前辅助场景回归入口

  **Acceptance Criteria**:
  - [ ] 所有测试脚本被重新标注为真实性 gate / 辅助控制流 / 辅助场景 / 诊断导出之一
  - [ ] semi/e2e 的通过条件不再被语言上误解为主链路成功
  - [ ] real-hop 或等价真实性 gate 成为 Phase 1 / Phase 2 的唯一主验收入口

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Test hierarchy explicitly separates authenticity from control flow
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
checks = ['smoke', 'semi', 'e2e', 'real-hop', '唯一主链路真实性验收']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，证明测试体系已按证据等级重新排序
    Evidence: .sisyphus/evidence/task-6-test-hierarchy.txt

  Scenario: Auxiliary tests cannot claim mainline success
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md').read_text()
print('不再被语言上误解为主链路成功' in text or '不能单独判定成功' in text)
PY
    Expected: 输出 True，证明辅助测试已被禁止冒名顶替
    Evidence: .sisyphus/evidence/task-6-test-hierarchy-error.txt
  ```

  **Commit**: NO | Message: `docs(testing): center authenticity gate over control-flow checks` | Files: [`.sisyphus/plans/chatgpt-tab-bridge-strategic-reset.md`]

- [x] 7. 恢复并稳定 first-hop 真实发送主链路

  **What to do**: 在新的身份模型、角色边界、四拍观察合同和状态门控之上，恢复一次可稳定复现的 first-hop 真发送路径；把失败明确定位到某一拍，而不是笼统落在 waiting 或 verification_failed。
  **Must NOT do**: 不得在真实性未建立前恢复 multi-round relay；不得以“脚本终于通过”“overlay 显示 running”为成功依据。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 这是整个战略重置的核心实现目标，牵涉 background/content-script/state/test 的一致收口
  - Skills: [`test`] - 需要围绕真实性 gate 做最小充分验证
  - Omitted: [`frontend-design`] - 不涉及任何 UI 美化

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [8, 9] | Blocked By: [4, 5, 6]

  **References**:
  - Pattern: `src/extension/background.ts` - 当前 first-hop loop 的协调核心
  - Pattern: `src/extension/content-script.ts` - 当前页面动作执行层
  - Pattern: `scripts/real-hop-playwright.mjs` - 当前唯一真实性 gate
  - Test: `tests/ack-signal.test.mjs` - 当前假阳性/错误信号回归线索

  **Acceptance Criteria**:
  - [ ] 至少一条真实 first-hop 路径可以在无 URL 前提下被页面独立事实稳定证明
  - [ ] 失败时能清楚落在四拍链路中的某个层级，而不是模糊等待态
  - [ ] `waiting_reply` 不再先于独立接受证据出现

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Logged-out or no-URL live session still proves first-hop
    Tool: Bash
    Steps: pnpm run test:real-hop -- --skip-bootstrap
    Expected: 生成 evidence bundle，且 acceptance-verdict.json 显示页面独立证据成立，而不是仅有 runtime success
    Evidence: .sisyphus/evidence/task-7-first-hop.txt

  Scenario: Runtime says waiting before page acceptance
    Tool: Bash
    Steps: pnpm run test:real-hop -- --skip-bootstrap
    Expected: 如果 waiting 在独立接受证据前出现，则脚本明确 FAIL，并将失败层级归因到 waiting_before_acceptance 或等价分类
    Evidence: .sisyphus/evidence/task-7-first-hop-error.txt
  ```

  **Commit**: NO | Message: `fix(relay): restore provable first-hop page acceptance` | Files: [`src/extension/background.ts`, `src/extension/content-script.ts`, `src/extension/core/state-machine.ts`, `scripts/real-hop-playwright.mjs`]

- [x] 8. 在 first-hop 已可信后恢复多轮 relay，并保持 URL-later 原则

  **What to do**: 仅在任务 7 达成后恢复 A↔B 多轮 relay；要求每一轮推进继续依赖页面事实，同时保持“URL 只是增强身份”的原则，不让 URL availability 反向成为业务前提。
  **Must NOT do**: 不得把多轮 relay 恢复建立在 first-hop 未稳定的前提上；不得为了恢复多轮而重新引入 URL-first 绑定捷径。

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: 需要把已证明的 first-hop 规则放大到多轮，而不重新引入旧误区
  - Skills: [`test`] - 需要最小多轮验证，确认轮次推进仍由页面事实驱动
  - Omitted: [`create-gsd-extension`] - 与扩展平台扩展无关

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [9] | Blocked By: [2, 7]

  **References**:
  - Pattern: `src/extension/core/relay-core.ts` - 当前 relay 封装与轮次协议入口
  - Pattern: `src/extension/background.ts` - 多轮推进与停止条件的协调核心
  - Pattern: `README.md` - 已定义 CONTINUE/FREEZE 协议与失败分层，需要与新真相源一致

  **Acceptance Criteria**:
  - [ ] 第二轮及后续轮次的推进仍以页面独立事实为前提，而非由上一轮 runtime 成功外推
  - [ ] 无 URL 时多轮 relay 仍被视为正常主链路，不因 lack of persistent URL 被判失败
  - [ ] URL 出现只触发身份增强，不改变已成立的核心业务判据

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Multi-round relay progresses on page facts, not inference
    Tool: Bash
    Steps: pnpm run test:e2e -- --skip-bootstrap
    Expected: 辅助场景脚本只能在 first-hop 真实性 gate 已通过的前提下用于验证多轮；证据包需显示每轮推进都可追溯到页面事实
    Evidence: .sisyphus/evidence/task-8-multi-round.txt

  Scenario: URL never appears during otherwise valid relay
    Tool: Bash
    Steps: pnpm run test:real-hop -- --skip-bootstrap
    Expected: 若页面无 persistent URL 但 first-hop/后续轮次页面事实成立，则不应因 url_not_available 被判主链路失败
    Evidence: .sisyphus/evidence/task-8-multi-round-error.txt
  ```

  **Commit**: NO | Message: `feat(relay): restore multi-round flow on session-first rules` | Files: [`src/extension/background.ts`, `src/extension/core/relay-core.ts`, `README.md`, `scripts/e2e-bridge-playwright.mjs`]

- [x] 9. 收尾 URL 升级、恢复策略与成熟化回归体系

  **What to do**: 在主链路已经可靠后，补上 URL 升级、恢复、最小持久化与成熟化回归体系；同时明确 smoke/semi/e2e/real-hop/诊断导出的长期职责边界与运行顺序。
  **Must NOT do**: 不得为了“看起来完整”构建过度复杂的持久化和看板系统；不得让恢复逻辑覆盖或弱化 page-fact-first 原则。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: 涉及恢复/回归/诊断的综合收尾，需要兼顾系统性与克制
  - Skills: [`review`, `test`] - 需要同时审查回归结构与验证命令层级
  - Omitted: [`frontend-design`] - 成熟化不等于界面美化

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [6, 7, 8]

  **References**:
  - Pattern: `src/extension/shared/chatgpt-url.ts` - URL 升级边界与规范化逻辑
  - Pattern: `README.md` - 需最终固化所有验证层级与恢复原则
  - Pattern: `scripts/real-hop-playwright.mjs` - 真实性回归基线
  - Pattern: `scripts/_playwright-bridge-helpers.mjs` - 诊断/辅助观察的长期承载点

  **Acceptance Criteria**:
  - [ ] URL 升级、恢复、最小持久化被明确定义为增强能力，不影响无 URL 主链路通过标准
  - [ ] 成熟化回归体系明确区分真实性验收、控制流辅助、场景回归与诊断导出
  - [ ] MV3 worker suspension、stale page instance、tab reachability 被纳入长期风险与回归项

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Recovery and URL upgrade remain optional enhancements
    Tool: Bash
    Steps: python - <<'PY'
from pathlib import Path
text = Path('README.md').read_text()
checks = ['Live Session 绑定（主模型）', 'Persistent URL 绑定（增强模式）', 'real-hop']
print(all(c in text for c in checks))
PY
    Expected: 输出 True，且回归文档继续保持 session-first / URL-later 顺序
    Evidence: .sisyphus/evidence/task-9-maturity.txt

  Scenario: Suspension/reachability risks are treated as regressions
    Tool: Bash
    Steps: pnpm run test:smoke && pnpm run test:semi -- --skip-bootstrap
    Expected: 控制流脚本只验证 reachability/状态辅助，不宣称主链路真实性；相关风险被列为长期回归项
    Evidence: .sisyphus/evidence/task-9-maturity-error.txt
  ```

  **Commit**: NO | Message: `chore(reliability): mature URL upgrade and regression boundaries` | Files: [`README.md`, `src/extension/shared/chatgpt-url.ts`, `scripts/real-hop-playwright.mjs`, `scripts/semi-bridge-playwright.mjs`]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Only commit when explicitly requested by the user.
- Commit messages must follow the repo Lore protocol and record why the strategic reset was necessary.
- Prefer one atomic commit per completed roadmap slice; do not mix truth-source reset with unrelated cleanup.

## Success Criteria
- 后续执行不再把 URL 作为 first-hop 或 relay 主链路前提。
- 后续执行不再允许 runtime/self-report 单独宣布 success。
- first-hop 恢复和真实性验收在 roadmap 与实现中保持绝对优先级。
- multi-round relay、URL 升级、持久化、回归矩阵都建立在已证明的 first-hop 之上。
