import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fold } from "../src/state.js";
import { viewerFor, canSeeApplication, canSeeProject, canSeeEvidence, applicantDesk, filterEvents } from "../src/access.js";

async function sampleState() {
  return fold(JSON.parse(await readFile(new URL("../data/sample-events.json", import.meta.url), "utf8")));
}

test("企业只能看到自身申报：星瀚可见母公司与控股子公司项目，看不到他人", async () => {
  const state = await sampleState();
  const v = viewerFor("APPLICANT", { subject_id: "S-XINGHAN-DIGITAL" });
  assert.equal(canSeeApplication(state, v, state.applications.get("APP-XH-TECH")), true);
  assert.equal(canSeeApplication(state, v, state.applications.get("APP-XH-COUNTY")), true); // 同集团
  assert.equal(canSeeApplication(state, v, state.applications.get("APP-QL-COUNTY")), false);
  assert.equal(canSeeProject(state, v, state.projects.get("PRJ-YS-TOUR")), false);
});

test("联合申报参与方可看联合项目", async () => {
  const state = await sampleState();
  const v = viewerFor("APPLICANT", { subject_id: "S-HM" });
  assert.equal(canSeeProject(state, v, state.projects.get("PRJ-YS-TOUR")), true);
  assert.equal(canSeeProject(state, v, state.projects.get("PRJ-QL-COUNTY")), false);
});

test("企业桌面只含自身申报与反馈；回避反馈不披露专家身份", async () => {
  const state = await sampleState();
  const v = viewerFor("APPLICANT", { subject_id: "S-XINGHAN-DIGITAL" });
  const desk = applicantDesk(state, v);
  const tech = desk.find((d) => d.application_id === "APP-XH-TECH");
  const types = tech.feedback.map((f) => f.event_type);
  assert.ok(types.includes("FUNDING_APPROVED"));
  assert.ok(types.includes("APPLICATION_DUPLICATE_REJECTED"));
  const recusal = tech.feedback.find((f) => f.event_type === "RECUSAL_DECIDED");
  assert.ok(recusal);
  assert.equal(recusal.payload.reviewer_id, undefined);
  assert.equal(recusal.payload.notice, "已按规定启动评审回避");
});

test("评审专家回避后不可见该申报", async () => {
  const state = await sampleState();
  const rv1 = viewerFor("REVIEWER", { reviewer_id: "RV-001" });
  assert.equal(canSeeApplication(state, rv1, state.applications.get("APP-XH-TECH")), false);
  const rv2 = viewerFor("REVIEWER", { reviewer_id: "RV-002" });
  assert.equal(canSeeApplication(state, rv2, state.applications.get("APP-XH-TECH")), true);
  assert.equal(canSeeApplication(state, rv2, state.applications.get("APP-QL-COUNTY")), false);
});

test("县级主管部门只见辖区受益项目与证据", async () => {
  const state = await sampleState();
  const county = viewerFor("COUNTY_OFFICER", { region_prefix: "510221" }); // 远安县
  assert.equal(canSeeProject(state, county, state.projects.get("PRJ-QL-COUNTY")), true);
  assert.equal(canSeeProject(state, county, state.projects.get("PRJ-TL-TECH")), false); // 江州市城区
  assert.equal(canSeeEvidence(state, county, state.evidences.get("EV-QL-M1")), true);
  assert.equal(canSeeEvidence(state, county, state.evidences.get("EV-TL-M1")), false);
});

test("企业事件流中不含 actor_id 个人字段与其他企业记录", async () => {
  const state = await sampleState();
  const v = viewerFor("APPLICANT", { subject_id: "S-QL" });
  const events = filterEvents(state, v);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.actor_id === undefined));
  assert.ok(events.every((e) => !(JSON.stringify(e.payload ?? {}).includes("PRJ-YF-OVERSEAS"))));
});

test("省级角色拥有全量视图", async () => {
  const state = await sampleState();
  const v = viewerFor("PROVINCIAL_PLAN_OFFICER");
  assert.equal(canSeeProject(state, v, state.projects.get("PRJ-YF-OVERSEAS")), true);
  assert.equal(canSeeEvidence(state, v, state.evidences.get("EV-TL-M1")), true);
});
