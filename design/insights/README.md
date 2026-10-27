# Insights mockups

The look the owner chose for Insights on 2026-10-28, for plan step P, part P8. What each part does, and why, is in [docs/product/insights-design.md](../../docs/product/insights-design.md); these pages show how it looks.

Open any `.html` file in a browser (dark, made for 1440 px wide), or look at the `.jpg` beside it. The tabs link to each other. The same boards, with the directions that weren't chosen, are on the owner's canvas: https://claude.ai/artifact/BHuQ9Y5GU49kzJaRtRqRtD.

| File | What |
|---|---|
| `overview.html` | Overview |
| `search-live.html` | Search, Live view (Search opens here) |
| `search-to-be-archived.html` | Search, To be archived view |
| `search-archive.html` | Search, Archive view |
| `search-everything.html` | Search, Everything view |
| `funnel.html` | Funnel |
| `emails.html` | Emails |
| `money.html` | Money (only for people who see money) |
| `goal.html` | Goal |

## How to use them

- They are a picture to build from, not code to copy. Build with the app's own pieces (`packages/ui`, `tokens.css`, the strings file) and add what's missing there, such as the series colours, the raised panel and the flow band.
- Every number is example data in the AI niche, at the scale the owner described: about 150,000 archived, 10,000 to be archived and 2,000 live. The real numbers come from the report (design section 5).
- The rail, top bar and page header copy the app as it is. Only the content area is new.
