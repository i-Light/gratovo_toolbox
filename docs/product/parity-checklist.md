# Parity checklist

The list that step 10 of the [migration plan](../migration-plan.md) walks, item by item. Nothing ships with an unticked row unless the row says why (a decision changed it, or the owner deferred it).

Sections 1 to 5 are generated from the prototype's plan data (`design/workbench-prototype/js/plan.js`) and the task map ([framework-tasks.md](framework-tasks.md)). If those change, regenerate with `node docs/product/gen-parity-checklist.js .` rather than editing them by hand. Section 6 is written by hand and is kept when regenerating.

Columns: **Old app** is how today's Flutter app handles the task (from the 18 Oct UI map). **Plan** is what the new app does. **Prototype** is whether the Workbench prototype already shows it. **New app** is the box to tick in step 10.

## 1. The framework tasks, step by step

### Search (YouTube, IG, TikTok) (find)

Old app overall: Strong at running searches; the run never hands you its results.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 1 | Enter or generate keywords | Works | Paste many keywords at once, duplicates removed; Gemini suggestions inline; the bridge status shows in Setup health | In the prototype | ☐ |
| 2 | Set search filters | Buried | Rules sit beside the keywords, always visible, edited inline | In the prototype | ☐ |
| 3 | Set the auto-clean rule | Buried | Same rules card; the 7-day archive is explained where rejects happen, with Bring back | In the prototype | ☐ |
| 4 | Start, stop or resume a run | Works | Start, Pause and Resume in the header and the console; pause says it finishes the current keyword | In the prototype | ☐ |
| 5 | Watch progress | Works | Live panel plus a tray ring that follows you to other screens; only the panel redraws | In the prototype | ☐ |
| 6 | See what the run found | Missing | Every run ends with a notification and a Review button that opens exactly what it found | In the prototype | ☐ |
| 7 | Hand keywords to a teammate | Works | A teammate's live run is shown, and overlapping keywords are flagged and skipped | In the prototype | ☐ |
| 8 | Search Instagram or TikTok | Missing | Platform on runs and creators; YouTube first, Instagram and TikTok when you decide | Your decision | ☐ |

### Qualify (views, niche, cadence, sponsors) (find)

Old app overall: Everything is there, but spread over a long profile and a right-click menu.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 9 | Look at the newest finds first | Buried | Review new opens on today's finds, gold mines first; rejected channels are hidden | In the prototype | ☐ |
| 10 | Filter by the qualifying signals | Partial | Gallery facets with counts, remembered, beside the cards instead of over them | In the prototype | ☐ |
| 11 | See the signals on the list row | Missing | Cards show the latest thumbnail, median views, uploads, top country, sponsors, email state, fit and stage | In the prototype | ☐ |
| 12 | Read the channel in depth | Partial | Peek panel: videos, numbers, audience, contact, fit reasons and notes, in tabs instead of one long page | In the prototype | ☐ |
| 13 | Check sponsors already seen | Buried | Sponsor names on cards and records; brands they sponsor are found automatically | In the prototype | ☐ |
| 14 | Shortlist a creator | Buried | S in triage, a button on every card, and the bulk bar | In the prototype | ☐ |
| 15 | Reject a creator | Buried | R with reasons 1–4; the toast explains the 7-day archive and offers Undo | In the prototype | ☐ |
| 16 | Qualify or reject many at once | Missing | Multi-select with shift-click and a bulk bar | In the prototype | ☐ |
| 17 | Bring a channel back from the archive | Buried | Toolbox › Archive shows the countdown; Bring back keeps the history | In the prototype | ☐ |
| 18 | Give a creator to a teammate | Partial | Owner on every card and record, assign in bulk, a Mine filter | In the prototype | ☐ |

### Get contact details (find)

Old app overall: Saving contacts is easy; finding and confirming them is not.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 19 | Find the creator's email | Partial | The email finder runs in the background after shortlisting and keeps updating the record | In the prototype | ☐ |
| 20 | Save contacts and pick the primary one | Works | Every address found is listed with where it came from and how sure it is | In the prototype | ☐ |
| 21 | Confirm an address is the right one | Missing | An explicit Confirm step; drafts to unconfirmed addresses are blocked with Confirm right on the card | In the prototype | ☐ |
| 22 | Record the person's name | Partial | The contact name is asked for at confirm time and used in the greeting | Partly shown | ☐ |
| 23 | Get from the list to the contacts | Buried | The Contacts tab and a Today bucket list everyone still waiting for one | In the prototype | ☐ |

### Cold outreach (reach)

Old app overall: The Comms queue works, but it is two clicks into Outreach, cut off from the creator, and has no mailbox picker.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 24 | See who is ready to be emailed | Buried | Approve emails in Today and the Waiting for you lane, with full counts | In the prototype | ☐ |
| 25 | Draft the first email | Partial | Drafted automatically the moment a contact is confirmed, with one rule set, in the background | In the prototype | ☐ |
| 26 | Review why, lessons, checks and recipient | Works | Why this email, the house rules it followed, and gates inline | In the prototype | ☐ |
| 27 | Edit and send | Works | Edit in place; Ctrl Enter to send; 10 seconds to undo | In the prototype | ☐ |
| 28 | Choose which mailbox it goes from | Missing | A From picker on every draft with the mailbox's capacity | In the prototype | ☐ |
| 29 | See the daily cap and warm-up before sending | Partial | Live meters per mailbox in Today and on every draft; warming and slowed tags | In the prototype | ☐ |
| 30 | Open the creator or conversation from the card | Missing | Every card opens its record beside the list (O) | In the prototype | ☐ |
| 31 | Email one creator directly | Works | One draft card everywhere, so the checks always run | In the prototype | ☐ |
| 32 | Reach creators who only take DMs | Partial | A contact channel per creator (email or DM); DM drafts ready to copy | Your decision | ☐ |

### 2–3 follow-ups (reach)

Old app overall: Creator follow-ups flow into the queue; seeing them is split over four places.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 33 | Get the follow-up when it is due | Works | The Follow-ups due bucket | In the prototype | ☐ |
| 34 | Draft and send it | Works | Same card; after sending, the toast names the next follow-up date | In the prototype | ☐ |
| 35 | Schedule one by hand | Buried | Send later: their morning, tomorrow, next Monday | In the prototype | ☐ |
| 36 | See every due follow-up in one place | Partial | Sequences: every creator and every step on one timeline | In the prototype | ☐ |
| 37 | Open the thread from a reminder notification | Missing | Every notification opens the exact item | In the prototype | ☐ |
| 38 | Stop after three and come back later | Partial | Park until a date; it comes back to Today by itself | In the prototype | ☐ |
| 39 | Follow up with a brand | Missing | Pitched brands get a nudge after 5 quiet days | Partly shown | ☐ |

### Replies (handle objections) (reach)

Old app overall: You can answer a reply, but not while seeing it; and nothing tells you one came in.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 40 | Know that a reply arrived | Partial | A reply lands in Answer replies, the notification links to it, and the rail count moves | In the prototype | ☐ |
| 41 | Check for replies now | Buried | Replies are read in the background; Paste a reply covers anything that slips | In the prototype | ☐ |
| 42 | Read the reply while writing the answer | Missing | Their message sits right above the draft, with Gemini's reading of it | In the prototype | ☐ |
| 43 | Draft the answer | Works | Drafted for you | In the prototype | ☐ |
| 44 | Correct how the engine read the situation | Buried | Rewrite chips on the card: Shorter, Warmer, More direct, New angle | In the prototype | ☐ |
| 45 | Label the reply | Partial | Gemini labels the intent; rate and audience save to the record in one click and move the stage | In the prototype | ☐ |
| 46 | Log a reply that came another way | Works | Paste a reply by hand: a quiet link under every thread | In the prototype | ☐ |
| 47 | Trust the conversation status | Missing | Stages move themselves: a reply stops the sequence; answering waits for them | In the prototype | ☐ |
| 48 | Skip a creator for good, or snooze | Missing | Snooze, Skip and Never contact in the card's menu | In the prototype | ☐ |

### Collect media kits and rates (reach)

Old app overall: One good dialog, buried seven cards down.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 49 | Record the media kit and rates | Buried | Facts from the reply save to the record and trigger the audience check | In the prototype | ☐ |
| 50 | Ask the creator for it | Partial | Suggested next step on every reply, with a drafted ask | In the prototype | ☐ |
| 51 | Keep the file they sent | Partial | The kit file is attached to the creator | Partly shown | ☐ |
| 52 | Keep other numbers they sent | Partial | One place for audience numbers | In the prototype | ☐ |
| 53 | See past rates | Works | Past rates on the record and in pricing | In the prototype | ☐ |

### Confirm the audience (reach)

Old app overall: A clear ready / not ready verdict, but it checks a different rule from your framework.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 54 | Enter top countries, age band and engagement | Buried | Saved from the reply or the kit, never typed twice | In the prototype | ☐ |
| 55 | See pass or fail, with the reasons | Works | Checks your rule: US/UK/CA/AU leads the top 3, buying age, engagement 3%+, rate agreed | In the prototype | ☐ |
| 56 | Record engagement | Partial | One field for engagement | In the prototype | ☐ |
| 57 | List only creators who pass | Works | Only signed creators reach the roster; failing ones are declined kindly or parked | In the prototype | ☐ |

### Sign creators (~5 per 1,000 emails) (close)

Old app overall: There is no "signed" in the app.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 58 | Mark a creator as signed | Missing | A Signed stage and a Sign button when the check passes | In the prototype | ☐ |
| 59 | Count signed creators against the target | Partial | Signed per 1,000 emails against the benchmark of about 5 | In the prototype | ☐ |
| 60 | Check a signing checklist | Missing | The audience check is the signing checklist; an agreement file comes later | Partly shown | ☐ |
| 61 | See the funnel | Missing | Funnel from found to deals | In the prototype | ☐ |

### Find and qualify brands (close)

Old app overall: Brands can be created; there is nothing to sort, qualify or search them by.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 62 | Find brands already sponsoring your creators | Buried | Sponsors seen on your creators become Found brands automatically | In the prototype | ☐ |
| 63 | Create a brand | Works | Add a brand inline | In the prototype | ☐ |
| 64 | Mark a brand as qualified, or tier it | Missing | Qualify: sells an AI tool, budget known, contact found; or set aside as not a fit | In the prototype | ☐ |
| 65 | Search, sort or filter brands | Missing | Brands board and Ctrl K search | In the prototype | ☐ |
| 66 | Check the boycott list | Works | Agency facts in Toolbox | In the prototype | ☐ |
| 67 | Archive or delete a brand | Missing | Not a fit sets a brand aside and keeps it searchable | In the prototype | ☐ |

### Pitch 1–2 signed creators per brand (close)

Old app overall: The pitch exists, four clicks deep, and the brand's side of the conversation is invisible.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 68 | Make a shortlist for a brand | Buried | A pitch picker per brand, ranked by fit | In the prototype | ☐ |
| 69 | Add creators to the shortlist | Partial | Pick one or two from the roster, each with reasons | In the prototype | ☐ |
| 70 | See which creators are ready, and why not | Partial | Match scores with reasons and clash warnings | In the prototype | ☐ |
| 71 | Draft the pitch | Works | Drafted with numbers and a price, behind the price gate | In the prototype | ☐ |
| 72 | Find the pitch afterwards | Buried | The pitch waits in Approve emails; the brand shows Pitched with the date | In the prototype | ☐ |
| 73 | Email a brand from its page | Missing | The brand record has an Emails tab with the same draft card | In the prototype | ☐ |
| 74 | Read the conversation with a brand | Missing | Brand threads everywhere: the record, Replies, the negotiation | In the prototype | ☐ |

### Negotiate terms (close)

Old app overall: Terms can be recorded; the negotiation itself has no home.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 75 | Write the negotiation replies | Partial | The negotiation sits beside the reply: the ladder and the draft together | In the prototype | ☐ |
| 76 | Start a deal | Partial | A deal starts from the accepted pitch with the price from the creator's rate | Planned | ☐ |
| 77 | Record agreed price and payout | Works | Price, payout and margin on every deal | In the prototype | ☐ |
| 78 | Record exclusivity and usage rights | Missing | Exclusivity and usage rights on the Negotiate checklist | In the prototype | ☐ |
| 79 | Keep the offer and counter history | Missing | Offer and counter history under the ladder | In the prototype | ☐ |
| 80 | Move the deal forward | Partial | Steps move only when their checklist is done; money order enforced | In the prototype | ☐ |

### Contracts (creator signs first) (close)

Old app overall: Order is enforced; everything around the contract is manual.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 81 | Track both contracts and the signing order | Works | Ordered checklist: the creator signs before the agency | In the prototype | ☐ |
| 82 | Mirror the brand's contract for the creator | Missing | A Mirrored for the creator step; a template comes with file handling | Partly shown | ☐ |
| 83 | Open the contract | Partial | Documents list beside the checklist | In the prototype | ☐ |
| 84 | Have the deal stage follow the contracts | Missing | The last tick moves the deal to Brief | In the prototype | ☐ |

### Brief and draft review (deliver)

Old app overall: Dates can be logged; the brief itself does not exist.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 85 | Send the creator the brief | Missing | A Brief step; the brief message itself comes next | Partly shown | ☐ |
| 86 | Log draft received and approved | Buried | Draft review checklist | In the prototype | ☐ |
| 87 | Check the draft against the brief | Missing | Checked against the brief; a side-by-side view comes next | Partly shown | ☐ |
| 88 | Get and record the brand's approval | Partial | Brand approved, with a message to the brand next | Partly shown | ☐ |

### Pre-live checks (deliver)

Old app overall: Not in the app.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 89 | Check links, placement and promo code | Missing | Pre-live checklist | In the prototype | ☐ |
| 90 | Find the tracking link | Buried | Test the tracking link from the step | In the prototype | ☐ |
| 91 | Record the promo code | Missing | Promo code item on the checklist | In the prototype | ☐ |

### Go-live email to the brand (deliver)

Old app overall: Publishing can be logged; telling the brand cannot.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 92 | Mark the video published with its link | Partial | The video link is saved on the deal; the date can be corrected | Partly shown | ☐ |
| 93 | Email the brand the live link | Missing | A go-live email drafted for the brand | Planned | ☐ |
| 94 | Move the deal to Live | Missing | Ticking Go-live moves the deal to Invoice and starts the money clock | In the prototype | ☐ |

### Invoice on go-live day (Net 30) (deliver)

Old app overall: Marks can be set; there is no invoice and, in the team's builds, no list of what is unpaid.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 95 | Mark the invoice sent and paid | Works | Sent and paid on the money panel | In the prototype | ☐ |
| 96 | Get the due date from the terms | Missing | Net 30 computed from the send date, with a countdown | In the prototype | ☐ |
| 97 | Create or send the invoice | Missing | An invoice ready to send on go-live day, Ctrl Enter | In the prototype | ☐ |
| 98 | See every unpaid invoice | Missing | Deliver › Money: every unpaid invoice with its age | In the prototype | ☐ |

### 30-day performance report (deliver)

Old app overall: Due dates show; the report is read but cannot be sent.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 99 | Know when it is due | Works | The report step lands in Today when due | In the prototype | ☐ |
| 100 | Read the views, CPM and clicks | Partial | Views, clicks and click rate on the step | In the prototype | ☐ |
| 101 | Send the report to the brand | Missing | Send the 30-day report in one click | In the prototype | ☐ |

### Pay the creator once the brand has paid (deliver)

Old app overall: Payout can be recorded; nothing prompts it.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 102 | Record payout due, paid, method and reference | Works | Payout amount, method and state on the deal | In the prototype | ☐ |
| 103 | Get told to pay once the brand has paid | Missing | The payout appears the moment the brand pays, and stays locked before | In the prototype | ☐ |
| 104 | See everything owed to creators | Missing | Payables: everything owed to creators | In the prototype | ☐ |

### Pitch the next deal (upsell) (deliver)

Old app overall: One reminder, hidden inside the report dialog.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 105 | Remind yourself to pitch the brand again | Buried | The Next deal step lands in Today with the best creators for that brand | In the prototype | ☐ |
| 106 | Pitch the same brand its next creator | Missing | Draft the next pitch from the deal | In the prototype | ☐ |
| 107 | Offer the same creator to another brand | Partial | The roster shows the best next brand per creator | In the prototype | ☐ |
| 108 | See a brand's results | Missing | A brand's deals and results on its record | Partly shown | ☐ |
| 109 | Record why a deal was lost | Missing | A lost reason on deals | Planned | ☐ |

### Daily to-do (4 focused hours) (team)

Old app overall: Home tells you the state, not the next thing to do.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 110 | See my list for today | Partial | Today: yours by default, the team view for you as owner, ordered by money | In the prototype | ☐ |
| 111 | See drafts waiting for my approval | Missing | Approve emails bucket and rail counts | In the prototype | ☐ |
| 112 | Review new finds | Partial | Review new opens the channels themselves, one at a time | In the prototype | ☐ |
| 113 | Track the daily target | Partial | A 4-hour budget bar and mailbox meters; everything clickable | In the prototype | ☐ |
| 114 | Jump to a creator, brand or deal by name | Missing | Ctrl K finds anything by name | In the prototype | ☐ |
| 115 | Run a focused work block | Missing | Focus mode | In the prototype | ☐ |

### Team and VA scaling (team)

Old app overall: Access levels work; assigning and checking work does not.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 116 | Give someone basic or full access | Works | Roles and what each can see | In the prototype | ☐ |
| 117 | Assign work to a person | Partial | Owner everywhere; hand off with a note | In the prototype | ☐ |
| 118 | See each person's results | Missing | Per-person load and results | In the prototype | ☐ |
| 119 | See what teammates did | Buried | The activity log on every record and in Toolbox | In the prototype | ☐ |
| 120 | See who is working on what now | Partial | Presence in the top bar and on records | In the prototype | ☐ |
| 121 | Give a VA a working view | Partial | Role-based Today: VAs get finds, contacts and follow-ups | Your decision | ☐ |
| 122 | Set up a new teammate's machine | Partial | Setup health and a first-week checklist | Partly shown | ☐ |

### Mailbox health (team)

Old app overall: The settings exist; none of it is visible where emails are sent.

| # | Task | Old app | Plan | Prototype | New app |
|---|---|---|---|---|---|
| 123 | Connect mailboxes | Buried | Mailboxes tab with connection warnings before they lapse | Partly shown | ☐ |
| 124 | Set the daily cap and warm-up date | Buried | Cap stepper on each mailbox | In the prototype | ☐ |
| 125 | See mailbox health where you send | Missing | Meters and tags on every draft and in Today | In the prototype | ☐ |
| 126 | Warm the mailbox up | Outside the app | Warm-up happens outside the app | Outside the app | ☐ |
| 127 | Watch bounces and spam placement | Missing | Bounce rate, inbox placement and an automatic slowdown | In the prototype | ☐ |

127 tasks in all.

## 2. Quality of life

| Area | Item | Priority | Prototype | New app |
|---|---|---|---|---|
| Everywhere | Command palette: find any creator, brand or deal, run any command | Must | In the prototype | ☐ |
| Everywhere | Shortcut sheet (?), keys in tooltips and on main buttons | Must | In the prototype | ☐ |
| Everywhere | G then a letter jumps to a screen | Should | In the prototype | ☐ |
| Everywhere | Records open beside the list; Alt ↑ / ↓ walks the list | Must | In the prototype | ☐ |
| Everywhere | Back and forward across screens, tabs and records | Should | In the prototype | ☐ |
| Everywhere | Undo and redo for every change, plus Undo on every toast | Must | In the prototype | ☐ |
| Everywhere | Undo send: 10 seconds to take an email back | Must | Partly shown | ☐ |
| Everywhere | A bar names anything broken, on every screen, with the fix one click away | Must | In the prototype | ☐ |
| Settings | Your picture opens your account: your name, Settings, appearance, shortcuts | Must | In the prototype | ☐ |
| Settings | Your real name and picture, from your account or set once | Must | In the prototype | ☐ |
| Settings | Find any setting with a search box or Ctrl K | Should | In the prototype | ☐ |
| Settings | Each setting says who it affects: just you, this computer, the whole team | Should | In the prototype | ☐ |
| Settings | Settings apply at once, say Saved in place, and undo with Ctrl Z | Must | In the prototype | ☐ |
| Settings | Theme, density, text size and motion per computer | Should | In the prototype | ☐ |
| Settings | Single-letter keys can be turned off for screen readers and dictation | Must | In the prototype | ☐ |
| Settings | Choose which alerts reach the bell; problems always do | Should | In the prototype | ☐ |
| Settings | Agency rules use the same editors as the screens that use them | Should | In the prototype | ☐ |
| Records | The channel's YouTube banner on its record, cropped the way YouTube crops it | Should | In the prototype | ☐ |
| Prototype | Prototype mode: the real app on an example copy; live data set aside untouched | Must | In the prototype | ☐ |
| Prototype | Off means off: no buttons, pins, keys or bars from prototype mode anywhere | Must | In the prototype | ☐ |
| Prototype | Scenarios: a normal Monday, a first day, a week later, something broke | Should | In the prototype | ☐ |
| Prototype | See the app as a teammate before they start | Should | In the prototype | ☐ |
| Prototype | Comment on anything: press C, click, write; pinned to that exact element | Must | In the prototype | ☐ |
| Prototype | Every comment in one list, and one click copies the open ones for Claude | Must | In the prototype | ☐ |
| Everywhere | Save status: Saving…, Saved, Offline with changes queued | Must | Partly shown | ☐ |
| Everywhere | Background jobs tray with progress | Must | In the prototype | ☐ |
| Everywhere | Notifications that open the exact item | Should | In the prototype | ☐ |
| Everywhere | Notes with @mentions on any record | Should | Partly shown | ☐ |
| Everywhere | Recent records in the palette | Should | In the prototype | ☐ |
| Everywhere | Tabs, filters, sort and scroll remembered per screen | Must | Partly shown | ☐ |
| Everywhere | Light or dark, comfortable or compact | Should | In the prototype | ☐ |
| Everywhere | Copy buttons on addresses and payment details | Should | In the prototype | ☐ |
| Everywhere | Empty states that say what to do next | Must | In the prototype | ☐ |
| Everywhere | Collapsible sidebar ([ key) | Could | In the prototype | ☐ |
| Everywhere | Skeletons, never a spinner over a loaded screen | Must | Planned | ☐ |
| Everywhere | Direction-neutral layout, ready for Arabic later | Could | Partly shown | ☐ |
| Today | One list across the business, closest to money first, each with a reason | Must | In the prototype | ☐ |
| Today | Time estimates and a 4-hour budget | Must | In the prototype | ☐ |
| Today | The next item opens when you finish one | Must | In the prototype | ☐ |
| Today | Focus mode: one item, progress, time left | Must | In the prototype | ☐ |
| Today | Snooze presets: later today, tomorrow, Monday, two weeks | Must | In the prototype | ☐ |
| Today | Hand off with a note; it lands in their Today | Should | In the prototype | ☐ |
| Today | Quick wins and Late filters | Could | In the prototype | ☐ |
| Today | Done today, with Undo on the latest | Must | In the prototype | ☐ |
| Today | Wrap up: summary, move the rest to tomorrow, a note for the morning | Should | In the prototype | ☐ |
| Today | Team view: everyone's list and load | Should | In the prototype | ☐ |
| Today | Mailbox capacity at a glance | Must | In the prototype | ☐ |
| Today | Due dates in plain words: "2 days late", "tomorrow" | Must | In the prototype | ☐ |
| Find | Searches run in the background; the tray follows you | Must | In the prototype | ☐ |
| Find | Per-keyword yield, so weak keywords stand out | Should | In the prototype | ☐ |
| Find | Paste many keywords; duplicates removed; Gemini suggestions | Should | In the prototype | ☐ |
| Find | Warning before searching a keyword a teammate is running | Must | In the prototype | ☐ |
| Find | Every run ends with a link to what it found | Must | In the prototype | ☐ |
| Find | Triage one channel at a time with its last 3 videos | Must | In the prototype | ☐ |
| Find | S, R, 1–4 and arrows in triage; no animation on keys | Must | In the prototype | ☐ |
| Find | Fit score with its reasons | Should | In the prototype | ☐ |
| Find | "Sara emailed this channel 4 months ago" guard | Must | In the prototype | ☐ |
| Find | Gallery with facet counts, saved views and card sizes | Must | In the prototype | ☐ |
| Find | Hover a thumbnail to flip through the last 3 videos | Should | In the prototype | ☐ |
| Find | Shift-click multi-select and a bulk bar | Must | In the prototype | ☐ |
| Find | Compare 2–4 channels side by side | Should | In the prototype | ☐ |
| Find | Email finder after shortlisting, with source and confidence | Must | In the prototype | ☐ |
| Find | Confirm all addresses that are 90%+ sure in one click | Should | In the prototype | ☐ |
| Find | Never-contact list honoured everywhere | Must | In the prototype | ☐ |
| Reach | One draft card everywhere: To, From, When, Why, gates, rewrite | Must | In the prototype | ☐ |
| Reach | Send later, in their morning | Should | In the prototype | ☐ |
| Reach | Mailbox picker with capacity and warm-up on every send | Must | In the prototype | ☐ |
| Reach | Rewrite chips instead of a hidden Redo | Should | In the prototype | ☐ |
| Reach | Sequence timeline for every creator | Must | In the prototype | ☐ |
| Reach | Gemini's reading of each reply: intent, summary, facts | Must | In the prototype | ☐ |
| Reach | Save rate and audience from a reply in one click | Must | In the prototype | ☐ |
| Reach | Paste a reply by hand, small and quiet | Must | In the prototype | ☐ |
| Reach | A reply stops the sequence by itself | Must | In the prototype | ☐ |
| Reach | Park until a date ("ping me in January") | Should | In the prototype | ☐ |
| Reach | Automatic slowdown when bounces pass 3% | Must | In the prototype | ☐ |
| Reach | Replies inbox with intent filters | Should | In the prototype | ☐ |
| Close | Audience check with your exact rule | Must | In the prototype | ☐ |
| Close | Decline kindly or park creators who fail | Should | In the prototype | ☐ |
| Close | Roster with rates, load and best next brand | Should | In the prototype | ☐ |
| Close | Match grid: brands × creators with clashes | Should | In the prototype | ☐ |
| Close | Pitch picker: 1–2 creators ranked with reasons | Must | In the prototype | ☐ |
| Close | Price gate on any email that names a price | Must | In the prototype | ☐ |
| Close | Negotiation ladder: rate, floor, offer, ask, margin | Must | In the prototype | ☐ |
| Close | Contracts in order: the creator signs first | Must | In the prototype | ☐ |
| Close | Brand qualification: AI tool, budget, contact | Must | In the prototype | ☐ |
| Deliver | Deal board by step with due dates and progress | Must | In the prototype | ☐ |
| Deliver | Checklists that move the deal when done | Must | In the prototype | ☐ |
| Deliver | Invoice on go-live day with a Net 30 countdown | Must | In the prototype | ☐ |
| Deliver | Payment reminders drafted for you | Should | In the prototype | ☐ |
| Deliver | Creator payout locked until the brand pays, then prompted | Must | In the prototype | ☐ |
| Deliver | 30-day report numbers on the step, one-click send | Should | In the prototype | ☐ |
| Deliver | Next deal suggested with the best creators | Should | In the prototype | ☐ |
| Deliver | Money: receivables and payables with their age | Must | In the prototype | ☐ |
| Team | Owner on every record; reassign in one click | Must | In the prototype | ☐ |
| Team | Presence: who is looking at this record | Should | In the prototype | ☐ |
| Team | Workload and rebalance | Should | In the prototype | ☐ |
| Team | Roles: what VAs can see and do | Must | Your decision | ☐ |
| Team | Activity log on every record and in Toolbox | Should | In the prototype | ☐ |
| Team | First-week checklist and a practice mode for new VAs | Should | Planned | ☐ |
| Speed | Every click answers within 100 ms; slow work goes to the background | Must | Planned | ☐ |
| Speed | Lists draw only what is on screen | Must | Planned | ☐ |
| Speed | One query per screen, not one per row | Must | Planned | ☐ |
| Speed | The frame does not rebuild when presence or sync ticks | Must | Planned | ☐ |
| Speed | Screens you leave stop working | Must | Planned | ☐ |
| Speed | Database work off the drawing thread | Must | Planned | ☐ |

## 3. Feedback: what every action must say back

| Action | What you see | What changes elsewhere | How to take it back | New app |
|---|---|---|---|---|
| Send an email | The card leaves and the next item opens. Toast: "Sent to Ines from outreach1. Follow-up 1 is planned for Thu 22 Oct." | Today count −1, mailbox meter +1, a new dot on the sequence | Undo for 10 s, or Ctrl Z | ☐ |
| Shortlist in triage | The next channel appears at once; the tally counts up | Confirm contacts; the tray shows "Finding emails", then "2 emails found" | Undo on the toast | ☐ |
| Reject | Toast names the reason and the 7-day archive | Toolbox › Archive | Undo, or Bring back for 7 days | ☐ |
| Confirm an address | The gate turns green; toast: "Gemini drafted the first email" with Review | Approve emails | Undo | ☐ |
| Save a fact from a reply | The chip says Saved; with rate and audience in, the stage moves to Media kit | The record and the audience check | Undo | ☐ |
| Tick a checklist item | The box fills; the last tick says "Contracts done, moved to Brief" | The next column of the deal board | Untick or Undo | ☐ |
| Send an invoice | Toast with the due date | Money › receivables; back in Today 3 days before it is due | Undo | ☐ |
| Mark the brand paid | The lock on the creator payout opens | Get paid: "Pay The AI Desk $1,500" | Undo | ☐ |
| Snooze | "Back tomorrow at 09:00" | The Snoozed list at the bottom of the queue | Bring back now | ☐ |
| Hand off | The owner chip changes; toast quotes your note | Their Today | Undo | ☐ |
| Start a search | The tray ring fills; the log runs | New finds in Review new; a notification when it stops | Pause | ☐ |
| Rewrite an email | The text shimmers while Gemini writes, then changes | Same card | Undo brings the old text back | ☐ |
| Make a mistake | A message beside the field says what is wrong and how to fix it | Nowhere else | Nothing to undo | ☐ |
| Any change | Top bar: Saving…, then Saved | Synced to the team | Ctrl Z | ☐ |

## 4. Speed: what made the old app lag, and the rule that prevents it

| Cause in the old app | Rule in the new app | New app |
|---|---|---|
| The app frame watches about 15 live sources, and teammate presence updates about once a second, so the whole frame rebuilds constantly | The frame listens only to what it shows; presence redraws only the avatars | ☐ |
| Every section stays alive in the background (Roster builds all three of its lists at once) | Screens you leave stop working and resume where you were | ☐ |
| My Day, the Comms queue, deals and conversations run one query per row | One query per screen, shaped for that screen | ☐ |
| The creator list queries on the drawing thread and re-reads every loaded row after any change | Database work off the drawing thread; only changed rows redraw | ☐ |
| Profiles build in one go and swap to a spinner when any channel changes anywhere | Records load in parts; a loaded screen never turns back into a spinner | ☐ |
| A new Python process starts for each Gmail status check | One long-running helper process for mail | ☐ |
| Heavy work at startup before anything shows | Today draws from the local copy first; sync catches up after | ☐ |

## 5. Design principles

- **Start every day in one place.** Today gathers every next action across finding, reaching, closing and delivering, ordered by how close it is to money, with a time estimate and a reason on each.
- **Every record shows its one next step.** Creators, brands and deals each carry a step tracker and a single next action with a Do it button. Waiting states say what they are waiting for and until when.
- **Routine work one at a time, judgment calls with everything.** High-volume work (finds, sends, follow-ups) runs as a queue you clear with the keyboard. Decisions that need judgment (negotiating, contracts, money) open the full record with all the context.
- **Never lose your place.** Records open beside the list instead of replacing it. Back and forward work across screens. Filters, tabs and drafts are remembered.
- **Every action answers four questions.** Did it work, where did it go, what happens next, and how do I take it back. Toasts say all four; counters move; the activity log records it.
- **Gates only where mistakes are expensive.** A wrong address, a price in writing, a full mailbox, a never-contact creator, paying a creator before the brand pays. Those stop you, inline, with the fix next to them. Everything else is undoable instead of confirmed.
- **Hands stay on the keyboard.** Every frequent action has a key, every key is shown where it applies, and single-letter keys never fire while you type.
- **Explain the machine.** Whenever the app decides something (a Gemini draft, a fit score, the order of Today, a match), it says why in one line, in plain words.
- **The team sees the same truth.** Every record has an owner, hand-offs carry a note, presence shows who is looking, and overlapping work is caught before it happens.
- **Fast and calm.** Every click answers within a tenth of a second; slow work runs in the background with visible progress. One accent colour, status colours only for status, nothing moves unless it means something.

## 6. The old app's capabilities outside the framework

Things the Flutter app does that the 127 tasks don't name. Each is ported, replaced by something in the prototype, or dropped. **Decide** means the owner says which, in step 9 at the latest. Paths are under `legacy/lib/`.

| Capability | Where in the old app | Proposal | New app |
|---|---|---|---|
| Sign-in and access levels (basic hides Outreach) | `features/auth`, `routing/app_redirect.dart` | Port: Supabase sign-in, roles Owner / Account manager / VA as in the prototype's Team › Roles | ☐ |
| Onboarding wizard | `features/onboarding` | Replace: the first-day Today screen plus Settings › Connections | ☐ |
| Dashboard: tiles, channel analytics, keyword distribution, "searching now" | `features/dashboard` | Replace: Insights (with drill-downs) and Today | ☐ |
| Campaigns: detail and shortlist | `features/campaigns` | Decide: fold into Close › Match and Pitch, or keep as its own view | ☐ |
| Finance: table, filters, summary | `features/finance` | Replace: Deliver › Money (invoices, aging, payouts) | ☐ |
| Team dashboard: weekly results per person | `features/team_dashboard` | Replace: Team (load, results) and Insights per person | ☐ |
| Job scheduler: scheduled jobs and cadence | `features/job_scheduler` | Port: background jobs in the jobs tray, schedules in Settings | ☐ |
| My apps card | `features/my_apps`, `docs/MY_APPS.md` | Decide | ☐ |
| Skills library: Gemini skills, Gem sync, import and export | `features/skills` | Decide: keep for keyword and classifier prompts, or move under Settings › Writing rules | ☐ |
| Email library: the critique library, tags, handbook export | `features/email_library` | Decide: still needed by the comms engine? | ☐ |
| Edit conflicts: resolve or discard refused edits | `features/conflicts` | Port: the conflict banner on the record plus a conflicts list | ☐ |
| News: industry feeds | `features/news`, `pipeline/tools/news.py` | Decide | ☐ |
| Scratchpad: one live shared text box per person | `features/scratchpad` | Decide | ☐ |
| Activity log | `features/logs` | Port: Toolbox › Activity log (in the prototype) | ☐ |
| Notification history | `features/notifications` | Port: the bell plus Toolbox › Notifications (in the prototype) | ☐ |
| Presence: who is online, what each person is viewing | `core/presence` | Port: in the prototype's top bar and records | ☐ |
| In-app updater | `core/update` | Port in step T5, was 3h (unsigned builds from the private release location, §9 Q12) | ☐ |
| Windows notifications for due follow-ups | `core/notifications` | Port | ☐ |
| Dhikr reminder overlay | `core/toast/dhikr_reminder_overlay.dart` | Decide (the owner's personal feature) | ☐ |
| Time zone setting and one date formatter | `core/time` | Port: Settings › Your day plus one formatter | ☐ |
| AWS API gateways for search routing | `core/aws`, settings, `pipeline/gratovo/scrapetube` | Port with the pipeline; keys per [decisions/0003](../decisions/0003-secrets.md) | ☐ |
| Python environment setting | settings | Replace: the bundled runtime | ☐ |
| GitHub token setting (updater) | `core/github` | Replace: the release design in step T5 (was 3h) | ☐ |
| AI providers (Anthropic API, template fill) | `core/ai` | Decide: Gemini bridge only, or also an API provider | ☐ |
| Channel avatar cache | `core/images` | Port | ☐ |
| Crash log | `core/logging/crash_log.dart` | Port: structured logs plus a crash report the owner can send | ☐ |
| Remote search requests (start a search on another machine) | `features/search` (`remote_search_intake`) | Port | ☐ |
| The 7-day archive sweep and restore | `features/archive`, `data/repositories/mirror/local_archive.dart` | Port: in the prototype's Toolbox › Archive and Find | ☐ |
| Arabic UI and right-to-left layout | `l10n/` | Later: English only for now, strings kept in one place | ☐ |
| Web read-only preview build | `web/` | Decide: probably drop | ☐ |
