# 0021. The full prototype: prototype mode shows the whole app

- **Date:** 2026-10-27
- **Status:** accepted (owner, 2026-10-27). It widens ADR 0019 and ground rule 9 of the migration plan, and adds step P to the plan. The working plan is `.router/PLAN.md` while step P runs.

## Context

ADR 0019 built prototype mode: the real app on example data, owner only, off at every start. Every screen showed in it, but the screens no step had built yet (Today, Deliver, Insights, Team, most of Close) were empty "still being built" cards, and built screens lacked the parts that wait on later steps.

The owner asked (2026-10-27) for prototype mode to show the **full app**: every screen, tab, button, feature and behaviour that is in the app now or will be, for steps that are done, half done or not started. The reasons: to try the whole app quickly in different situations, to fix what exists, and to fix the design of the coming steps before they are built, all in one place where the comments land.

The owner's condition: the prototype **can never drift** from the real app.

The design spec is now `design/workbench-v6/`, which replaces `design/workbench-prototype/` (v3). Another AI made v6 with little input from the owner, and it changed parts the app had already built from v3 (Find and Reach). The owner asked that v6 be questioned, not copied: quality of life, layout, features, workflows, and choices that come down to taste.

## Decision

1. **One app, one set of screens.** Prototype mode is not a copy. Every missing screen and feature is built once, as the real React screen with its real local logic (in `packages/core` and main), running on the example data. A later step only connects what has to reach the outside world (Gmail, Gemini, YouTube, Supabase, R2) and turns the screen on in live mode. Nothing is built twice.
2. **The live gate stays** (ADR 0016, `renderer/lib/wired.ts`). In live mode only what is wired to real data shows. A screen, tab or action is added to `liveWired` when it reads and writes only real data. Prototype mode (`source: "example"`) shows everything.
3. **The no-drift check.** A unit test fails if a file outside an allowlist imports the prototype-mode state (`renderer/lib/prototype.ts`). The allowlist is the prototype chrome only: the comment tool (`renderer/prototype/**`), the state itself (`lib/prototype*.ts`), the start that reads its status (`app/start.tsx`), the frame that mounts the comment layer (`app/app.tsx`), the top bar's chip (`app/top-bar.tsx`), the palette's prototype entries (`overlays/commands.ts`, `overlays/palette.tsx`), and Settings › Prototype mode with its visibility (`lib/settings.ts`, `settings/settings-screen.tsx`, `settings/results.tsx`, `settings/prototype-section.tsx`). These are exactly the files that read it when step P began. So no screen can show different buttons, layout or behaviour because prototype mode is on. Screens may still check the data source for the live gate and for the stand-ins example data already uses (ADR 0019 D3).
4. **Actions that would leave the computer** use the stand-ins example data already has: sends are recorded locally, drafts are filled without Gemini, and an e-signature link, an invoice email or a share is a local record. Main keeps refusing the thirteen outside calls while prototype mode is on (ADR 0019 D6).
5. **New data goes into local-only tables** the sync never reads (for example `deal_details`, `brand_details`, `day_state`), or local-only columns marked "no Supabase column yet", as `deals.flow_step` already is. The sync and Supabase are not touched in step P. Each later step that wires a screen decides its Supabase columns, with grants (supabase/README.md) and the owner's go for production.
6. **The spec is `design/workbench-v6/`,** questioned, not copied. Where v6 differs from what is built and the choice is taste, the owner decides. Where it only adds something, it is added. The owner's answers so far:
   - **Approving a draft:** one draft card everywhere. Today shows it in its work pane; Review in Reach or Close keeps opening it beside where you are (v6 sent every Review to Today).
   - **Review new keys:** the app's keys stay (R asks for the reason, 1 to 4 reject with a reason, O opens). Added from v6: N for Never contact, a fifth reason "Bot / fake engagement" on 5, and Enter opens as well as O.
   - **The creator record:** the Overview matches the creator's stage and shows what that stage needs at a glance (just found: recent videos, subscribers, median views and the rest that helps decide). Nothing is lost: every fact has its own tab. Tabs: Overview, Channel, Videos, Sponsors, Contacts, Audience, Emails, Deals, Notes, Activity. The tab names beyond the owner's (Overview, Emails, Deals, Notes, Activity) are a proposal for the owner to check in prototype mode. The brand and deal records follow the same pattern.
   - **Insights** (2026-10-27): built to [product/insights-design.md](../product/insights-design.md), not v6's. It has six tabs, a verdict and an action on every number, and Search over four views of the catalog. Replies are tracked, opens and clicks are not. It runs right after P1. Prototype mode shows the full Insights; live mode shows the parts with real data as soon as they are built.
   - **Toolbox:** tabs, like every other screen (v6 used a list and a detail pane). It gains Calculator and Notifications.
   - Added without asking, because they only add: search and filter chips on Reach › Replies, brands on the Reach board with an Everyone/Mine switch and Signed capped at 6, a Creators/Brands switch on Sequences, the triage card's extra facts, the Gallery's three new signals, the G-key hint bar, Recent and brand and deal results in the palette, stepping through a list on the record page, and a link from Reach › Mailboxes to Connect a mailbox in Settings › Connections.
   - Left out of v6: its Plan page, design-notes layer, layout switcher, demo reset and JSON export (prototype chrome the app does differently), the light theme, and Talent Managers (dropped 2026-10-27).
7. **Team work shows in the prototype too.** The Team screen, hand-offs, "see the app as a teammate", VA onboarding and Settings › Team and money are built on example data in step P's last part, so the owner can design them now. Solo first still holds for what makes them real: R2 sharing, syncing hand-offs and teammates' runs wait for step T, and none of it shows in live mode before then. This changes ADR 0019's note that "see the app as a teammate" moved to step T (T4): its screen is built in P9 on example data, and T4 makes it real.
8. **The four gaps on hold** (`search-1`, `first-1`, `mail-1`, `mail-2`) stay out, until the owner says otherwise.

## Consequences

- Live mode gains Today (P4) and the additions to screens already wired (D6), where they run on real data. Anything that needs data live mode doesn't have yet (brands on the Reach board, brand sequences) stays behind `liveWired` until its step.
- Steps 7 (Today), 8 (parts 2 and 3) and 9 shrink to wiring live data where step P built the screen. Today (step 7 part 1) is built in step P and wired live in the same part, because its first buckets read only local data.
- The example seed grows to v6's size (about 37 creators, 10 brands, 8 deals, with every field the screens show), and its tests change with it.
- `docs/feedback/comments.json` becomes the main way the owner steers the coming steps.
- Docs that pointed at `design/workbench-prototype/` now point at `design/workbench-v6/`. The v3 folder stays until step 11's cleanup.
