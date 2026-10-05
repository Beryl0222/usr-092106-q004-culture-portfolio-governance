/**
 * 行级访问范围。
 *
 * 角色口径：
 * - APPLICANT（企业）：只能查看自身申报、该申报的反馈（受理/驳回/决定/支付阻断原因）
 *   与自身项目材料；联合申报的参与方可见本联合项目；看不到其他企业的任何记录；
 * - REVIEWER（评审专家）：仅可见被指派且本人未回避的申报；
 * - COUNTY_OFFICER：仅可见受益区域落在本辖区（区划前缀）内的项目与去标识反馈；
 * - PROVINCIAL_*：全量履职视图；
 * - PUBLIC：不在本模块放行，统一走 public-view.js 的公开发布口径。
 *
 * 个人/机构敏感字段按“履职必需”最小化返回。
 */

import { groupOf } from "./state.js";

const SENSITIVE_EVENT_FIELDS = ["actor_id"]; // actor_role 保留用于解释决定链

export function viewerFor(role, { subject_id = null, reviewer_id = null, region_prefix = null } = {}) {
  return { role, subject_id, reviewer_id, region_prefix };
}

/** 判断主体（含联合申报参与方）是否属于该观众所在企业。 */
function subjectCanSeeProject(state, viewer, project) {
  const ownGroup = groupOf(state, viewer.subject_id);
  const memberIds = [project.lead_subject_id, ...project.co_subject_ids];
  return memberIds.includes(viewer.subject_id) || memberIds.some((s) => groupOf(state, s) === ownGroup && ownGroup !== null);
}

export function canSeeApplication(state, viewer, app) {
  switch (viewer.role) {
    case "PROVINCIAL_PLAN_OFFICER":
    case "PROVINCIAL_FINANCE_OFFICER":
      return true;
    case "APPLICANT": {
      const ownGroup = groupOf(state, viewer.subject_id);
      const ids = [app.lead_subject_id, ...app.co_subject_ids];
      return ids.includes(viewer.subject_id) || ids.some((s) => groupOf(state, s) === ownGroup && ownGroup !== null);
    }
    case "REVIEWER":
      return app.reviewers.some(
        (r) => r.reviewer_id === viewer.reviewer_id && !app.recused_reviewer_ids.includes(viewer.reviewer_id),
      );
    case "COUNTY_OFFICER":
      return app.regions.some((code) => viewer.region_prefix && code.startsWith(viewer.region_prefix));
    default:
      return false;
  }
}

export function canSeeProject(state, viewer, project) {
  switch (viewer.role) {
    case "PROVINCIAL_PLAN_OFFICER":
    case "PROVINCIAL_FINANCE_OFFICER":
      return true;
    case "APPLICANT":
      return subjectCanSeeProject(state, viewer, project);
    case "REVIEWER": {
      const app = state.applications.get(project.application_id);
      return app ? canSeeApplication(state, viewer, app) : false;
    }
    case "COUNTY_OFFICER":
      return project.regions.some((code) => viewer.region_prefix && code.startsWith(viewer.region_prefix));
    default:
      return false;
  }
}

export function canSeeEvidence(state, viewer, pack) {
  switch (viewer.role) {
    case "PROVINCIAL_PLAN_OFFICER":
    case "PROVINCIAL_FINANCE_OFFICER":
      return true;
    case "APPLICANT":
      return groupOf(state, pack.subject_id) === groupOf(state, viewer.subject_id);
    case "REVIEWER":
      return [...state.projects.values()].some(
        (p) => p.project_id === pack.project_id && canSeeProject(state, viewer, p),
      );
    case "COUNTY_OFFICER":
      return pack.benefit_regions.some((code) => viewer.region_prefix && code.startsWith(viewer.region_prefix));
    default:
      return false;
  }
}

/** 企业视角：自身申报 + 反馈时间线（受理、补正、重复驳回、回避之外的行政决定、支付阻断原因）。 */
export function applicantDesk(state, viewer) {
  if (viewer.role !== "APPLICANT") throw new Error("applicantDesk 仅供 APPLICANT 角色使用");
  const ownGroup = groupOf(state, viewer.subject_id);
  const apps = [...state.applications.values()].filter((a) => canSeeApplication(state, viewer, a));
  return apps.map((app) => {
    const project = app.project_id ? state.projects.get(app.project_id) : null;
    const feedback = [];
    for (const e of state.events) {
      const p = e.payload ?? {};
      const aboutApp =
        p.application_id === app.application_id ||
        (e.aggregate_type === "funding_application" && e.aggregate_id === app.application_id);
      const aboutProject = project && p.project_id === project.project_id;
      if (!aboutApp && !aboutProject) continue;
      if (
        ["APPLICATION_DUPLICATE_REJECTED", "APPLICATION_AMENDED", "FUNDING_APPROVED", "RECUSAL_DECIDED", "BUDGET_TRANSFER_DECIDED", "MILESTONE_DELAY_DECIDED", "PROJECT_TERMINATION_DECIDED", "FUNDS_RECOVERY_DECIDED", "PAYMENT_BLOCKED", "CONFLICT_DECLARED"].includes(e.event_type)
      ) {
        // 回避决定涉及评审专家个人信息，不向企业披露专家身份，仅告知“已按规定启动回避”
        const payload = e.event_type === "RECUSAL_DECIDED" ? { notice: "已按规定启动评审回避" } : sanitizePayload(p);
        feedback.push({ event_id: e.event_id, event_type: e.event_type, occurred_at: e.occurred_at, summary: e.summary, payload });
      }
    }
    return {
      application_id: app.application_id,
      stream_id: app.stream_id,
      status: app.status,
      project_id: app.project_id,
      feedback,
      evidence_ids: project
        ? [...state.evidences.values()].filter((v) => groupOf(state, v.subject_id) === ownGroup && v.project_id === project.project_id).map((v) => v.evidence_id)
        : [],
    };
  });
}

/** 过滤一个事件列表：去掉不可见事件，并对可见事件剥离敏感字段。 */
export function filterEvents(state, viewer, events = state.events) {
  return events
    .filter((e) => eventVisible(state, viewer, e))
    .map((e) => stripSensitive(e));
}

function eventVisible(state, viewer, e) {
  if (viewer.role === "PROVINCIAL_PLAN_OFFICER" || viewer.role === "PROVINCIAL_FINANCE_OFFICER") return true;
  const p = e.payload ?? {};
  if (p.application_id) {
    const app = state.applications.get(p.application_id);
    if (app && canSeeApplication(state, viewer, app)) return true;
  }
  if (p.project_id) {
    const proj = state.projects.get(p.project_id);
    if (proj && canSeeProject(state, viewer, proj)) return true;
  }
  if (e.aggregate_type === "funding_application") return state.applications.has(e.aggregate_id) && canSeeApplication(state, viewer, state.applications.get(e.aggregate_id));
  if (e.aggregate_type === "funded_project") return state.projects.has(e.aggregate_id) && canSeeProject(state, viewer, state.projects.get(e.aggregate_id));
  if (e.aggregate_type === "evidence_pack") {
    const pack = state.evidences.get(e.aggregate_id);
    return pack ? canSeeEvidence(state, viewer, pack) : false;
  }
  return false;
}

function stripSensitive(event) {
  const clone = { ...event };
  for (const k of SENSITIVE_EVENT_FIELDS) delete clone[k];
  return clone;
}

function sanitizePayload(p) {
  const clone = { ...p };
  delete clone.reviewer_id; // 不向企业披露评审专家身份
  return clone;
}
