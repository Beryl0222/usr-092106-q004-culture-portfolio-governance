/**
 * 省级看板读模型。所有数值单元格都携带 trace（逐级溯源链）：
 * 规划目标 → 年度指标/考核期 → 申报 → 立项项目 → 合同支付/里程碑 → 成果证据 → 原始事件。
 *
 * 读模型不做权限裁剪；请先经 access.js 的 viewer 过滤后再对外输出。
 */

import { CONCENTRATION_ALERT, REGIONS } from "./catalog.js";
import { groupOf, projectMemberGroupIds } from "./state.js";

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * 1) 资金集中：按专项资金 × 考核期汇总批准额、拨付额，按最终控制集团穿透归集，
 *    输出份额与预警；可逐层下钻到项目、申报、支付与证据。
 */
export function fundingConcentration(state, { period_id = null, stream_id = null } = {}) {
  const rows = [];
  for (const stream of state.fundingStreams.values()) {
    if (stream_id && stream.stream_id !== stream_id) continue;
    const projects = [...state.projects.values()].filter(
      (p) => p.stream_id === stream.stream_id && (!period_id || p.period_id === period_id),
    );
    let approved = 0;
    let executed = 0;
    const groups = new Map();
    for (const p of projects) {
      approved += p.approved_wan;
      const pExecuted = executedOf(state, p);
      executed += pExecuted;
      const gId = groupOf(state, p.lead_subject_id) ?? `unknown:${p.lead_subject_id}`;
      const g = groups.get(gId) ?? { control_group_id: gId, approved_wan: 0, executed_wan: 0, projects: [] };
      g.approved_wan += p.approved_wan;
      g.executed_wan += pExecuted;
      g.projects.push(projectTrace(state, p));
      groups.set(gId, g);
    }
    const groupRows = [...groups.values()]
      .map((g) => ({ ...g, share: approved ? round1(g.approved_wan / approved) : 0 }))
      .sort((a, b) => b.approved_wan - a.approved_wan);
    const topShare = groupRows[0]?.share ?? 0;
    rows.push({
      stream_id: stream.stream_id,
      stream_name: stream.current_name,
      period_id,
      approved_total_wan: approved,
      executed_total_wan: round1(executed),
      distinct_groups: groupRows.length,
      top_share: topShare,
      concentration_alert: topShare > CONCENTRATION_ALERT,
      groups: groupRows,
    });
  }
  return { view: "funding_concentration", period_id, alert_threshold: CONCENTRATION_ALERT, rows };
}

/**
 * 2) 城乡缺口：指标在城市/县域的目标值、实际值与缺口；
 *    实际值由“去重后的成果 × 区域受益份额”汇总，同一成果只计一次。
 */
export function urbanRuralGap(state, { goal_id = null, period_id = null } = {}) {
  const periods = [...state.periods.values()].filter(
    (pd) => (!goal_id || pd.goal_id === goal_id) && (!period_id || pd.period_id === period_id),
  );
  const rows = [];
  for (const period of periods) {
    const goal = state.goals.get(period.goal_id);
    for (const [metricKey, target] of period.targets ?? []) {
      // resultIndex 按“指标|成果去重键”存储；看板按指标汇总，同一成果已在索引层去重
      const claims = [...state.resultIndex.entries()]
        .filter(([key]) => key.startsWith(`${metricKey}|`))
        .flatMap(([, list]) => list);
      const bucket = { urban: 0, rural: 0, unclassified: 0 };
      const regions = new Map();
      const traces = [];
      for (const c of claims) {
        for (const r of c.region_shares) {
          const v = c.value * r.share;
          const meta = REGIONS[r.region_code];
          const cls = !meta ? "unclassified" : meta.urban ? "urban" : "rural";
          bucket[cls] += v;
          const cell = regions.get(r.region_code) ?? { region_code: r.region_code, region_name: meta?.name ?? r.region_code, achieved: 0 };
          cell.achieved += v;
          regions.set(r.region_code, cell);
        }
        traces.push({
          metric_id: metricKey,
          project_id: c.project_id,
          evidence_id: c.evidence_id,
          event_ids: [c.event_id],
        });
      }
      const targetVal = target.value;
      const achieved = bucket.urban + bucket.rural + bucket.unclassified;
      rows.push({
        goal_id: period.goal_id,
        goal_name: goal?.current_name ?? period.goal_id,
        original_approval_no: goal?.original_approval_no ?? null, // 更名后原批复口径仍在
        period_id: period.period_id,
        year: period.year,
        locked: period.locked,
        metric_id: metricKey,
        metric_name: state.measures.get(metricKey)?.name ?? metricKey,
        unit: state.measures.get(metricKey)?.unit ?? "",
        target: targetVal,
        achieved_total: round1(achieved),
        gap_total: round1(Math.max(0, targetVal - achieved)),
        achieved_urban: round1(bucket.urban),
        achieved_rural: round1(bucket.rural),
        rural_share: achieved ? round1(bucket.rural / achieved) : 0,
        unclassified_warning: bucket.unclassified > 0,
        region_breakdown: [...regions.values()].map((r) => ({ ...r, achieved: round1(r.achieved) })),
        trace: { goal_id: period.goal_id, period_id: period.period_id, metric_id: metricKey, contributions: traces },
      });
    }
  }
  return { view: "urban_rural_gap", rows };
}

/**
 * 3) 里程碑风险：逾期 / 临期 / 已核验 / 已批准延期，穿透到延期决定链与核验证据。
 */
export function milestoneRisks(state, { asOf = new Date().toISOString(), withinDays = 30 } = {}) {
  const now = Date.parse(asOf);
  const window = withinDays * 86400000;
  const rows = [];
  for (const p of state.projects.values()) {
    if (p.status === "terminated") continue;
    for (const m of p.milestones.values()) {
      const due = Date.parse(m.due_date);
      let risk;
      if (m.verified_event_id) risk = "verified";
      else if (due < now) risk = "overdue";
      else if (due - now <= window) risk = "due_soon";
      else risk = "on_track";
      rows.push({
        project_id: p.project_id,
        goal_id: p.goal_id,
        period_id: p.period_id,
        stream_id: p.stream_id,
        milestone_code: m.code,
        milestone_name: m.name,
        due_date: m.due_date,
        risk,
        delay_approved: Boolean(m.delay_event_id),
        delay_event_id: m.delay_event_id,
        verified_event_id: m.verified_event_id,
        trace: milestoneTrace(state, p, m),
      });
    }
  }
  const order = { overdue: 0, due_soon: 1, on_track: 2, verified: 3 };
  rows.sort((a, b) => order[a.risk] - order[b.risk] || Date.parse(a.due_date) - Date.parse(b.due_date));
  return { view: "milestone_risk", asOf, rows };
}

/** 把溯源引用解析为完整材料（供下钻界面/访问过滤使用）。 */
export function resolveTrace(state, trace) {
  const out = { events: [] };
  const addEvent = (id) => {
    const e = state.byId.get(id);
    if (e) out.events.push(e);
  };
  for (const id of trace.event_ids ?? []) addEvent(id);
  if (trace.goal_id) out.goal = state.goals.get(trace.goal_id) ?? null;
  if (trace.application_id) out.application = state.applications.get(trace.application_id) ?? null;
  if (trace.project_id) {
    const p = state.projects.get(trace.project_id);
    out.project = p ?? null;
    if (p) {
      out.contract = state.contracts.get(p.contract_id) ? redactContract(state.contracts.get(p.contract_id)) : null;
      out.evidences = [...state.evidences.values()].filter((v) => v.project_id === p.project_id).map((v) => ({ ...v, files: v.files }));
    }
  }
  if (trace.evidence_ids?.length) {
    const byId = trace.evidence_ids.map((id) => state.evidences.get(id)).filter(Boolean);
    out.evidences = [...(out.evidences ?? []), ...byId.filter((v) => !(out.evidences ?? []).some((x) => x.evidence_id === v.evidence_id))];
  }
  return out;
}

/* ---------------- 内部辅助 ---------------- */

function executedOf(state, project) {
  let total = 0;
  for (const c of state.contracts.values()) {
    if (c.project_id !== project.project_id) continue;
    for (const pay of c.payments.values()) if (pay.status === "executed") total += pay.amount_wan;
  }
  return total;
}

function projectTrace(state, p) {
  const paymentIds = [];
  const evidenceIds = new Set();
  const eventIds = [p.approval_event_id];
  for (const c of state.contracts.values()) {
    if (c.project_id !== p.project_id) continue;
    for (const pay of c.payments.values()) {
      paymentIds.push(pay.request_event_id);
      pay.evidence_ids.forEach((id) => evidenceIds.add(id));
      if (pay.effect_event_id) eventIds.push(pay.effect_event_id);
    }
  }
  const app = state.applications.get(p.application_id);
  if (app?.received_event_id) eventIds.push(app.received_event_id);
  return {
    project_id: p.project_id,
    application_id: p.application_id,
    lead_subject_id: p.lead_subject_id,
    member_groups: [...projectMemberGroupIds(state, p)],
    approved_wan: p.approved_wan,
    status: p.status,
    payment_request_ids: paymentIds,
    evidence_ids: [...evidenceIds],
    trace: {
      goal_id: p.goal_id,
      application_id: p.application_id,
      project_id: p.project_id,
      period_id: p.period_id,
      event_ids: eventIds,
    },
  };
}

function milestoneTrace(state, p, m) {
  const evidenceIds = [];
  const eventIds = [];
  if (m.verified_event_id) eventIds.push(m.verified_event_id);
  if (m.delay_event_id) eventIds.push(m.delay_event_id);
  for (const ev of state.evidences.values()) {
    if (ev.project_id === p.project_id && ev.milestone_code === m.code) {
      evidenceIds.push(ev.evidence_id);
      eventIds.push(ev.submitted_event_id);
    }
  }
  return {
    goal_id: p.goal_id,
    application_id: p.application_id,
    project_id: p.project_id,
    evidence_ids: evidenceIds,
    event_ids: eventIds,
  };
}

function redactContract(c) {
  return { contract_id: c.contract_id, contract_no: c.contract_no, total_wan: c.total_wan };
}
