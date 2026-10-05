import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fold } from "../src/state.js";
import { fundingConcentration, urbanRuralGap, milestoneRisks } from "../src/read-models.js";

const AS_OF = "2027-03-10T00:00:00+08:00";

async function sampleState() {
  return fold(JSON.parse(await readFile(new URL("../data/sample-events.json", import.meta.url), "utf8")));
}

test("资金集中：科技融合专项按控制集团穿透，星瀚集团份额60%触发预警", async () => {
  const state = await sampleState();
  const view = fundingConcentration(state, { period_id: "period-2026" });
  const tech = view.rows.find((r) => r.stream_id === "stream-tech");
  assert.equal(tech.approved_total_wan, 850); // 星瀚500 + 同路350
  assert.equal(tech.executed_total_wan, 270); // 200 + 70
  assert.equal(tech.distinct_groups, 2);
  assert.equal(tech.top_share, 0.6);
  assert.equal(tech.concentration_alert, true);
});

test("资金集中可下钻：集团 → 项目 → 申报/合同支付 → 证据 → 事件链", async () => {
  const state = await sampleState();
  const tech = fundingConcentration(state, { period_id: "period-2026" }).rows.find((r) => r.stream_id === "stream-tech");
  const xh = tech.groups.find((g) => g.control_group_id === "G-XINGHAN");
  assert.equal(xh.projects.length, 1);
  const proj = xh.projects[0];
  assert.equal(proj.project_id, "PRJ-XH-TECH");
  assert.equal(proj.application_id, "APP-XH-TECH");
  assert.deepEqual(proj.payment_request_ids, ["E055"]);
  assert.ok(proj.evidence_ids.includes("EV-XH-M1"));
  assert.ok(proj.trace.event_ids.includes("E023")); // 申报受理
  assert.ok(proj.trace.event_ids.includes("E056")); // 拨付到账
});

test("城乡缺口：成果按区域份额分摊；联合展销只计一次（470而非620）", async () => {
  const state = await sampleState();
  const county = urbanRuralGap(state, { period_id: "period-2026" }).rows.find((r) => r.metric_id === "M-COUNTY-01");
  assert.equal(county.achieved_total, 470); // 320 + 150（远山重复的150被去重）
  assert.equal(county.achieved_urban, 0);
  assert.equal(county.achieved_rural, 470);
  assert.equal(county.gap_total, 330);
  assert.equal(county.original_approval_no, "川文规〔2026〕1号"); // 更名后原批复仍在
});

test("城乡缺口：一个项目可共同贡献两个指标", async () => {
  const state = await sampleState();
  const rows = urbanRuralGap(state, { period_id: "period-2026" }).rows;
  const tour = rows.find((r) => r.metric_id === "M-TOUR-01");
  assert.equal(tour.achieved_total, 340); // 青岚80 + 远山260
});

test("里程碑风险：终止项目不计；延期批准更新到期日；逾期分级", async () => {
  const state = await sampleState();
  const risks = milestoneRisks(state, { asOf: AS_OF });
  const tl = risks.rows.find((r) => r.project_id === "PRJ-TL-TECH");
  assert.equal(tl, undefined); // 已终止
  const xh2 = risks.rows.find((r) => r.project_id === "PRJ-XH-TECH" && r.milestone_code === "M2");
  assert.equal(xh2.risk, "on_track"); // 已延期到 2027-06-30
  assert.equal(xh2.delay_approved, true);
  assert.ok(xh2.trace.event_ids.includes("E092")); // 延期决定可溯源
});
