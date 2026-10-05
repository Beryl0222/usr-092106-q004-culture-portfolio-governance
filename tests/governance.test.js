import assert from "node:assert/strict";
import test from "node:test";

import { buildPortfolio } from "../data/samples/portfolio-events.js";
import { violationScenarios } from "../data/samples/violations.js";
import { applicantView, controlClosure, fold } from "../src/portfolio.js";
import { validateEvent } from "../src/validator.js";

function foldMain() {
  return fold(buildPortfolio());
}

test("主线端到端事件流全部被接收，零拒绝", () => {
  const { rejected } = foldMain();
  assert.deepEqual(rejected, [], rejected.map((r) => `${r.event_id}: ${r.errors.join("; ")}`).join("\n"));
});

test("每条主线事件都满足基础信封契约", () => {
  for (const event of buildPortfolio()) {
    assert.deepEqual(validateEvent(event), []);
  }
});

test("G3：控制关系闭包穿透全资子公司；关系失效后闭包收缩", () => {
  const { state } = foldMain();
  const closure = controlClosure(
    "app-zishen",
    state.controlEdges,
    "2026-09-03T10:00:00+08:00",
  );
  assert.deepEqual([...closure].sort(), ["app-jiasheng", "app-zishen"]);

  // 控制关系在 2025 年失效：2026 年求值时闭包只剩自身
  const retracted = state.controlEdges.map((e) => ({ ...e, valid_to: "2025-01-01" }));
  const shrunk = controlClosure("app-zishen", retracted, "2026-09-03T10:00:00+08:00");
  assert.deepEqual([...shrunk], ["app-zishen"]);
});

test("G4/G5：拆单经委员会认定并撤回后，立项才生效；立项引用审查决定", () => {
  const { state } = foldMain();
  assert.equal(state.applications.get("apl-001").approved, true);
  assert.equal(state.applications.get("apl-002")?.approved, false); // 已撤回，不立项
  assert.notEqual(state.applications.get("apl-002")?.rejected, true);
});

test("G6：预算闭合，合同与累计支付不超过落实预算", () => {
  const { state } = foldMain();
  const p1 = state.projects.get("prj-001");
  assert.equal(p1.secured, 800_000);
  assert.equal(p1.released, 800_000);
  const c1 = state.contracts.get("CTR-2026-001");
  assert.equal(c1.released, 800_000);
  assert.ok(c1.released <= c1.amount);
});

test("G7：迟报重复上传不产生二次拨付，阻断留痕", () => {
  const { state, accepted } = foldMain();
  const releases = accepted.filter((e) => e.event_type === "PAYMENT_RELEASED");
  assert.equal(releases.length, 3);
  assert.equal(state.seenPaymentKeys.size, 4); // 3 笔出账 + 1 笔追回
  const blocked = accepted.filter((e) => e.event_type === "PAYMENT_BLOCKED");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].payload.reason, "DUPLICATE_KEY");
  // 紫申合同累计出账仍是一笔 32 万 + 一笔 48 万，没有变成 64 万
  assert.equal(state.contracts.get("CTR-2026-001").released, 800_000);
});

test("G8：终止项目的追回金额不超过已拨未追回余额", () => {
  const { state } = foldMain();
  const p2 = state.projects.get("prj-002");
  assert.equal(p2.terminated, true);
  assert.equal(p2.released, 200_000);
  assert.equal(p2.recovered, 200_000);
});

test("G9：两个项目以不同成果共同贡献同一指标；重复成果经裁决只计一次", () => {
  const { state } = foldMain();
  const active = state.contributions.filter((c) => !c.duplicate);
  assert.equal(active.length, 2);
  const keys = active.map((c) => c.key);
  assert.ok(keys.some((k) => k.endsWith("oc-expo-system")));
  assert.ok(keys.some((k) => k.endsWith("oc-tour-fair")));
  assert.ok(!keys.some((k) => k.includes("prj-002") && k.endsWith("oc-expo-system")));
});

test("G1/G2：更名不改写原事件；调整只作用于未锁定考核期", () => {
  const events = buildPortfolio();
  const defined = events.find((e) => e.event_type === "PLAN_GOAL_DEFINED");
  assert.equal(defined.payload.goal_name, "县域居民文化消费规模");
  assert.equal(defined.payload.definition_snapshot.basis_doc_no, "省文旅规划〔2026〕12号");

  const { state } = foldMain();
  assert.equal(state.periods.get("2026").locked, true);
  assert.equal(state.periods.get("2027").locked, false);
});

test("G11：公开发布只含达标汇总格并带差分检查结论", () => {
  const { state } = foldMain();
  const release = state.publicReleases[0];
  assert.equal(release.diff_check_passed, true);
  assert.ok(release.cells.every((c) => c.beneficiary_count >= release.min_group_size));
});

test("企业侧视图：紫申只能看到自身申报/证据/支付与结论反馈，看不到他人信息与评审人身份", () => {
  const events = foldMain().accepted;
  const view = applicantView(events, "app-zishen", new Set(["紫申数字 基本户 0002"]));
  const json = JSON.stringify(view);

  const aplIds = new Set(
    view.applications
      .filter((a) => a.event_type === "APPLICATION_RECEIVED")
      .map((a) => a.event_id),
  );
  assert.ok(aplIds.has("evt-apl-001-received"));
  assert.ok(!json.includes("apl-003"));
  assert.ok(!json.includes("apl-003"));
  assert.ok(!json.includes("app-bing"));
  assert.ok(!json.includes("app-ding"));
  assert.ok(!json.includes("rev-zhang"));
  assert.ok(!json.includes("rev-li"));
  assert.ok(!json.includes("丙地 基本户 0007"));

  // 查重反馈可见事实与规则，但命中明细不投影
  const flagged = view.applications.find((a) => a.event_type === "APPLICATION_DUPLICATE_FLAGGED");
  assert.ok(flagged);
  assert.equal(flagged.payload.matched_pairs, undefined);
  assert.equal(flagged.payload.control_path, undefined);

  // 证据状态：重复票据被拒、标记迟报且记录了重复命中
  const dup = view.evidence.find((e) => e.evidence_id === "evd-002");
  assert.equal(dup.status, "REJECTED");
  assert.equal(dup.late, true);
  assert.equal(dup.duplicate_matched, true);

  // 只能看到与自己账户相关的支付结果（含阻断原因），看不到丙地出账
  const payAccounts = view.payments.map((p) => p.event_id);
  assert.ok(payAccounts.length >= 2);
  assert.ok(JSON.stringify(view.payments).includes("DUPLICATE_KEY"));
});

test("全部违规场景都被折叠器拒绝并命中预期规则", () => {
  for (const scenario of violationScenarios) {
    const { rejected } = fold(scenario.events);
    const allMessages = rejected.flatMap((r) => r.errors);
    for (const expected of scenario.expect) {
      assert.ok(
        allMessages.some((m) => m.includes(expected)),
        `场景「${scenario.name}」缺少预期错误「${expected}」，实际：\n${allMessages.join("\n")}`,
      );
    }
  }
});
