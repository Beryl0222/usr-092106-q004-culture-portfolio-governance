/**
 * 事件目录：事件类型、聚合类型与载荷级校验规则的唯一来源。
 * 契约 schema（contracts/domain.schema.json）的枚举必须与本文件保持一致，
 * 由 tests/contract.test.js 交叉校验。
 *
 * 版本约定（与仓库既有约定一致，只能加强、不能破坏）：
 * - 事件一经接收，event_id / occurred_at / version 不得原地改写；
 * - 同一聚合内 version 从 1 起严格递增；
 * - 业务更正产生后继事件，并通过 causation_id 指向前序决定/事件。
 */

export const AGGREGATE_TYPES = [
  // 既有聚合，保持原名
  "policy_goal",
  "funding_application",
  "funded_project",
  "outcome_measure",
  // 规划与专项
  "funding_program",
  "assessment_period",
  "annual_target",
  // 主体与决定链
  "applicant",
  "governance_decision",
  // 项目执行与资金
  "budget_allocation",
  "contract",
  "evidence",
  "payment",
  // 公开
  "public_release",
];

export const EVENT_TYPES = [
  // 既有事件，保持原名
  "APPLICATION_RECEIVED",
  "CONFLICT_DECLARED",
  "FUNDING_APPROVED",
  "MILESTONE_VERIFIED",
  "FUNDS_RECOVERED",

  // 规划目标 / 专项 / 考核期 / 年度指标
  "PLAN_GOAL_DEFINED",
  "PLAN_GOAL_RENAMED",
  "FUNDING_PROGRAM_PUBLISHED",
  "FUNDING_PROGRAM_RENAMED",
  "ASSESSMENT_PERIOD_OPENED",
  "ASSESSMENT_PERIOD_LOCKED",
  "ANNUAL_TARGET_SET",
  "ANNUAL_TARGET_ADJUSTED",

  // 申报主体与控制关系
  "APPLICANT_REGISTERED",
  "CONTROL_RELATIONSHIP_RECORDED",
  "CONTROL_RELATIONSHIP_RETRACTED",

  // 申报与评审
  "JOINT_APPLICATION_LINKED",
  "APPLICATION_WITHDRAWN",
  "APPLICANT_DUPLICATE_FLAGGED",
  "APPLICATION_DUPLICATE_FLAGGED",
  "APPLICATION_SUPPLEMENT_RECEIVED",
  "APPLICATION_REJECTED",
  "REVIEWER_ASSIGNED",
  "REVIEW_DECISION_RECORDED",

  // 立项、预算、合同、里程碑
  "PROJECT_ESTABLISHED",
  "BUDGET_SOURCE_SECURED",
  "BUDGET_TRANSFER_REQUESTED",
  "BUDGET_TRANSFER_APPROVED",
  "CONTRACT_SIGNED",
  "MILESTONE_PLANNED",
  "MILESTONE_DELAY_REQUESTED",
  "MILESTONE_DELAY_APPROVED",
  "PROJECT_TERMINATED",

  // 证据与支付
  "EVIDENCE_SUBMITTED",
  "EVIDENCE_DUPLICATE_MATCHED",
  "EVIDENCE_ACCEPTED",
  "EVIDENCE_REJECTED",
  "PAYMENT_REQUESTED",
  "PAYMENT_RELEASED",
  "PAYMENT_BLOCKED",

  // 成果计量
  "OUTCOME_CONTRIBUTION_RECORDED",
  "OUTCOME_DEDUP_RESOLVED",

  // 公开发布
  "PUBLIC_SUMMARY_RELEASED",
];

/** 事件允许归属的聚合类型。未列出的事件可按目录文档归属，校验不强制。 */
export const EVENT_AGGREGATE = {
  PLAN_GOAL_DEFINED: "policy_goal",
  PLAN_GOAL_RENAMED: "policy_goal",

  FUNDING_PROGRAM_PUBLISHED: "funding_program",
  FUNDING_PROGRAM_RENAMED: "funding_program",

  ASSESSMENT_PERIOD_OPENED: "assessment_period",
  ASSESSMENT_PERIOD_LOCKED: "assessment_period",
  ANNUAL_TARGET_SET: "annual_target",
  ANNUAL_TARGET_ADJUSTED: "annual_target",

  APPLICANT_REGISTERED: "applicant",
  CONTROL_RELATIONSHIP_RECORDED: "applicant",
  CONTROL_RELATIONSHIP_RETRACTED: "applicant",

  APPLICATION_RECEIVED: "funding_application",
  JOINT_APPLICATION_LINKED: "funding_application",
  APPLICATION_WITHDRAWN: "funding_application",
  APPLICANT_DUPLICATE_FLAGGED: "funding_application",
  APPLICATION_DUPLICATE_FLAGGED: "funding_application",
  APPLICATION_SUPPLEMENT_RECEIVED: "funding_application",
  CONFLICT_DECLARED: "funding_application",
  APPLICATION_REJECTED: "funding_application",
  FUNDING_APPROVED: "funding_application",

  REVIEWER_ASSIGNED: "governance_decision",
  REVIEW_DECISION_RECORDED: "governance_decision",

  PROJECT_ESTABLISHED: "funded_project",
  MILESTONE_PLANNED: "funded_project",
  MILESTONE_DELAY_REQUESTED: "funded_project",
  MILESTONE_DELAY_APPROVED: "funded_project",
  MILESTONE_VERIFIED: "funded_project",
  PROJECT_TERMINATED: "funded_project",
  FUNDS_RECOVERED: "funded_project",

  BUDGET_SOURCE_SECURED: "budget_allocation",
  BUDGET_TRANSFER_REQUESTED: "budget_allocation",
  BUDGET_TRANSFER_APPROVED: "budget_allocation",
  CONTRACT_SIGNED: "contract",

  EVIDENCE_SUBMITTED: "evidence",
  EVIDENCE_DUPLICATE_MATCHED: "evidence",
  EVIDENCE_ACCEPTED: "evidence",
  EVIDENCE_REJECTED: "evidence",

  PAYMENT_REQUESTED: "payment",
  PAYMENT_RELEASED: "payment",
  PAYMENT_BLOCKED: "payment",

  OUTCOME_CONTRIBUTION_RECORDED: "outcome_measure",
  OUTCOME_DEDUP_RESOLVED: "outcome_measure",

  PUBLIC_SUMMARY_RELEASED: "public_release",
};

/** 决定链中的角色。 */
export const ACTOR_ROLES = [
  "PLANNING_DEPARTMENT", // 规划处：目标与指标
  "PROGRAM_OFFICE", // 专项管理机构：受理、回避、延期
  "FINANCE_DEPARTMENT", // 资金管理部门：预算调剂、拨付
  "REVIEW_COMMITTEE", // 评审委员会：立项、重复出资认定
  "PROVINCIAL_CULTURE_DEPT", // 省级文化主管部门：终止、追回
  "AUDIT", // 审计/监督
  "APPLICANT", // 申报主体（企业）
  "REVIEWER", // 评审个人
];

/** 决定类型 → 有权作出该决定的角色（决定链权限矩阵的机器可读部分）。 */
export const DECISION_AUTHORITY = {
  RECUSAL: "PROGRAM_OFFICE",
  FUNDING_REVIEW: "REVIEW_COMMITTEE", // 立项审查结论 APPROVED / REJECTED
  DUPLICATE_FUNDING_RULING: "REVIEW_COMMITTEE",
  BUDGET_TRANSFER: "FINANCE_DEPARTMENT",
  MILESTONE_DELAY: "PROGRAM_OFFICE",
  PROJECT_TERMINATION: "PROVINCIAL_CULTURE_DEPT",
  FUND_RECOVERY: "PROVINCIAL_CULTURE_DEPT",
  TARGET_ADJUSTMENT: "PLANNING_DEPARTMENT",
};

/**
 * 需要已记录决定作为前置的事件：
 * 事件载荷 causation_id 必须指向一条 REVIEW_DECISION_RECORDED，
 * 且其 result 与下表预期一致（申请被驳回同样需要一条“结论为 REJECTED”的正式决定）。
 */
export const DECISION_BOUND_EVENTS = {
  FUNDING_APPROVED: "APPROVED",
  APPLICATION_REJECTED: "REJECTED",
  BUDGET_TRANSFER_APPROVED: "APPROVED",
  MILESTONE_DELAY_APPROVED: "APPROVED",
  PROJECT_TERMINATED: "APPROVED",
  FUNDS_RECOVERED: "APPROVED",
  ANNUAL_TARGET_ADJUSTED: "APPROVED",
};

/** 必须携带幂等键的事件（同一幂等键重复到达只能产生一次效果）。 */
export const IDEMPOTENCY_REQUIRED_EVENTS = new Set([
  "PAYMENT_RELEASED",
  "FUNDS_RECOVERED",
]);

/** REVIEW_DECISION_RECORDED.payload 必填字段。 */
export const DECISION_PAYLOAD_FIELDS = [
  "decision_type",
  "result",
  "subject_id",
  "actor_id",
  "actor_role",
];

/** 公开汇总的最小群体阈值：任一汇总格受益主体数低于该值必须并入“其他”或抑制。 */
export const PUBLIC_CELL_MIN_BENEFICIARIES = 3;
