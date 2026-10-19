# Progress: step 3c (the app shell)

Started 2026-10-19, after #5 (the owner's answers) merged. `CONTEXT.md` is the scout's read of the prototype; `PLAN.md` is the plan for the first of three pull requests (3c-1, the frame).

## Done

- Recon: `.router/CONTEXT.md`. Its section 9 lists points settled in `PLAN.md` (decisions D1 to D11).
- Plan: `.router/PLAN.md`.
- T0 (lead): dependencies added: `immer` 11.1.21 (core); fonts `@fontsource-variable/readex-pro` and `@fontsource/ibm-plex-mono` 5.3.0, React 19.3.1 for its components (ui); Testing Library 16.3.3, user-event 14.6.8 and happy-dom 21.0.3 (root). Checked: Vite resolves a bare package path in a CSS `url()` and emits the font file.
- Reference screenshots of the prototype (light, dark, 1440 and 400 px) are made by `scratchpad/proto-ref.cjs` (not committed; rerun it).

## Next

T1, T2 and T3 in parallel; then T4, T5, T6; then T7 (verify, look, review, docs, PR).
