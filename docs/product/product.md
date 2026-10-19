# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Prototype: delegated. React 18 + htm loaded from a CDN, no build step, so it runs as a published page and can seed a later React app. The real product today is a Flutter desktop app (Windows, PC-first) with a SQLite mirror, Supabase team sync and a Python pipeline. Moving the real app to Electron + React + TypeScript is under consideration and undecided.

## Users

- Primary, next six months: the agency owner, who runs the whole flow personally, from finding creators to collecting money and pitching the next deal.
- Later: employees and VAs who take over the daily volume (finds, contacts, sends, follow-ups). They must be able to learn the tool fast without the owner explaining every screen.

## Product Purpose

An influencer-marketing agency workbench for AI-niche YouTube creators and AI-tool sponsors. It covers the agency's full framework in one place: find and qualify creators, get contacts, cold outreach with 2–3 follow-ups, replies, media kits and rates, audience checks (US/UK/CA/AU in the top 3), signing creators (about 5 per 1,000 emails), finding and qualifying brands, pitching 1–2 signed creators per brand, negotiating, contracts (the creator signs first, then the agency signs with the brand), brief and draft review, pre-live checks, go-live email, invoice on go-live day (Net 30), 30-day report, paying the creator once the brand has paid, and pitching the next deal. Across everything: a daily to-do of about 4 hours, team/VA scaling, and mailbox health.

Success: the owner opens one screen each morning, works down what matters in order, and nothing that leads to money is forgotten or buried.

## Positioning

A single next-action queue for the whole agency journey, fed by the agency's own pipeline (YouTube search runs, Gemini-drafted emails written to the house rules, a person approving every send), rather than a generic CRM the owner has to remember to check.

## Operating Context

- Desktop PC, long daily sessions; keyboard and mouse.
- Searches run as background jobs from a Python pipeline; Gemini drafts emails through a local bridge.
- Every outgoing email is approved by a person's click; nothing sends on its own.
- Replies: the app reads the outreach mailboxes by default and shows each reply on the right record. A small, quiet way to paste a reply by hand must exist for failures or edge cases.
- Several outreach mailboxes with daily caps, warm-up periods and bounce monitoring.

## Capabilities and Constraints

- English only for now. Arabic may come later; layout uses logical (direction-neutral) CSS so it can be mirrored, but no RTL work is in scope.
- Current app pain points (from the UI map): lag, unclear workflow, missing actions, hard to understand, functions buried across many screens.
- Undecided: role permissions for VAs, whether VAs see money, per-person daily budgets.

## Brand Commitments

Gratovo name. The existing app palette (deep navy surfaces, Gratovo blue #0079ba / #4cb6ef) is the incumbent identity.

## Evidence on Hand

No real customer data in the prototype. All creators, brands, deals and numbers are invented AI-niche examples and must be marked as example data.

## Product Principles

1. Start every day in one place; order work by how close it is to money.
2. Every creator, brand and deal shows its step and the one action that moves it.
3. Routine volume is done one item at a time with the keyboard; judgment calls get the full record.
4. Every action confirms itself: what happened, where it went, what is next, and how to undo it.
5. Gates only where mistakes are expensive (wrong address, prices, caps, money order); everything else is undoable.
