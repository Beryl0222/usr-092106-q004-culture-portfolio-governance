# 领域模型：文化项目组合治理

本文是规划处项目组合治理服务的统一语义。事件名称与聚合类型以 `src/catalog.js` / `contracts/domain.schema.json` 为机器可读来源，本文负责说明含义、关系与生命周期。

## 1. 要解决的问题

“十五五”规划落实时，科技融合、县域文化消费、文旅协同、海外发行申报等多个专项同时在项目库运行。人工表格无法回答：

1. 同一企业（含其控制的关联企业）是否把相近支出拆到多个专项重复申报；
2. 资金是否在区域、专项、企业维度异常集中；
3. 城乡区域短板的指标是否真正改善，改善能否下钻到核验材料；
4. 同一成果是否被多个项目/专项重复计入指标；
5. 迟报、重复上传的材料是否触发了第二次拨付；
6. 公开汇总是否可以反推出某企业未发布的商业计划。

模型把以下链条连成一条可追溯的证据线：

```
规划目标 → 年度指标（考核期） → 专项 → 申报（主体控制关系/联合申报）
        → 立项 → 预算来源 → 合同支付 → 里程碑 → 成果证据
        → 成果计量（贡献/去重） → 区域受益 → 看板汇总 → 公开发布
```

横向贯穿的是 **治理决定链**：评审回避、立项决定、预算调剂、延期、终止、追回，每一步都是有权限角色作出的、可追溯、不可原地改写的决定。

## 2. 聚合总览

| 聚合 | aggregate_type | 职责 | 典型标识前缀 |
|---|---|---|---|
| 规划目标 | `policy_goal` | “十五五”规划的顶层目标，含口径快照 | `goal-` |
| 专项资金 | `funding_program` | 科技融合 / 县域文化消费 / 文旅协同 / 海外发行等专项 | `prog-` |
| 考核期 | `assessment_period` | 目标考核区间，可锁定 | `period-` |
| 年度指标 | `annual_target` | 目标在某考核期内的指标值与调整记录 | `target-` |
| 申报主体 | `applicant` | 企业/事业单位及其统一社会信用代码 | `app-` |
| 申报 | `funding_application` | 一次申报，含支出条目、受益范围、联合申报关系 | `apl-` |
| 在库项目 | `funded_project` | 立项后的项目、里程碑、延期与终止 | `prj-` |
| 预算安排 | `budget_allocation` | 项目的每条预算来源与调剂记录 | `bud-` |
| 合同 | `contract` | 合同与支付条款 | `ctr-` |
| 支付 | `payment` | 每一笔拨付请求与出账 | `pay-` |
| 里程碑核验 | `funded_project`（事件流） | 里程碑计划与核验证据 | — |
| 证据 | `evidence` | 成果/支出/核验材料，含内容指纹 | `evd-` |
| 成果计量 | `outcome_measure` | 指标贡献记录与“同一成果只计一次”的裁决 | `out-` |
| 治理决定 | `governance_decision` | 回避、立项、调剂、延期、终止、追回等决定 | `dec-` |
| 公开发布 | `public_release` | 对外发布的汇总批次 | `rel-` |

## 3. 核心概念与不变量

### 3.1 规划目标与政策口径（policy_goal）

- 目标由 `PLAN_GOAL_DEFINED` 建立，载荷携带**口径快照** `definition_snapshot`：指标定义、统计边界、适用区域、原文依据（文号）。
- 政策/专项更名只产生 `PLAN_GOAL_RENAMED` / `FUNDING_PROGRAM_RENAMED`，原名、原文号、原批复口径随快照永久保留；所有历史事件仍指向原口径。
- **不变量 G1（口径不可抹除）**：任何事件引用的目标口径以事件发生时的快照为准；更名不得重写历史指标值与历史决定。

### 3.2 考核期与年度指标（assessment_period / annual_target）

- 考核期由 `ASSESSMENT_PERIOD_OPENED` 开启；`ASSESSMENT_PERIOD_LOCKED` 锁定。锁定后该期数据冻结，用于考核与审计。
- 指标由 `ANNUAL_TARGET_SET` 设定；跨年度调整产生 `ANNUAL_TARGET_ADJUSTED`，载荷包含调整依据与生效区间。
- **不变量 G2（调整不回溯）**：指标调整只作用于 `effective_from` 之后且**尚未锁定**的考核期；对已锁定期，系统拒绝接收调整事件。
- 一个目标可挂多个年度指标；多个专项的项目可以共同贡献同一指标（见 3.9）。

### 3.3 专项资金（funding_program）

- 专项有独立预算盘子、申报指南、支持范围与补助方式（事前补助/事后奖补/贴息）。
- 专项归属目标（一个专项可服务多个目标），是看板“资金集中”分析的第一维。

### 3.4 申报主体与控制关系（applicant）

- 主体以统一社会信用代码 `credit_code` 唯一登记。
- 控制关系由 `CONTROL_RELATIONSHIP_RECORDED` 记录（母子公司、同一实际控制人、受同一集团控制等），带生效区间与依据（股权比例/协议）。
- 关系失效用 `CONTROL_RELATIONSHIP_RETRACTED` 表达，历史关系仍可查。
- **重复出资判定的主体范围** = 申报主体 ∪ 申报时点处于生效期内的全部受控/关联主体。
- **不变量 G3（穿透查重）**：拆单检测必须在控制关系闭包内进行，不能只按申报抬头比对。

### 3.5 申报（funding_application）

- `APPLICATION_RECEIVED` 登记申报，载荷携带：
  - `expenditure_items[]`：支出条目（用途说明、金额、支出发生时间、费用类别）；
  - `benefit_regions[]`：受益区域（省/市/县 + 城乡分类 urban/rural + 是否县域短板区）；
  - `declared_funding[]`：企业自报的同一支出在其他专项/层级已获或正在申请的资金；
  - `content_fingerprint`：申报书指纹。
- 联合申报由 `JOINT_APPLICATION_LINKED` 表达主从关系：一个牵头主体 + 若干参与方，附分工与资金分配比例。联合体内各方法人责任与收款账户明确登记。
- 补正材料 `APPLICATION_SUPPLEMENT_RECEIVED` 不改变申报的原始提交时间（迟报判定以首次提交为准）。
- 撤报 `APPLICATION_WITHDRAWN` 后申报不再进入评审，但记录保留。
- **查重信号**：
  - `APPLICANT_DUPLICATE_FLAGGED`：主体层（控制闭包内多专项申报密度异常）；
  - `APPLICATION_DUPLICATE_FLAGGED`：项目层，载荷含匹配到的支出条目对、相似度、命中规则（指纹/费用类别+时间窗+金额/关联主体）。
  - 标记是**信号**不是结论；认定必须由评审委员会以 `REVIEW_DECISION_RECORDED`（`decision_type=DUPLICATE_FUNDING_RULING`）作出。
- **不变量 G4（无重复出资认定不立项）**：存在未裁决的拆单标记时，申报不得流转到 `FUNDING_APPROVED`。

### 3.6 评审回避与决定链（governance_decision）

- `REVIEWER_ASSIGNED` 登记评审人（含所属机构）；`CONFLICT_DECLARED` 登记利益冲突与回避（与申报主体的任职/持股/亲属/近期项目关系）。
- 每条 `REVIEW_DECISION_RECORDED` 必填：`decision_type`、`result`（APPROVED/REJECTED）、`subject_id`（决定对象）、`actor_id`、`actor_role`，可选委员名单、依据文件、意见。
- 决定类型与有权角色（机器可读版见 `src/catalog.js` 的 `DECISION_AUTHORITY`）：

| decision_type | 有权角色 | 后继生效事件 |
|---|---|---|
| RECUSAL | 专项管理机构 | （评审人替换） |
| FUNDING_REVIEW | 评审委员会 | FUNDING_APPROVED / APPLICATION_REJECTED |
| DUPLICATE_FUNDING_RULING | 评审委员会 | （解除/确认重复） |
| BUDGET_TRANSFER | 资金管理部门 | BUDGET_TRANSFER_APPROVED |
| MILESTONE_DELAY | 专项管理机构 | MILESTONE_DELAY_APPROVED |
| PROJECT_TERMINATION | 省级文化主管部门 | PROJECT_TERMINATED |
| FUND_RECOVERY | 省级文化主管部门 | FUNDS_RECOVERED |
| TARGET_ADJUSTMENT | 规划处 | ANNUAL_TARGET_ADJUSTED |

- **不变量 G5（决定链完整）**：批准/生效类事件必须通过 `causation_id` 引用一条结论相符的 `REVIEW_DECISION_RECORDED`（立项生效要求 result=APPROVED，驳回生效要求 result=REJECTED），且决定的 `actor_role` 与权限矩阵匹配；缺决定、越权决定、结论不符的决定都不能产生资金或状态生效。
- 业务更正是**后继事件**：决定被复议改变时，追加新决定并以 `causation_id` 链接原决定，原事件不删除不改写。

### 3.7 立项、预算来源与调剂

- `PROJECT_ESTABLISHED` 由立项决定触发，项目与申报一对一，可挂多个目标贡献。
- `BUDGET_SOURCE_SECURED` 逐条登记预算来源：专项、层级（中央/省/市/县）、资金性质、金额、科目。看板“资金集中”按来源汇总。
- `BUDGET_TRANSFER_REQUESTED` → 资金部门决定 → `BUDGET_TRANSFER_APPROVED`：调剂必须保留原科目余额与去向，调剂金额受余额约束。
- **不变量 G6（预算闭合）**：项目各来源已落实金额之和 = 预算总额；合同额、累计支付额不得超过已落实可用预算（扣除冻结/调剂出/终止份额）。

### 3.8 合同、支付与防二次拨付

- `CONTRACT_SIGNED` 登记合同（编号、金额、收款账户、与项目的关联）。
- 支付链：`PAYMENT_REQUESTED`（附应付里程碑/票据）→ `PAYMENT_RELEASED` 或 `PAYMENT_BLOCKED`。
- 每笔出账携带 **`idempotency_key`**（建议：合同号+期次+收款账户+金额的规范化哈希）。
- **不变量 G7（拨付幂等）**：同一 `idempotency_key` 只允许一次 `PAYMENT_RELEASED`；重复请求（含企业迟报后补传、系统重试、材料重复上传）登记为新的请求事件但绝不第二次出账，重复出账尝试触发 `PAYMENT_BLOCKED`（reason=DUPLICATE_KEY）。
- **不变量 G8（支付前提）**：出账要求对应里程碑 `MILESTONE_VERIFIED`、证据 `EVIDENCE_ACCEPTED`、项目未终止、无未处理完的重复出资认定。
- 追回：`FUNDS_RECOVERED` 携带幂等键与原支付引用，追回金额 ≤ 已拨未追回余额。

### 3.9 里程碑、证据与成果唯一计量

- `MILESTONE_PLANNED` 定义里程碑（计划日期、交付物、关联指标、付款比例）；延期走请求→批准链；`MILESTONE_VERIFIED` 是核验通过事实，引用被接受的证据。
- 证据链：
  - `EVIDENCE_SUBMITTED`：提交即登记 `content_hash`（文件内容指纹）、`canonical_key`（规范化业务键，如“票据代码+号码”或“作品 ISRC+用途”）、来源、提交主体；
  - `EVIDENCE_DUPLICATE_MATCHED`：指纹或业务键命中已存在证据（跨项目、跨专项、跨关联主体均比对）；
  - `EVIDENCE_ACCEPTED` / `EVIDENCE_REJECTED`：核验结论（引用核验人/决定）。
- **不变量 G9（同果只计一次）**：成果计量以“唯一成果”为单位。`OUTCOME_CONTRIBUTION_RECORDED` 记录项目对指标的贡献时必须绑定一个 `canonical_outcome_id`；同一 canonical outcome 在同一指标、同一考核期内只允许一条生效贡献。多个项目共同贡献一个指标时允许（多对多），但必须在成果层面拆分清楚；重复命中由 `OUTCOME_DEDUP_RESOLVED` 裁决（保留主计项目，其余标记为 DUPLICATE，不删除）。
- **不变量 G10（证据必达）**：任何指标贡献与里程碑核验都必须下钻到至少一条 `EVIDENCE_ACCEPTED`；看板每个数字都能沿贡献→项目→里程碑→证据逐层下钻。
- 迟报处理：迟交材料照常登记并标注 `late=true` 与超期天数；是否采信由核验决定；**迟报本身不产生新的应付义务**，付款幂等与证据去重规则优先。

### 3.10 区域受益与看板

- 每条支出/成果可声明多个受益区域，附分配比例（合计 100%）。区域维：省/市/县 + 城乡分类 + 短板标记。
- 省级看板三类视图，全部支持下钻：
  1. **资金集中**：按专项/区域/主体（含控制闭包）/供应商集中度 → 项目 → 预算来源 → 合同支付 → 凭证；
  2. **城乡缺口**：指标的城乡/县域分组值、缺口与趋势 → 年度指标 → 贡献项目 → 成果证据；
  3. **里程碑风险**：逾期/临期/延期已批/未核验 → 项目 → 里程碑 → 证据与决定链。

### 3.11 公开发布（public_release）

- `PUBLIC_SUMMARY_RELEASED` 登记发布批次：口径、时间、包含的汇总格与抑制规则执行记录。
- **不变量 G11（公开不可反推）**：
  - 公开层只含汇总指标，不含企业、项目、合同、证据级数据；
  - 最小群体阈值（见 `PUBLIC_CELL_MIN_BENEFICIARIES`，默认 3）：任一汇总格覆盖主体数低于阈值时并入“其他”或抑制；
  - 抑制一致性：同一维度在不同批次、不同维度组合下不得通过差值反推出被抑制格（k-匿名 + 抑制格不复出）；
  - 发布前执行增量攻击检查：与历史批次的差分不得落在单一主体上；
  - 企业未发布的商业计划（在审申报、未签约预算、未公开成果）永不进入公开层；企业侧门户只返回本主体（含经授权的联合体成员）的申报与反馈。

## 4. 典型生命周期

```
goal defined → program published → period opened → target set
applicant registered ── control relationship recorded
application received ─┬─ joint linked
                      ├─ duplicate flagged → ruling 决定（认定/排除）
                      ├─ reviewer assigned → conflict declared（回避换人）
                      ├─ supplement received（不重置提交时间）
                      └─ review decision(APPROVED) → funding approved
→ project established → budget source secured（可多源）
→ contract signed → milestone planned
→ evidence submitted →（duplicate matched?）→ accepted
→ milestone verified → payment requested → payment released（幂等）
→ outcome contribution recorded（重复则 dedup resolved）
异常路径：
  transfer requested → decision → transfer approved
  delay requested → decision → delay approved
  termination decision → project terminated →（recovery decision → funds recovered）
period locked →（此后 target adjustment 对该期不可生效）
public summary released（阈值抑制 + 差分检查）
```

## 5. 状态与时间的基本原则

1. **Append-only**：事件只追加；标识、发生时间、版本不原地改写；更正走后继事件 + `causation_id`。
2. **版本**：同一聚合内 `version` 从 1 严格递增；同一业务流程的事件共享 `correlation_id`。
3. **事实与决定分离**：申报、提交、请求是事实；批准、驳回、采信是决定；事实不能替代表决。
4. **最小知悉**：事件载荷按调用方职责投影字段；企业侧只能读自身申报、自身证据状态与对自身的反馈，看不到其他主体、查重命中明细和评审人个人信息。
5. **金额单位**：全库金额统一为人民币元（整数分或两位小数，载荷中显式 `currency=CNY`）。
