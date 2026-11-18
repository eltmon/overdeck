plan-digest: 4fb776b0a081c3992afcfc933a087527e8a0159048c4dccdafbb37cde4ad0c3a

## sharpens-framing: Resume success is not required

The draft's `resume-origin.ac1` accepts any status except 403, so a 401, 404 or 500 would satisfy it. `src/cli/commands/conversations/resume.ts:45-48` treats every non-2xx response as failure. The PRD also requires refusal of a wrong internal token (`.pan/drafts/pan-5516.md:21,28`), but the xBRIEF omits that case; the current route test covers it at `src/dashboard/server/routes/__tests__/conversations-resume-route.test.ts:93-97`. Change `resume-origin.ac1` to require 200 and a handler call, and add the wrong-token refusal to the xBRIEF acceptance criteria.

## sharpens-framing: Unknown-key 404 is not tested

The draft's `resume-identifiers.ac3` promises a 404, but `src/dashboard/server/routes/__tests__/conversations-resume-route.test.ts:65-66` mocks the handler to return a successful response for every key. Its unknown-key test at lines 116-119 only checks the argument. The real handler returns 404 for a missing name at `src/lib/overdeck/conversation-runtime.ts:1131-1133`. Require a route test with the real handler, or narrow `resume-identifiers.ac3` to assert only unchanged handoff and cite the existing handler's 404 test.
