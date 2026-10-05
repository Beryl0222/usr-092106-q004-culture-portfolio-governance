/**
 * 公开汇总发布口径。
 *
 * 目标：社会公众可看“资金投入了哪些方向、城乡缺口、成果数量”，但无法反推出
 * 某家企业（尤其是未发布商业计划的企业）的申报、立项与材料。
 *
 * 防护：
 * 1. k-匿名：每个汇总单元格至少含 k 个相互独立的最终控制集团；
 * 2. 主导份额：任一集团在格内份额不得超过阈值；
 * 3. 金额/数量统一舍入到公开步长；
 * 4. 不下钻：公开结果只到“专项 × 年度 × 城乡类/区县”层，不含主体、项目、证据；
 * 5. 差分攻击防护：同维兄弟格被抑制时，其合计格一并抑制（互补抑制）。
 */

import { PUBLICATION_RULES, REGIONS } from "./catalog.js";
import { groupOf } from "./state.js";

const SUPPRESSED = null;

export function publishSummary(state, rules = PUBLICATION_RULES) {
  return {
    published_at: new Date().toISOString(),
    rules: { ...rules },
    funding_by_stream_year: fundingCells(state, rules),
    outcomes_by_region_metric: outcomeCells(state, rules),
  };
}

function fundingCells(state, rules) {
  // 维度：专项 × 年度（考核期）× 城乡类
  const cells = new Map();
  for (const p of state.projects.values()) {
    const period = state.periods.get(p.period_id);
    const year = period?.year;
    const groupId = groupOf(state, p.lead_subject_id) ?? `unknown:${p.lead_subject_id}`;
    // 项目跨多个区县时，在同一城乡类单元格内只计一次
    const classes = new Set(p.regions.map(urbanClass));
    for (const cls of classes) {
      const key = `${p.stream_id}|${year}|${cls}`;
      const cell = cells.get(key) ?? mkCell(p.stream_id, year);
      cell.urban_class = cls;
      cell.groups.set(groupId, (cell.groups.get(groupId) ?? 0) + p.approved_wan);
      cell.projectIds.add(p.project_id);
      cells.set(key, cell);
    }
  }
  return finalizeCells([...cells.values()], rules, "amount_wan", "project_count");
}

function outcomeCells(state, rules) {
  // 公开发布只到“指标 × 区县”层；成果去重键（场次ID/备案号等）属于私有下钻，不进入公开维度
  const cells = new Map();
  for (const [resultIndexKey, claims] of state.resultIndex) {
    const metricKey = resultIndexKey.split("|")[0];
    for (const c of claims) {
      for (const r of c.region_shares) {
        const key = `${metricKey}|${r.region_code}`;
        const cell = cells.get(key) ?? mkCell(metricKey, r.region_code);
        const project = state.projects.get(c.project_id);
        const groupId = project ? groupOf(state, project.lead_subject_id) ?? `unknown` : "unknown";
        cell.groups.set(groupId, (cell.groups.get(groupId) ?? 0) + c.value * r.share);
        cell.valueSum += c.value * r.share;
        cell.contributionKeys.add(`${c.project_id}|${c.evidence_id}`);
        cells.set(key, cell);
      }
    }
  }
  return finalizeCells([...cells.values()], rules, "result_value", "contribution_count");
}

function mkCell(dimA, dimB) {
  return {
    dim_a: dimA,
    dim_b: dimB,
    region_code: dimB,
    region_name: REGIONS[dimB]?.name ?? dimB,
    groups: new Map(),
    valueSum: 0,
    projectIds: new Set(),
    contributionKeys: new Set(),
  };
}

function urbanClass(code) {
  const meta = REGIONS[code];
  if (!meta) return "unclassified";
  return meta.urban ? "urban" : "rural";
}

/** k-匿名 / 主导份额 / 舍入 / 互补抑制。 */
function finalizeCells(cells, rules, amountField, countField) {
  const evaluate = (cell) => {
    const k = cell.groups.size;
    const total = [...cell.groups.values()].reduce((a, b) => a + b, 0);
    const top = Math.max(0, ...cell.groups.values());
    const dominance = total > 0 ? top / total : 0;
    return {
      k,
      dominance: Math.round(dominance * 100) / 100,
      suppressed: k < rules.minSubjects || dominance > rules.maxDominance,
      reasons: [
        ...(k < rules.minSubjects ? [`独立主体数 ${k} 低于公开下限 ${rules.minSubjects}`] : []),
        ...(dominance > rules.maxDominance ? [`主导主体份额 ${Math.round(dominance * 100)}% 超过上限 ${rules.maxDominance * 100}%`] : []),
      ],
    };
  };

  const evaluated = cells.map((cell) => ({ cell, eval: evaluate(cell) }));

  // 互补抑制：同一 dim_a 下只要有一个兄弟格被抑制，合计/对照推断仍可能反推，
  // 因此把该维度组标记为 complement_suppressed（其余格照常发布，但调用方可知存在缺口）。
  const groupsByDimA = new Map();
  for (const item of evaluated) {
    const list = groupsByDimA.get(item.cell.dim_a) ?? [];
    list.push(item);
    groupsByDimA.set(item.cell.dim_a, list);
  }
  for (const siblings of groupsByDimA.values()) {
    if (siblings.some((s) => s.eval.suppressed) && siblings.length > 1) {
      for (const s of siblings) s.complement = true;
    }
  }

  return evaluated.map(({ cell, eval: ev, complement }) => {
    const count = countField === "project_count" ? cell.projectIds.size : cell.contributionKeys.size;
    const amount = countField === "project_count" ? [...cell.groups.values()].reduce((a, b) => a + b, 0) : cell.valueSum;
    if (ev.suppressed) {
      return {
        dim_a: cell.dim_a,
        dim_b: cell.dim_b,
        urban_class: cell.urban_class ?? null,
        region_code: cell.region_code,
        region_name: cell.region_name,
        published: false,
        suppression_reasons: ev.reasons,
        complement_suppressed: Boolean(complement),
      };
    }
    return {
      dim_a: cell.dim_a,
      dim_b: cell.dim_b,
      urban_class: cell.urban_class ?? null,
      region_code: cell.region_code,
      region_name: cell.region_name,
      published: true,
      independent_subjects: ev.k,
      top_share: ev.dominance,
      complement_suppressed: Boolean(complement),
      [amountField]: roundTo(amount, rules.amountStepWan),
      [countField]: roundCount(count, rules.countStep),
    };
  });
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function roundCount(value, step) {
  return Math.max(step, Math.round(value / step) * step);
}
