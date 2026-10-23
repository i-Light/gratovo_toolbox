# Situations

Name the stage of the deal and, for a reply, its type (the id goes in `situation.reply_type`).
`needs a person` marks replies where a human must confirm before anything is sent.

## Deal stages — influencer

- `prospect` Found, not contacted — rules INF-QUAL-01, INF-QUAL-03, FND-ETH-06
- `contacted` First message sent, no reply — rules INF-FIRST-01, INF-FU-01, FND-DLV-19
- `replied` They answered — rules INF-REPLY-04, INF-REPLY-06, INF-QUAL-02
- `qualifying` Getting media kit, audience, rates — rules INF-REPLY-01, INF-REPLY-05, INF-PRICE-08
- `negotiating` Agreeing a price — rules INF-NEG-13, INF-NEG-06, INF-PRICE-06
- `closed` Data + price + ready: in the roster — rules INF-CLOSE-01, INF-ONB-01, INF-ONB-02
- `sold` A brand bought this creator — rules BRD-CLOSE-02, INF-ONB-04
- `contract` Creator contract out / signed — rules INF-CLOSE-02, INF-CLOSE-03, BRD-CONTRACT-08
- `production` Brief, script, draft, revisions — rules INF-DELIV-06, INF-DELIV-09, INF-DELIV-07
- `live` Scheduled / live — rules INF-DELIV-10, INF-DELIV-11, INF-PAY-01
- `after` Reporting, payment, next deal — rules INF-AFTER-02, INF-AFTER-01
- `lost` Not working with us (for now) — rules INF-NEG-04, INF-REPLY-09

## Deal stages — brand

- `prospect` Found, audited, not contacted — rules BRD-QUAL-02, BRD-QUAL-03, FND-ETH-05
- `contacted` Pitch sent, no reply — rules BRD-FIRST-01, BRD-FU-03, FND-DLV-19
- `replied` They answered — rules BRD-REPLY-05, BRD-QUAL-08
- `presenting` Shortlist / offer on the table — rules BRD-PRES-05, BRD-PRES-09, BRD-OFFER-10
- `negotiating` Price and terms — rules BRD-NEG-09, BRD-NEG-13, BRD-OBJ-06
- `agreed` Yes in writing: rate, deliverables, date — rules BRD-CLOSE-02, BRD-CLOSE-03
- `contract` Contracts — rules BRD-CONTRACT-05, BRD-CONTRACT-09, BRD-CONTRACT-08
- `production` Brief, approvals — rules BRD-DELIV-06, BRD-DELIV-05, BRD-DELIV-02
- `live` Live and reporting — rules BRD-AFTER-08, BRD-AFTER-09
- `payment` Invoice and payment — rules BRD-PAY-02, BRD-PAY-03, BRD-PAY-01
- `after` Next deal or make-good — rules BRD-AFTER-10, BRD-AFTER-06, BRD-AFTER-04
- `paused` Asked to come back later — rules BRD-REPLY-07, BRD-OBJ-07
- `lost` No (for now) — rules BRD-OBJ-14, BRD-OBJ-16, BRD-FU-05

## Reply types — influencer

- `inf.interested_vague` Interested / 'what do you have in mind?' (e.g. 'sure, what do you have in mind'; 'tell me more'; 'what brands') → rules INF-REPLY-04, INF-REPLY-06, INF-REPLY-01
- `inf.asks_price_from_us` Asks us to name the price (e.g. "what's your budget"; 'what would you pay'; 'make me an offer') → rules INF-PRICE-09 — needs a person: price
- `inf.gives_rate` Gives their rate or rate card (e.g. 'my rate is'; 'I charge'; 'rate card attached') → rules INF-PRICE-07, INF-PRICE-01, INF-NEG-13, INF-NEG-03 — needs a person: price
- `inf.media_kit` Sends media kit / analytics (e.g. 'media kit attached'; 'here are my stats') → rules INF-REPLY-05, INF-QUAL-02, BRD-QUAL-04
- `inf.who_are_you` Doubts us: website, domain, who you manage, past work (e.g. "what's your website"; 'who do you work with'; 'show me past campaigns') → rules INF-REPLY-03, INF-REPLY-02, FND-ETH-03, INF-REPLY-20 — needs a person: claim
- `inf.thinks_we_are_brand` Thinks we are the brand (e.g. "what's your product"; 'send me the product') → rules INF-FIRST-10, FND-ETH-01, INF-REPLY-27
- `inf.has_manager` Redirects to a manager / agency (e.g. 'contact my manager'; 'please email my agent'; "cc'ing my team") → rules INF-MGR-05, INF-MGR-02, INF-MGR-14
- `inf.counter` Counter-offer in negotiation (e.g. 'I can do'; 'lowest I can go'; 'meet in the middle') → rules INF-NEG-06, INF-NEG-09, INF-NEG-17 — needs a person: price
- `inf.non_negotiable` 'My rates are non-negotiable' (e.g. 'non-negotiable'; 'firm on my rate') → rules INF-NEG-18, INF-NEG-11, INF-NEG-04 — needs a person: price
- `inf.already_worked_brand` Already worked with that brand (e.g. 'I worked with them'; "I'm already partnered with") → rules INF-REPLY-07
- `inf.wants_upfront` Asks for payment upfront / payment terms (e.g. '50% upfront'; 'when do I get paid') → rules INF-PAY-03, BRD-CONTRACT-03, INF-CLOSE-03, INF-NEG-38 — needs a person: terms
- `inf.wants_exclusivity_terms` Asks about exclusivity / usage rights (e.g. 'exclusive'; 'usage rights'; 'whitelisting') → rules INF-REPLY-32, INF-CLOSE-04, INF-CLOSE-03, INF-CLOSE-06 — needs a person: terms
- `inf.not_interested` Not interested / no partnerships (e.g. 'not interested'; "I don't do sponsorships"; 'not taking deals') → rules INF-REPLY-09, INF-REPLY-08
- `inf.later` Busy now / later (e.g. 'maybe next month'; 'fully booked') → rules INF-REPLY-22, FND-MIND-06, INF-FU-01
- `inf.agrees` Agrees to work with us (e.g. 'sounds good'; "let's do it"; "I'm in") → rules INF-CLOSE-01, INF-ONB-01, INF-ONB-02, INF-CLOSE-06
- `inf.chasing_us` Creator keeps checking in (e.g. 'any update'; 'did you find a brand') → rules INF-ONB-08, INF-ONB-02, INF-ONB-03
- `inf.delivery_update` Script / draft / go-live / shipping message (e.g. "here's the script"; 'draft link'; "I'll post on"; 'received the product') → rules INF-DELIV-09, INF-DELIV-07, INF-DELIV-10, INF-DELIV-08, INF-DELIV-11
- `inf.contract_question` Question or change request on the contract (e.g. 'about the contract'; 'can we change') → rules BRD-CONTRACT-03, INF-CLOSE-03, INF-CLOSE-06 — needs a person: terms
- `inf.payment_question` Asks about their payment (e.g. 'when will I be paid'; 'payment status') → rules INF-PAY-01, INF-CLOSE-05
- `inf.angry` Annoyed, rude or complaining (e.g. 'stop emailing'; 'this is spam'; 'rude') → rules INF-REPLY-24, FND-MIND-04, INF-NEG-04, FND-ETH-12

## Reply types — brand

- `brd.more_info` 'Send more information' about the creator (e.g. 'send more info'; 'tell me more about'; 'share details') → rules BRD-REPLY-05, BRD-PRES-04, BRD-PRES-03
- `brd.asks_rates` Asks for rates / pricing (e.g. 'what are the rates'; 'how much'; 'pricing') → rules BRD-REPLY-20, BRD-NEG-09, BRD-OFFER-04 — needs a person: price
- `brd.wants_roster` Wants the full roster, rates and analytics at once (e.g. 'send your roster'; 'list of creators'; 'all your influencers') → rules BRD-REPLY-19, BRD-REPLY-10, BRD-PRES-07, BRD-PRES-15
- `brd.only_deliverable` Only wants a specific deliverable (e.g. 'we only do youtube integrations'; 'only looking for') → rules BRD-REPLY-06 — needs a person: price
- `brd.budget_given` Names a budget or range (e.g. 'our budget is'; 'we can spend'; 'max budget') → rules BRD-PRES-08, BRD-OFFER-02, BRD-NEG-12 — needs a person: price
- `brd.price_too_high` 'Price is too high' (e.g. 'too expensive'; 'out of budget'; 'a bit high') → rules BRD-OBJ-06, BRD-OBJ-15, BRD-NEG-11 — needs a person: price
- `brd.lowball` Lowball counter-offer (e.g. 'we can offer'; 'our max is') → rules BRD-NEG-04, BRD-NEG-05, BRD-NEG-12, BRD-NEG-07, BRD-NEG-24 — needs a person: price
- `brd.paused` Pausing campaigns / after Q4 / next quarter (e.g. 'pausing campaigns'; 'after Q4'; 'revisit next quarter') → rules BRD-REPLY-07, BRD-OBJ-07, BRD-OBJ-23
- `brd.wrong_fit` Creator doesn't make sense for us (e.g. 'not the right fit'; "doesn't align") → rules BRD-OBJ-01, BRD-OBJ-08, BRD-OBJ-14
- `brd.affiliate_only` Only affiliate / ambassador program (e.g. 'affiliate'; 'commission only'; 'ambassador program') → rules BRD-OBJ-09, BRD-OBJ-13, BRD-REPLY-01 — needs a person: terms
- `brd.no_agencies` We don't work with agencies / prefer creators directly (e.g. "don't work with agencies"; 'prefer to work directly') → rules BRD-OBJ-10, BRD-OBJ-12
- `brd.exclusive_question` Asks if we are exclusive / creator has another agency (e.g. 'are you exclusive'; 'already has an agency') → rules BRD-REPLY-04, BRD-OBJ-05, BRD-OBJ-11 — needs a person: claim
- `brd.about_agency` Asks about the agency / past work / case studies (e.g. 'who have you worked with'; 'case studies'; 'tell me about your agency') → rules BRD-OBJ-22, BRD-REPLY-03, FND-ETH-03, BRD-OFFER-14 — needs a person: claim
- `brd.cc_colleague` Hands us to a colleague (CC) (e.g. "cc'ing"; 'looping in'; 'my colleague will') → rules BRD-REPLY-08, BRD-REPLY-25
- `brd.wants_call` Asks for a call (e.g. 'hop on a call'; 'schedule a meeting') → rules BRD-REPLY-12, FND-CALL-13
- `brd.yes` Says yes / wants to proceed (e.g. "let's move forward"; "we'd like to proceed"; 'approved') → rules BRD-CLOSE-02, BRD-CLOSE-03, BRD-CLOSE-01, BRD-CONTRACT-12 — needs a person: terms
- `brd.contract_sent` Sends a contract / asks for ours (e.g. 'contract attached'; 'send your agreement') → rules BRD-CONTRACT-01, BRD-CONTRACT-05, BRD-CONTRACT-09, BRD-CONTRACT-08 — needs a person: terms
- `brd.brief_or_feedback` Sends the brief, approves or asks revisions (e.g. 'brief attached'; 'approved'; 'please change') → rules BRD-DELIV-06, BRD-DELIV-05, BRD-DELIV-04, BRD-DELIV-08
- `brd.payment` Payment, invoice or delay message (e.g. 'invoice'; 'payment processed'; 'net 30') → rules BRD-PAY-02, BRD-PAY-03, BRD-PAY-01, BRD-PAY-08, BRD-PAY-09
- `brd.results` Asks about results / unhappy with results (e.g. 'how did it perform'; 'disappointed'; 'low clicks') → rules BRD-AFTER-09, BRD-AFTER-07, BRD-AFTER-10, BRD-AFTER-05 — needs a person: terms
- `brd.no` No / not interested (e.g. 'not interested'; 'not at this time'; "we'll pass") → rules BRD-OBJ-16, BRD-OBJ-14, BRD-FU-05, BRD-OBJ-23
- `brd.wrong_person` Wrong person / redirect (e.g. 'not the right person'; 'contact our marketing team') → rules BRD-FIRST-02, BRD-QUAL-01

## Reply types — any

- `any.out_of_office` Out-of-office / auto-reply (e.g. 'out of office'; 'on vacation until'; 'automatic reply') → rules FND-WRITE-05, INF-REPLY-30
- `any.bounce` Bounce / address does not exist (e.g. 'delivery failed'; 'address not found'; 'undeliverable') → rules FND-DLV-06
- `any.unsubscribe` Asks to stop (e.g. 'unsubscribe'; 'remove me'; 'stop emailing') → rules FND-ETH-12, FND-MIND-04
- `any.other_language` Writes in another language → rules FND-WRITE-06
- `any.unclear` Unclear / unrelated → rules BRD-REPLY-09, FND-WRITE-06 — needs a person: fact_missing
