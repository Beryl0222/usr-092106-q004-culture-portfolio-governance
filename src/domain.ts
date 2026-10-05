/** 文化项目组合治理使用的领域事件信封（与 contracts/domain.schema.json 对应）。 */
export interface DomainEvent {
  event_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  /** 触发本事件的前序事件或决定（更正链、决定链）。 */
  causation_id?: string;
  /** 同一业务流程的关联标识。 */
  correlation_id?: string;
  /** 业务载荷；字段约定见 docs/event-catalog.md。 */
  payload?: Record<string, unknown>;
}

/** 治理决定的结论。 */
export type DecisionResult = "APPROVED" | "REJECTED";

/** 决定链中的角色（与 src/catalog.js ACTOR_ROLES 对应）。 */
export type ActorRole =
  | "PLANNING_DEPARTMENT"
  | "PROGRAM_OFFICE"
  | "FINANCE_DEPARTMENT"
  | "REVIEW_COMMITTEE"
  | "PROVINCIAL_CULTURE_DEPT"
  | "AUDIT"
  | "APPLICANT"
  | "REVIEWER";

/** REVIEW_DECISION_RECORDED 事件的载荷。 */
export interface GovernanceDecisionPayload {
  decision_type: string;
  result: DecisionResult;
  subject_id: string;
  actor_id: string;
  actor_role: ActorRole;
  basis_docs?: string[];
  comments?: string;
}
