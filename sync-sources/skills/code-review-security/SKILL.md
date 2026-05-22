---
name: code-review-security
description: Deep security analysis focusing on OWASP Top 10
---

# Security Review

Deep security analysis focus:

## OWASP Top 10 Checklist
- [ ] Injection (SQL, NoSQL, OS, LDAP)
- [ ] Broken Authentication
- [ ] Sensitive Data Exposure
- [ ] XML External Entities (XXE)
- [ ] Broken Access Control
- [ ] Security Misconfiguration
- [ ] Cross-Site Scripting (XSS)
- [ ] Insecure Deserialization
- [ ] Using Components with Known Vulnerabilities
- [ ] Insufficient Logging & Monitoring

## Additional Checks
- Hardcoded secrets or credentials
- Path traversal vulnerabilities
- SSRF (Server-Side Request Forgery)
- Cryptographic weaknesses
- Rate limiting gaps

## Output Format
For each finding:
- **Severity**: Critical/High/Medium/Low
- **Location**: file:line
- **Description**: What's wrong
- **Impact**: What could happen
- **Remediation**: How to fix
