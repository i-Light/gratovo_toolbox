# 0007. Toolchain pins: TypeScript 6 and ESLint 10 for now

- **Date:** 2026-10-19
- **Status:** accepted. Revisit when the two blockers below are lifted (about the next minor release of typescript-eslint).

## Context

Step 3a pins the toolchain at the current stable releases. Two of the newest majors could not be used together with the other tools, as checked with `npm view` on 2026-10-19:

- **TypeScript 7.0** is out, but `typescript-eslint` 8.71.2 accepts only `typescript` below 6.1.0. We use typescript-eslint for the strict lint rules, so we stay on **TypeScript 6.0.3**.
- **ESLint 10.13** is current. `eslint-plugin-jsx-a11y` 6.10.2 still declares a peer range of `eslint` up to 9. We checked that its accessibility rules fire under ESLint 10 (a planted `<img>` without `alt` is reported), so we use **ESLint 10.13.0** and accept the peer warning that pnpm prints on install. ESLint 9 was already out of support when this was checked.

## Decision

- TypeScript 6.0.3 until typescript-eslint supports TypeScript 7.
- ESLint 10.13.0 with the peer warning from jsx-a11y. Re-check the plugin on each upgrade; if its rules stop firing, pin the plugin's last working version or drop it for a maintained alternative.
- Everything else is the latest stable release at the time of step 3a, pinned exactly (`save-exact=true`).

## Alternatives considered

- **TypeScript 7 now:** would need typescript-eslint to drop its peer limit, which it has not done. A workaround (a separate lint step without typed rules) would lose the strict rules we want.
- **ESLint 9:** out of support, so no fixes for it.

## Consequences

- Two items on the upgrade list: TypeScript 7 and a jsx-a11y release that accepts ESLint 10.
- The rule set is unchanged by these choices, so no code changes when the upgrades land.
