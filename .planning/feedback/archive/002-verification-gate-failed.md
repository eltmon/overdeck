---
specialist: verification-gate
issueId: PAN-699
outcome: failed
timestamp: 2026-04-21T04:24:30Z
---

VERIFICATION FAILED for PAN-699 (attempt 1/10):

Failed check: test

Verification FAILED at test (21607ms):

div>[39m
    [36m</div>[39m
  [36m</div>[39m
[36m</body>[39m
 ❯ Object.getElementError ../../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/config.js:37:19
 ❯ ../../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/query-helpers.js:76:38
 ❯ ../../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/query-helpers.js:52:17
 ❯ ../../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/query-helpers.js:95:19
 ❯ src/components/TerminalPanel.test.tsx:83:19
     81|     renderTerminalPanel(agent);
     82| 
     83|     expect(screen.getByTestId('activity-view')).toHaveAttribute('data-…
       |                   ^
     84|   });
     85| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL |panopticon-dashboard|  src/components/TerminalPanel.test.tsx > TerminalPanel — planning agent routing > hides the popout button for planning agents showing ActivityView
Error: expect(element).not.toBeInTheDocument()

expected document not to contain element, found <button
  class="p-1 rounded transition-colors hover:bg-white/10"
  style="color: rgb(146, 164, 201);"
  title="Pop out terminal"
>
  <svg
    class="lucide lucide-external-link w-3.5 h-3.5"
    fill="none"
    height="24"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    viewBox="0 0 24 24"
    width="24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M15 3h6v6"
    />
    <path
      d="M10 14 21 3"
    />
    <path
      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
    />
  </svg>
</button> instead
 ❯ src/components/TerminalPanel.test.tsx:90:57
     88|     renderTerminalPanel(agent);
     89| 
     90|     expect(screen.queryByTitle('Pop out terminal')).not.toBeInTheDocum…
       |                                                         ^
     91|   });
     92| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-699 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-699 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.
