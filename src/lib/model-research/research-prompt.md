# Model Capability Research Task

You are a research specialist tasked with gathering comprehensive data on AI model capabilities for coding tasks. Your findings will be used to intelligently route coding tasks to the best available model.

## Models to Research

Research these models across all skill dimensions:

### Anthropic
- Claude Opus 4.5 (`claude-opus-4-5`)
- Claude Sonnet 4.5 (`claude-sonnet-4-5`)
- Claude Haiku 4.5 (`claude-haiku-4-5`)

### OpenAI
- GPT-5.2 Codex (`gpt-5.2-codex`)
- O3 Deep Research (`o3-deep-research`)
- GPT-4o (`gpt-4o`)
- GPT-4o Mini (`gpt-4o-mini`)

### Google
- Gemini 3 Pro (`gemini-3-pro-preview`)
- Gemini 3 Flash (`gemini-3-flash-preview`)

### Z.AI
- GLM 4.7 (`glm-4.7`)
- GLM 4.7 Flash (`glm-4.7-flash`)

### Kimi/Moonshot
- Kimi K2 (`kimi-k2`)
- Kimi K2.5 (`kimi-k2.5`)

## Skill Dimensions to Evaluate

For each model, score these skills (0-100 scale, 100 = best in class):

1. **code-generation** - Writing new code from specifications
2. **code-review** - Finding issues, suggesting improvements
3. **debugging** - Root cause analysis, fixing bugs
4. **planning** - Architecture decisions, system design
5. **documentation** - Writing clear docs, PRDs, comments
6. **testing** - Generating tests, finding edge cases
7. **security** - Security analysis, vulnerability detection
8. **performance** - Performance optimization, bottleneck analysis
9. **synthesis** - Combining information, summarizing findings
10. **speed** - Response latency (relative, 100 = fastest)
11. **context-length** - Effective context window utilization

## Research Sources

### Benchmark Leaderboards
- LMSYS Chatbot Arena: https://chat.lmsys.org/?leaderboard
- Artificial Analysis: https://artificialanalysis.ai/
- HuggingFace Open LLM Leaderboard: https://huggingface.co/spaces/open-llm-leaderboard
- LiveCodeBench: https://livecodebench.github.io/

### Coding Benchmarks
- HumanEval scores
- MBPP (Mostly Basic Python Problems) scores
- SWE-bench scores
- CodeContests scores

### Community Sources
- Reddit r/LocalLLaMA, r/ClaudeAI, r/ChatGPT
- Hacker News discussions
- AI Discord servers
- Blog posts from AI researchers

### Pricing Information
- Official pricing pages for each provider
- Calculate average cost per 1M tokens (input + output average)

## Output Format

Produce a JSON file with this structure:

```json
{
  "research_date": "2026-01-29",
  "sources_consulted": ["list of URLs and sources"],
  "models": {
    "claude-opus-4-5": {
      "displayName": "Claude Opus 4.5",
      "provider": "anthropic",
      "costPer1MTokens": 45.0,
      "contextWindow": 200000,
      "skills": {
        "code-generation": 95,
        "code-review": 98,
        "debugging": 97,
        "planning": 98,
        "documentation": 95,
        "testing": 92,
        "security": 98,
        "performance": 90,
        "synthesis": 98,
        "speed": 40,
        "context-length": 95
      },
      "evidence": {
        "code-generation": "HumanEval: 92.1%, SWE-bench: 54%",
        "security": "Best OWASP detection rate in testing"
      },
      "notes": "Best for critical tasks requiring deep reasoning"
    }
  },
  "methodology": "Description of how scores were determined",
  "confidence_levels": {
    "high": ["claude-opus-4-5", "gpt-4o"],
    "medium": ["kimi-k2.5", "glm-4.7"],
    "low": ["models with limited benchmark data"]
  }
}
```

## Research Strategy

### Phase 1: Benchmark Collection
Spawn subagents to collect data from:
1. Official benchmark leaderboards
2. Recent research papers (2025-2026)
3. Model cards and documentation

### Phase 2: Community Analysis
Spawn subagents to analyze:
1. Reddit discussions on model comparisons
2. Developer blog posts and reviews
3. Twitter/X discussions from AI researchers

### Phase 3: Pricing Research
Gather current pricing from:
1. Official provider pricing pages
2. API documentation
3. Third-party aggregators

### Phase 4: Synthesis
Combine findings into final scores with:
1. Weighted average of benchmark scores
2. Community sentiment adjustment (+/- 5 points)
3. Confidence level based on data availability

## Important Notes

1. **Recency matters** - Prefer data from 2025-2026
2. **Coding focus** - Prioritize coding-specific benchmarks
3. **Practical > Theoretical** - Real-world performance matters more than synthetic benchmarks
4. **Cost accuracy** - Use current pricing, prices change frequently
5. **Conservative estimates** - When uncertain, score conservatively

## Deliverables

1. `research-output.json` - Complete research data in the format above
2. `research-summary.md` - Executive summary of findings
3. `score-changes.md` - Recommended changes to baseline scores with evidence

Begin your research now. Use web search and fetch capabilities to gather data.
