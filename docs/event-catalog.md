# 事件目录与版本约定

所有事件复用仓库既有信封（`event_id / event_type / aggregate_type / aggregate_id / occurred_at / version / summary`），新增两个可选公共字段：

- `causation_id`：触发本事件的前序事件或决定（更正链、决定链）。
- `correlation_id`：同一业务流程的关联标识（如一次申报流程、一个项目执行流）。
- `payload`：业务载荷。

枚举的机器可读来源是 `src/catalog.js`，JSON Schema 同步于 `contracts/domain.schema.json`。

## 1. 版本与兼容性约定

1. 事件一经接收，`event_id`、`occurred_at`、`version` 永不原地改写；业务更正追加后继事件，并用 `causation_id` 指向被更正事件/决定。
2. 同一聚合内 `version` 从 1 起严格 +1；并发写入以聚合流的版本冲突检测拒绝乱序。
3. 事件类型与聚合类型枚举**只增不删、不改语义**；本次扩展保留全部既有取值（`APPLICATION_RECEIVED` 等 5 个事件与 4 个聚合原名不变）。
4. 载荷字段只增不删为兼容；字段语义收紧需新版本事件类型，不复用旧名称。
5. 无 `payload` 的最简历史信封（如 `data/sample.json`）永远通过基础校验；载荷级规则只作用于携带 `payload` 的治理事件。
6. 决定链事件（批准/生效类）必须满足：存在 `causation_id` → 指向一条 `REVIEW_DECISION_RECORDED`，其 `result` 与生效事件的预期结论一致（如 `FUNDING_APPROVED` 要求 APPROVED、`APPLICATION_REJECTED` 要求 REJECTED），且 `actor_role` 符合权限矩阵。该校验由 `validateGovernanceEvent(record, decisionIndex)` 执行。

## 2. 事件目录

载荷字段标 **必填** 者为该事件成立的最低要求；其余为推荐字段。

### 2.1 规划目标 / 专项

| event_type | 聚合 | 必填载荷 | 发起方 | 说明 / 后继规则 |
|---|---|---|---|---|
| `PLAN_GOAL_DEFINED` | policy_goal | goal_code, goal_name, definition_snapshot（指标定义/统计边界/适用区域/依据文号）, plan_term | 规划处 | 口径快照随事件固化 |
| `PLAN_GOAL_RENAMED` | policy_goal | new_name, former_name, rename_basis | 规划处 | 仅更名；causation_id 指向定义事件；原口径快照不失效（G1） |
| `FUNDING_PROGRAM_PUBLISHED` | funding_program | program_code, program_name, goal_codes[], budget_cap, support_scope, aid_type, guideline_version | 专项管理机构 | 专项与目标多对多 |
| `FUNDING_PROGRAM_RENAMED` | funding_program | new_name, former_name, rename_basis | 专项管理机构 | 原批复文号与口径保留 |

### 2.2 考核期 / 年度指标

| event_type | 聚合 | 必填载荷 | 发起方 | 约束 |
|---|---|---|---|---|
| `ASSESSMENT_PERIOD_OPENED` | assessment_period | period_code, starts_on, ends_on, goal_codes[] | 规划处 | 同目标期间不得重叠 |
| `ASSESSMENT_PERIOD_LOCKED` | assessment_period | locked_by, locked_at | 规划处 | 锁定后该期数据冻结（G2） |
| `ANNUAL_TARGET_SET` | annual_target | goal_code, period_code, metric_code, target_value, unit, baseline_value | 规划处 | 同目标+期+指标唯一 |
| `ANNUAL_TARGET_ADJUSTED` | annual_target | new_value, former_value, adjust_basis, effective_from, decision_event_id | 规划处 | 仅对 effective_from 之后且未锁定的期生效；须引用 TARGET_ADJUSTMENT 决定（G2、G5） |

### 2.3 申报主体与控制关系

| event_type | 聚合 | 必填载荷 | 发起方 | 约束 |
|---|---|---|---|---|
| `APPLICANT_REGISTERED` | applicant | applicant_name, credit_code, applicant_type | 主体/登记机构 | credit_code 全局唯一；重复登记被拒绝 |
| `CONTROL_RELATIONSHIP_RECORDED` | applicant | parent_id, child_id（或 controller_id / controlled_id）, relation_type, valid_from, evidence_ref | 主体申报+机构核验 | 穿透查重闭包依据（G3） |
| `CONTROL_RELATIONSHIP_RETRACTED` | applicant | relationship_event_id, valid_to, reason | 机构 | 不删除原关系；闭包按时间点求值 |

### 2.4 申报与评审事实

| event_type | 聚合 | 必填载荷 | 发起方 | 约束 |
|---|---|---|---|---|
| `APPLICATION_RECEIVED` | funding_application | program_code, applicant_id, submitted_at, expenditure_items[], benefit_regions[], declared_funding[], content_fingerprint | 申报主体 | 首报时间固定；补正不重置 |
| `JOINT_APPLICATION_LINKED` | funding_application | lead_applicant_id, members[]{applicant_id, role, share_pct, account_ref} | 申报主体 | 份额合计 100% |
| `APPLICATION_SUPPLEMENT_RECEIVED` | funding_application | supplement_items[], evidence_ids[], submitted_at | 申报主体 | 标注 late；不改变原 submitted_at |
| `APPLICATION_WITHDRAWN` | funding_application | reason | 申报主体 | 撤报后不再评审，记录保留 |
| `APPLICANT_DUPLICATE_FLAGGED` | funding_application | applicant_id, matched_applications[], rule_hits[], control_path | 系统/机构 | 主体层信号 |
| `APPLICATION_DUPLICATE_FLAGGED` | funding_application | matched_pairs[]{item_a_ref, item_b_ref, similarity, rule}, across_programs[] | 系统/机构 | 支出条目层信号；未裁决不得立项（G4） |
| `CONFLICT_DECLARED` | funding_application | reviewer_id, conflict_type, relation_detail, recusal_result | 评审人/机构 | 回避后该评审人不得再出现在本申报决定中 |
| `REVIEWER_ASSIGNED` | governance_decision | application_id, reviewer_id, reviewer_org | 专项管理机构 | aggregate_id 为决定链 id |
| `REVIEW_DECISION_RECORDED` | governance_decision | **decision_type, result(APPROVED/REJECTED), subject_id, actor_id, actor_role**；basis_docs[], comments? | 见权限矩阵 | 所有生效类动作的前置（G5） |
| `FUNDING_APPROVED` | funding_application | approved_amount, budget_sources[], award_doc_no | （系统据决定生效） | causation_id→FUNDING_REVIEW 决定且 result=APPROVED；无未决拆单标记（G4） |
| `APPLICATION_REJECTED` | funding_application | reason, basis | （系统据决定生效） | causation_id→FUNDING_REVIEW 决定且 result=REJECTED；驳回同样必须是正式决定 |

> 说明：`REVIEW_DECISION_RECORDED.result` 是有权角色对对象作出的结论。立项审查通过为 `decision_type=FUNDING_REVIEW, result=APPROVED`；不予立项为 `decision_type=FUNDING_REVIEW, result=REJECTED`。生效事件与决定结论的匹配由 `validateGovernanceEvent` 强制（见 `DECISION_BOUND_EVENTS`）。

### 2.5 立项、预算、合同、里程碑

| event_type | 聚合 | 必填载荷 | 发起方/前置 | 约束 |
|---|---|---|---|---|
| `PROJECT_ESTABLISHED` | funded_project | application_id, program_code, lead_applicant_id, goal_codes[], total_budget, region_scope[] | causation_id→立项决定 | 与申报一对一 |
| `BUDGET_SOURCE_SECURED` | budget_allocation | project_id, program_code, fund_level, fund_type, amount, currency=CNY, fiscal_year, doc_ref | 资金部门 | G6 闭合 |
| `BUDGET_TRANSFER_REQUESTED` | budget_allocation | project_id, from_line_id, to_line_id, amount, reason | 项目/机构 | 不得超过源科目可用余额 |
| `BUDGET_TRANSFER_APPROVED` | budget_allocation | request_event_id, transfer_lines[] | causation_id→BUDGET_TRANSFER 决定（FINANCE_DEPARTMENT） | 保留原科目痕迹 |
| `CONTRACT_SIGNED` | contract | project_id, contract_no, amount, payee_account, payment_terms[], signed_at | 机构 | 合同额 ≤ 可用预算（G6） |
| `MILESTONE_PLANNED` | funded_project | milestones[]{code, name, due_date, deliverables, pay_pct, metric_links[]} | 项目管理 | 付款比例合计 ≤ 100% |
| `MILESTONE_DELAY_REQUESTED` | funded_project | milestone_code, requested_due_date, reason, evidence_ids[] | 项目 | — |
| `MILESTONE_DELAY_APPROVED` | funded_project | request_event_id, new_due_date | causation_id→MILESTONE_DELAY 决定（PROGRAM_OFFICE） | 原计划日期保留 |
| `MILESTONE_VERIFIED` | funded_project | milestone_code, verified_at, evidence_ids[], verifier_id | 核验通过事实 | 证据必须全部 EVIDENCE_ACCEPTED（G10） |
| `PROJECT_TERMINATED` | funded_project | reason, effective_date, recovered_plan? | causation_id→PROJECT_TERMINATION 决定（省级部门） | 终止后冻结后续支付（G8） |
| `FUNDS_RECOVERED` | funded_project | **idempotency_key**, original_payment_ids[], amount, reason, account_ref | causation_id→FUND_RECOVERY 决定 | 金额 ≤ 已拨未追回余额 |

### 2.6 证据与支付

| event_type | 聚合 | 必填载荷 | 约束 |
|---|---|---|---|
| `EVIDENCE_SUBMITTED` | evidence | project_id, milestone_code?, evidence_type, content_hash, canonical_key, submitted_by, submitted_at, late? | 提交即留痕；企业仅可见自身证据状态 |
| `EVIDENCE_DUPLICATE_MATCHED` | evidence | new_evidence_id, existing_evidence_id, match_type(HASH/CANONICAL_KEY/FUZZY), score, across_scope | 跨项目/专项/关联主体比对；信号 |
| `EVIDENCE_ACCEPTED` | evidence | reviewer_id, accepted_at, canonical_outcome_id? | 采信决定；可绑定唯一成果 id（G9） |
| `EVIDENCE_REJECTED` | evidence | reviewer_id, reason | 不支撑付款与计量（G8/G10） |
| `PAYMENT_REQUESTED` | payment | contract_id, milestone_code, amount, payee_account, request_no, evidence_ids[] | 重复/迟报请求照常登记 |
| `PAYMENT_RELEASED` | payment | **idempotency_key**, request_event_id, amount, payee_account, released_at | G7 全局唯一；前置见 G8 |
| `PAYMENT_BLOCKED` | payment | request_event_id, reason(DUPLICATE_KEY/MISSING_VERIFICATION/TERMINATED/DUPLICATE_FUNDING_OPEN) | 阻断必须留痕并反馈申报主体 |

### 2.7 成果计量与公开发布

| event_type | 聚合 | 必填载荷 | 约束 |
|---|---|---|---|
| `OUTCOME_CONTRIBUTION_RECORDED` | outcome_measure | project_id, goal_code, period_code, metric_code, canonical_outcome_id, value, unit, evidence_ids[], region_allocation[] | 同指标+同期+同成果唯一生效（G9）；证据必达（G10） |
| `OUTCOME_DEDUP_RESOLVED` | outcome_measure | kept_contribution_id, duplicate_contribution_ids[], ruling_decision_id, rule | 重复项标 DUPLICATE 不删除 |
| `PUBLIC_SUMMARY_RELEASED` | public_release | release_batch, period_code, cells[], suppressed_cells[], min_group_size, diff_check_passed, released_at | G11：阈值抑制、跨批差分检查通过方可发布 |

## 3. 幂等与去重键速查

| 键 | 用途 | 唯一性范围 |
|---|---|---|
| `PAYMENT_RELEASED.payload.idempotency_key` | 防二次拨付 | 全局、永久 |
| `FUNDS_RECOVERED.payload.idempotency_key` | 防重复追回 | 全局、永久 |
| `evidence.content_hash` | 文件级重复上传识别 | 全局 |
| `evidence.canonical_key` | 业务凭证去重（票据号等） | 同证据类型全局 |
| `canonical_outcome_id` | 同一成果只计一次 | 同一指标+考核期 |
| `applicant.credit_code` | 主体唯一 | 全局 |
| `(goal_code, period_code, metric_code)` | 指标唯一定位 | 全局 |

## 4. 更正模式

- 指标值更正：追加 `ANNUAL_TARGET_ADJUSTED`（受锁定约束），不改 `ANNUAL_TARGET_SET`。
- 决定变更：追加新的 `REVIEW_DECISION_RECORDED`，`causation_id` 指向原决定；原决定保留。
- 证据改判：先 `EVIDENCE_REJECTED`（对原采信）再采信新证据；已据此产生的贡献发 `OUTCOME_DEDUP_RESOLVED` 或冲正贡献（负值贡献事件，仍走同一计量唯一规则）。
- 支付差错：不得删除/改写 `PAYMENT_RELEASED`；通过 `FUNDS_RECOVERED` 或冲正支付（新事件、新幂等键）纠正。
