# 0004. Prototype mode is the real app on example data

- **Date:** 2026-10-19
- **Status:** accepted (owner's request; shown working in the Workbench prototype)

## Context

The owner wants to develop and plan the app "no matter the app's state". That means seeing any screen in any condition: empty, busy, late or broken. It also means commenting on any element for future fixes. They asked that it be the app's own code with example data injected, not a clone. And they asked that it have minimal impact on normal use, "as if that mode didn't exist".

## Decision

- **One `DataSource` interface** with live and example implementations, chosen at runtime. The example source uses seeded fixtures and stand-in adapters, so nothing is sent, nothing calls Gemini or YouTube, and nothing touches the live database.
- **An owner-only switch** in Settings, off by default.
  - **On:** the live data, its undo history and running jobs are set aside, and an example copy is used.
  - **Off:** everything is restored exactly. Toasts are cleared on every switch so an Undo can't reach across.
- **When off, there is no trace.** No chip, no comment button, no pins, no bars, no key handlers, no palette entries, no comment-store connection. This is checked by an automated test.
- **Scenarios:** a normal Monday, the first day (empty), a week later (everything slipped), something broke (mailbox signed out, Gemini offline, search stopped).
- **See the app as a teammate:** their Today, with money hidden if their role hides it.
- **The comment tool:**
  - press C or use the top-bar button, point at anything, click and write;
  - pins anchor to stable `data-ui` ids on components; when the exact spot changes, the pin falls back to its section, marked as moved;
  - one list gathers every comment, and "Copy open for Claude" exports them.

## Consequences

- Every component that should be commentable carries a `data-ui` id ([conventions.md](../conventions.md)).
- Outbound adapters are interfaces from day one, which also makes them testable.
- Where comments are stored is open (migration plan §9 Q9).
