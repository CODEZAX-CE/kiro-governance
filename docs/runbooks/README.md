# Runbooks — Kiro Governance Operations

Operations manuals for maintaining the Kiro Governance MCP server infrastructure.

---

## Runbooks

| Runbook | Purpose | Frequency | Risk |
|---------|---------|-----------|------|
| [cert-rotation.md](./cert-rotation.md) | Regenerate self-signed TLS certificate (yearly or if compromised) | Annually | Medium |
| [ec2-deploy.md](./ec2-deploy.md) | Deploy code to EC2, configure systemd service, set up auto-recovery | On first deploy + code updates | Medium |

---

## Quick Reference

### Certificate Rotation (OE-1)

When: Certificate expires (365 days) or if compromised  
Who: Ops/DevOps  
Time: ~10 minutes  
Steps: Regenerate cert → extract fingerprint → update GitHub Secrets + `.env` files → restart server

### EC2 Deployment (OE-2)

When: Initial deployment or code updates  
Who: DevOps  
Time: ~15 minutes (initial), ~5 minutes (updates)  
Steps: Clone repo → build → set SSM params → install systemd service → test

### EC2 Auto-Recovery (REL-1)

When: Any production deployment  
Who: DevOps  
Time: ~2 minutes  
Steps: Configure CloudWatch alarm for EC2 system health → 2 failed checks trigger automatic recover

---

## Alerting & Monitoring

### Critical Metrics

| Metric | Threshold | Action |
|--------|-----------|--------|
| MCP server down (StatusCheckFailed_System) | 2 consecutive checks | Auto-recover EC2 instance |
| API call latency (p99) | >2 seconds | Investigate DynamoDB throttling or Slack timeouts |
| Error rate | >5% of requests | Check logs for classification failures or SSM lookup errors |

### CloudWatch Logs

```bash
aws logs tail /kiro-governance/mcp-server --follow --region us-east-1
```

### Health Check

```bash
curl -k https://<elastic-ip>:443/health
```

---

## Security Considerations

1. **TLS Certificates**: Self-signed for POC. Rotate annually or immediately if compromised.
2. **API Keys**: Stored in SSM Parameter Store (SecureString). Never commit to version control.
3. **Elastic IP**: Public-facing with port 443 open to 0.0.0.0/0. For production, restrict to known CIDRs or use ALB + WAF.
4. **Secrets in `.env`**: Add to `.gitignore`. Never commit. Share via secure channels only.

---

## Support

For issues or questions:
1. Check the relevant runbook troubleshooting section
2. Review CloudWatch logs: `aws logs tail /kiro-governance/mcp-server`
3. Contact the project team
