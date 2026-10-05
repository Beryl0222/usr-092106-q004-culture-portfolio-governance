/** 文化项目组合治理使用的领域事件信封（基础字段沿用既有约定）。 */
export interface DomainEvent {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  /** 操作人（个人标识仅在履职必需时读取）。 */
  actor_id?: string;
  /** 操作人角色，决定链权限校验依据。 */
  actor_role?: string;
  /** 上游事件/决定编号，形成有权限的决定链。 */
  causation_id?: string;
  /** 入口幂等键：申报、支付等重复提交只生效一次。 */
  idempotency_key?: string;
  /** 业务载荷，字段约定见 docs/领域模型.md。 */
  payload?: Record<string, unknown>;
}

/** 规划目标（policy_goal）。政策更名只新增名称，original_approval 不可抹除。 */
export interface PolicyGoal {
  goal_id: string;
  code: string;
  current_name: string;
  original_name: string;
  original_approval_no: string;
  metrics: string[];
}

/** 考核期：锁定后 TARGET_ADJUSTED 不得再作用于该期。 */
export interface AssessmentPeriod {
  period_id: string;
  goal_id: string;
  year: number;
  locked: boolean;
}

/** 申报主体：通过控制关系穿透到同一控制集团。 */
export interface ApplicantSubject {
  subject_id: string;
  name: string;
  unified_credit_code: string;
  /** 最终控制集团标识，由 CONTROL_RELATION_DECLARED 穿透归并。 */
  control_group_id: string;
}

/** 看板单元格的逐级溯源链：目标 → 申报 → 项目 → 支付/里程碑 → 证据 → 事件。 */
export interface DrilldownRef {
  goal_id?: string;
  application_id?: string;
  project_id?: string;
  payment_id?: string;
  evidence_id?: string;
  event_ids: string[];
}
