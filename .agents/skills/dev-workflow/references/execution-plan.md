# Adaptive execution-plan lifecycle

An Andino plan is a live, portable handoff contract. It records durable ticket
state, not a transcript, and scales its density to the work.

## Select the minimum useful depth

| Depth | Use when | Expected density |
| --- | --- | --- |
| LITE | A small task needs a requested plan, cross-session checkpoint, or minimal coordination | Objective, observable acceptance, constraints, current state, 1–3 phases, verification and NEXT ACTION. |
| STANDARD | Default non-trivial ticket with a clear local boundary | LITE plus snapshot, relevant scope/context, approach or impact map, richer phase contracts, decisions and verification mapping where useful. |
| DEEP | Architecture, migration, difficult unknown root cause, security-sensitive or long-running multi-subsystem work where mistakes or handoff are costly | STANDARD plus evidence-backed technical contracts, dependencies, findings, revisions, gates, detailed verification and handoff context. |

Task class and plan depth are related but not identical: SIMPLE normally has no
plan, STANDARD normally uses STANDARD, and COMPLEX uses STANDARD or DEEP. A feature,
many files, or a long prompt alone does not make a plan DEEP. Escalate or de-escalate
when evidence changes ambiguity, risk, or handoff cost; preserve the change in Plan
Revisions. Depth controls planning density, never workflow or worker routing.

## Create and evolve one plan

Use the user's path or repository convention; otherwise use
`docs/exec-plans/active/<ticket>.md`. Reuse an existing ticket plan rather than
starting a parallel lifecycle. Start from [the adaptive template](execution-plan-template.md),
remove optional sections that add no handoff value, and replace placeholders with
facts or explicit `UNKNOWN` or `TBD AFTER INVESTIGATION`.

The header, Executive Snapshot, Objective, Acceptance Criteria, Execution Board and
NEXT ACTION are required for an active STANDARD or DEEP plan. LITE may combine the
snapshot with Current State and omit detailed phase sections. Add scope, user
decisions, technical context, baseline, architecture, file impact, findings,
revisions, verification matrix, approval gates, Git information or limitations only
when they materially constrain execution or proof.

Keep planned and actual state distinct:

- Goal, Technical Contract, Implementation Steps and planned Verification describe intent.
- Result / Evidence, Files / Areas Touched and Progress Log record outcomes.
- Deviations preserve what changed, why, and the supporting evidence.
- The Execution Board is the live index and must agree with phase detail.

Do not invent files, symbols, commands, branches, root causes, metrics or steps before
inspection. Prefer a bounded unknown over professional-looking fiction. Exclude raw
reasoning, large logs or diffs, copied source, credentials, repeated repository rules
and repeated facts. Compact completed phases once evidence and material decisions
remain sufficient to resume.

## Phase, debugging and gate semantics

Canonical phase statuses are `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, and `SKIPPED`.
Normally exactly one phase is `IN_PROGRESS`. A DONE phase keeps relevant actual
evidence; a BLOCKED phase names its blocker. Debug plans begin with reproduction and
investigation; concrete fix detail remains TBD until evidence confirms root cause.
Use Findings / Root Cause with `CONFIRMED`, `REJECTED`, and `UNKNOWN` so a fresh agent
does not repeat discarded hypotheses.

When policy requires approval for a destructive Git action, production side effect,
irreversible migration, or manual acceptance, add an `APPROVAL GATE` naming the action
and `Status: WAITING` or `APPROVED`. Do not create gates for ordinary edits, and do not
perform the gated action while waiting.

## Checkpoint, resume and completion

Update the plan at material discoveries, phase completion, strategy/depth changes,
blockers, verification and handoff. The Executive Snapshot should let a fresh agent
understand the objective, progress, critical decision and immediate next action in
about 30 seconds. NEXT ACTION names the first file/symbol or question, the concrete
action, and the next check. Follow [handoff](handoff.md) on resume.

At completion, record final observable acceptance and evidence, set actual board
statuses, retain material decisions/revisions and set `Status: DONE`. NEXT ACTION is
`None — ticket complete` or a real user/follow-up action, never a fake pending phase.
Move the plan to the repository's completed location and update direct links; if an
external ticket relies on its old path, leave a short forwarding pointer.

## Deterministic validation

Where the repository provides validation, check at least:

- valid plan depth and phase statuses;
- Current Phase exists in the board and normally exactly one phase is IN_PROGRESS;
- board and detailed phase statuses agree;
- DONE phases include relevant result/evidence; BLOCKED phases name a blocker;
- active plans have a concrete NEXT ACTION and preserve acceptance criteria;
- mandatory sections are non-empty and mature plans contain no template placeholders;
- completed plans contain no fake pending phase;
- material history is append-oriented rather than silently rewritten.

Mechanical checks complement review: they cannot prove technical truth, sufficient
evidence, or handoff clarity.
