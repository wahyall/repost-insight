# Progress and context guards

Behavioral rules unless a host adapter documents a supported hard limit:

- Same tool + materially same arguments + unchanged state: reuse the result.
- Before repeating, identify the new information or state the call will produce.
- Break A → B → A → B when the second cycle adds no evidence; summarize the gap
  and choose a different hypothesis/tool or checkpoint the blocker.
- Retry only transient failures, at most twice with backoff per unchanged operation.
  Do not retry schema, credentials, permission or daily-quota failures unchanged.
- Search → filter → relevant range. Bound output at the tool; avoid full DOM,
  logs, SQL results, minified lines, directories, histories or source dumps.
- Read stable rules once; refresh plan/context only after possible drift. Store
  stable policy separately from task state. Do not claim cache/token savings without metrics.
- Default subagents zero; no planner/implementer/reviewer/verifier swarm by habit.
  If useful and authorized, use bounded independent scopes and compact results.
- Use one browser surface for reproduction; another only for a distinct diagnosis.
- No broad research for a typo, no reasoning MCP stacked on native reasoning.
- Stop verification after relevant checks pass unless new changes or evidence justify more.
- If the host exposes step/output limits, checkpoint before exhausting them.
  Limits must not turn incomplete work into a DONE claim.
