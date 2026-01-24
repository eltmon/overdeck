---
name: incident-response
description: Structured approach to production incidents
---

# Incident Response

## 1. Assess (First 5 minutes)
- What is the impact? (users affected, severity)
- What is the blast radius? (which services/regions)
- Is it getting worse or stable?

## 2. Mitigate (Stop the bleeding)
- Can we rollback?
- Can we feature-flag it off?
- Can we scale/redirect traffic?
- Communicate status to stakeholders

## 3. Investigate (Once stable)
- Gather logs, metrics, traces
- Identify root cause
- Document timeline of events

## 4. Fix
- Implement permanent fix
- Test thoroughly before deploying
- Deploy with extra monitoring

## 5. Postmortem
- Document: What happened, why, how we fixed it
- Identify: What would have prevented this
- Action items: Concrete improvements
