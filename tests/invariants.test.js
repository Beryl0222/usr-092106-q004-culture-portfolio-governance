import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fold } from "../src/state.js";
import { checkInvariants } from "../src/invariants.js";

const AS_OF = "2027-03-10T00:00:00+08:00";

async function loadSample() {
  return JSON.parse(await readFile(new URL("../data/sample-events.json", import.meta.url), "utf8"));
}

function check(events) {
  return checkInvariants(fold(events), { asOf: AS_OF });
}

const without = (events, ids) => events.filter((e) => !ids.includes(e.event_id));
const byId = (events, id) => events.find((e) => e.event_id === id);

test("样例事件流不产生任何硬性违规", async () => {
  const events = await loadSample();
  const errors = check(events).filter((f) => f.level === "error");
  assert.deepEqual(errors, []);
});

test("同一控制集团跨专项拆单：撤回后合规；未撤回即报 SPLIT_EXPENSE", async () => {
  const events = without(await loadSample(), ["E031"]); // 去掉撤回
  const findings = check(events).filter((f) => f.code === "SPLIT_EXPENSE");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /EXP-AIGC-CLUSTER/);
});

test("重复受理同一申报：DUPLICATE_APPLICATION", async () => {
  const events = [...(await loadSample())];
  events.push({
    event_id: "X-DUP-APP",
    event_type: "APPLICATION_RECEIVED",
    aggregate_type: "funding_application",
    aggregate_id: "APP-XH-TECH-COPY",
    occurred_at: "2026-02-17T10:00:00+08:00",
    version: 1,
    summary: "同幂等键再次受理（违规构造）",
    idempotency_key: "IDEMP-APP-XH-001",
    payload: { stream_id: "stream-overseas", period_id: "period-2026", lead_subject_id: "S-XINGHAN-DIGITAL", expense_items: [{ item_key: "EXP-AIGC-CLUSTER" }] },
  });
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("DUPLICATE_APPLICATION"));
});

test("同一支付请求二次拨付：DOUBLE_PAYMENT", async () => {
  const events = [...(await loadSample())];
  events.push({
    event_id: "X-DBL-PAY",
    event_type: "PAYMENT_EXECUTED",
    aggregate_type: "contract_payment",
    aggregate_id: "C-QL-COUNTY",
    occurred_at: "2027-01-05T10:00:00+08:00",
    version: 6,
    summary: "重复拨付（违规构造）",
    idempotency_key: "IDEMP-PAY-C-QL-M1",
    payload: { request_event_id: "E059", amount_wan: 120 },
  });
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("DOUBLE_PAYMENT"));
});

test("考核期锁定后调整目标：TARGET_ADJUSTED_AFTER_LOCK", async () => {
  const events = [...(await loadSample())];
  events.push({
    event_id: "X-ADJ-LOCKED",
    event_type: "TARGET_ADJUSTED",
    aggregate_type: "policy_goal",
    aggregate_id: "goal-155-culture",
    occurred_at: "2027-12-05T09:00:00+08:00",
    version: 12,
    summary: "锁定后调整2026指标（违规构造）",
    actor_role: "PROVINCIAL_PLAN_OFFICER",
    causation_id: "E008",
    payload: { period_id: "period-2026", metric_id: "M-COUNTY-01", new_value: 1000 },
  });
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("TARGET_ADJUSTED_AFTER_LOCK"));
});

test("未锁定年度的目标调整允许；锁定不追溯往期", async () => {
  const events = await loadSample();
  const state = fold(events);
  assert.equal(state.periods.get("period-2026").targets.get("M-COUNTY-01").value, 800);
  assert.equal(state.periods.get("period-2027").targets.get("M-COUNTY-01").value, 950);
});

test("越权决定与缺失/错误上游：DECISION_UNAUTHORIZED / DECISION_CAUSATION_INVALID", async () => {
  const events = [...(await loadSample())];
  events.push({
    event_id: "X-UNAUTH",
    event_type: "BUDGET_TRANSFER_DECIDED",
    aggregate_type: "decision_record",
    aggregate_id: "X-DEC-1",
    occurred_at: "2026-06-05T15:00:00+08:00",
    version: 1,
    summary: "企业自行批准调剂（违规构造）",
    actor_role: "APPLICANT",
    causation_id: "E047",
    payload: { project_id: "PRJ-XH-TECH", approved: true, amount_wan: 0 },
  });
  events.push({
    event_id: "X-BADCAUSE",
    event_type: "MILESTONE_DELAY_DECIDED",
    aggregate_type: "decision_record",
    aggregate_id: "X-DEC-2",
    occurred_at: "2027-02-04T15:00:00+08:00",
    version: 1,
    summary: "延期决定挂错上游（违规构造）",
    actor_role: "PROVINCIAL_PLAN_OFFICER",
    causation_id: "E001",
    payload: { project_id: "PRJ-XH-TECH", milestone_code: "M2", approved: false },
  });
  const findings = check(events);
  assert.ok(findings.some((f) => f.code === "DECISION_UNAUTHORIZED" && f.event_id === "X-UNAUTH"));
  assert.ok(findings.some((f) => f.code === "DECISION_CAUSATION_INVALID" && f.event_id === "X-BADCAUSE"));
});

test("评审专家未回避即立项：REVIEW_CONFLICT_NOT_RECUSED", async () => {
  const events = without(await loadSample(), ["E033"]); // 去掉回避决定
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("REVIEW_CONFLICT_NOT_RECUSED"));
});

test("大额调剂缺少财务处共同决定：BUDGET_TRANSFER_NEEDS_FINANCE", async () => {
  const events = without(await loadSample(), ["E050"]);
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("BUDGET_TRANSFER_NEEDS_FINANCE"));
});

test("迟报材料不得拨付：PAYMENT_ON_LATE_EVIDENCE", async () => {
  const events = [...(await loadSample())];
  // 原本被阻断（E063 PAYMENT_BLOCKED），变异为违规拨付
  byId(events, "E063").event_type = "PAYMENT_EXECUTED";
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("PAYMENT_ON_LATE_EVIDENCE"));
});

test("重复上传材料不得拨付：PAYMENT_ON_DUPLICATE_EVIDENCE", async () => {
  const events = [...(await loadSample())];
  events.push(
    {
      event_id: "X-PAYREQ-DUP",
      event_type: "PAYMENT_REQUESTED",
      aggregate_type: "contract_payment",
      aggregate_id: "C-XH-TECH",
      occurred_at: "2026-09-05T10:00:00+08:00",
      version: 4,
      summary: "以重复材料申请拨付（违规构造）",
      idempotency_key: "IDEMP-PAY-C-XH-DUP",
      payload: { project_id: "PRJ-XH-TECH", phase: "补充", amount_wan: 30, evidence_ids: ["EV-XH-M1-DUP"] },
    },
    {
      event_id: "X-PAYEXEC-DUP",
      event_type: "PAYMENT_EXECUTED",
      aggregate_type: "contract_payment",
      aggregate_id: "C-XH-TECH",
      occurred_at: "2026-09-09T10:00:00+08:00",
      version: 5,
      summary: "对重复材料放款（违规构造）",
      idempotency_key: "IDEMP-PAY-C-XH-DUP",
      payload: { request_event_id: "X-PAYREQ-DUP", amount_wan: 30 },
    },
  );
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("PAYMENT_ON_DUPLICATE_EVIDENCE"));
});

test("终止后不得拨付：PAYMENT_AFTER_TERMINATION", async () => {
  const events = [...(await loadSample())];
  events.push(
    {
      event_id: "X-PAYREQ-AFTER",
      event_type: "PAYMENT_REQUESTED",
      aggregate_type: "contract_payment",
      aggregate_id: "C-TL-TECH",
      occurred_at: "2026-11-10T10:00:00+08:00",
      version: 6,
      summary: "终止后申请拨付（违规构造）",
      idempotency_key: "IDEMP-PAY-C-TL-POST",
      payload: { project_id: "PRJ-TL-TECH", phase: "尾款", amount_wan: 50, evidence_ids: [] },
    },
    {
      event_id: "X-PAYEXEC-AFTER",
      event_type: "PAYMENT_EXECUTED",
      aggregate_type: "contract_payment",
      aggregate_id: "C-TL-TECH",
      occurred_at: "2026-11-12T10:00:00+08:00",
      version: 7,
      summary: "终止后放款（违规构造）",
      idempotency_key: "IDEMP-PAY-C-TL-POST",
      payload: { request_event_id: "X-PAYREQ-AFTER", amount_wan: 50 },
    },
  );
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("PAYMENT_AFTER_TERMINATION"));
});

test("同一成果重复计绩：OUTCOME_DOUBLE_COUNTED；追加去重事件后消除", async () => {
  const dup = check(without(await loadSample(), ["E076"])).some((f) => f.code === "OUTCOME_DOUBLE_COUNTED");
  assert.ok(dup);
  const clean = check(await loadSample()).some((f) => f.code === "OUTCOME_DOUBLE_COUNTED");
  assert.equal(clean, false);
});

test("追回执行必须有前置追回决定：RECOVERY_WITHOUT_DECISION", async () => {
  const events = without(await loadSample(), ["E072"]);
  const codes = check(events).map((f) => f.code);
  assert.ok(codes.includes("RECOVERY_WITHOUT_DECISION"));
});

test("政策更名保留原批复口径；专项更名保留原名", async () => {
  const state = fold(await loadSample());
  const goal = state.goals.get("goal-155-culture");
  assert.equal(goal.current_name, "文化强省“十五五”建设目标");
  assert.equal(goal.original_name, "文化产业“十五五”高质量发展目标");
  assert.equal(goal.original_approval_no, "川文规〔2026〕1号");
  const stream = state.fundingStreams.get("stream-tour");
  assert.equal(stream.current_name, "文旅融合协同专项");
  assert.equal(stream.original_name, "文旅协同发展专项");
});
