# 文化项目组合治理

本仓库保存文化产业“十五五”项目组合治理服务的领域资料、事件契约与可执行校验，
供业务团队在统一语义上继续建设。

## 目录

- `contracts/domain.schema.json`：领域事件信封、事件/聚合枚举与可选追溯字段。
- `data/sample.json`：最初的中文信封样例（仍受支持）。
- `data/sample-events.json`：端到端中文事件流（E001–E095），覆盖拆单、回避、调剂、
  延期、终止、追回、迟报阻断、重复材料去重、成果唯一计绩、政策更名、考核期锁定等场景。
- `src/catalog.js`：事件目录、决定权限矩阵、决定因果约定、阈值与区域/指标字典。
- `src/state.js`：不可变事件流 → 当前快照与索引（控制集团、支出、指纹、成果）。
- `src/invariants.js`：重复资金、幂等、锁定、决定链、支付护栏、成果去重等全量不变量。
- `src/read-models.js`：资金集中、城乡缺口、里程碑风险三个看板读模型，单元格携带
  「目标→申报→项目→支付/里程碑→证据→事件」逐级溯源链。
- `src/access.js`：企业/评审/县级/省级行级访问范围与企业申报反馈桌面。
- `src/public-view.js`：公开汇总的 k-匿名、主导份额、舍入与差分反推防护。
- `src/validator.js`：基础事件信封校验（原有）。
- `docs/领域模型.md`：聚合、规则、决定链、下钻与隐私口径的完整说明。
- `tests/`：信封契约、不变量（含违规反例）、读模型、访问隔离、公开隐私测试。

## 领域边界

事件一旦被接收，其标识、发生时间和版本不应被原地改写；业务更正应产生后继记录（更高
`version`）。本次扩展全部为向后兼容的新增：原 7 个必填信封字段、原事件/聚合枚举名称保持
不变。涉及个人、机构或商业敏感信息时，调用方只读取完成职责所必需的字段；公开汇总不得
下钻到主体与项目。

## 本地检查

```bash
node --test
```

快速体验（读样例 → 归建 → 校验 → 看板 → 公开口径）：

```bash
node -e "import('./src/state.js').then(async ({fold})=>{const fs=await import('node:fs/promises');const {checkInvariants}=await import('./src/invariants.js');const {fundingConcentration}=await import('./src/read-models.js');const {publishSummary}=await import('./src/public-view.js');const s=fold(JSON.parse(await fs.readFile('./data/sample-events.json','utf8')));console.log('校验结果:',checkInvariants(s,{asOf:'2027-03-10T00:00:00+08:00'}).length,'条 finding');console.log(JSON.stringify(fundingConcentration(s,{period_id:'period-2026'}).rows.map(r=>[r.stream_name,r.approved_total_wan,r.top_share,r.concentration_alert]),null,1));console.log('公开格:',publishSummary(s).funding_by_stream_year.length);})"
```
