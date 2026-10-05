import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPortfolio } from "../data/samples/portfolio-events.js";
import { AGGREGATE_TYPES, EVENT_TYPES } from "../src/catalog.js";
import { validateEvent } from "../src/validator.js";

test("样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("最简历史信封始终通过基础校验（无 payload 不受载荷规则约束）", () => {
  assert.deepEqual(
    validateEvent({
      event_id: "legacy-1",
      event_type: "APPLICATION_RECEIVED",
      aggregate_type: "policy_goal",
      aggregate_id: "x",
      occurred_at: "2026-09-20T15:00:00+08:00",
      version: 1,
      summary: "历史记录",
    }),
    [],
  );
});

test("JSON Schema 与目录的枚举保持同步", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"),
  );
  assert.deepEqual([...schema.properties.event_type.enum].sort(), [...EVENT_TYPES].sort());
  assert.deepEqual([...schema.properties.aggregate_type.enum].sort(), [...AGGREGATE_TYPES].sort());
  for (const field of ["causation_id", "correlation_id", "payload"]) {
    assert.ok(field in schema.properties, `schema 缺少公共字段 ${field}`);
  }
});

test("未知事件/聚合枚举被拒绝", () => {
  const base = {
    event_id: "x",
    event_type: "UNKNOWN",
    aggregate_type: "policy_goal",
    aggregate_id: "x",
    occurred_at: "2026-09-20T15:00:00+08:00",
    version: 1,
    summary: "x",
  };
  assert.ok(validateEvent(base).some((m) => m.includes("未知事件类型")));
  assert.ok(validateEvent({ ...base, event_type: "APPLICATION_RECEIVED", aggregate_type: "nope" })
    .some((m) => m.includes("未知聚合类型")));
});

test("导出的 JSON 样例与构建器一致且全部通过信封校验", async () => {
  const exported = JSON.parse(
    await readFile(new URL("../data/samples/portfolio-events.json", import.meta.url), "utf8"),
  );
  assert.equal(exported.length, buildPortfolio().length);
  for (const event of exported) {
    assert.deepEqual(validateEvent(event), []);
  }
});
