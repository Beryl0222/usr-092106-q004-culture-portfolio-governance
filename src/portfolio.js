/**
 * 项目组合治理事件折叠器：按顺序接收事件，执行《governance-rules.md》第 8 节的
 * 接收侧检查（信封、版本、决定链、G2/G4/G6–G11 业务不变量），把已接收事件折叠为当前状态。
 *
 * 不修改输入事件；不合法事件进入 rejected，不产生部分生效。
 */
import {
  DECISION_AUTHORITY,
  PUBLIC_CELL_MIN_BENEFICIARIES,
} from "./catalog.js";
import { validateGovernanceEvent } from "./validator.js";

const iso = (s) => new Date(s).getTime();

/**
 * 在指定日期求值的控制关系闭包：沿生效中的控制边无向遍历，
 * 用于 G3 穿透查重（同一集团内母子/兄弟主体一并比对）。
 */
export function controlClosure(applicantId, edges, atDate) {
  const t = atDate ? iso(atDate) : Infinity;
  const adjacency = new Map();
  for (const e of edges) {
    const from = iso(e.valid_from);
    const to = e.valid_to ? iso(e.valid_to) : Infinity;
    if (from <= t && t <= to) {
      if (!adjacency.has(e.parent_id)) adjacency.set(e.parent_id, new Set());
      if (!adjacency.has(e.child_id)) adjacency.set(e.child_id, new Set());
      adjacency.get(e.parent_id).add(e.child_id);
      adjacency.get(e.child_id).add(e.parent_id);
    }
  }
  const closure = new Set([applicantId]);
  const queue = [applicantId];
  while (queue.length) {
    const cur = queue.pop();
    for (const next of adjacency.get(cur) ?? []) {
      if (!closure.has(next)) {
        closure.add(next);
        queue.push(next);
      }
    }
  }
  return closure;
}

function initialState() {
  return {
    versions: new Map(), // aggregate_id -> 最新 version
    lastTime: new Map(), // aggregate_id -> 最新 occurred_at
    decisions: new Map(), // event_id -> 决定事件
    applicants: new Map(),
    controlEdges: [],
    recusedReviewers: new Map(), // application_id -> Set(reviewer_id)
    applications: new Map(), // id -> { program, applicant, openDuplicate, approved, rejected }
    projects: new Map(), // id -> { secured, contractAmount, released, recovered, terminated, milestones }
    contracts: new Map(), // contract_no(或 id) -> { project_id, amount }
    evidence: new Map(), // evidence_id -> { status, hash, canonical_key, project_id }
    seenPaymentKeys: new Set(),
    requests: new Map(), // payment 聚合 id -> 最近请求载荷
    periods: new Map(), // period_code -> { locked }
    targets: new Map(), // aggregate_id -> { period_code }
    contributions: [],
    publicReleases: [],
  };
}

function checkBusiness(state, event, errors) {
  const { event_type: type, aggregate_id: id, payload = {} } = event;
  const app = (x) => state.applications.get(x);
  const proj = (x) => state.projects.get(x);

  switch (type) {
    case "APPLICANT_REGISTERED": {
      if ([...state.applicants.values()].some((a) => a.credit_code === payload.credit_code)) {
        errors.push("credit_code 已存在：主体重复登记");
      }
      break;
    }
    case "CONTROL_RELATIONSHIP_RECORDED": {
      if (!state.applicants.has(payload.parent_id) || !state.applicants.has(payload.child_id)) {
        errors.push("控制关系两端的主体必须先登记");
      }
      break;
    }
    case "APPLICATION_RECEIVED": {
      if (!state.applicants.has(payload.applicant_id)) errors.push("申报主体未登记");
      break;
    }
    case "APPLICANT_DUPLICATE_FLAGGED":
    case "APPLICATION_DUPLICATE_FLAGGED": {
      if (app(id)) app(id).openDuplicate = true;
      break;
    }
    case "REVIEWER_ASSIGNED":
      break;
    case "CONFLICT_DECLARED": {
      if (!state.recusedReviewers.has(id)) state.recusedReviewers.set(id, new Set());
      state.recusedReviewers.get(id).add(payload.reviewer_id);
      break;
    }
    case "REVIEW_DECISION_RECORDED": {
      const authority = DECISION_AUTHORITY[payload.decision_type];
      if (!authority) {
        errors.push(`未知决定类型：${payload.decision_type}`);
      } else if (payload.actor_role !== authority) {
        errors.push(
          `${payload.decision_type} 只能由 ${authority} 作出，实际角色 ${payload.actor_role}（G5 越权）`,
        );
      }
      if (payload.decision_type === "FUNDING_REVIEW") {
        const recused = state.recusedReviewers.get(payload.subject_id);
        const people = [payload.actor_id, ...(payload.committee ?? [])];
        const hit = people.find((p) => recused?.has(p));
        if (hit) errors.push(`已回避评审人 ${hit} 不得参与该申报决定`);
      }
      if (payload.decision_type === "DUPLICATE_FUNDING_RULING") {
        // 认定/排除结论作出后，相关申报的未决拆单标记解除
        for (const appId of [payload.subject_id, ...(payload.application_ids ?? [])]) {
          const a = state.applications.get(appId);
          if (a) a.openDuplicate = false;
        }
      }
      break;
    }
    case "FUNDING_APPROVED": {
      const a = app(id);
      if (!a) {
        errors.push("申报不存在");
      } else {
        if (a.openDuplicate) errors.push("存在未裁决的拆单标记，不得立项（G4）");
        if (a.rejected) errors.push("已驳回申报不得再立项");
      }
      break;
    }
    case "PROJECT_ESTABLISHED": {
      const a = app(payload.application_id);
      if (!a?.approved) errors.push("立项项目必须来自已批准申报");
      break;
    }
    case "BUDGET_SOURCE_SECURED": {
      if (!proj(payload.project_id)) errors.push("项目不存在");
      break;
    }
    case "CONTRACT_SIGNED": {
      const p = proj(payload.project_id);
      if (!p) {
        errors.push("项目不存在");
      } else if (payload.amount > p.secured) {
        errors.push(`合同额 ${payload.amount} 超过已落实预算 ${p.secured}（G6）`);
      }
      break;
    }
    case "MILESTONE_VERIFIED": {
      const p = proj(id);
      if (!p) errors.push("项目不存在");
      for (const evId of payload.evidence_ids ?? []) {
        if (state.evidence.get(evId)?.status !== "ACCEPTED") {
          errors.push(`里程碑核验引用的证据 ${evId} 未被采信（G10）`);
        }
      }
      break;
    }
    case "EVIDENCE_SUBMITTED":
      break;
    case "EVIDENCE_DUPLICATE_MATCHED": {
      if (payload.new_evidence_id === payload.existing_evidence_id) {
        errors.push("重复命中不能指向证据自身");
      }
      break;
    }
    case "EVIDENCE_ACCEPTED":
    case "EVIDENCE_REJECTED":
      break;
    case "PAYMENT_RELEASED": {
      const contract = state.contracts.get(payload.contract_id ?? payload.contract_no);
      if (!contract) {
        errors.push("支付对应的合同不存在");
        break;
      }
      const p = proj(contract.project_id);
      if (p.terminated) errors.push("项目已终止，不得继续拨付（G8）");
      if (!p.milestones.has(payload.milestone_code)) {
        errors.push(`里程碑 ${payload.milestone_code} 未核验，不得拨付（G8）`);
      }
      for (const evId of payload.evidence_ids ?? []) {
        if (state.evidence.get(evId)?.status !== "ACCEPTED") {
          errors.push(`支付引用的证据 ${evId} 未被采信（G8/G10）`);
        }
      }
      if (state.seenPaymentKeys.has(payload.idempotency_key)) {
        errors.push("idempotency_key 已出账，拒绝二次拨付（G7）");
      }
      const after = contract.released + payload.amount;
      if (after > contract.amount) {
        errors.push(`累计支付 ${after} 将超过合同额 ${contract.amount}（G6）`);
      }
      break;
    }
    case "PAYMENT_BLOCKED":
      break;
    case "FUNDS_RECOVERED": {
      const p = proj(id);
      if (!p) {
        errors.push("项目不存在");
      } else if (payload.amount > p.released - p.recovered) {
        errors.push(
          `追回 ${payload.amount} 超过已拨未追回余额 ${p.released - p.recovered}`,
        );
      }
      if (state.seenPaymentKeys.has(payload.idempotency_key)) {
        errors.push("追回幂等键重复");
      }
      break;
    }
    case "ANNUAL_TARGET_SET":
      break;
    case "ANNUAL_TARGET_ADJUSTED": {
      const target = state.targets.get(id);
      if (!target) {
        errors.push("被调整指标不存在");
      } else if (state.periods.get(target.period_code)?.locked) {
        errors.push(`考核期 ${target.period_code} 已锁定，调整不得回溯（G2）`);
      }
      break;
    }
    case "OUTCOME_CONTRIBUTION_RECORDED": {
      for (const evId of payload.evidence_ids ?? []) {
        if (state.evidence.get(evId)?.status !== "ACCEPTED") {
          errors.push(`成果贡献引用的证据 ${evId} 未被采信（G10）`);
        }
      }
      break;
    }
    case "OUTCOME_DEDUP_RESOLVED":
      break;
    case "PUBLIC_SUMMARY_RELEASED": {
      const minSize = payload.min_group_size ?? PUBLIC_CELL_MIN_BENEFICIARIES;
      const cells = payload.cells ?? [];
      const suppressed = new Set(payload.suppressed_cells ?? []);
      for (const cell of cells) {
        if (suppressed.has(cell.cell_key)) {
          errors.push(`被抑制格 ${cell.cell_key} 不得出现在发布数据中（G11）`);
        }
        if ((cell.beneficiary_count ?? 0) < minSize) {
          errors.push(`汇总格 ${cell.cell_key} 受益主体数 ${cell.beneficiary_count} 低于阈值 ${minSize}（G11）`);
        }
      }
      // 抑制一致性：某分组若公布合计且仅有 1 个被抑制格，该格可被差值反推
      const groups = new Map();
      for (const cell of cells) {
        if (!cell.group_key) continue;
        if (!groups.has(cell.group_key)) groups.set(cell.group_key, { shown: 0, suppressedInGroup: 0, hasTotal: false });
        groups.get(cell.group_key).shown += 1;
      }
      for (const key of suppressed) {
        const g = key.split("|")[0];
        if (groups.has(g)) groups.get(g).suppressedInGroup += 1;
      }
      for (const cell of cells) {
        if (cell.is_total && groups.has(cell.group_key)) groups.get(cell.group_key).hasTotal = true;
      }
      for (const [g, info] of groups) {
        if (info.hasTotal && info.suppressedInGroup === 1) {
          errors.push(`分组 ${g} 仅抑制 1 格且公布合计，可被差值反推（G11）`);
        }
      }
      if (payload.diff_check_passed !== true) {
        errors.push("跨批差分检查未通过，整批不得发布（G11）");
      }
      break;
    }
    default:
      break;
  }
}

function apply(state, event) {
  const { event_type: type, aggregate_id: id, payload = {} } = event;
  switch (type) {
    case "APPLICANT_REGISTERED":
      state.applicants.set(id, { ...payload });
      break;
    case "CONTROL_RELATIONSHIP_RECORDED":
      state.controlEdges.push({ ...payload });
      break;
    case "CONTROL_RELATIONSHIP_RETRACTED": {
      const edge = state.controlEdges.find(
        (e) => `${e.parent_id}->${e.child_id}` === payload.relationship_key,
      );
      if (edge) edge.valid_to = payload.valid_to;
      break;
    }
    case "APPLICATION_RECEIVED":
      state.applications.set(id, {
        program: payload.program_code,
        applicant: payload.applicant_id,
        openDuplicate: false,
        approved: false,
        rejected: false,
      });
      break;
    case "APPLICATION_REJECTED": {
      const a = state.applications.get(id);
      if (a) a.rejected = true;
      break;
    }
    case "FUNDING_APPROVED": {
      const a = state.applications.get(id);
      if (a) a.approved = true;
      break;
    }
    case "PROJECT_ESTABLISHED":
      state.projects.set(id, {
        application: payload.application_id,
        secured: 0,
        contractAmount: 0,
        released: 0,
        recovered: 0,
        terminated: false,
        milestones: new Set(),
      });
      break;
    case "BUDGET_SOURCE_SECURED": {
      const p = state.projects.get(payload.project_id);
      if (p) p.secured += payload.amount;
      break;
    }
    case "CONTRACT_SIGNED": {
      const p = state.projects.get(payload.project_id);
      if (p) p.contractAmount += payload.amount;
      state.contracts.set(payload.contract_no, {
        project_id: payload.project_id,
        amount: payload.amount,
        released: 0,
      });
      break;
    }
    case "MILESTONE_VERIFIED": {
      state.projects.get(id)?.milestones.add(payload.milestone_code);
      break;
    }
    case "EVIDENCE_SUBMITTED":
      state.evidence.set(id, { status: "SUBMITTED", ...payload });
      break;
    case "EVIDENCE_DUPLICATE_MATCHED": {
      const e = state.evidence.get(payload.new_evidence_id);
      if (e) e.matched = payload.existing_evidence_id;
      break;
    }
    case "EVIDENCE_ACCEPTED": {
      const e = state.evidence.get(id);
      if (e) {
        e.status = "ACCEPTED";
        if (payload.canonical_outcome_id) e.canonical_outcome_id = payload.canonical_outcome_id;
      }
      break;
    }
    case "EVIDENCE_REJECTED": {
      const e = state.evidence.get(id);
      if (e) e.status = "REJECTED";
      break;
    }
    case "PAYMENT_REQUESTED":
      state.requests.set(id, payload);
      break;
    case "PAYMENT_RELEASED": {
      state.seenPaymentKeys.add(payload.idempotency_key);
      const contract = state.contracts.get(payload.contract_id ?? payload.contract_no);
      if (contract) contract.released += payload.amount;
      const project = state.projects.get(contract?.project_id);
      if (project) project.released += payload.amount;
      break;
    }
    case "PROJECT_TERMINATED": {
      const p = state.projects.get(id);
      if (p) p.terminated = true;
      break;
    }
    case "FUNDS_RECOVERED": {
      const p = state.projects.get(id);
      if (p) p.recovered += payload.amount;
      state.seenPaymentKeys.add(payload.idempotency_key);
      break;
    }
    case "ASSESSMENT_PERIOD_OPENED":
      state.periods.set(payload.period_code, { locked: false });
      break;
    case "ASSESSMENT_PERIOD_LOCKED":
      state.periods.set(payload.period_code, { locked: true });
      break;
    case "ANNUAL_TARGET_SET":
      state.targets.set(id, { period_code: payload.period_code });
      break;
    case "OUTCOME_CONTRIBUTION_RECORDED":
      state.contributions.push({
        id,
        event_id: event.event_id,
        key: [payload.goal_code, payload.period_code, payload.metric_code, payload.canonical_outcome_id].join("|"),
        duplicate: false,
      });
      break;
    case "OUTCOME_DEDUP_RESOLVED":
      for (const c of state.contributions) {
        if ((payload.duplicate_contribution_ids ?? []).includes(c.event_id)) c.duplicate = true;
      }
      break;
    case "PUBLIC_SUMMARY_RELEASED":
      state.publicReleases.push(payload);
      break;
    default:
      break;
  }
}

/** 折叠后的全局不变量：G9 同一成果在同指标+同考核期只能有一条生效贡献。 */
export function effectiveContributionConflicts(state) {
  const seen = new Map();
  const conflicts = [];
  for (const c of state.contributions) {
    if (c.duplicate) continue;
    if (seen.has(c.key)) conflicts.push({ key: c.key, events: [seen.get(c.key), c.event_id] });
    else seen.set(c.key, c.event_id);
  }
  return conflicts;
}

/**
 * 企业侧只读视图：viewer 只能看到本主体（可扩展为含授权联合成员）的申报、
 * 自身提交的证据状态，以及针对本主体申报的结论反馈；
 * 其他主体申报、查重命中明细、评审人身份信息一律不投影（治理规则 7.1/7.2）。
 *
 * @param {object[]} events 已接收事件
 * @param {string} viewerId 查看方 applicant_id
 * @param {Set<string>} [ownAccounts] 本主体收款账户集合；不传则不投影任何支付明细
 */
export function applicantView(events, viewerId, ownAccounts) {
  const myApplicationIds = new Set();
  for (const e of events) {
    if (e.event_type === "APPLICATION_RECEIVED" && e.payload?.applicant_id === viewerId) {
      myApplicationIds.add(e.aggregate_id);
    }
    if (e.event_type === "JOINT_APPLICATION_LINKED") {
      const memberIds = [e.payload?.lead_applicant_id, ...(e.payload?.members ?? []).map((m) => m.applicant_id)];
      if (memberIds.includes(viewerId)) myApplicationIds.add(e.aggregate_id);
    }
  }

  const view = { applications: [], evidence: [], feedback: [], payments: [] };

  // 证据归属：以 EVIDENCE_SUBMITTED 的 submitted_by 为准，
  // 后续核验/重复命中事件载荷不含提交人，按 aggregate_id 归并状态。
  const evidenceOwner = new Map();
  const evidenceState = new Map();
  for (const e of events) {
    if (e.event_type === "EVIDENCE_SUBMITTED") {
      evidenceOwner.set(e.aggregate_id, e.payload?.submitted_by);
      evidenceState.set(e.aggregate_id, {
        event_id: e.event_id,
        evidence_id: e.aggregate_id,
        status: "SUBMITTED",
        late: Boolean(e.payload?.late),
        duplicate_matched: false,
      });
    }
  }

  for (const e of events) {
    if (e.aggregate_type === "funding_application" && myApplicationIds.has(e.aggregate_id)) {
      const payload = { ...(e.payload ?? {}) };
      // 查重信号对企业可见“被标记”这一事实与命中规则，但不暴露其他主体标识
      if (e.event_type === "APPLICATION_DUPLICATE_FLAGGED") {
        delete payload.matched_pairs;
        delete payload.control_path;
      }
      // 回避记录对申报方只告知“已启动回避”，不透露评审人身份与关系细节
      if (e.event_type === "CONFLICT_DECLARED") {
        delete payload.reviewer_id;
        delete payload.relation_detail;
      }
      view.applications.push({ event_id: e.event_id, event_type: e.event_type, payload });
    }
    if (
      e.aggregate_type === "evidence"
      && (evidenceOwner.get(e.aggregate_id) === viewerId || e.payload?.submitted_by === viewerId)
      && evidenceState.has(e.aggregate_id)
    ) {
      const row = evidenceState.get(e.aggregate_id);
      if (e.event_type === "EVIDENCE_DUPLICATE_MATCHED") row.duplicate_matched = true;
      if (e.event_type === "EVIDENCE_ACCEPTED") row.status = "ACCEPTED";
      if (e.event_type === "EVIDENCE_REJECTED") {
        row.status = "REJECTED";
        row.reject_reason = e.payload?.reason;
      }
    }
    if (e.event_type === "REVIEW_DECISION_RECORDED" && myApplicationIds.has(e.payload?.subject_id)) {
      view.feedback.push({
        decision_id: e.event_id,
        application_id: e.payload.subject_id,
        decision_type: e.payload.decision_type,
        result: e.payload.result,
        ruling: e.payload.ruling,
        requirement: e.payload.requirement,
        // 刻意不投影 actor_id / committee / 评审人单位
      });
    }
    if (e.aggregate_type === "payment" && ownAccounts?.has(e.payload?.payee_account)) {
      view.payments.push({
        event_id: e.event_id,
        event_type: e.event_type,
        amount: e.payload.amount,
        currency: e.payload.currency,
        reason: e.payload.reason,
      });
    }
  }
  view.evidence = [...evidenceState.values()];
  return view;
}

/**
 * 折叠事件流。
 * @returns {{state: object, accepted: object[], rejected: Array<{event_id:string, errors:string[]}>}}
 */
export function fold(events) {
  const state = initialState();
  const accepted = [];
  const rejected = [];

  for (const event of events) {
    const errors = validateGovernanceEvent(event, state.decisions);

    const expectedVersion = (state.versions.get(event.aggregate_id) ?? 0) + 1;
    if (event.version !== expectedVersion) {
      errors.push(`version 不连续：期望 ${expectedVersion}，实际 ${event.version}`);
    }
    const lastTime = state.lastTime.get(event.aggregate_id);
    if (lastTime && iso(event.occurred_at) < iso(lastTime)) {
      errors.push("occurred_at 早于该聚合已有事件");
    }

    if (errors.length === 0) checkBusiness(state, event, errors);

    if (errors.length > 0) {
      rejected.push({ event_id: event.event_id, errors });
      continue;
    }
    apply(state, event);
    state.versions.set(event.aggregate_id, event.version);
    state.lastTime.set(event.aggregate_id, event.occurred_at);
    if (event.event_type === "REVIEW_DECISION_RECORDED") {
      state.decisions.set(event.event_id, event);
    }
    accepted.push(event);
  }

  for (const conflict of effectiveContributionConflicts(state)) {
    rejected.push({ event_id: conflict.events[1], errors: [`同一成果在同指标+考核期内重复计量（G9）：${conflict.key}`] });
  }
  return { state, accepted, rejected };
}
