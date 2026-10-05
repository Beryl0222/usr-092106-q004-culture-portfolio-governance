/**
 * 违规场景：每个场景由合法主线事件流派生或独立构造，
 * fold 后必须在 rejected 中出现预期错误（子串匹配）。
 */
import { buildPortfolio } from "./portfolio-events.js";

const clone = (events) => events.map((e) => structuredClone(e));
const byId = (events, id) => events.find((e) => e.event_id === id);

function drop(events, eventId) {
  return clone(events.filter((e) => e.event_id !== eventId));
}

function mapEvent(events, eventId, fn) {
  const copy = clone(events);
  fn(byId(copy, eventId));
  return copy;
}

export const violationScenarios = [
  {
    name: "立项生效缺少治理决定（G5）",
    events: drop(buildPortfolio(), "evt-dec-review-01"),
    expect: ["引用的决定 evt-dec-review-01 不存在"],
  },
  {
    name: "资金部门越权作出立项审查决定（G5）",
    events: mapEvent(buildPortfolio(), "evt-dec-review-01", (e) => {
      e.payload.actor_role = "FINANCE_DEPARTMENT";
    }),
    expect: ["FUNDING_REVIEW 只能由 REVIEW_COMMITTEE 作出"],
  },
  {
    name: "已回避评审人进入委员会名单",
    events: mapEvent(buildPortfolio(), "evt-dec-review-01", (e) => {
      e.payload.committee = ["rev-li", "rev-zhang"];
    }),
    expect: ["已回避评审人 rev-zhang 不得参与该申报决定"],
  },
  {
    name: "拆单标记未裁决即立项（G4）",
    events: drop(buildPortfolio(), "evt-dec-dup-01"),
    expect: ["存在未裁决的拆单标记，不得立项"],
  },
  {
    name: "同一幂等键二次出账（G7）",
    events: (() => {
      const stream = clone(buildPortfolio());
      const first = byId(stream, "evt-pay-001-released");
      stream.push({
        ...structuredClone(first),
        event_id: "evt-pay-dup",
        aggregate_id: "pay-dup-attack",
        version: 1,
        occurred_at: "2027-05-01T10:00:00.000Z",
        summary: "重复出账尝试",
        payload: { ...first.payload, request_no: "REQ-DUP" },
      });
      return stream;
    })(),
    expect: ["idempotency_key 已出账，拒绝二次拨付"],
  },
  {
    name: "里程碑未核验即拨付（G8）",
    events: (() => {
      const stream = clone(buildPortfolio());
      const ctrIdx = stream.findIndex(
        (e) => e.event_type === "CONTRACT_SIGNED" && e.aggregate_id === "ctr-001",
      );
      const head = stream.slice(0, ctrIdx + 1);
      head.push({
        event_id: "evt-pay-early",
        event_type: "PAYMENT_RELEASED",
        aggregate_type: "payment",
        aggregate_id: "pay-early",
        occurred_at: "2026-10-01T10:00:00.000Z",
        version: 1,
        summary: "里程碑未核验的提前拨付",
        payload: {
          contract_no: "CTR-2026-001",
          milestone_code: "ms-1",
          amount: 320_000,
          currency: "CNY",
          payee_account: "紫申数字 基本户 0002",
          idempotency_key: "pay:CTR-2026-001:ms-1:320000:0002:early",
        },
      });
      return head;
    })(),
    expect: ["里程碑 ms-1 未核验，不得拨付"],
  },
  {
    name: "合同额超过已落实预算（G6）",
    events: (() => {
      const es = clone(buildPortfolio());
      const ctr = es.find((e) => e.event_type === "CONTRACT_SIGNED" && e.aggregate_id === "ctr-001");
      ctr.payload.amount = 900_000;
      return es;
    })(),
    expect: ["合同额 900000 超过已落实预算 800000"],
  },
  {
    name: "已锁定考核期的指标调整被拒绝（G2）",
    events: [
      {
        event_id: "evt-g2-open",
        event_type: "ASSESSMENT_PERIOD_OPENED",
        aggregate_type: "assessment_period",
        aggregate_id: "p-2026",
        occurred_at: "2026-01-01T00:00:00.000Z",
        version: 1,
        summary: "开启考核期",
        payload: { period_code: "2026" },
      },
      {
        event_id: "evt-g2-set",
        event_type: "ANNUAL_TARGET_SET",
        aggregate_type: "annual_target",
        aggregate_id: "t-1",
        occurred_at: "2026-01-02T00:00:00.000Z",
        version: 1,
        summary: "设定指标",
        payload: { period_code: "2026" },
      },
      {
        event_id: "evt-g2-lock",
        event_type: "ASSESSMENT_PERIOD_LOCKED",
        aggregate_type: "assessment_period",
        aggregate_id: "p-2026",
        occurred_at: "2026-01-03T00:00:00.000Z",
        version: 2,
        summary: "锁定考核期",
        payload: { period_code: "2026", locked_by: "planning" },
      },
      {
        event_id: "evt-g2-dec",
        event_type: "REVIEW_DECISION_RECORDED",
        aggregate_type: "governance_decision",
        aggregate_id: "dec-g2",
        occurred_at: "2026-01-04T00:00:00.000Z",
        version: 1,
        summary: "规划处调整决定",
        payload: {
          decision_type: "TARGET_ADJUSTMENT",
          result: "APPROVED",
          subject_id: "t-1",
          actor_id: "planning",
          actor_role: "PLANNING_DEPARTMENT",
        },
      },
      {
        event_id: "evt-g2-adj",
        event_type: "ANNUAL_TARGET_ADJUSTED",
        aggregate_type: "annual_target",
        aggregate_id: "t-1",
        occurred_at: "2026-01-05T00:00:00.000Z",
        version: 2,
        summary: "对已锁定期调整",
        causation_id: "evt-g2-dec",
        payload: { new_value: 1, former_value: 0, effective_from: "2026-01-01" },
      },
    ],
    expect: ["考核期 2026 已锁定，调整不得回溯"],
  },
  {
    name: "同一成果在同指标+考核期重复计量（G9）",
    events: clone(buildPortfolio()).filter((e) => e.event_type !== "OUTCOME_DEDUP_RESOLVED"),
    expect: ["同一成果在同指标+考核期内重复计量"],
  },
  {
    name: "公开汇总存在小群体格且差分检查未过（G11）",
    events: (() => {
      const es = clone(buildPortfolio());
      const rel = es.find((e) => e.event_type === "PUBLIC_SUMMARY_RELEASED");
      rel.payload.cells[0].beneficiary_count = 1;
      rel.payload.diff_check_passed = false;
      return es;
    })(),
    expect: ["低于阈值 3", "跨批差分检查未通过"],
  },
  {
    name: "聚合版本不连续被拒绝",
    events: [
      {
        event_id: "evt-v1",
        event_type: "ASSESSMENT_PERIOD_OPENED",
        aggregate_type: "assessment_period",
        aggregate_id: "p-x",
        occurred_at: "2026-01-01T00:00:00.000Z",
        version: 1,
        summary: "v1",
        payload: { period_code: "x" },
      },
      {
        event_id: "evt-v3",
        event_type: "ASSESSMENT_PERIOD_LOCKED",
        aggregate_type: "assessment_period",
        aggregate_id: "p-x",
        occurred_at: "2026-01-02T00:00:00.000Z",
        version: 3,
        summary: "v3 跳号",
        payload: { locked_by: "x" },
      },
    ],
    expect: ["version 不连续：期望 2，实际 3"],
  },
  {
    name: "追回金额超过已拨未追回余额",
    events: (() => {
      const es = clone(buildPortfolio());
      const rec = es.find((e) => e.event_type === "FUNDS_RECOVERED" && e.aggregate_id === "prj-002");
      rec.payload.amount = 200_001;
      return es;
    })(),
    expect: ["追回 200001 超过已拨未追回余额 200000"],
  },
];
