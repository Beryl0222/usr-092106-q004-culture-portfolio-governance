/**
 * 文化项目组合治理 —— 领域事件目录与权限矩阵。
 *
 * 兼容性约定（沿用仓库既有基础信封）：
 * - 事件信封必填：event_id / event_type / aggregate_type / aggregate_id /
 *   occurred_at / version / summary；
 * - version 为同一聚合流上从 1 开始、严格递增的正整数，事件一经接收不得原地改写，
 *   更正只能追加后继事件（更高 version）；
 * - 本目录只做“新增”：保留全部既有聚合类型与事件类型名称。
 */

export const AGGREGATE_TYPES = [
  // —— 既有（不得改名、不得删除）——
  "policy_goal",
  "funding_application",
  "funded_project",
  "outcome_measure",
  // —— 十五五项目组合治理新增 ——
  "funding_stream", // 专项资金（科技融合 / 县域文化消费 / 文旅协同 / 海外发行）
  "assessment_period", // 考核期（年度指标期，可锁定）
  "applicant_subject", // 申报主体及其控制关系
  "decision_record", // 有权限的行政决定链
  "contract_payment", // 合同与支付
  "evidence_pack", // 成果证据材料包
];

export const EVENT_TYPES = [
  // —— 既有（名称与语义保留）——
  "APPLICATION_RECEIVED",
  "CONFLICT_DECLARED",
  "FUNDING_APPROVED",
  "MILESTONE_VERIFIED",
  "FUNDS_RECOVERED",
  // —— 规划目标 / 指标 / 考核期 ——
  "POLICY_GOAL_DEFINED",
  "POLICY_RENAMED", // 政策更名：只追加，原批复口径保存在快照里
  "TARGET_SET",
  "TARGET_ADJUSTED", // 跨年度调整：仅对尚未锁定的考核期生效
  "METRIC_DEFINED",
  "ASSESSMENT_PERIOD_OPENED",
  "ASSESSMENT_PERIOD_LOCKED",
  // —— 专项资金 ——
  "FUNDING_STREAM_OPENED",
  "FUNDING_STREAM_RENAMED",
  // —— 申报主体 / 控制关系穿透 ——
  "SUBJECT_REGISTERED",
  "CONTROL_RELATION_DECLARED",
  // —— 申报与评审 ——
  "REVIEW_TASK_ASSIGNED",
  "APPLICATION_AMENDED",
  "APPLICATION_DUPLICATE_REJECTED", // 同幂等键重复申报被拒
  "APPLICATION_WITHDRAWN",
  // —— 项目执行 ——
  "BUDGET_TRANSFER_REQUESTED",
  "MILESTONE_DELAY_REQUESTED",
  "PROJECT_TERMINATION_REQUESTED",
  // —— 有权限的决定链 ——
  "RECUSAL_DECIDED", // 评审回避决定
  "BUDGET_TRANSFER_DECIDED", // 预算调剂决定
  "MILESTONE_DELAY_DECIDED", // 延期决定
  "PROJECT_TERMINATION_DECIDED", // 终止决定
  "FUNDS_RECOVERY_DECIDED", // 追回决定（FUNDS_RECOVERED 是执行）
  // —— 合同支付 ——
  "CONTRACT_RECORDED",
  "PAYMENT_REQUESTED",
  "PAYMENT_EXECUTED",
  "PAYMENT_BLOCKED", // 迟报 / 重复证据 / 已追回等情形下阻断拨付
  // —— 成果证据 ——
  "EVIDENCE_SUBMITTED",
  "EVIDENCE_DEDUPLICATED", // 重复上传识别：同一材料指纹只认首包
  // —— 指标成果去重 ——
  "OUTCOME_DEDUPLICATED", // 同一成果只计算一次（可共同贡献同一指标）
];

/** 事件类型 → 允许挂载的聚合类型。 */
export const EVENT_AGGREGATE = {
  APPLICATION_RECEIVED: "funding_application",
  CONFLICT_DECLARED: "funding_application",
  FUNDING_APPROVED: "funded_project",
  MILESTONE_VERIFIED: "funded_project",
  FUNDS_RECOVERED: "funded_project",
  POLICY_GOAL_DEFINED: "policy_goal",
  POLICY_RENAMED: "policy_goal",
  TARGET_SET: "policy_goal",
  TARGET_ADJUSTED: "policy_goal",
  METRIC_DEFINED: "outcome_measure",
  OUTCOME_DEDUPLICATED: "outcome_measure",
  ASSESSMENT_PERIOD_OPENED: "assessment_period",
  ASSESSMENT_PERIOD_LOCKED: "assessment_period",
  FUNDING_STREAM_OPENED: "funding_stream",
  FUNDING_STREAM_RENAMED: "funding_stream",
  SUBJECT_REGISTERED: "applicant_subject",
  CONTROL_RELATION_DECLARED: "applicant_subject",
  REVIEW_TASK_ASSIGNED: "funding_application",
  APPLICATION_AMENDED: "funding_application",
  APPLICATION_DUPLICATE_REJECTED: "funding_application",
  APPLICATION_WITHDRAWN: "funding_application",
  BUDGET_TRANSFER_REQUESTED: "funded_project",
  MILESTONE_DELAY_REQUESTED: "funded_project",
  PROJECT_TERMINATION_REQUESTED: "funded_project",
  RECUSAL_DECIDED: "decision_record",
  BUDGET_TRANSFER_DECIDED: "decision_record",
  MILESTONE_DELAY_DECIDED: "decision_record",
  PROJECT_TERMINATION_DECIDED: "decision_record",
  FUNDS_RECOVERY_DECIDED: "decision_record",
  CONTRACT_RECORDED: "contract_payment",
  PAYMENT_REQUESTED: "contract_payment",
  PAYMENT_EXECUTED: "contract_payment",
  PAYMENT_BLOCKED: "contract_payment",
  EVIDENCE_SUBMITTED: "evidence_pack",
  EVIDENCE_DEDUPLICATED: "evidence_pack",
};

export const ROLES = [
  "PROVINCIAL_PLAN_OFFICER", // 规划处
  "PROVINCIAL_FINANCE_OFFICER", // 财务处
  "REVIEWER", // 评审专家
  "COUNTY_OFFICER", // 县级主管部门
  "APPLICANT", // 申报企业
  "PUBLIC", // 社会公众（仅公开汇总）
];

/**
 * 决定类事件 → 有权作出该决定的角色。
 * 企业（APPLICANT）只能“申请”，不能“决定”；评审专家只能出评审意见，
 * 回避 / 调剂 / 延期 / 终止 / 追回均由行政侧决定并留痕。
 */
export const DECISION_AUTHORITY = {
  RECUSAL_DECIDED: ["PROVINCIAL_PLAN_OFFICER"],
  BUDGET_TRANSFER_DECIDED: ["PROVINCIAL_PLAN_OFFICER", "PROVINCIAL_FINANCE_OFFICER"],
  MILESTONE_DELAY_DECIDED: ["PROVINCIAL_PLAN_OFFICER"],
  PROJECT_TERMINATION_DECIDED: ["PROVINCIAL_PLAN_OFFICER"],
  FUNDS_RECOVERY_DECIDED: ["PROVINCIAL_FINANCE_OFFICER"],
  TARGET_ADJUSTED: ["PROVINCIAL_PLAN_OFFICER"],
  POLICY_RENAMED: ["PROVINCIAL_PLAN_OFFICER"],
  FUNDING_STREAM_RENAMED: ["PROVINCIAL_PLAN_OFFICER"],
  FUNDING_APPROVED: ["PROVINCIAL_PLAN_OFFICER"],
};

/** 预算调剂超过批准总额该比例时，须财务处共同决定。 */
export const BUDGET_TRANSFER_FINANCE_THRESHOLD = 0.2;

/**
 * 决定类事件必须能回溯到的上游事件类型（有权限的决定链）。
 * 没有上游申请/立项记录的决定一律不成立。
 */
export const DECISION_CAUSATION = {
  FUNDING_APPROVED: ["APPLICATION_RECEIVED"],
  TARGET_ADJUSTED: ["TARGET_SET"],
  RECUSAL_DECIDED: ["REVIEW_TASK_ASSIGNED"],
  BUDGET_TRANSFER_DECIDED: ["BUDGET_TRANSFER_REQUESTED"],
  MILESTONE_DELAY_DECIDED: ["MILESTONE_DELAY_REQUESTED"],
  PROJECT_TERMINATION_DECIDED: ["PROJECT_TERMINATION_REQUESTED"],
  FUNDS_RECOVERY_DECIDED: ["PROJECT_TERMINATION_DECIDED", "FUNDS_RECOVERY_DECIDED"],
};

/** 看板资金集中度预警阈值：单一控制集团份额。 */
export const CONCENTRATION_ALERT = 0.3;

/** 公开汇总隐私参数（默认值，可在发布时收紧）。 */
export const PUBLICATION_RULES = {
  minSubjects: 3, // k-匿名：单元格内至少 3 个相互独立的控制集团
  maxDominance: 0.65, // 主导份额上限
  amountStepWan: 100, // 金额按 100 万元舍入
  countStep: 5, // 成果数量按 5 的倍数舍入
};

/** 示例区域字典：code → 名称、城乡属性（看板城乡缺口口径）。 */
export const REGIONS = {
  "510100": { name: "江州市城区", urban: true },
  "510121": { name: "宁县", urban: false },
  "510122": { name: "岚山县", urban: false },
  "510200": { name: "云港市城区", urban: true },
  "510221": { name: "远安县", urban: false },
};

/** 指标字典：result_key 为“同一成果”的规范化去重键来源。 */
export const METRICS = {
  "M-TECH-01": { name: "文化科技融合成果转化数", unit: "项", resultKey: "copyright_no", urban: true },
  "M-COUNTY-01": { name: "县域文化消费人次", unit: "万人次", resultKey: "activity_session_id", urban: false },
  "M-TOUR-01": { name: "文旅协同带动接待量", unit: "万人次", resultKey: "activity_session_id", urban: null },
  "M-OVERSEAS-01": { name: "海外发行落地数", unit: "项", resultKey: "overseas_release_ref", urban: null },
};

export function isDecision(eventType) {
  return Object.prototype.hasOwnProperty.call(DECISION_AUTHORITY, eventType);
}
