# Cost Estimate — kiro_governance POC

**Version:** 1.1
**Date:** 2026-06-11
**Author:** AWS Architect
**Region:** us-east-1
**Pricing Model:** On-Demand

---

## Monthly Cost Breakdown

| Component | Service | Config | $/mo |
|---|---|---|---|
| MCP Server | EC2 t3.micro | On-demand, us-east-1, Linux | $8.47 |
| DynamoDB | DynamoDB on-demand | PAY_PER_REQUEST, <25 WCU/RCU (free tier) | $0.00 |
| GitHub Actions | GitHub (free tier) | 2,000 min/mo included | $0.00 |
| SSM Parameter Store | SSM | Standard tier, <10 parameters | $0.00 |
| **Total** | | | **~$8.47/mo** |

---

## Notes & Context

- **QuickSight and Athena removed per customer decision 2026-06-11 — dashboard is out of scope.**
- **Data transfer:** EC2 ↔ DynamoDB traffic is within-region (us-east-1) — $0.00.
- **DynamoDB detail:** POC volume is <100 writes/month and <500 reads/month. Free tier covers 25 WCU + 25 RCU provisioned-equivalent. On-demand at this volume incurs no cost.

---

## Budget Protection

| Control | Value | Rationale |
|---------|-------|-----------|
| AWS Budgets alarm | $15/mo | ~77% above estimate; catches unexpected usage without false alarms |

**Recommendation:** Set an AWS Budgets alarm at **$15/mo** (approximately 77% buffer above the $8.47 estimate). This provides early warning for cost anomalies without generating noise from minor fluctuations.

---

## Cost Scaling (Future Reference)

| Scale Factor | Impact | Estimated Cost |
|---|---|---|
| 1x (current POC) | 1 project, <100 events/mo | ~$8.47/mo |
| 5x projects | 5 projects, ~500 events/mo | ~$8.47/mo (DynamoDB still negligible) |
| 50x projects | 50 projects, ~5,000 events/mo | ~$8.97/mo (DynamoDB ~$0.50) |

At POC scale, the cost is dominated by the fixed EC2 cost ($8.47 of $8.47). Variable costs become relevant only at >10,000 events/month.

---

## Source Traceability

| Line Item | Source |
|---|---|
| EC2 t3.micro $8.47 | AWS Pricing: t3.micro on-demand us-east-1 = $0.0116/hr × 730 hrs |
| DynamoDB $0.00 | AWS Free Tier: 25 WCU + 25 RCU + 25 GB storage |
| Budget ~$8.47 | SRS NFR-05 (revised per CR 2026-06-11) |
