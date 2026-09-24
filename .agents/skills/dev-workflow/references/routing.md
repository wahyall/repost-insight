# Capability routing

## Plan depth is not capability routing

Select plan density conservatively before selecting a worker: SIMPLE normally has
no plan and uses LITE only when a checkpoint is required; STANDARD uses STANDARD;
COMPLEX uses STANDARD unless DEEP detail materially reduces ambiguity, risk, or
handoff cost. File count, a long prompt, or the word "feature" does not justify DEEP.
Escalate or de-escalate after evidence changes the real complexity, and record a
material depth change as a plan revision. This choice does not create another
workflow router or change worker invocation policy.

Select by the current phase, not a flat manifest. Native filesystem/search/shell/Git
and fetching are preferred when they already answer the question. Resolve installed
names through the host catalog. If absent, apply the method directly; do not install
alternatives simply to fill the catalog.

Respect native invocation controls. Installed does not mean model-invokable.
For explicit-only workers, recommend the user's native invocation when that method
is needed; never reproduce a blocked skill through file reads or alternate tools.
Do ordinary task work within the available permissions without claiming a worker
was invoked. Codex implicit policy, Claude manual-only mode and OpenCode V1 deny
permissions have different semantics; there is no universal hidden-but-callable mode.
Antigravity's scoped descriptions are behavioral guidance, not a native hard switch.

| Need | Default worker / instrument | Boundary |
| --- | --- | --- |
| Unknown bug root cause | systematic-debugging | reproduce/trace first; regression evidence |
| Behavior needing a regression or executable contract | test-driven-development | use project tests; skip test ceremony for text-only edits |
| Completion claim | verification-before-completion | actual relevant evidence, no repeated full suites |
| Review | code-review-and-quality | targeted diff and actionable defects; no unsolicited rewrite |
| Unclear product requirements | brainstorming | only unresolved product/design choices |
| Large implementation ordering | writing-plans if useful | existing plan remains durable state; no second mandatory plan lifecycle |
| Structural relationship | existing Graphify or symbol/reference search | verify current source; no automatic graph generation |
| Historical decisions | claude-mem targeted search → timeline → selected detail | any working host integration; no automatic per-prompt retrieval |
| Visual character | design-taste-frontend (`taste-skill` alias) | landing/portfolio/redesign scope |
| UX, accessibility, dashboard, design system | ui-ux-pro-max | project stack and accepted design win |
| Both visual character and deeper UX/system work | both UI skills | use [UI coexistence](ui-coexistence.md); one direction, no duplicate workflow |
| Fidelity clone | clone-website | preserve reference; redesign only when requested |
| Over-engineering | Ponytail or code-simplification on demand | minimum correct change; no automatic family activation |
| Version-sensitive library behavior | current official docs or Context7 | inspect dependency version first |
| Browser navigation/E2E | one native browser, Browser Harness or Playwright | DevTools for a distinct console/network/performance question |
| Database/cloud/design/media operations | corresponding project MCP/plugin | enable only relevant service; authorization still applies |

Alternative planning/debugging/TDD methods are manual; do not combine competing
methods for the same job. Retired routers redirect to Andino without invoking a
bootstrap chain. A specialized skill's generic boilerplate never overrides the
user's constraints, accepted repository contract or authorization.
