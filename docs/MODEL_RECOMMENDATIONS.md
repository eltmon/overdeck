# Panopticon Model Recommendations

Optimal AI model assignments for each agent task based on research from January 2026.

## Summary

| Task Category | Speed | Quality | Cost | Recommended Model |
|--------------|-------|---------|------|-------------------|
| Exploration/Planning | Slow | Critical | High | **Claude Opus 4.5** |
| Implementation/Testing | Medium | Critical | Medium | **Claude Sonnet 4.5** |
| Code Review (Security) | Slow | Critical | High | **Claude Opus 4.5** |
| Subagent (Explore/Bash) | Fast | Medium | Low | **Claude Haiku 4.5** |
| Triage/Quick CLI | Very Fast | Medium | Low | **Claude Haiku 4.5** |

## Performance Benchmarks (2025-2026)

### SWE-Bench Verified (Bug Fixing)
- Claude Opus 4.5: **80.9%**
- Claude Sonnet 4.5: **82%** (with parallel attempts)
- Claude Haiku 4.5: **73.3%**
- GLM-4.7: 73.8%
- GPT-4o: ~68%
- Kimi K2: ~65%
- Gemini 2.5 Pro: 63.2%

### Speed Rankings
1. Gemini 2.0 Flash (6.25s for 500-word output)
2. Claude Haiku 4.5 (2x faster than Sonnet)
3. GLM-4 Flash (ultra-low latency)

## Detailed Recommendations

### High-Complexity Tasks (Opus 4.5)

**Exploration Phase** (`issue-agent:exploration`)
- Deep codebase understanding required
- Architectural discovery and mapping
- Trade-off: Higher cost justified by better planning foundation

**Planning Phase** (`issue-agent:planning`)
- Critical architectural decisions
- Multi-system impact analysis
- Trade-off: 80.9% SWE-bench accuracy ensures solid plans

**Security Reviewer** (`convoy:security-reviewer`)
- SAFETY CRITICAL - no compromises
- Threat modeling and vulnerability detection
- Trade-off: Security bugs are 10-100x more expensive to fix later

**Review Agent** (`specialist-review-agent`)
- Deep code analysis for subtle issues
- Architectural pattern validation
- Trade-off: Quality reviews prevent production bugs

### Quality-Critical Tasks (Sonnet 4.5)

**Implementation** (`issue-agent:implementation`)
- Best coding model: 82% SWE-bench with parallel attempts
- Excellent balance of speed and quality
- Trade-off: $3/$15 per million tokens

**Testing** (`issue-agent:testing`)
- Comprehensive test coverage generation
- Edge case identification
- Trade-off: Test quality directly impacts CI/CD reliability

**Documentation** (`issue-agent:documentation`)
- Contextual, well-structured documentation
- Consistent technical writing quality

**Review Response** (`issue-agent:review-response`)
- Nuanced feedback understanding
- Targeted, high-quality fixes

**Test Agent** (`specialist-test-agent`)
- Comprehensive test suite generation
- Multi-step reasoning for edge cases

**Merge Agent** (`specialist-merge-agent`)
- Context understanding for conflict resolution
- Code semantics preservation

**Performance Reviewer** (`convoy:performance-reviewer`)
- Algorithmic analysis
- Bottleneck identification

**Correctness Reviewer** (`convoy:correctness-reviewer`)
- Logic validation
- Off-by-one and edge case detection

**Synthesis Agent** (`convoy:synthesis-agent`)
- Review aggregation
- Coherent recommendations from multiple perspectives

**General Subagent** (`subagent:general-purpose`)
- Versatile fallback for unknown task types

**PRD Agent** (`prd-agent`)
- Detailed requirements documentation
- Comprehensive feature specification

**Planning Agent** (`planning-agent`)
- Sprint planning quality
- Dependency analysis

**Interactive CLI** (`cli:interactive`)
- Conversation quality for extended sessions
- Context retention (200K token window)

### Speed-Critical Tasks (Haiku 4.5)

**Explore Subagent** (`subagent:explore`)
- SPEED CRITICAL - codebase scanning
- 73.3% SWE-bench is excellent for exploration
- Trade-off: 2x faster than Sonnet, 1/3 cost

**Plan Subagent** (`subagent:plan`)
- Fast task breakdown
- Initial planning drafts

**Bash Subagent** (`subagent:bash`)
- Simple CLI generation
- Lower-risk operations

**Decomposition Agent** (`decomposition-agent`)
- Fast epic breakdown
- Initial work item generation

**Triage Agent** (`triage-agent`)
- SPEED CRITICAL for real-time prioritization
- Frequent operations don't require deep analysis

**Quick Command CLI** (`cli:quick-command`)
- SPEED CRITICAL - users expect instant responses
- Simple queries don't need deep reasoning

## Cost Analysis

### Claude Family (USD per million tokens)
| Model | Input | Output | Batch Discount |
|-------|-------|--------|----------------|
| Haiku 4.5 | $1 | $5 | 50% |
| Sonnet 4.5 | $3 | $15 | 50% |
| Opus 4.5 | $5 | $25 | 50% |

### Recommended Cost Distribution
- **60%** of operations: Haiku 4.5 (exploration, planning subagents, triage)
- **35%** of operations: Sonnet 4.5 (implementation, testing, documentation)
- **5%** of operations: Opus 4.5 (security review, architecture, critical planning)

### Monthly Cost Estimate (100 agent-hours)
- Budget approach (all Haiku): ~$500/month
- Balanced approach (this config): ~$1,200/month
- Premium approach (all Opus): ~$5,000/month

## Alternative Models

### For Cost-Sensitive Deployments
- **GLM-4 Flash**: $0.10/M tokens (100x cheaper than Opus)
- **GLM-4.7**: 73.8% SWE-bench, $2.20/M tokens
- **Kimi K2**: Strong coding, ~$1-3/M tokens

### For International Users
- **Kimi K2** (Moonshot): Excellent for Chinese language support
- **GLM-4 Long**: 1M token context window

## Optimization Strategies

### 1. Batch Processing
Enable batch mode for 50% cost reduction on non-urgent operations:
- Documentation updates
- Bulk test generation
- PR review batches

### 2. Cascade Approach
Run fast Haiku pass first, escalate to Sonnet/Opus only when complexity detected:
- Decomposition: Haiku draft → Sonnet validation
- Code review: Haiku scan → Opus deep analysis for flagged issues

### 3. Parallel Processing
Run multiple models simultaneously for critical decisions:
- Security: Opus primary + Sonnet verification
- Implementation: Sonnet primary + Haiku for syntax checks

## Sources

- [Claude AI Models 2025: Opus vs Sonnet vs Haiku Guide - DEV Community](https://dev.to/dr_hernani_costa/claude-ai-models-2025-opus-vs-sonnet-vs-haiku-guide-24mn)
- [Claude Opus 4.5: Benchmarks, Agents, Tools, and More - DataCamp](https://www.datacamp.com/blog/claude-opus-4-5)
- [Claude Haiku 4.5 Deep Dive - Caylent](https://caylent.com/blog/claude-haiku-4-5-deep-dive-cost-capabilities-and-the-multi-agent-opportunity)
- [Claude API Pricing Guide 2026 - AI Free API](https://www.aifreeapi.com/en/posts/claude-api-pricing-per-million-tokens)
- [Kimi K2 vs Qwen 3 vs GLM 4.5 - Clarifai](https://www.clarifai.com/blog/kimi-k2-vs-qwen-3-vs-glm-4-5)
- [GLM-4.7 Benchmark Analysis - Towards AI](https://pub.towardsai.net/the-14-vs-2-plot-twist-why-glm-4-7-just-broke-the-ai-leaderboard-addeef80a2f8)
- [LLM Latency Benchmark 2026 - AIM](https://research.aimultiple.com/llm-latency-benchmark/)
