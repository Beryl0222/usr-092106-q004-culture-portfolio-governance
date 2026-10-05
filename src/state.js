/**
 * 状态归建器：把不可变事件流折叠成当前快照与各类索引。
 * 归建是只读、可重放的；任何业务更正都通过追加事件体现，不直接改快照结构以外的东西。
 *
 * 载荷字段约定（payload）见 docs/领域模型.md。
 */

import { EVENT_AGGREGATE } from "./catalog.js";

export function fold(events) {
  const state = {
    events: [],
    byId: new Map(),
    streams: new Map(), // aggregate_id -> { aggregate_type, byVersion: Map }
    foldErrors: [],

    goals: new Map(), // goal_id -> goal
    periods: new Map(), // period_id -> period
    measures: new Map(), // metric_id -> metric
    fundingStreams: new Map(), // stream_id -> stream

    subjects: new Map(), // subject_id -> subject
    groupMembers: new Map(), // control_group_id -> Set<subject_id>

    applications: new Map(), // application_id(=aggregate_id) -> application
    projects: new Map(), // project_id(=aggregate_id) -> project
    decisions: new Map(), // decision_id(=aggregate_id) -> decision event
    contracts: new Map(), // contract_payment aggregate_id -> contract
    evidences: new Map(), // evidence_id(=aggregate_id) -> evidence pack

    idempotency: new Map(), // key -> [event]
    // `${controlGroupId}|${periodId}|${itemKey}` -> [{application_id, stream_id, event_id}]
    expenseIndex: new Map(),
    // fingerprint -> 首个材料包证据
    fingerprintIndex: new Map(),
    // `${metric_id}|${result_key}` -> [{project_id, evidence_id, event_id, value, regions}]
    resultIndex: new Map(),
  };

  for (const event of events) apply(state, event);
  return state;
}

function apply(state, event) {
  state.events.push(event);
  state.byId.set(event.event_id, event);

  // 流版本登记
  let stream = state.streams.get(event.aggregate_id);
  if (!stream) {
    stream = { aggregate_type: event.aggregate_type, byVersion: new Map() };
    state.streams.set(event.aggregate_id, stream);
  }
  stream.byVersion.set(event.version, event);

  if (event.idempotency_key) {
    const list = state.idempotency.get(event.idempotency_key) ?? [];
    list.push(event);
    state.idempotency.set(event.idempotency_key, list);
  }

  const p = event.payload ?? {};
  switch (event.event_type) {
    // ---------- 规划目标 / 指标 / 考核期 ----------
    case "POLICY_GOAL_DEFINED":
      state.goals.set(event.aggregate_id, {
        goal_id: event.aggregate_id,
        code: p.code,
        current_name: p.name,
        original_name: p.name, // 更名不改原批复口径
        original_approval_no: p.approval_no,
        metric_ids: p.metric_ids ?? [],
      });
      break;
    case "POLICY_RENAMED": {
      const goal = state.goals.get(event.aggregate_id);
      if (goal) goal.current_name = p.new_name;
      else state.foldErrors.push(missingRef(event, `policy_goal ${event.aggregate_id}`));
      break;
    }
    case "FUNDING_STREAM_OPENED":
      state.fundingStreams.set(event.aggregate_id, {
        stream_id: event.aggregate_id,
        code: p.stream_code,
        category: p.category,
        current_name: p.name,
        original_name: p.name,
        original_approval_no: p.approval_no,
      });
      break;
    case "FUNDING_STREAM_RENAMED": {
      const s = state.fundingStreams.get(event.aggregate_id);
      if (s) s.current_name = p.new_name;
      else state.foldErrors.push(missingRef(event, `funding_stream ${event.aggregate_id}`));
      break;
    }
    case "METRIC_DEFINED":
      state.measures.set(p.metric_id ?? event.aggregate_id, {
        metric_id: p.metric_id ?? event.aggregate_id,
        name: p.name,
        unit: p.unit,
      });
      break;
    case "ASSESSMENT_PERIOD_OPENED":
      state.periods.set(event.aggregate_id, {
        period_id: event.aggregate_id,
        goal_id: p.goal_id,
        year: p.year,
        locked: false,
        locked_event_id: null,
      });
      break;
    case "ASSESSMENT_PERIOD_LOCKED": {
      const period = state.periods.get(event.aggregate_id);
      if (period) {
        period.locked = true;
        period.locked_event_id = event.event_id;
      } else state.foldErrors.push(missingRef(event, `assessment_period ${event.aggregate_id}`));
      break;
    }
    case "TARGET_SET":
    case "TARGET_ADJUSTED": {
      const period = state.periods.get(p.period_id);
      if (!period) {
        state.foldErrors.push(missingRef(event, `assessment_period ${p.period_id}`));
        break;
      }
      period.targets ??= new Map();
      const prev = period.targets.get(p.metric_id);
      period.targets.set(p.metric_id, {
        value: p.target_value ?? p.new_value,
        updated_by: event.event_id,
        base_value: prev ? prev.base_value : p.target_value ?? p.new_value,
        adjustments: prev ? [...prev.adjustments, event.event_id] : [],
      });
      break;
    }

    // ---------- 申报主体 / 控制关系 ----------
    case "SUBJECT_REGISTERED":
      state.subjects.set(event.aggregate_id, {
        subject_id: event.aggregate_id,
        name: p.name,
        unified_credit_code: p.unified_credit_code,
        control_group_id: p.control_group_id,
      });
      joinGroup(state, p.control_group_id, event.aggregate_id);
      break;
    case "CONTROL_RELATION_DECLARED": {
      const child = state.subjects.get(event.aggregate_id);
      const parent = state.subjects.get(p.parent_subject_id);
      if (!child || !parent) {
        state.foldErrors.push(missingRef(event, "控制关系主体"));
        break;
      }
      child.control_group_id = parent.control_group_id;
      joinGroup(state, parent.control_group_id, child.subject_id);
      break;
    }

    // ---------- 申报与评审 ----------
    case "APPLICATION_RECEIVED": {
      const app = {
        application_id: event.aggregate_id,
        stream_id: p.stream_id,
        goal_id: p.goal_id,
        period_id: p.period_id,
        lead_subject_id: p.lead_subject_id,
        co_subject_ids: p.co_subject_ids ?? [],
        budget_requested_wan: p.budget_requested_wan,
        regions: p.regions ?? [],
        metric_contributions: p.metric_contributions ?? [],
        expense_items: p.expense_items ?? [],
        status: "received",
        project_id: null,
        conflict_event_ids: [],
        reviewers: [],
        recused_reviewer_ids: [],
        received_event_id: event.event_id,
      };
      state.applications.set(app.application_id, app);
      indexExpenses(state, app, event);
      break;
    }
    case "CONFLICT_DECLARED": {
      const app = state.applications.get(event.aggregate_id);
      if (app) app.conflict_event_ids.push(event.event_id);
      for (const otherId of p.suspect_application_ids ?? []) {
        const other = state.applications.get(otherId);
        if (other) other.conflict_event_ids.push(event.event_id);
      }
      break;
    }
    case "REVIEW_TASK_ASSIGNED":
      for (const appId of p.application_ids ?? []) {
        const app = state.applications.get(appId);
        if (app) app.reviewers.push({ reviewer_id: p.reviewer_id, control_group_id: p.control_group_id ?? null, event_id: event.event_id });
      }
      break;
    case "RECUSAL_DECIDED": {
      state.decisions.set(event.aggregate_id, decision(event, p));
      const app = state.applications.get(p.application_id);
      if (app && p.recused) app.recused_reviewer_ids.push(p.reviewer_id);
      break;
    }
    case "APPLICATION_AMENDED": {
      const app = state.applications.get(event.aggregate_id);
      if (app && p.amendment) Object.assign(app, pickAmendment(p.amendment));
      break;
    }
    case "APPLICATION_DUPLICATE_REJECTED": {
      const app = state.applications.get(event.aggregate_id);
      // 幂等拒收只作为对原申报的反馈，不改变原申报的受理状态
      if (app) app.duplicate_attempts = (app.duplicate_attempts ?? 0) + 1;
      break;
    }
    case "APPLICATION_WITHDRAWN": {
      const app = state.applications.get(event.aggregate_id);
      if (app) app.status = "withdrawn";
      break;
    }

    // ---------- 立项与执行 ----------
    case "FUNDING_APPROVED": {
      const app = state.applications.get(p.application_id);
      const milestones = new Map();
      for (const m of p.milestone_schedule ?? []) {
        milestones.set(m.code, { code: m.code, name: m.name, due_date: m.due_date, verified_event_id: null, delay_event_id: null });
      }
      const project = {
        project_id: event.aggregate_id,
        application_id: p.application_id,
        stream_id: p.stream_id,
        goal_id: p.goal_id,
        period_id: p.period_id,
        lead_subject_id: p.lead_subject_id ?? app?.lead_subject_id,
        co_subject_ids: p.co_subject_ids ?? app?.co_subject_ids ?? [],
        approved_wan: p.approved_wan,
        regions: p.regions ?? app?.regions ?? [],
        milestones,
        status: "active",
        contract_id: null,
        transfer_total_wan: 0,
        recovery_decided_wan: 0,
        recovered_wan: 0,
        approval_event_id: event.event_id,
      };
      state.projects.set(project.project_id, project);
      if (app) {
        app.status = "approved";
        app.project_id = project.project_id;
      }
      break;
    }
    case "BUDGET_TRANSFER_REQUESTED":
      // 请求仅留痕，决定在 decision_record 上处理
      break;
    case "BUDGET_TRANSFER_DECIDED": {
      state.decisions.set(event.aggregate_id, decision(event, p));
      const project = state.projects.get(p.project_id);
      // 规划处与财务处可能就同一申请各自“共同决定”，金额只计一次
      if (project && p.approved && event.causation_id && !project._transfer_seen?.has(event.causation_id)) {
        project.transfer_total_wan += p.amount_wan ?? 0;
        (project._transfer_seen ??= new Set()).add(event.causation_id);
      }
      break;
    }
    case "MILESTONE_DELAY_REQUESTED":
      break;
    case "MILESTONE_DELAY_DECIDED": {
      state.decisions.set(event.aggregate_id, decision(event, p));
      const project = state.projects.get(p.project_id);
      const m = project?.milestones.get(p.milestone_code);
      if (m && p.approved) {
        m.due_date = p.new_due_date;
        m.delay_event_id = event.event_id;
      }
      break;
    }
    case "MILESTONE_VERIFIED": {
      const project = state.projects.get(event.aggregate_id);
      const m = project?.milestones.get(p.milestone_code);
      if (m) m.verified_event_id = event.event_id;
      for (const evId of p.evidence_ids ?? []) {
        const ev = state.evidences.get(evId);
        if (ev) indexResultClaims(state, ev, event);
      }
      break;
    }
    case "PROJECT_TERMINATION_DECIDED": {
      state.decisions.set(event.aggregate_id, decision(event, p));
      const project = state.projects.get(p.project_id);
      if (project) project.status = "terminated";
      break;
    }
    case "FUNDS_RECOVERY_DECIDED": {
      state.decisions.set(event.aggregate_id, decision(event, p));
      const project = state.projects.get(p.project_id);
      if (project) project.recovery_decided_wan += p.amount_wan ?? 0;
      break;
    }
    case "FUNDS_RECOVERED": {
      const project = state.projects.get(event.aggregate_id);
      if (project) project.recovered_wan += p.amount_wan ?? 0;
      break;
    }

    // ---------- 合同 / 支付 ----------
    case "CONTRACT_RECORDED": {
      state.contracts.set(event.aggregate_id, {
        contract_id: event.aggregate_id,
        project_id: p.project_id,
        contract_no: p.contract_no,
        total_wan: p.total_wan,
        payments: new Map(),
      });
      const project = state.projects.get(p.project_id);
      if (project) project.contract_id = event.aggregate_id;
      break;
    }
    case "PAYMENT_REQUESTED": {
      const contract = state.contracts.get(event.aggregate_id);
      if (!contract) {
        state.foldErrors.push(missingRef(event, `contract_payment ${event.aggregate_id}`));
        break;
      }
      contract.payments.set(event.event_id, {
        request_event_id: event.event_id,
        project_id: p.project_id,
        phase: p.phase,
        amount_wan: p.amount_wan,
        evidence_ids: p.evidence_ids ?? [],
        status: "requested",
        effect_event_id: null,
      });
      break;
    }
    case "PAYMENT_EXECUTED":
    case "PAYMENT_BLOCKED": {
      const contract = state.contracts.get(event.aggregate_id);
      const pay = contract?.payments.get(p.request_event_id);
      if (pay) {
        pay.status = event.event_type === "PAYMENT_EXECUTED" ? "executed" : "blocked";
        pay.effect_event_id = event.event_id;
        pay.block_reason = event.event_type === "PAYMENT_BLOCKED" ? p.reason : null;
      } else state.foldErrors.push(missingRef(event, `payment request ${p.request_event_id}`));
      break;
    }

    // ---------- 证据 / 成果 ----------
    case "EVIDENCE_SUBMITTED": {
      const pack = {
        evidence_id: event.aggregate_id,
        project_id: p.project_id,
        subject_id: p.submitted_by_subject_id,
        files: p.files ?? [],
        milestone_code: p.milestone_code,
        claims: p.result_claims ?? [],
        benefit_regions: p.benefit_regions ?? [],
        region_shares: p.region_shares ?? null,
        submitted_event_id: event.event_id,
        deduped_files: [], // [{fingerprint, first_evidence_id, event_id}]
      };
      state.evidences.set(pack.evidence_id, pack);
      for (const f of pack.files) {
        const first = state.fingerprintIndex.get(f.fingerprint);
        if (first) {
          pack.deduped_files.push({ fingerprint: f.fingerprint, first_evidence_id: first.evidence_id, event_id: null });
        } else {
          state.fingerprintIndex.set(f.fingerprint, {
            evidence_id: pack.evidence_id,
            project_id: pack.project_id,
            subject_id: pack.subject_id,
            event_id: event.event_id,
          });
        }
      }
      break;
    }
    case "EVIDENCE_DEDUPLICATED": {
      const pack = state.evidences.get(event.aggregate_id);
      const hit = pack?.deduped_files.find((d) => d.fingerprint === p.fingerprint);
      if (hit) {
        hit.event_id = event.event_id;
        hit.first_evidence_id = p.first_evidence_id ?? hit.first_evidence_id;
      }
      break;
    }
    case "OUTCOME_DEDUPLICATED": {
      const key = `${p.metric_id}|${p.result_key}`;
      const list = state.resultIndex.get(key) ?? [];
      for (const d of p.dropped ?? []) {
        const idx = list.findIndex((c) => c.project_id === d.project_id && c.evidence_id === d.evidence_id);
        if (idx >= 0) list.splice(idx, 1);
      }
      state.resultIndex.set(key, list);
      break;
    }
    default:
      // 未知事件不致命，由不变量校验报告
      break;
  }
}

function joinGroup(state, groupId, subjectId) {
  if (!groupId) return;
  const set = state.groupMembers.get(groupId) ?? new Set();
  set.add(subjectId);
  state.groupMembers.set(groupId, set);
}

function indexExpenses(state, app, event) {
  const lead = state.subjects.get(app.lead_subject_id);
  for (const item of app.expense_items) {
    const key = `${lead?.control_group_id ?? "?"}|${app.period_id}|${item.item_key}`;
    const list = state.expenseIndex.get(key) ?? [];
    list.push({ application_id: app.application_id, stream_id: app.stream_id, event_id: event.event_id });
    state.expenseIndex.set(key, list);
  }
}

function indexResultClaims(state, pack, verifiedEvent) {
  for (const claim of pack.claims) {
    const key = `${claim.metric_id}|${claim.result_key}`;
    const list = state.resultIndex.get(key) ?? [];
    const shares = distribute(pack, claim);
    list.push({
      project_id: pack.project_id,
      evidence_id: pack.evidence_id,
      event_id: verifiedEvent.event_id,
      value: claim.contribution_value ?? 1,
      region_shares: shares,
    });
    state.resultIndex.set(key, list);
  }
}

/** 成果区域贡献：优先使用 payload 的 region_shares，否则在受益区域间均摊。 */
function distribute(pack, claim) {
  const regions = pack.benefit_regions;
  if (!regions.length) return [];
  if (pack.region_shares?.length) {
    return pack.region_shares.map((r) => ({ region_code: r.region_code, share: r.share }));
  }
  return regions.map((region_code) => ({ region_code, share: 1 / regions.length }));
}

function decision(event, p) {
  return {
    decision_id: event.aggregate_id,
    event_id: event.event_id,
    type: event.event_type,
    causation_id: event.causation_id ?? null,
    actor_role: event.actor_role ?? null,
    payload: p,
  };
}

function pickAmendment(a) {
  const allowed = ["budget_requested_wan", "regions", "metric_contributions", "expense_items"];
  return Object.fromEntries(Object.entries(a).filter(([k]) => allowed.includes(k)));
}

function missingRef(event, what) {
  return `事件 ${event.event_id}（${event.event_type}）引用了不存在的对象：${what}`;
}

export function groupOf(state, subjectId) {
  return state.subjects.get(subjectId)?.control_group_id ?? null;
}

export function projectMemberGroupIds(state, project) {
  const ids = [project.lead_subject_id, ...project.co_subject_ids].map((s) => groupOf(state, s));
  return new Set(ids.filter(Boolean));
}

export { EVENT_AGGREGATE };
