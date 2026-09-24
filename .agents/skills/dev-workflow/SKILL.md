---
name: dev-workflow
description: Route engineering tickets with the minimum useful methodology and maintain portable execution plans. Use for non-trivial task coordination or resuming a checkpoint; simple edits may proceed directly.
---

# Dev Workflow

Project rules constrain work. The execution plan stores durable ticket state.
This skill manages that state and selects relevant workers; tools are instruments,
memory and graphs are optional context accelerators. Codex, Claude Code,
Antigravity and OpenCode are peers: the active host is primary for this session.

## Enter at the current state

1. Honor the user's scope and explicit skill choice. A capability list is availability, not an execution order.
2. If a plan is supplied or the ticket has an active plan, resume it using [handoff](references/handoff.md). Do not bootstrap again.
3. Otherwise classify by uncertainty, dependencies and risk, not file count alone:

| Class | Default process | Durable plan |
| --- | --- | --- |
| SIMPLE: typo, label, known local fix, trivial transform | understand → edit → targeted verify | normally none; LITE only when requested or needed for continuation |
| STANDARD: clear local feature/bug/refactor | objective → targeted context → implement → verify | STANDARD for non-trivial tickets; reuse an existing plan |
| COMPLEX: unclear root cause, architecture, migration, cross-system or high-risk work | investigate → relevant methodology → implement → verify → checkpoint | STANDARD or DEEP according to actual ambiguity, risk and handoff cost |

LITE, STANDARD and DEEP are planning density within this one workflow, not new
routers. For plans, use [execution-plan](references/execution-plan.md) and its template.
Ask only about ambiguity that could materially change the outcome and cannot be
resolved from current evidence. Continue independent authorized work while waiting.

## Route once, then work

Select zero or the minimum useful process/domain skills from [routing](references/routing.md).
Choose one default methodology per job. Invoke a relevant Superpowers skill directly;
do not pass through `using-superpowers`, `using-agent-skills` or the retired
`agent-skills` router. A specialist must not start a competing lifecycle.
Retain explicit user choices; the plan's checkpoint semantics remain stable.

Use current context first, then the smallest relevant source/config read.
Do not retrieve memory or load graph, UI, documentation or review tools merely
because they exist. Missing accelerators do not block work or handoff.

## Progress and completion

Apply [anti-loop](references/anti-loop.md). A repeated call needs new evidence or
changed state. Default subagents: zero. Delegate only bounded independent work
when authorized and useful. Increase reasoning effort only when difficulty warrants
it and the host supports the control; never invent runtime settings.

Update the plan at material discoveries, phase completion, strategy changes,
blockers, verification and handoff. Preserve completed history and decision reasons.
Keep CURRENT STATE, CURRENT PHASE, EVIDENCE and a concrete NEXT ACTION current.

Verify changed behavior and required project checks. Report unavailable validation
honestly. Mark DONE only when acceptance criteria are satisfied; otherwise leave
an actionable checkpoint. Do not commit, push, merge, publish or deploy without
the user's authorization for that action.
