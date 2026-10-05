import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fold } from "../src/state.js";
import { publishSummary } from "../src/public-view.js";

async function sampleState() {
  return fold(JSON.parse(await readFile(new URL("../data/sample-events.json", import.meta.url), "utf8")));
}

test("公开汇总：小样本单元格全部抑制（k-匿名+主导份额），不含主体/项目维度", async () => {
  const state = await sampleState();
  const pub = publishSummary(state);
  assert.ok(pub.funding_by_stream_year.length > 0);
  for (const cell of pub.funding_by_stream_year) {
    assert.equal(cell.published, false);
    assert.ok(cell.suppression_reasons.length > 0);
    assert.equal(cell.control_group_id, undefined);
    assert.equal(cell.project_id, undefined);
  }
});

test("公开汇总：达到 k=3 且无主导主体时发布，并按步长舍入", async () => {
  const state = await sampleState();
  // 构造同一单元格中三个独立集团、份额均衡的项目（2026 城区、科技融合）
  for (const [i, sid] of ["S-A", "S-B", "S-C"].entries()) {
    state.subjects.set(sid, { subject_id: sid, name: sid, control_group_id: `G-${sid}` });
    state.projects.set(`PRJ-PUB-${i}`, {
      project_id: `PRJ-PUB-${i}`,
      application_id: `APP-PUB-${i}`,
      stream_id: "stream-tech",
      goal_id: "goal-155-culture",
      period_id: "period-2026",
      lead_subject_id: sid,
      co_subject_ids: [],
      approved_wan: 333,
      regions: ["510100"],
      milestones: new Map(),
      status: "active",
      contract_id: null,
      transfer_total_wan: 0,
      recovery_decided_wan: 0,
      recovered_wan: 0,
      approval_event_id: null,
    });
  }
  const pub = publishSummary(state, { minSubjects: 3, maxDominance: 0.65, amountStepWan: 100, countStep: 5 });
  const cell = pub.funding_by_stream_year.find((c) => c.dim_a === "stream-tech" && c.urban_class === "urban");
  assert.equal(cell.published, true);
  assert.equal(cell.independent_subjects, 4); // 同路 + 3 个新增独立集团
  assert.equal(cell.amount_wan, 1300); // 350（同路城区）+ 333×3 = 1349，按100万舍入
  assert.equal(cell.project_count, 5); // 4 个项目按 5 的倍数舍入
  assert.equal(cell.project_id, undefined);
});

test("公开汇总：主导份额超限时即使主体数达标也抑制", async () => {
  const state = await sampleState();
  // 同一城区文旅单元格：一家主导380万 + 三家各10万，k=4 达标但主导份额 380/410≈93%
  const mk = (sid, amount) => {
    state.subjects.set(sid, { subject_id: sid, name: sid, control_group_id: `G-${sid}` });
    state.projects.set(`PRJ-DOM-${sid}`, {
      project_id: `PRJ-DOM-${sid}`,
      stream_id: "stream-tour",
      period_id: "period-2026",
      lead_subject_id: sid,
      co_subject_ids: [],
      approved_wan: amount,
      regions: ["510200"],
      milestones: new Map(),
      status: "active",
      transfer_total_wan: 0,
      recovery_decided_wan: 0,
      recovered_wan: 0,
    });
  };
  mk("S-BIG", 380);
  mk("S-D", 10);
  mk("S-E", 10);
  mk("S-F", 10);
  const pub = publishSummary(state);
  const cell = pub.funding_by_stream_year.find((c) => c.dim_a === "stream-tour" && c.urban_class === "urban");
  assert.equal(cell.published, false);
  assert.ok(cell.suppression_reasons.some((r) => r.includes("主导主体份额")));
});
