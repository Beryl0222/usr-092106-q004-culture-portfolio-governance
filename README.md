# 文化项目组合治理

本仓库保存该服务的领域资料、事件契约与最小校验实现，供业务团队在统一语义上继续建设。

## 已有内容

- `docs/domain-model.md`：领域模型——规划目标、考核期与年度指标、专项、申报主体与控制关系、联合申报、立项、预算来源、合同支付、里程碑、证据、成果唯一计量、决定链、看板与公开发布。
- `docs/event-catalog.md`：事件目录（聚合、必填载荷、发起权限、幂等键、更正模式）与版本兼容约定。
- `docs/governance-rules.md`：治理规则 G1–G11（拆单防控、决定链权限矩阵、预算闭合、拨付幂等、同果只计一次、考核期锁定、公开反推断防护、企业侧可见性、接收侧检查顺序）。
- `contracts/domain.schema.json`：领域事件信封 schema（枚举与 `src/catalog.js` 同步，只增不删）。
- `src/catalog.js`：事件/聚合枚举、角色与决定权限、决定绑定、幂等要求、公开阈值的机器可读来源。
- `src/validator.js`：`validateEvent`（基础信封，向后兼容）与 `validateGovernanceEvent`（决定链、幂等键等载荷级校验）。
- `src/portfolio.js`：事件折叠器——版本连续性、G2/G4/G6–G11 业务不变量执行、控制关系闭包（G3 穿透查重）与企业侧只读视图（强制主体范围与敏感字段脱敏）。
- `data/sample.json`：既有最简中文样例（继续通过基础校验）。
- `data/samples/`：
  - `portfolio-events.js` / `.json`：贯穿科技融合、县域文化消费、文旅协同三个专项的端到端事件流（拆单认定、回避、联合申报、延期、迟报重复上传阻断、成果去重、终止追回、期锁定、公开抑制）；
  - `violations.js`：11 个必须被拒绝的违规场景。
- `tests/`：契约一致性与全部不变量的测试。

## 领域边界

事件一旦被接收，其标识、发生时间和版本不得原地改写；同一聚合内 version 严格 +1，业务更正产生后继记录并以 `causation_id` 链接。事实（申报、提交、请求）与决定（审查结论、调剂、延期、终止、追回）分离：生效事件必须引用有权角色作出的、结论相符的 `REVIEW_DECISION_RECORDED`。涉及个人、机构或商业敏感信息时，调用方只读取完成职责所必需的字段；企业侧只能看到自身（含授权联合成员）的申报、证据状态与反馈。

## 本地检查

```bash
node --test
```

导出 JSON 样例（修改构建器后重新生成）：

```bash
node --input-type=module -e "
import { writeFileSync } from 'node:fs';
import { buildPortfolio } from './data/samples/portfolio-events.js';
writeFileSync('data/samples/portfolio-events.json', JSON.stringify(buildPortfolio(), null, 2) + '\n');
"
```
