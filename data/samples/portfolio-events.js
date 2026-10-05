/**
 * 端到端中文样例事件流（虚构主体与项目，仅用于联调）。
 *
 * 主线情节：
 * - “县域文化消费”目标与四个专项发布；目标随后更名（原口径保留）；
 * - 集团母公司“嘉盛文化科技”与全资子公司“紫申数字”把同一笔数字展陈支出
 *   分别报向科技融合专项与县域文化消费专项 → 拆单标记 → 评审委员会认定、择一撤回；
 * - 评审人张某某利益冲突回避，改派李某；
 * - 紫申项目立项、两级预算、合同、两期里程碑（第二期延期获批）、证据核验、拨付；
 *   企业迟报后重复上传同一票据 → 命中重复、阻断二次拨付；
 * - 联合申报项目与紫申项目共同贡献同一指标（不同成果，合法）；
 *   又误把紫申成果重复计入 → 去重裁决；
 * - 联合项目终止 → 追回资金；2026 考核期锁定；2027 指标经规划处决定调整；
 * - 公开汇总按最小群体阈值抑制并通过差分检查后发布。
 *
 * 主线事件流折叠后必须 0 拒绝；违规场景见 violations.js。
 */

const T0 = new Date("2026-09-01T09:00:00+08:00").getTime();
const MINUTE = 60_000;

export function buildPortfolio() {
  const versions = new Map();
  const events = [];
  let seq = 0;

  function add(type, aggregateType, aggregateId, summary, payload = {}, links = {}) {
    const v = (versions.get(aggregateId) ?? 0) + 1;
    versions.set(aggregateId, v);
    seq += 1;
    const event = {
      event_id: links.id ?? `evt-${String(seq).padStart(3, "0")}`,
      event_type: type,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      occurred_at: new Date(T0 + seq * MINUTE).toISOString(),
      version: v,
      summary,
    };
    if (links.causation) event.causation_id = links.causation;
    if (links.correlation) event.correlation_id = links.correlation;
    if (Object.keys(payload).length) event.payload = payload;
    events.push(event);
    return event;
  }

  // —— 规划目标与专项 ——
  add("PLAN_GOAL_DEFINED", "policy_goal", "goal-county-consume", "定义“县域居民文化消费规模”规划目标", {
    goal_code: "G-COUNTY-CONSUME",
    goal_name: "县域居民文化消费规模",
    plan_term: "十五五",
    definition_snapshot: {
      metric_definition: "县域常住人口人均文化消费支出（元/人·年）",
      statistical_boundary: "县及县级市常住人口，城乡分类按统计口径 v2024",
      applicable_regions: ["全省"],
      basis_doc_no: "省文旅规划〔2026〕12号",
    },
  }, { id: "evt-goal-defined" });
  for (const [code, name, scope] of [
    ["PROG-TECH", "科技融合专项", "文化科技融合应用"],
    ["PROG-COUNTY", "县域文化消费专项", "县域文化消费场景"],
    ["PROG-TOUR", "文旅协同专项", "文旅融合协同项目"],
    ["PROG-OVERSEAS", "海外发行专项", "文化产品海外发行"],
  ]) {
    add("FUNDING_PROGRAM_PUBLISHED", "funding_program", code, `发布${name}`, {
      program_code: code,
      program_name: name,
      goal_codes: ["G-COUNTY-CONSUME"],
      budget_cap: 50_000_000,
      support_scope: scope,
      aid_type: "事后奖补",
      guideline_version: "2026.1",
    });
  }
  add("PLAN_GOAL_RENAMED", "policy_goal", "goal-county-consume", "目标随政策更名，原批复口径保留", {
    new_name: "县域和小城镇文化消费提升",
    former_name: "县域居民文化消费规模",
    rename_basis: "省文旅规划〔2026〕31号",
  }, { causation: "evt-goal-defined" });

  // —— 考核期与年度指标 ——
  add("ASSESSMENT_PERIOD_OPENED", "assessment_period", "period-2026", "开启 2026 考核期", {
    period_code: "2026",
    starts_on: "2026-01-01",
    ends_on: "2026-12-31",
    goal_codes: ["G-COUNTY-CONSUME"],
  });
  add("ASSESSMENT_PERIOD_OPENED", "assessment_period", "period-2027", "开启 2027 考核期", {
    period_code: "2027",
    starts_on: "2027-01-01",
    ends_on: "2027-12-31",
    goal_codes: ["G-COUNTY-CONSUME"],
  });
  add("ANNUAL_TARGET_SET", "annual_target", "target-consume-2026", "设定 2026 年人均文化消费指标", {
    goal_code: "G-COUNTY-CONSUME",
    period_code: "2026",
    metric_code: "m-per-capita-culture-spend",
    target_value: 1600,
    unit: "元/人·年",
    baseline_value: 1320,
  });
  add("ANNUAL_TARGET_SET", "annual_target", "target-consume-2027", "设定 2027 年人均文化消费指标", {
    goal_code: "G-COUNTY-CONSUME",
    period_code: "2027",
    metric_code: "m-per-capita-culture-spend",
    target_value: 1750,
    unit: "元/人·年",
    baseline_value: 1480,
  });

  // —— 申报主体与控制关系 ——
  add("APPLICANT_REGISTERED", "applicant", "app-jiasheng", "登记嘉盛文化科技集团（母公司）", {
    applicant_name: "嘉盛文化科技集团有限公司",
    credit_code: "91110000JS0000001X",
    applicant_type: "enterprise",
  });
  add("APPLICANT_REGISTERED", "applicant", "app-zishen", "登记紫申数字科技（全资子公司）", {
    applicant_name: "紫申数字科技有限公司",
    credit_code: "91110000ZS0000002Y",
    applicant_type: "enterprise",
  });
  add("APPLICANT_REGISTERED", "applicant", "app-bing", "登记丙地文旅运营公司", {
    applicant_name: "丙地文旅运营有限公司",
    credit_code: "91330000BF0000003Z",
    applicant_type: "enterprise",
  });
  add("APPLICANT_REGISTERED", "applicant", "app-ding", "登记丁县演艺机构（联合申报方）", {
    applicant_name: "丁县惠民演艺有限公司",
    credit_code: "91330000DG0000004W",
    applicant_type: "enterprise",
  });
  add("CONTROL_RELATIONSHIP_RECORDED", "applicant", "rel-js-zs-01", "登记嘉盛对紫申的全资控制关系", {
    parent_id: "app-jiasheng",
    child_id: "app-zishen",
    relation_type: "WHOLLY_OWNED_SUBSIDIARY",
    valid_from: "2023-06-01",
    evidence_ref: "股权登记信息",
  });

  // —— 拆单：同一支出报两个专项 ——
  const expoItem = {
    item_code: "EXP-DIGITAL-EXPO",
    description: "沉浸式数字展陈系统开发与部署",
    amount: 800_000,
    currency: "CNY",
    expense_category: "数字内容开发",
    incurred_on: "2026-07-15",
  };
  add("APPLICATION_RECEIVED", "funding_application", "apl-001", "紫申申报县域文化消费专项", {
    program_code: "PROG-COUNTY",
    applicant_id: "app-zishen",
    submitted_at: "2026-09-03T10:00:00+08:00",
    expenditure_items: [expoItem],
    benefit_regions: [{ region_code: "330122", region_type: "county", urban_rural: "rural", weak_area: true, share_pct: 100 }],
    declared_funding: [],
    content_fingerprint: "sha256:9f1a2b",
  }, { id: "evt-apl-001-received", correlation: "cor-apl-001" });
  add("APPLICATION_RECEIVED", "funding_application", "apl-002", "嘉盛就同一支出申报科技融合专项（涉嫌拆单）", {
    program_code: "PROG-TECH",
    applicant_id: "app-jiasheng",
    submitted_at: "2026-09-04T11:20:00+08:00",
    expenditure_items: [{ ...expoItem, description: "沉浸式数字展陈系统研发" }],
    benefit_regions: [{ region_code: "330100", region_type: "city", urban_rural: "urban", weak_area: false, share_pct: 100 }],
    declared_funding: [],
    content_fingerprint: "sha256:9f1a2b",
  }, { correlation: "cor-apl-002" });
  add("APPLICATION_DUPLICATE_FLAGGED", "funding_application", "apl-001", "控制闭包内命中跨专项同一支出：拆单嫌疑", {
    matched_pairs: [{
      item_a_ref: "apl-001/EXP-DIGITAL-EXPO",
      item_b_ref: "apl-002/EXP-DIGITAL-EXPO",
      similarity: 0.96,
      rule: "FINGERPRINT+EXPENSE_CATEGORY+TIME_WINDOW+CONTROL_CLOSURE",
    }],
    across_programs: ["PROG-COUNTY", "PROG-TECH"],
    control_path: "app-zishen <-WHOLLY_OWNED- app-jiasheng",
  });

  // —— 评审回避 ——
  add("REVIEWER_ASSIGNED", "governance_decision", "dec-assign-01", "指派张某评审 apl-001", {
    application_id: "apl-001",
    reviewer_id: "rev-zhang",
    reviewer_org: "某数字文化研究院",
  });
  add("CONFLICT_DECLARED", "funding_application", "apl-001", "张某披露持有嘉盛股份，回避", {
    reviewer_id: "rev-zhang",
    conflict_type: "EQUITY_HOLDING",
    relation_detail: "评审人持有申报方关联母公司嘉盛 3% 股份",
    recusal_result: "RECUSED",
  });
  add("REVIEWER_ASSIGNED", "governance_decision", "dec-assign-02", "改派李某评审 apl-001", {
    application_id: "apl-001",
    reviewer_id: "rev-li",
    reviewer_org: "省社科院文化产业研究中心",
  });

  // —— 重复出资认定：责令择一，apl-002 撤回 ——
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-dup-01", "委员会认定同一支出不得跨专项重复补助", {
    decision_type: "DUPLICATE_FUNDING_RULING",
    result: "APPROVED",
    subject_id: "apl-001",
    application_ids: ["apl-001", "apl-002"],
    ruling: "CONFIRMED_DUPLICATE",
    requirement: "同一数字展陈支出只能在一个专项申报，撤回 apl-002",
    actor_id: "rev-committee-2026-3",
    actor_role: "REVIEW_COMMITTEE",
    basis_docs: ["查重比对报告", "股权穿透核查表"],
  }, { id: "evt-dec-dup-01" });
  add("APPLICATION_WITHDRAWN", "funding_application", "apl-002", "嘉盛撤回科技融合专项申报", {
    reason: "执行重复出资认定决定，同一支出择一申报",
  }, { causation: "evt-dec-dup-01" });

  // —— 立项：apl-001 ——
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-review-01", "委员会审查通过 apl-001", {
    decision_type: "FUNDING_REVIEW",
    result: "APPROVED",
    subject_id: "apl-001",
    actor_id: "rev-committee-2026-3",
    actor_role: "REVIEW_COMMITTEE",
    committee: ["rev-li"],
    basis_docs: ["评审意见表", "查重认定整改确认"],
  }, { id: "evt-dec-review-01" });
  add("FUNDING_APPROVED", "funding_application", "apl-001", "apl-001 立项，补助 80 万元", {
    approved_amount: 800_000,
    currency: "CNY",
    budget_sources: [
      { program_code: "PROG-COUNTY", fund_level: "PROVINCIAL", amount: 600_000 },
      { program_code: "PROG-COUNTY", fund_level: "COUNTY", amount: 200_000 },
    ],
    award_doc_no: "县文产〔2026〕88号",
  }, { causation: "evt-dec-review-01" });

  // —— 项目执行：prj-001 ——
  add("PROJECT_ESTABLISHED", "funded_project", "prj-001", "建立在库项目：紫申数字展陈", {
    application_id: "apl-001",
    program_code: "PROG-COUNTY",
    lead_applicant_id: "app-zishen",
    goal_codes: ["G-COUNTY-CONSUME"],
    total_budget: 800_000,
    region_scope: [{ region_code: "330122", urban_rural: "rural", share_pct: 100 }],
  }, { id: "evt-prj-001-established" });
  add("BUDGET_SOURCE_SECURED", "budget_allocation", "bud-001", "落实省级补助 60 万元", {
    project_id: "prj-001", program_code: "PROG-COUNTY", fund_level: "PROVINCIAL",
    fund_type: "事后奖补", amount: 600_000, currency: "CNY", fiscal_year: 2026, doc_ref: "财教〔2026〕55号",
  });
  add("BUDGET_SOURCE_SECURED", "budget_allocation", "bud-002", "落实县级配套 20 万元", {
    project_id: "prj-001", program_code: "PROG-COUNTY", fund_level: "COUNTY",
    fund_type: "配套", amount: 200_000, currency: "CNY", fiscal_year: 2026, doc_ref: "县财〔2026〕19号",
  });
  add("CONTRACT_SIGNED", "contract", "ctr-001", "签订项目合同 80 万元", {
    project_id: "prj-001", contract_no: "CTR-2026-001", amount: 800_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", signed_at: "2026-09-20",
    payment_terms: [{ milestone_code: "ms-1", pct: 40 }, { milestone_code: "ms-2", pct: 60 }],
  });
  add("MILESTONE_PLANNED", "funded_project", "prj-001", "登记两期里程碑计划", {
    milestones: [
      { code: "ms-1", name: "展陈系统上线", due_date: "2026-11-30", deliverables: ["系统验收报告"], pay_pct: 40, metric_links: ["m-per-capita-culture-spend"] },
      { code: "ms-2", name: "县域场景运营满 3 个月", due_date: "2027-03-31", deliverables: ["运营数据与凭证"], pay_pct: 60, metric_links: ["m-per-capita-culture-spend"] },
    ],
  });

  // 第一期：证据 → 核验 → 拨付
  add("EVIDENCE_SUBMITTED", "evidence", "evd-001", "紫盛提交系统验收与发票", {
    project_id: "prj-001", milestone_code: "ms-1", evidence_type: "ACCEPTANCE_REPORT_AND_INVOICE",
    content_hash: "sha256:abc111", canonical_key: "INV-2026-0001",
    submitted_by: "app-zishen", submitted_at: "2026-11-25T10:00:00+08:00",
  });
  add("EVIDENCE_ACCEPTED", "evidence", "evd-001", "核验通过：验收与发票真实有效", {
    reviewer_id: "staff-qian", accepted_at: "2026-11-28T15:00:00+08:00", canonical_outcome_id: "oc-expo-system",
  });
  add("MILESTONE_VERIFIED", "funded_project", "prj-001", "第一期里程碑核验通过", {
    milestone_code: "ms-1", verified_at: "2026-11-29T10:00:00+08:00", evidence_ids: ["evd-001"], verifier_id: "staff-qian",
  });
  add("PAYMENT_REQUESTED", "payment", "pay-001", "申请第一期款 32 万元", {
    contract_no: "CTR-2026-001", milestone_code: "ms-1", amount: 320_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", request_no: "REQ-001", evidence_ids: ["evd-001"],
  });
  add("PAYMENT_RELEASED", "payment", "pay-001", "第一期款出账 32 万元", {
    contract_no: "CTR-2026-001", milestone_code: "ms-1", amount: 320_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", released_at: "2026-12-02T10:00:00+08:00",
    evidence_ids: ["evd-001"], idempotency_key: "pay:CTR-2026-001:ms-1:320000:0002",
  }, { id: "evt-pay-001-released" });

  // 迟报后重复上传同一票据 → 命中重复、阻断第二次拨付
  add("EVIDENCE_SUBMITTED", "evidence", "evd-002", "企业次年补传同一发票（迟报、内容相同）", {
    project_id: "prj-001", milestone_code: "ms-1", evidence_type: "INVOICE",
    content_hash: "sha256:abc111", canonical_key: "INV-2026-0001",
    submitted_by: "app-zishen", submitted_at: "2027-01-12T09:00:00+08:00", late: true,
  });
  add("EVIDENCE_DUPLICATE_MATCHED", "evidence", "evd-002", "内容指纹与业务键均命中 evd-001", {
    new_evidence_id: "evd-002", existing_evidence_id: "evd-001",
    match_type: "HASH", score: 1.0, across_scope: "same-project-resubmission",
  });
  add("EVIDENCE_REJECTED", "evidence", "evd-002", "重复票据不予采信", {
    reviewer_id: "staff-qian", reason: "DUPLICATE_EVIDENCE_LATE_RESUBMISSION",
  });
  add("PAYMENT_REQUESTED", "payment", "pay-002", "企业凭补传发票再次申请第一期款", {
    contract_no: "CTR-2026-001", milestone_code: "ms-1", amount: 320_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", request_no: "REQ-002-DUP", evidence_ids: ["evd-002"],
  });
  add("PAYMENT_BLOCKED", "payment", "pay-002", "重复拨付被阻断（同一幂等键）", {
    request_no: "REQ-002-DUP", reason: "DUPLICATE_KEY",
    idempotency_key: "pay:CTR-2026-001:ms-1:320000:0002",
    payee_account: "紫申数字 基本户 0002",
  });

  // 第二期：延期获批 → 核验 → 拨付
  add("MILESTONE_DELAY_REQUESTED", "funded_project", "prj-001", "申请第二期延期至 4 月底", {
    milestone_code: "ms-2", requested_due_date: "2027-04-30", reason: "县域场地改造延后", evidence_ids: [],
  });
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-delay-01", "专项机构批准延期", {
    decision_type: "MILESTONE_DELAY", result: "APPROVED", subject_id: "prj-001",
    actor_id: "staff-program-office", actor_role: "PROGRAM_OFFICE", basis_docs: ["延期申请单"],
  }, { id: "evt-dec-delay-01" });
  add("MILESTONE_DELAY_APPROVED", "funded_project", "prj-001", "第二期延期获批，新日期 2027-04-30", {
    milestone_code: "ms-2", new_due_date: "2027-04-30",
  }, { causation: "evt-dec-delay-01" });
  add("EVIDENCE_SUBMITTED", "evidence", "evd-003", "提交三个月运营数据与凭证", {
    project_id: "prj-001", milestone_code: "ms-2", evidence_type: "OPERATION_DATA",
    content_hash: "sha256:def222", canonical_key: "OPS-prj-001-ms2",
    submitted_by: "app-zishen", submitted_at: "2027-04-25T10:00:00+08:00",
  });
  add("EVIDENCE_ACCEPTED", "evidence", "evd-003", "运营证据核验通过", {
    reviewer_id: "staff-qian", accepted_at: "2027-04-27T10:00:00+08:00", canonical_outcome_id: "oc-expo-operations",
  });
  add("MILESTONE_VERIFIED", "funded_project", "prj-001", "第二期里程碑核验通过", {
    milestone_code: "ms-2", verified_at: "2027-04-28T10:00:00+08:00", evidence_ids: ["evd-003"], verifier_id: "staff-qian",
  });
  add("PAYMENT_REQUESTED", "payment", "pay-003", "申请第二期款 48 万元", {
    contract_no: "CTR-2026-001", milestone_code: "ms-2", amount: 480_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", request_no: "REQ-003", evidence_ids: ["evd-003"],
  });
  add("PAYMENT_RELEASED", "payment", "pay-003", "第二期款出账 48 万元", {
    contract_no: "CTR-2026-001", milestone_code: "ms-2", amount: 480_000, currency: "CNY",
    payee_account: "紫申数字 基本户 0002", released_at: "2027-04-30T10:00:00+08:00",
    evidence_ids: ["evd-003"], idempotency_key: "pay:CTR-2026-001:ms-2:480000:0002",
  });

  // —— 联合申报项目 prj-002：共同贡献同一指标（不同成果） ——
  add("APPLICATION_RECEIVED", "funding_application", "apl-003", "丙地文旅申报文旅协同专项", {
    program_code: "PROG-TOUR", applicant_id: "app-bing",
    submitted_at: "2026-09-08T10:00:00+08:00",
    expenditure_items: [{ item_code: "TOUR-FAIR", description: "县域文旅集市运营", amount: 500_000, currency: "CNY", expense_category: "活动运营", incurred_on: "2026-08-20" }],
    benefit_regions: [{ region_code: "330123", region_type: "county", urban_rural: "rural", weak_area: true, share_pct: 100 }],
    declared_funding: [], content_fingerprint: "sha256:77ccdd",
  }, { correlation: "cor-apl-003" });
  add("JOINT_APPLICATION_LINKED", "funding_application", "apl-003", "联合丁县演艺，份额 70/30", {
    lead_applicant_id: "app-bing",
    members: [
      { applicant_id: "app-bing", role: "LEAD", share_pct: 70, account_ref: "丙地 基本户 0007" },
      { applicant_id: "app-ding", role: "MEMBER", share_pct: 30, account_ref: "丁县 基本户 0004" },
    ],
  });
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-review-02", "委员会通过 apl-003", {
    decision_type: "FUNDING_REVIEW", result: "APPROVED", subject_id: "apl-003",
    actor_id: "rev-committee-2026-3", actor_role: "REVIEW_COMMITTEE", committee: ["rev-li"],
  }, { id: "evt-dec-review-02" });
  add("FUNDING_APPROVED", "funding_application", "apl-003", "apl-003 立项 50 万元", {
    approved_amount: 500_000, currency: "CNY",
    budget_sources: [{ program_code: "PROG-TOUR", fund_level: "PROVINCIAL", amount: 500_000 }],
    award_doc_no: "文旅协〔2026〕210号",
  }, { causation: "evt-dec-review-02" });
  add("PROJECT_ESTABLISHED", "funded_project", "prj-002", "建立在库项目：县域文旅集市", {
    application_id: "apl-003", program_code: "PROG-TOUR", lead_applicant_id: "app-bing",
    goal_codes: ["G-COUNTY-CONSUME"], total_budget: 500_000,
    region_scope: [{ region_code: "330123", urban_rural: "rural", share_pct: 100 }],
  });
  add("BUDGET_SOURCE_SECURED", "budget_allocation", "bud-003", "落实省级补助 50 万元", {
    project_id: "prj-002", program_code: "PROG-TOUR", fund_level: "PROVINCIAL",
    fund_type: "事后奖补", amount: 500_000, currency: "CNY", fiscal_year: 2026, doc_ref: "财教〔2026〕60号",
  });
  add("CONTRACT_SIGNED", "contract", "ctr-002", "签订合同 50 万元", {
    project_id: "prj-002", contract_no: "CTR-2026-002", amount: 500_000, currency: "CNY",
    payee_account: "丙地 基本户 0007", signed_at: "2026-09-25",
    payment_terms: [{ milestone_code: "ms-1", pct: 40 }],
  });
  add("MILESTONE_PLANNED", "funded_project", "prj-002", "登记一期里程碑", {
    milestones: [{ code: "ms-1", name: "集市首场运营", due_date: "2026-12-31", deliverables: ["活动结算与参与数据"], pay_pct: 40, metric_links: ["m-per-capita-culture-spend"] }],
  });
  add("EVIDENCE_SUBMITTED", "evidence", "evd-004", "提交集市运营证据", {
    project_id: "prj-002", milestone_code: "ms-1", evidence_type: "EVENT_OPERATION",
    content_hash: "sha256:444eee", canonical_key: "FAIR-prj-002-ms1",
    submitted_by: "app-bing", submitted_at: "2026-12-20T10:00:00+08:00",
  });
  add("EVIDENCE_ACCEPTED", "evidence", "evd-004", "集市运营证据采信", {
    reviewer_id: "staff-sun", accepted_at: "2026-12-26T10:00:00+08:00", canonical_outcome_id: "oc-tour-fair",
  });
  add("MILESTONE_VERIFIED", "funded_project", "prj-002", "一期里程碑核验通过", {
    milestone_code: "ms-1", verified_at: "2026-12-28T10:00:00+08:00", evidence_ids: ["evd-004"], verifier_id: "staff-sun",
  });
  add("PAYMENT_REQUESTED", "payment", "pay-004", "申请第一期款 20 万元", {
    contract_no: "CTR-2026-002", milestone_code: "ms-1", amount: 200_000, currency: "CNY",
    payee_account: "丙地 基本户 0007", request_no: "REQ-004", evidence_ids: ["evd-004"],
  });
  add("PAYMENT_RELEASED", "payment", "pay-004", "第一期款出账 20 万元", {
    contract_no: "CTR-2026-002", milestone_code: "ms-1", amount: 200_000, currency: "CNY",
    payee_account: "丙地 基本户 0007", released_at: "2026-12-30T10:00:00+08:00",
    evidence_ids: ["evd-004"], idempotency_key: "pay:CTR-2026-002:ms-1:200000:0007",
  });

  // —— 成果计量：不同成果共同贡献同一指标 ——
  add("OUTCOME_CONTRIBUTION_RECORDED", "outcome_measure", "out-001", "数字展陈计入 2026 人均消费指标", {
    project_id: "prj-001", goal_code: "G-COUNTY-CONSUME", period_code: "2026",
    metric_code: "m-per-capita-culture-spend", canonical_outcome_id: "oc-expo-system",
    value: 18, unit: "元/人·年", evidence_ids: ["evd-001"],
    region_allocation: [{ region_code: "330122", urban_rural: "rural", share_pct: 100 }],
  }, { id: "evt-out-001" });
  add("OUTCOME_CONTRIBUTION_RECORDED", "outcome_measure", "out-002", "文旅集市计入同一指标（不同成果，合法）", {
    project_id: "prj-002", goal_code: "G-COUNTY-CONSUME", period_code: "2026",
    metric_code: "m-per-capita-culture-spend", canonical_outcome_id: "oc-tour-fair",
    value: 12, unit: "元/人·年", evidence_ids: ["evd-004"],
    region_allocation: [{ region_code: "330123", urban_rural: "rural", share_pct: 100 }],
  }, { id: "evt-out-002" });

  // 误把紫申成果再次计入 → 去重裁决（保留 out-001，out-003 标记重复）
  add("EVIDENCE_SUBMITTED", "evidence", "evd-005", "丙地误用紫申展陈截图申报成果", {
    project_id: "prj-002", evidence_type: "SCREENSHOT",
    content_hash: "sha256:abc111", canonical_key: "INV-2026-0001",
    submitted_by: "app-bing", submitted_at: "2027-01-05T10:00:00+08:00",
  });
  add("EVIDENCE_DUPLICATE_MATCHED", "evidence", "evd-005", "命中紫申已采信证据 evd-001", {
    new_evidence_id: "evd-005", existing_evidence_id: "evd-001",
    match_type: "HASH", score: 1.0, across_scope: "cross-project-cross-applicant",
  });
  add("EVIDENCE_ACCEPTED", "evidence", "evd-005", "材料形式合规进入计量比对（成果归属待裁决）", {
    reviewer_id: "staff-sun", accepted_at: "2027-01-06T10:00:00+08:00", canonical_outcome_id: "oc-expo-system",
  });
  add("OUTCOME_CONTRIBUTION_RECORDED", "outcome_measure", "out-003", "丙地尝试将同一成果计入指标", {
    project_id: "prj-002", goal_code: "G-COUNTY-CONSUME", period_code: "2026",
    metric_code: "m-per-capita-culture-spend", canonical_outcome_id: "oc-expo-system",
    value: 9, unit: "元/人·年", evidence_ids: ["evd-005"],
    region_allocation: [{ region_code: "330123", urban_rural: "rural", share_pct: 100 }],
  }, { id: "evt-out-003" });
  add("OUTCOME_DEDUP_RESOLVED", "outcome_measure", "out-003", "裁决：成果归紫申，out-003 计为重复", {
    kept_contribution_id: "evt-out-001",
    duplicate_contribution_ids: ["evt-out-003"],
    ruling_decision_id: "evt-dec-dedup-outcome-01",
    rule: "SAME_CANONICAL_OUTCOME_IN_PERIOD",
  });

  // —— prj-002 终止并追回 ——
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-term-01", "省级部门决定终止 prj-002", {
    decision_type: "PROJECT_TERMINATION", result: "APPROVED", subject_id: "prj-002",
    reason: "后续活动未开展且提供材料失实",
    actor_id: "leader-dept", actor_role: "PROVINCIAL_CULTURE_DEPT", basis_docs: ["核查报告"],
  }, { id: "evt-dec-term-01" });
  add("PROJECT_TERMINATED", "funded_project", "prj-002", "prj-002 终止，冻结后续支付", {
    reason: "材料失实", effective_date: "2027-02-01",
  }, { causation: "evt-dec-term-01" });
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-recovery-01", "省级部门决定追回已拨 20 万元", {
    decision_type: "FUND_RECOVERY", result: "APPROVED", subject_id: "prj-002",
    actor_id: "leader-dept", actor_role: "PROVINCIAL_CULTURE_DEPT", basis_docs: ["审计意见书"],
  }, { id: "evt-dec-recovery-01" });
  add("FUNDS_RECOVERED", "funded_project", "prj-002", "追回 20 万元", {
    idempotency_key: "recover:CTR-2026-002:ms-1:200000:0007",
    original_payment_ids: ["pay:CTR-2026-002:ms-1:200000:0007"],
    amount: 200_000, currency: "CNY", reason: "终止并追回", account_ref: "丙地 基本户 0007",
  }, { causation: "evt-dec-recovery-01" });

  // —— 2026 锁定；2027 指标经规划处决定调整（未锁定期，合法） ——
  add("ASSESSMENT_PERIOD_LOCKED", "assessment_period", "period-2026", "锁定 2026 考核期", {
    period_code: "2026",
    locked_by: "planning-dept", locked_at: "2027-03-15T17:00:00+08:00",
  });
  add("REVIEW_DECISION_RECORDED", "governance_decision", "dec-target-01", "规划处决定上调 2027 指标", {
    decision_type: "TARGET_ADJUSTMENT", result: "APPROVED", subject_id: "target-consume-2027",
    actor_id: "planning-dept", actor_role: "PLANNING_DEPARTMENT",
    basis_docs: ["十五五中期评估报告"],
  }, { id: "evt-dec-target-01" });
  add("ANNUAL_TARGET_ADJUSTED", "annual_target", "target-consume-2027", "2027 指标由 1750 调整为 1820", {
    new_value: 1820, former_value: 1750, adjust_basis: "中期评估", effective_from: "2027-01-01",
    decision_event_id: "evt-dec-target-01",
  }, { causation: "evt-dec-target-01" });

  // —— 公开发布：阈值抑制 + 差分检查 ——
  add("PUBLIC_SUMMARY_RELEASED", "public_release", "rel-2026-final", "发布 2026 年度公开汇总", {
    release_batch: "PUB-2026-FINAL", period_code: "2026",
    min_group_size: 3, diff_check_passed: true, released_at: "2027-03-20T10:00:00+08:00",
    cells: [
      { cell_key: "county|urban", group_key: "county", beneficiary_count: 12, value: 1580 },
      { cell_key: "county|rural", group_key: "county", beneficiary_count: 18, value: 1465 },
      { cell_key: "county|total", group_key: "county", is_total: true, beneficiary_count: 30, value: 1512 },
    ],
    suppressed_cells: ["county|rural-remote-a", "county|rural-remote-b", "overseas|single-applicant"],
  });

  return events;
}
