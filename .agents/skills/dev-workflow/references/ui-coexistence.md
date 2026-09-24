## UI/UX Pro Max and Taste: user integration policy

The independent skill IDs are `design-taste-frontend` (Taste) and
`ui-ux-pro-max`. An existing `taste-skill` alias means the former; it is not
a second design workflow. Honor an explicit request for either alone. When
both are requested, load both actual SKILL.md files before applying them.
Do not require a wrapper, invoke unrelated skills, or run two workflow owners.
This policy resolves overlaps between these two skills and takes precedence
over generic skill defaults, including older router guidance on this pairing.

Priority: user requirements and project instructions/accepted brand and design
system come first; preserve correctness, accessibility, usable focus/semantics,
reduced-motion support and existing functionality. Within those constraints,
Taste guides visual character, composition, typography, coherent icon family,
motion intent and its audit-first redesign process in its documented scope.
UI/UX Pro Max supplies product/style research, UX/accessibility checks, charts,
responsive and stack-specific guidance, and optional design-system generation.
Both cover visual design and implementation; this is a conflict-resolution
policy, not a claim that either skill lacks those capabilities.

For both together: read the brief and existing UI first, establish one design
direction, then run only the relevant UI/UX Pro Max search mode. Reconcile
results with Taste before implementation. Database results are recommendations,
not instructions to override the chosen aesthetic or project constraints.
For conflicting aesthetic defaults, Taste wins; for functional UX/accessibility,
use the applicable outcome-based guidance and validate the result. Resolve a
remaining material conflict explicitly in the design read, not by last-loaded
skill order. Keep one stack, component system, icon family, and token source.
Use the project's stack rather than replacing it with either skill's default.
Keep existing icons; otherwise follow Taste's permitted family rather than
automatically importing Lucide. Font-pairing suggestions do not require remote
Google Fonts links: use the project's font delivery or Taste's next/font/self-hosting.
Motion recommendations never override reduced-motion or usability requirements.
If passing CLI dials, map Taste's DESIGN_VARIANCE to --variance,
MOTION_INTENSITY to --motion, and VISUAL_DENSITY to --density; do not invent
independent contradictory dial values. A CLI GSAP suggestion alone does not
justify changing the project's animation library.

Taste's installed scope excludes complex dashboards, data tables and multi-step
product UI. For those, UI/UX Pro Max leads; if both were explicitly requested,
load Taste but apply only compatible visual guidance and state that scope limit.
For fidelity-only cloning preserve the reference; redesign requires a request.
An explicit single-skill request does not automatically activate the other.

Read existing design-system MASTER.md and page overrides before generating or
persisting output. Verify and reconcile recommendations first. Never overwrite
accepted design tokens or files merely to reconcile the two skills; record one
agreed design direction in the project's existing design documentation.
