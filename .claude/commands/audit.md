---
description: "Architecture audit. Surfaces deep-module opportunities + shallow wrappers in named area. Pre-redesign or quarterly. No code edits — produces refactor issues."
---

# /audit `<area>`

Wraps `improve-codebase-architecture` against `<area>` (file path, directory, or `CONTEXT.md` term). Read-only — surfaces candidates, files refactor issues, never edits code.

## Sequence

1. Read `CONTEXT.md` glossary + any ADRs in the area.
2. `Explore` subagent walks modules. Note friction: bouncing between many small modules to understand one concept, modules where interface is nearly as complex as implementation, pure functions extracted only for testability with the real bugs hiding in callers, tightly-coupled modules leaking across seams.
3. **Deletion test** per suspect module: deletion scatters complexity across N callers (deep, keep) vs vanishes it (shallow wrapper, merge inline).
4. Present numbered candidate list. Per candidate: **files** / **problem** / **solution** (plain English) / **benefits** in locality + leverage + testability. Use CONTEXT.md vocabulary for domain, `improve-codebase-architecture/LANGUAGE.md` vocabulary for architecture (module/interface/seam/depth, not "component"/"service"/"boundary").
5. **ADR conflicts.** Surface only when friction warrants reopening the ADR. Mark `_contradicts ADR-NNNN — but worth reopening because…_`. Don't list every refactor an ADR forbids.
6. User picks candidates → convert chosen ones to refactor issues via `to-issues` (label `enhancement`, `needs-triage`). No interfaces designed yet — that's the implementing PR's job.

## When to invoke

- Before any major redesign (Stock overhaul, CRM rework, dashboard restructure).
- Quarterly cadence.
- When a module has been touched ≥5 times in 30 days (shallow-seam smell — repeated edits in one place often mean the abstraction is wrong).

## Output

Numbered candidate list in chat → user picks → issues filed. **No code edits in this command.**
