import {
  AGGREGATE_TYPES,
  DECISION_BOUND_EVENTS,
  DECISION_PAYLOAD_FIELDS,
  EVENT_AGGREGATE,
  EVENT_TYPES,
  IDEMPOTENCY_REQUIRED_EVENTS,
} from "./catalog.js";

const required = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

/**
 * 基础信封校验（既有约定，行为保持兼容）：
 * 仅检查必填字段与 version 取值，另对枚举取值做白名单校验。
 * 不含任何业务流程判断。
 */
export function validateEvent(record) {
  const errors = required.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if (record.event_type && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知事件类型：${record.event_type}`);
  }
  if (record.aggregate_type && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知聚合类型：${record.aggregate_type}`);
  }
  return errors;
}

/**
 * 载荷级契约校验。对携带 payload 的治理事件执行更强约束；
 * 不含 payload 的历史最简信封（如 data/sample.json）不受这些规则约束。
 *
 * @param {object} record 单条事件
 * @param {Map<string, object>} [decisionIndex] event_id → 已接收的 REVIEW_DECISION_RECORDED，
 *        用于校验决定链前置（批准类事件必须引用 APPROVED 决定）
 */
export function validateGovernanceEvent(record, decisionIndex) {
  const errors = validateEvent(record);
  if (errors.length > 0) return errors;

  const { event_type: type, aggregate_type: aggregate, payload = {} } = record;

  // 事件与聚合归属一致（仅对目录中登记了归属的事件强制）
  const expectedAggregate = EVENT_AGGREGATE[type];
  if (expectedAggregate && aggregate !== expectedAggregate) {
    errors.push(`${type} 应归属于聚合 ${expectedAggregate}，实际为 ${aggregate}`);
  }

  // 决定链：批准/生效类事件必须引用一条结论相符的治理决定
  if (Object.hasOwn(DECISION_BOUND_EVENTS, type)) {
    const expectedResult = DECISION_BOUND_EVENTS[type];
    if (!record.causation_id) {
      errors.push(`${type} 必须通过 causation_id 引用治理决定`);
    } else if (decisionIndex) {
      const decision = decisionIndex.get(record.causation_id);
      if (!decision) {
        errors.push(`${type} 引用的决定 ${record.causation_id} 不存在`);
      } else if (decision.payload?.result !== expectedResult) {
        errors.push(`${type} 要求决定 ${record.causation_id} 的 result 为 ${expectedResult}`);
      }
    }
  }

  // 资金出账事件必须携带幂等键，防止迟报/重复材料造成二次拨付
  if (IDEMPOTENCY_REQUIRED_EVENTS.has(type) && !payload.idempotency_key) {
    errors.push(`${type} 必须携带 payload.idempotency_key`);
  }

  // 治理决定载荷的必填字段
  if (type === "REVIEW_DECISION_RECORDED") {
    for (const field of DECISION_PAYLOAD_FIELDS) {
      if (payload[field] === undefined || payload[field] === null) {
        errors.push(`REVIEW_DECISION_RECORDED 缺少 payload.${field}`);
      }
    }
  }

  return errors;
}
