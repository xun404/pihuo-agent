---
name: pihuo-simplification
description: Use when asked to identify safe simplifications in PiHuo without inventing features or weakening session, ACP, approval, and recovery contracts.
---

# PiHuo Simplification Review

Find evidence-backed reductions in code, configuration, UI states, tests, or
documentation. This is an audit skill: do not remove or refactor anything
until the user authorizes a concrete change.

## Method

1. Bound the target package, screen, or workflow; inspect its production
   callers, tests, and documented contract.
2. Classify each candidate as unreachable, duplicated, obsolete,
   over-generalized, or only apparently redundant.
3. Trace the exact consumer and lifecycle before proposing deletion or merge.
   For live worker state, include reload, snapshot hydration, terminal state,
   pending approval, cancellation, and late-event scenarios.
4. Prefer a small reversible simplification. State the behavior preserved, the
   evidence, the affected files, and the verification required.

## Do not simplify away

- loopback authentication, explicit permission choices, or approval audit
  semantics;
- ordered worker activity and worker-card placement/recovery logic;
- user-visible error, timeout, cancellation, or restart paths merely because
  they are uncommon;
- an abstraction with a real cross-boundary consumer, unless its replacement
  preserves that boundary.

Reject speculative cleanup that requires a new framework, a broad redesign, or
an invented product capability. “Not observed locally” is a lead to inspect,
not proof that a path is dead.
