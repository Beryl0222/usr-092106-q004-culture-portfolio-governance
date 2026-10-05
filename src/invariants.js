/**
 * 全量不变量校验。
 *
 * 输入：原始事件列表（或 fold() 之后的 state）。
 * 输出 findings：[{ level: "error"|"warning", code, message, event_id?, refs? }]
 * - error：违反硬性治理规则（重复资金、越权决定、锁定后调整、二次拨付等）；
 * - warning：看板可信度受影响但不构成违规（受益区域缺失等）。
 */

import { validateEvent } from "./validator.js";
import { fold, groupOf } from "./state.js";
import {
  EVENT_TYPES,
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  DECISION_AUTHORITY,
  DECISION_CAUSATION,
  BUDGET_TRANSFER_FINANCE_THRESHOLD,
} from "./catalog.js";

export function checkInvariants(eventsOrState, { asOf = new Date().toISOString() } = {}) {
  const state = Array.isArray(eventsOrState) ? fold(eventsOrState) : eventsOrState;
  const findings = [];
  const err = (code, message, event_id = null, refs = null) => findings.push({ level: "error", code, message, event_id, refs });
  const warn = (code, message, event_id = null, refs = null) => findings.push({ level: "warning", code, message, event_id, refs });

  // 0) 归建期引用完整性
  for (const msg of state.foldErrors) err("BROKEN_REFERENCE", msg);

  // 1) 信封 / 目录合法性 + 流版本连续
  checkEnvelopeAndStreams(state, err);

  // 2) 幂等：重复申报不得二次受理、重复支付请求不得二次拨付
  checkIdempotency(state, err);

  // 3) 同一控制集团拆单复用支出
  checkExpenseSplitting(state, err, warn);

  // 4) 考核期锁定后不得再调整目标
  checkLockedPeriods(state, err);

  // 5) 决定链：权限、回避、因果、调剂、终止后拨付、追回
  checkDecisionChain(state, err);

  // 6) 支付护栏：迟报 / 重复证据不得拨付，合同与追回金额约束
  checkPayments(state, err, warn);

  // 7) 成果去重：同一成果只计算一次
  checkOutcomeDedup(state, err);

  // 8) 看板可信度
  checkCoverage(state, warn, asOf);

  return findings;
}

function checkEnvelopeAndStreams(state, err) {
  for (const e of state.events) {
    for (const msg of validateEvent(e)) err("ENVELOPE", msg, e.event_id);
    if (!EVENT_TYPES.includes(e.event_type)) err("UNKNOWN_EVENT_TYPE", `未知事件类型：${e.event_type}`, e.event_id);
    if (!AGGREGATE_TYPES.includes(e.aggregate_type)) err("UNKNOWN_AGGREGATE_TYPE", `未知聚合类型：${e.aggregate_type}`, e.event_id);
    const expectedAgg = EVENT_AGGREGATE[e.event_type];
    if (expectedAgg && e.aggregate_type !== expectedAgg) {
      err("AGGREGATE_MISMATCH", `${e.event_type} 必须挂在 ${expectedAgg} 上，实际为 ${e.aggregate_type}`, e.event_id);
    }
  }
  for (const [id, stream] of state.streams) {
    const versions = [...stream.byVersion.keys()].sort((a, b) => a - b);
    for (let i = 0; i < versions.length; i++) {
      if (versions[i] !== i + 1) {
        err("STREAM_VERSION_GAP", `聚合 ${id} 流版本不连续：期望 ${i + 1}，实际 ${versions[i]}`);
        break;
      }
    }
    const ordered = versions.map((v) => stream.byVersion.get(v));
    for (let i = 1; i < ordered.length; i++) {
      if (Date.parse(ordered[i].occurred_at) < Date.parse(ordered[i - 1].occurred_at)) {
        err("STREAM_TIME_REVERSED", `聚合 ${id} 的 v${ordered[i].version} 发生时间早于 v${ordered[i - 1].version}`, ordered[i].event_id);
      }
    }
  }
}

function checkIdempotency(state, err) {
  for (const [key, events] of state.idempotency) {
    const effectiveReceived = events.filter((e) => e.event_type === "APPLICATION_RECEIVED");
    if (effectiveReceived.length > 1) {
      err(
        "DUPLICATE_APPLICATION",
        `幂等键 ${key} 存在 ${effectiveReceived.length} 次有效受理，重复申报必须以 APPLICATION_DUPLICATE_REJECTED 拒绝，不得二次受理`,
        effectiveReceived[1].event_id,
        effectiveReceived.map((e) => e.event_id),
      );
    }
    const executed = events.filter((e) => e.event_type === "PAYMENT_EXECUTED");
    if (executed.length > 1) {
      err(
        "DOUBLE_PAYMENT",
        `幂等键 ${key} 存在 ${executed.length} 次拨付执行，同一支付请求不得二次拨付`,
        executed[1].event_id,
        executed.map((e) => e.event_id),
      );
    }
  }
}

function checkExpenseSplitting(state, err, warn) {
  for (const [indexKey, hits] of state.expenseIndex) {
    if (hits.length < 2) continue;
    const [groupId, periodId, itemKey] = indexKey.split("|");
    const live = hits.filter((h) => {
      const app = state.applications.get(h.application_id);
      return app && app.status !== "withdrawn";
    });
    const distinctStreams = new Set(live.map((h) => h.stream_id));
    if (live.length > 1 && distinctStreams.size > 1) {
      err(
        "SPLIT_EXPENSE",
        `控制集团 ${groupId} 在考核期 ${periodId} 把同一支出项 ${itemKey} 拆入 ${distinctStreams.size} 个专项资金且均未退出，构成重复申报资金`,
        live[live.length - 1].event_id,
        live.map((h) => ({ application_id: h.application_id, stream_id: h.stream_id, event_id: h.event_id })),
      );
    } else if (live.length > 1) {
      warn(
        "REPEATED_EXPENSE_SAME_STREAM",
        `控制集团 ${groupId} 在同一专项内重复列支 ${itemKey}，需人工核验`,
        live[live.length - 1].event_id,
      );
    }
  }
}

function checkLockedPeriods(state, err) {
  for (const e of state.events) {
    if (e.event_type !== "TARGET_ADJUSTED") continue;
    const period = state.periods.get(e.payload?.period_id);
    if (period?.locked && Date.parse(e.occurred_at) >= Date.parse(lockTime(state, period.period_id))) {
      err(
        "TARGET_ADJUSTED_AFTER_LOCK",
        `考核期 ${period.period_id}（${period.year} 年度）已锁定，跨年度调整只能作用于尚未锁定的考核期`,
        e.event_id,
      );
    }
  }
}

function lockTime(state, periodId) {
  const stream = state.streams.get(periodId);
  const lock = [...(stream?.byVersion.values() ?? [])].find((e) => e.event_type === "ASSESSMENT_PERIOD_LOCKED");
  return lock?.occurred_at ?? "9999-12-31T23:59:59Z";
}

function checkDecisionChain(state, err) {
  const decided = state.events.filter((e) => Object.hasOwn(DECISION_AUTHORITY, e.event_type));
  for (const e of decided) {
    const allowed = DECISION_AUTHORITY[e.event_type];
    if (!allowed.includes(e.actor_role)) {
      err(
        "DECISION_UNAUTHORIZED",
        `${e.event_type} 只能由 ${allowed.join(" / ")} 作出，实际角色为 ${e.actor_role ?? "未记录"}`,
        e.event_id,
      );
    }
    const requiredUpstreams = DECISION_CAUSATION[e.event_type];
    if (requiredUpstreams) {
      const upstream = e.causation_id ? state.byId.get(e.causation_id) : null;
      if (!upstream || !requiredUpstreams.includes(upstream.event_type)) {
        err(
          "DECISION_CAUSATION_INVALID",
          `决定 ${e.event_type} 缺少有效上游（需 ${requiredUpstreams.join(" / ")} 之一）`,
          e.event_id,
        );
      }
    }
  }

  // 评审回避：被派审专家与申报主体属同一控制集团，立项前必须已作出回避决定
  for (const app of state.applications.values()) {
    const appGroup = groupOf(state, app.lead_subject_id);
    for (const assignment of app.reviewers) {
      if (assignment.control_group_id && appGroup && assignment.control_group_id === appGroup) {
        const recused = app.recused_reviewer_ids.includes(assignment.reviewer_id);
        if (!recused && ["approved"].includes(app.status)) {
          err(
            "REVIEW_CONFLICT_NOT_RECUSED",
            `评审专家 ${assignment.reviewer_id} 与申报主体同属控制集团 ${appGroup}，未回避即进入立项`,
            app.approval_event_id,
          );
        }
      }
    }
  }

  // 预算调剂：累计调剂超批准总额阈值须财务处共同决定；不得超出批准总额
  for (const p of state.projects.values()) {
    if (p.transfer_total_wan > p.approved_wan + 1e-9) {
      err(
        "BUDGET_TRANSFER_OVER_LIMIT",
        `项目 ${p.project_id} 累计调剂 ${p.transfer_total_wan} 万元超过批准总额 ${p.approved_wan} 万元`,
      );
    }
    if (p.transfer_total_wan > p.approved_wan * BUDGET_TRANSFER_FINANCE_THRESHOLD + 1e-9) {
      const financeOk = [...state.decisions.values()].some(
        (d) => d.type === "BUDGET_TRANSFER_DECIDED" && d.payload?.project_id === p.project_id && d.actor_role === "PROVINCIAL_FINANCE_OFFICER" && d.payload?.approved,
      );
      if (!financeOk) {
        err(
          "BUDGET_TRANSFER_NEEDS_FINANCE",
          `项目 ${p.project_id} 调剂规模超过批准额 ${BUDGET_TRANSFER_FINANCE_THRESHOLD * 100}%，须财务处共同决定`,
        );
      }
    }
  }

  // 终止：决定后不得再拨付；追回：先有追回决定且不超额
  for (const p of state.projects.values()) {
    const term = [...state.decisions.values()].find((d) => d.type === "PROJECT_TERMINATION_DECIDED" && d.payload?.project_id === p.project_id);
    if (term) {
      for (const c of state.contracts.values()) {
        if (c.project_id !== p.project_id) continue;
        for (const pay of c.payments.values()) {
          if (pay.status === "executed") {
            const exec = state.byId.get(pay.effect_event_id);
            if (exec && Date.parse(exec.occurred_at) >= Date.parse(state.byId.get(term.event_id).occurred_at)) {
              err("PAYMENT_AFTER_TERMINATION", `项目 ${p.project_id} 终止后仍发生拨付（支付 ${pay.request_event_id}）`, pay.effect_event_id);
            }
          }
        }
      }
    }
    if (p.recovered_wan > p.recovery_decided_wan + 1e-9) {
      err(
        "RECOVERY_OVER_DECIDED",
        `项目 ${p.project_id} 已追回 ${p.recovered_wan} 万元，超过追回决定额 ${p.recovery_decided_wan} 万元`,
      );
    }
  }
  for (const e of state.events) {
    if (e.event_type !== "FUNDS_RECOVERED") continue;
    // FUNDS_RECOVERED 挂在 funded_project 聚合上，前置必须有同项目的追回决定
    const hasDecision = [...state.decisions.values()].some(
      (d) => d.type === "FUNDS_RECOVERY_DECIDED" && d.payload?.project_id === e.aggregate_id,
    );
    if (!hasDecision) err("RECOVERY_WITHOUT_DECISION", `资金追回执行 ${e.event_id} 缺少前置追回决定`, e.event_id);
  }
}

function checkPayments(state, err, warn) {
  for (const contract of state.contracts.values()) {
    let executedTotal = 0;
    for (const pay of contract.payments.values()) {
      if (pay.status === "executed") executedTotal += pay.amount_wan;

      for (const evId of pay.evidence_ids) {
        const pack = state.evidences.get(evId);
        if (!pack) {
          err("PAYMENT_EVIDENCE_MISSING", `支付 ${pay.request_event_id} 引用的证据 ${evId} 不存在`, pay.request_event_id);
          continue;
        }
        // 重复上传的材料不得作为拨付依据
        if (pack.deduped_files.length > 0 && pay.status === "executed") {
          err(
            "PAYMENT_ON_DUPLICATE_EVIDENCE",
            `支付 ${pay.request_event_id} 以重复上传的材料为依据（首见 ${pack.deduped_files[0].first_evidence_id}），不得二次拨付`,
            pay.effect_event_id,
          );
        }
        // 迟报：材料晚于所对应里程碑到期日，且该里程碑未在提交前获批延期
        if (pack.milestone_code) {
          const project = state.projects.get(pay.project_id ?? pack.project_id);
          const m = project?.milestones.get(pack.milestone_code);
          if (m) {
            const submittedAt = Date.parse(state.byId.get(pack.submitted_event_id).occurred_at);
            const due = Date.parse(m.due_date);
            const delayApprovedBefore = m.delay_event_id && Date.parse(state.byId.get(m.delay_event_id).occurred_at) <= submittedAt;
            if (submittedAt > due && !delayApprovedBefore && pay.status === "executed") {
              err(
                "PAYMENT_ON_LATE_EVIDENCE",
                `里程碑 ${m.code} 证据迟报（${pack.submitted_event_id}）且无在先延期批准，不得据此拨付`,
                pay.effect_event_id,
              );
            }
          }
        }
      }
    }
    const project = state.projects.get(contract.project_id);
    if (project && executedTotal > project.approved_wan + 1e-9) {
      err(
        "PAYMENT_OVER_APPROVED",
        `项目 ${project.project_id} 合同累计拨付 ${executedTotal} 万元超过批准额 ${project.approved_wan} 万元`,
      );
    }
    // 已决定追回的金额不得再次流出口袋
    if (project && executedTotal > project.approved_wan - project.recovery_decided_wan + 1e-9 && project.recovery_decided_wan > 0) {
      warn(
        "PAYMENT_WITH_RECOVERY_GAP",
        `项目 ${project.project_id} 拨付余额未扣除已决定追回 ${project.recovery_decided_wan} 万元，请核对追缴路径`,
      );
    }
  }
}

function checkOutcomeDedup(state, err) {
  for (const [key, claims] of state.resultIndex) {
    const distinctProjects = new Set(claims.map((c) => c.project_id));
    if (distinctProjects.size > 1) {
      err(
        "OUTCOME_DOUBLE_COUNTED",
        `指标成果 ${key} 被 ${distinctProjects.size} 个项目重复计绩，同一成果只能计算一次（应追加 OUTCOME_DEDUPLICATED）`,
        claims[claims.length - 1].event_id,
        claims.map((c) => ({ project_id: c.project_id, evidence_id: c.evidence_id })),
      );
    }
  }
}

function checkCoverage(state, warn, asOf) {
  const asOfMs = Date.parse(asOf);
  for (const p of state.projects.values()) {
    if (!p.regions.length) warn("NO_BENEFIT_REGION", `项目 ${p.project_id} 未登记受益区域，无法纳入城乡缺口口径`, p.approval_event_id);
    if (p.status !== "active") continue;
    for (const m of p.milestones.values()) {
      if (!m.verified_event_id && Date.parse(m.due_date) < asOfMs) {
        warn("MILESTONE_OVERDUE", `项目 ${p.project_id} 里程碑 ${m.code} 已逾期未核验`, m.delay_event_id);
      }
    }
  }
}
