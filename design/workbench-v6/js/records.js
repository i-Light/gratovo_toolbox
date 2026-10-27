/* records.js — V6 Work Surfaces shared by Today, Phase screens, QuickDraft Dock, and Peek panel:
   - DraftCard with P4 Cross-Party CC Block (BRD-REPLY-24), P7 Emergency Social Proof Gate (HC-07), Phishing Guard (BRD-REPLY-30), and VA Shadow Gate
   - Thread & AiRead with F6 Interactive Reclassify ▾ Dropdown (all situations from situations.md) + 1-Click Reply Simulator Presets
   - DualDealRoom (F3: Brand Thread ⇄ Agency Margin & Terms Bridge ⇄ Creator / Manager Thread with 1-click Relays)
   - DealChecklist with F4 10-Step DealRibbon, F5 Dual Deadlines & Multi-Model Selector, System 12 Physical Shipping Guard, System 13 5-Point Video QC Gate & Pre-Live Check-ins, System 14 Post-Go-Live Hype Cadence & Proactive Make-Good Engine
   - PitchPicker with P1 Mode A (Cold First Touch HC-14) vs Mode B (Warm 3-Option Priced Offer HC-26), Multi-Format Multipliers, Dual-Buyer Sequencing (HC-25), and Brand Talent Packet trigger
   - CreatorBody with System 1–5 (12-video trimmed avg, view stability, bot risk, 1–5 star rubric, Brokered vs Exclusive 25%, 14d Warmth Pulse, Exclusivity Locks, Onboarding Profile). */
(function(){
"use strict";
var W = window.W, html = W.html, Icon = W.Icon, useState = W.useState, useRef = W.useRef, useEffect = W.useEffect, useLayoutEffect = W.useLayoutEffect;
var Btn = W.Btn, Tag = W.Tag;

/* ================= draft card ================= */
function AutoText(p){
  var ref = useRef(null);
  useLayoutEffect(function(){ var el = ref.current; if (el){ el.style.height = "auto"; el.style.height = (el.scrollHeight + 2) + "px"; } }, [p.value]);
  return html`<textarea ref=${ref} id=${p.id} class=${p.cls} value=${p.value} onInput=${function(e){ p.onChange(e.target.value); }} aria-label=${p.label} spellcheck="true"></textarea>`;
}
function Gate(p){
  var q = p.q, g = p.g, o = W.rec(q.to);
  var st = useState(o && o.cands && o.cands.length ? o.cands[o.cands.length - 1].email : (o && o.email) || ""), pick = st[0], setPick = st[1];
  if (g.ok) return html`<div class="gate ok"><${Icon} n="checkc" /><span class="grow">${g.k === "price" ? "Price confirmed" : g.k === "claim" ? "Track-record / HC-07 framing verified" : "Confirmed"}</span></div>`;
  if (g.k === "unconfirmed" && q.to.t === "creator"){
    var cands = (o.cands && o.cands.length ? o.cands : [{email:o.email, src:o.emailSrc, conf:o.emailConf}]).filter(function(c){ return c.email; });
    return html`<div class="gate" data-why="gates"><${Icon} n="alert" /><div class="grow col tight" style=${{gap:"6px"}}>
      <span><b>Address not confirmed.</b> ${W.maskMoney(g.text)}</span>
      <div class="row wrap">
        <select class="sel sm" style=${{width:"auto", maxWidth:"100%"}} value=${pick} onChange=${function(e){ setPick(e.target.value); }} aria-label="Address to confirm">
          ${cands.map(function(c){ return html`<option key=${c.email} value=${c.email}>${c.email} · ${c.src} · ${Math.round(c.conf * 100)}%</option>`; })}
        </select>
        <${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.confirmEmail(o.id, pick); }}>Confirm this address</${Btn}>
      </div></div></div>`;
  }
  /* P7: Track-Record Claim & HC-07 Emergency Social Proof Gate */
  if (g.k === "claim"){
    return html`<div class="gate" data-why="gates"><${Icon} n="shield" /><span class="grow"><b>Track-Record Claim Check (FND-ETH-03):</b> ${W.maskMoney(g.text)}</span>
      <span class="row wrap" style=${{gap:"6px"}}>
        <${Btn} size="sm" kind="pri" icon="sparkle" onClick=${function(){ W.A.useEmergencySocialProof(q.id); }}>Use HC-07 Emergency Social Proof</${Btn}>
        <${Btn} size="sm" onClick=${function(){ W.A.confirmGate(q.id, g.k); }}>Claims are 100% true</${Btn}>
      </span></div>`;
  }
  var healthyMb = g.k === "cap" ? W.D().mail.filter(function(m){ return !W.mailboxBlocked(m) && m.cap - m.sent > 3; })[0] : null;
  var canConfirm = !(g.k === "price" && !W.canSeeMoney()) && !(g.k === "va_shadow" && W.isShadowVA());
  return html`<div class=${W.cx("gate", g.k === "never" ? "block" : null)} data-why="gates"><${Icon} n="alert" /><span class="grow">${W.maskMoney(g.text)}</span>
    <span class="row wrap" style=${{gap:"6px"}}>
      ${healthyMb ? html`<${Btn} size="sm" kind="pri" icon="mail" onClick=${function(){ W.A.setMailbox(q.id, healthyMb.id); }}>Switch to ${healthyMb.addr.split("@")[0]}</${Btn}>` : null}
      ${canConfirm ? html`<${Btn} size="sm" onClick=${function(){ W.A.confirmGate(q.id, g.k); }}>${g.k === "price" ? "Confirm price" : g.k === "phishing" ? "Verified corporate domain" : "Approve"}</${Btn}>` : html`<${Tag} icon="lock">Owned by AM/Owner</${Tag}>`}
    </span></div>`;
}

W.DraftCard = function(p){
  var q = p.q, o = W.rec(q.to);
  var open = q.gates.filter(function(g){ return !g.ok; });
  var key = p.itemKey || W.itemKeyForDraft(q);
  W.useKeys({"mod+enter":function(){ if (!open.length) W.A.sendDraft(q.id, {key:key}); else W.toast({msg:"This email still needs you", sub:W.maskMoney(open[0].text), icon:"alert", tone:"warn"}); }}, !!p.primary);
  if (!o) return null;
  var mb = W.mailbox(q.mailbox) || W.D().mail[0], left = mb.cap - mb.sent;
  var title = (W.KIND[q.kind] || "Email") + (q.n ? " " + q.n + " of 3" : "");
  var whyOpen = useState(false), ccOpen = useState(!!q.cc), schedOpen = useState(false), schedDay = useState(2), schedHour = useState(9);
  var topCountry = q.to.t === "creator" ? ((o.countries && o.countries[0] && o.countries[0][0]) || "US") : (o.country || "US");
  var tzHour = {US:15, CA:15, BR:14, GB:10, FR:9, DE:9, ES:9, NG:10, IN:5, PK:6, PH:3, AU:1}[topCountry] || 15;
  var tzLabel = {US:"EST", CA:"EST", BR:"BRT", GB:"BST", FR:"CET", DE:"CET", ES:"CET", NG:"WAT", IN:"IST", PK:"PKT", PH:"PHT", AU:"AEST"}[topCountry] || "local";
  var theirMorning = W.at(1, tzHour, 0);
  var lint = W.lintDraft ? W.lintDraft(q) : {ok:true, words:0, issues:[]};
  var moments = q.kind === "first" && q.to.t === "creator" && o.moments && o.moments.length ? o.moments : null;
  var curMom = q.momentIdx != null ? q.momentIdx : (o.momentIdx || 0);
  var steerOpts = [["shorter","Shorter"],["warmer","Warmer"],["direct","More direct"],["redo","New angle"]].filter(function(s){ return !(q.kind === "first" && s[0] === "warmer"); });
  var shownSubj = W.canSeeMoney() ? q.subject : W.maskMoney(q.subject);
  var shownBody = W.canSeeMoney() ? q.body : W.maskMoney(q.body);
  var recEmail = q.toEmail || o.email;
  var recContact = q.toContact || o.contact || o.name;
  /* P4: Check if CC contains a cross-party email (BRD-REPLY-24) */
  var ccLeak = q.cc && ((q.to.t === "brand" && W.D().creators.some(function(c){ return c.email && q.cc.toLowerCase().indexOf(c.email.toLowerCase()) >= 0; })) ||
                        (q.to.t === "creator" && W.D().brands.some(function(b){ return b.email && q.cc.toLowerCase().indexOf(b.email.toLowerCase()) >= 0; })));
  function schedule(e){ W.menu(e, [{head:"Send later"},
    {label:"Their morning (" + topCountry + ")", hint:W.fmtDate(theirMorning) + " · 09:00 " + tzLabel + " (" + W.fmtTime(theirMorning) + " yours)", icon:"sun", run:function(){ W.A.sendDraft(q.id, {at:theirMorning, key:key}); }},
    {label:"Tomorrow, 09:00 yours", hint:W.fmtDate(W.at(1)), icon:"clock", run:function(){ W.A.sendDraft(q.id, {at:W.at(1, 9), key:key}); }},
    {label:"Monday, 09:00", icon:"calendar", run:function(){ W.A.sendDraft(q.id, {at:W.at(7, 9), key:key}); }},
    {sep:true},
    {label:"Pick day & time…", icon:"sliders", run:function(){ schedOpen[1](true); }}]); }
  function more(e){ W.menu(e, W.snoozeItems(key, title + " to " + o.name).concat([{sep:true}], W.handItems(key, q.to, title + " to " + o.name), [{sep:true},
    {label:"Skip this email", icon:"arrowR", run:function(){ W.A.skipDraft(q.id, key); }},
    q.to.t === "creator" ? {label:"Never contact " + o.name, icon:"ban", danger:true, run:function(){ W.A.never(o.id, "Owner chose never contact"); }} : null].filter(Boolean)), {align:"end"}); }
  return html`<div class=${W.cx("draft", q.rewriting ? "rewriting" : null)} data-why="draft">
    <div class="dh">
      <div class="row wrap">
        <${Tag} hue="var(--reach)" icon=${q.kind === "reply" ? "reply" : q.kind === "followup" ? "clock" : "send"}>${title}</${Tag}>
        ${q.pitchMode ? html`<${Tag} tone=${q.pitchMode === "cold" ? "info" : "good"}>${q.pitchMode === "cold" ? "HC-14 Cold First Touch (No $)" : "HC-26 Priced Offer"}</${Tag}>` : null}
        <span class="small muted">Drafted by Gemini · ${W.ago(q.created)}${q.edited ? " · edited by you" : ""}</span>
        ${lint.ok ? html`<${Tag} tone="good" icon="check" tip="Passes Gratovo Playbook checks (word count, zero fanboy praise, banned phrases, greeting, one clear CTA)">Playbook: Good · ${lint.words}w</${Tag}>`
          : html`<span class="row wrap" style=${{gap:"4px"}}><${Tag} tone="warn" icon="alert" tip=${lint.issues.map(function(x){ return x.rule + ": " + x.msg; }).join(" · ")}>Playbook: ${W.plural(lint.issues.length, "issue")} · ${lint.words}w</${Tag}><button type="button" class="btn sm" style=${{height:"22px", padding:"0 8px", fontSize:"11.5px"}} onClick=${function(){ W.A.fixDraftLint(q.id); }}><${Icon} n="sparkle" s=${12} />Fix in 1 click</button></span>`}
        <span class="sp"></span>
        <button type="button" class="btn ghost sm" onClick=${function(){ whyOpen[1](!whyOpen[0]); }} aria-expanded=${String(whyOpen[0])}><${Icon} n="sparkle" />Why this email</button>
      </div>
      <div class="dline"><span>To</span><span class="row wrap" style=${{gap:"6px", minWidth:0}}><b class="ell" style=${{fontWeight:500}}>${recContact}</b><span class="mono small ell muted">${recEmail || "no address"}</span>
        ${q.to.t === "creator" ? (o.confirmed ? html`<${Tag} tone="good" icon="check">confirmed</${Tag}>` : html`<${Tag} tone="warn" icon="alert">not confirmed</${Tag}>`) : null}
        ${q.to.t === "brand" && /@(gmail|yahoo|hotmail|outlook)\.com$/i.test(recEmail || "") ? html`<${Tag} tone="warn" icon="alert" tip="BRD-REPLY-30: Personal email address — verify corporate domain before sending roster">personal email</${Tag}>` : null}
        ${recEmail ? html`<button type="button" class="iconbtn" style=${{width:"26px", height:"26px"}} onClick=${function(){ W.copy(recEmail, "the address"); }} aria-label="Copy address" data-tip="Copy address"><${Icon} n="copy" s=${14} /></button>` : null}
        ${!ccOpen[0] ? html`<button type="button" class="btn ghost sm" style=${{height:"22px", padding:"0 6px", fontSize:"11.5px"}} onClick=${function(){ ccOpen[1](true); }}>+ CC</button>` : null}</span></div>
      ${ccOpen[0] ? html`<div class="dline"><span>CC</span><span class="row wrap" style=${{gap:"6px"}}><input class="inp sm mono" style=${{maxWidth:"260px", borderColor:ccLeak ? "var(--crit)" : null}} placeholder=${q.to.t === "creator" ? "manager@talent.co (never brand)" : "colleague@brand.com (never creator)"} value=${q.cc || ""} onInput=${function(e){ W.A.editDraft(q.id, {cc:e.target.value}); }} aria-label="CC address" />${ccLeak ? html`<${Tag} tone="crit" icon="ban">BRD-REPLY-24: Cross-party CC blocked!</${Tag}>` : null}<button type="button" class="btn ghost sm" onClick=${function(){ W.A.editDraft(q.id, {cc:""}); ccOpen[1](false); }}>Remove</button></span></div>` : null}
      <div class="dline"><span>From</span><span class="row wrap" style=${{gap:"8px", minWidth:0}}>
        <select class="sel sm" style=${{width:"auto", maxWidth:"60%"}} value=${q.mailbox} onChange=${function(e){ W.A.setMailbox(q.id, e.target.value); }} aria-label="Send from">
          ${W.D().mail.map(function(m){ var why = W.mailboxBlocked(m); return html`<option key=${m.id} value=${m.id}>${m.addr}${why ? " (" + (m.status === "error" ? "signed out" : m.paused ? "paused" : "full today") + ")" : ""}</option>`; })}
        </select>
        <${W.Meter} v=${mb.sent} max=${mb.cap} w=${64} tone=${left <= 3 ? "crit" : left <= 8 ? "warn" : null} label="Sends used today" />
        <span class="small muted num">${left} left today</span>
        ${mb.status === "error" ? html`<${Tag} tone="crit" icon="alert" tip=${mb.err || ""}>signed out</${Tag}>` : mb.paused ? html`<${Tag} icon="pause">paused</${Tag}>` : mb.status !== "good" ? html`<${Tag} tone="warn" tip=${mb.note || ""}>${mb.status === "warming" ? "warming up · day " + mb.warm.day + " of " + mb.warm.of : "slowed"}</${Tag}>` : null}
      </span></div>
    </div>
    <div class="db">
      ${moments ? html`<div class="col tight" style=${{padding:"6px 8px", background:"var(--sunk)", borderRadius:"var(--r-s)", gap:"5px"}} data-why="moments">
        <div class="row wrap" style=${{gap:"6px"}}><span class="tiny muted"><b style=${{color:"var(--ink-2)"}}>Video moment (${o.videos && o.videos[0] ? o.videos[0].t.slice(0, 38) : "latest upload"}):</b> pick 1 of 3 checkable hooks (gratovo-moments)</span></div>
        <div class="row wrap" style=${{gap:"5px"}}>${moments.map(function(m, idx){ var on = curMom === idx; return html`<button key=${idx} type="button" class="chip" style=${{height:"auto", padding:"4px 8px", textAlign:"start"}} aria-pressed=${String(on)} onClick=${function(){ W.A.pickMoment(o.id, idx); }} data-tip=${W.maskMoney("Quote: \"" + m.quote + "\" → Bridge: " + m.bridge)}>
          <span class="mono tiny" style=${{color:"var(--reach)", fontWeight:600}}>${m.at}</span> <span class="tiny b">${m.kind}:</span> <span class="tiny ell" style=${{maxWidth:"220px"}}>${W.maskMoney(m.point.replace(/^your\s+/i, ""))}</span>
        </button>`; })}</div>
      </div>` : null}
      <input class="subj" value=${shownSubj} onInput=${function(e){ W.A.editDraft(q.id, {subject:e.target.value}); }} aria-label="Subject" id=${"subj-" + q.id} />
      <${AutoText} id=${"body-" + q.id} cls="bodyta" value=${shownBody} label="Email text" onChange=${function(v){ W.A.editDraft(q.id, {body:v}); }} />
      ${!lint.ok ? html`<div class="callout warn" style=${{padding:"7px 10px"}}><${Icon} n="alert" /><div class="grow small">${lint.issues.map(function(x){ return x.rule + ": " + x.msg; }).join(" · ")}</div><${Btn} size="sm" icon="sparkle" onClick=${function(){ W.A.fixDraftLint(q.id); }}>Fix now</${Btn}></div>` : null}
      ${whyOpen[0] ? html`<div class="callout info"><${Icon} n="sparkle" /><div class="grow col tight" style=${{gap:"6px"}}><span>${W.maskMoney(q.why)}</span><span class="row wrap" style=${{gap:"4px"}}>${(q.rules || []).map(function(r){ return html`<span key=${r} class="tag line mono" data-tip="House rule the draft followed">${r}</span>`; })}</span></div></div>` : null}
      ${q.gates.length ? html`<div class="col tight">${q.gates.map(function(g, i){ return html`<${Gate} key=${g.k + i} q=${q} g=${g} />`; })}</div>` : null}
      ${schedOpen[0] ? html`<div class="callout info" style=${{alignItems:"center"}}><${Icon} n="calendar" /><span class="row wrap grow" style=${{gap:"8px"}}><span>Schedule send:</span><select class="sel sm" style=${{width:"auto"}} value=${schedDay[0]} onChange=${function(e){ schedDay[1](+e.target.value); }} aria-label="Schedule day">${[1,2,3,4,5,7,10,14].map(function(d){ return html`<option key=${d} value=${d}>${W.fmtDate(W.at(d))}</option>`; })}</select><select class="sel sm" style=${{width:"auto"}} value=${schedHour[0]} onChange=${function(e){ schedHour[1](+e.target.value); }} aria-label="Schedule hour">${[8,9,10,11,14,15,16,17].map(function(h){ return html`<option key=${h} value=${h}>${("0"+h).slice(-2)}:00</option>`; })}</select></span><${Btn} size="sm" kind="pri" icon="clock" onClick=${function(){ W.A.sendDraft(q.id, {at:W.at(schedDay[0], schedHour[0], 0), key:key}); schedOpen[1](false); }}>Schedule</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ schedOpen[1](false); }}>Cancel</${Btn}></div>` : null}
    </div>
    <div class="df">
      <span class="btn-split">
        <${Btn} kind="pri" icon="send" disabled=${open.length > 0 || !!q.rewriting || !!ccLeak} onClick=${function(){ W.A.sendDraft(q.id, {key:key}); }} tip=${open.length ? "Clear the warning above first" : "Send now"} kbd="Ctrl Enter">Send</${Btn}>
        <${Btn} kind="pri" label="Send later" disabled=${open.length > 0 || !!ccLeak} onClick=${schedule} tip="Send later"><${Icon} n="chevD" s=${14} /></${Btn}>
      </span>
      <span class="row wrap" style=${{gap:"2px"}} data-why="steer">
        <span class="small muted" style=${{padding:"0 4px 0 8px"}}>Rewrite</span>
        ${steerOpts.map(function(s){ var down = (W.D().health || {}).gemini === "offline"; return html`<button key=${s[0]} type="button" class="btn ghost sm" disabled=${!!q.rewriting || down} data-tip=${down ? "The Gemini bridge is offline. Edit the text by hand, or reconnect it." : null} onClick=${function(){ W.A.steer(q.id, s[0]); }}>${q.rewriting === s[0] ? html`<${Icon} n="refresh" cls="spin" />` : null}${s[1]}</button>`; })}
      </span>
      <span class="sp"></span>
      <button type="button" class="iconbtn" onClick=${more} aria-label="More actions" data-tip="Snooze, hand off, skip or never contact"><${Icon} n="more" /></button>
    </div>
  </div>`;
};

/* ================= conversation & F6 Full 47-Situation Classifier + Reclassify ================= */
var SIM_PRESETS = {
  creator: [
    ["Who are you?", "Hey — who are you guys and what brands or case studies have you actually run?"],
    ["Rate + US audience", "Thanks for reaching out! My rate is $1,600 for a 60–90s integration. Audience is US 44%, UK 11%, Canada 8%."],
    ["Rate too high ($3.5K)", "Happy to chat — our standard rate for a 60s integration is $3,500."],
    ["Wants intro call", "Sounds interesting! Can we hop on a quick 10-minute Zoom call tomorrow to chat through how you work?"],
    ["Talent manager reply", "Hi Moustafa, I manage partnerships for this channel at Apex Talent (sarah@apextalent.co). What budget and timeline are you working with?"],
    ["No exclusivity", "Open to hearing more, as long as it's non-exclusive and I can keep my direct sponsors."]
  ],
  brand: [
    ["Send talent roster", "Interested! Can you send over your full talent roster and media kits with rates?"],
    ["Why not go direct?", "Why shouldn't we just reach out to these creators directly instead of going through an agency?"],
    ["Counter-offer ($3,800)", "We like the channel fit, but our max budget for this test integration is $3,800. Can you make that work?"],
    ["Only do CPM deals", "We only run performance / CPM campaigns with a view guarantee right now."],
    ["Let's hop on a call", "Let's jump on a 15-minute discovery call on Thursday to walk through your creators."],
    ["Budget locked till Q1", "Our Q4 creator budget is fully locked, reach back out when Q1 planning opens."]
  ]
};

W.Thread = function(p){
  var ref = p.refx, th = W.threadOf(ref), lim = p.limit || 3;
  var all = useState(false), paste = useState(false), txt = useState("");
  var shown = all[0] ? th : th.slice(-lim);
  var lastIn = W.lastIn(ref), o = W.rec(ref);
  var presets = SIM_PRESETS[ref.t === "brand" ? "brand" : "creator"] || [];
  return html`<div class="col" style=${{gap:"10px"}}>
    ${th.length > shown.length ? html`<button type="button" class="btn ghost sm" style=${{alignSelf:"center"}} onClick=${function(){ all[1](true); }}>Show ${th.length - shown.length} earlier</button>` : null}
    ${!th.length ? html`<p class="hint">No emails yet.</p>` : null}
    <div class="thread">
      ${shown.map(function(m, i){ return html`<div key=${m.at + "-" + i} class=${W.cx("msg", m.dir)}>
        <div class="mh"><span>${m.dir === "in" ? (o.contact || o.name) : (m.by ? W.member(m.by).name : "You")}${m.toContact ? " → " + m.toContact : ""}</span><span>${W.fmtDate(m.at)} ${W.fmtTime(m.at)}</span>${m.scheduled ? html`<span>· scheduled</span>` : null}${m.pasted ? html`<span>· pasted in</span>` : null}</div>${W.canSeeMoney() ? m.text : W.maskMoney(m.text)}</div>`; })}
    </div>
    ${lastIn && lastIn.ai && p.ai !== false ? html`<${W.AiRead} refx=${ref} m=${lastIn} />` : null}
    ${p.paste !== false ? (paste[0] ? html`<div class="col tight" data-why="paste">
        <div class="row wrap" style=${{gap:"4px"}}><span class="tiny muted">1-Click Reply Simulator Presets (situations.md):</span>
          ${presets.map(function(pr){ return html`<button key=${pr[0]} type="button" class="chip" style=${{height:"22px", padding:"0 7px", fontSize:"11px"}} onClick=${function(){ txt[1](pr[1]); }}>${pr[0]}</button>`; })}
        </div>
        <textarea class="ta" rows="3" placeholder=${"Paste " + (o.contact || o.name) + "'s reply here"} value=${txt[0]} onInput=${function(e){ txt[1](e.target.value); }} aria-label="Pasted reply" autoFocus=${true}
          onKeyDown=${function(e){ if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); e.stopPropagation(); if (txt[0].trim()){ W.A.pasteReply(ref, txt[0]); txt[1](""); paste[1](false); } } else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); paste[1](false); } }}></textarea>
        <div class="row wrap"><${Btn} size="sm" kind="pri" icon="paste" disabled=${!txt[0].trim()} onClick=${function(){ W.A.pasteReply(ref, txt[0]); txt[1](""); paste[1](false); }}>Classify & Draft Reply <span class="kbd">Ctrl Enter</span></${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ paste[1](false); }}>Cancel</${Btn}><span class="hint">Matches against all 47 Playbook situations.</span></div>
      </div>` : html`<div class="row wrap"><button type="button" class="btn ghost sm" style=${{color:"var(--muted)"}} onClick=${function(){ paste[1](true); }} data-why="paste"><${Icon} n="paste" />Paste or simulate a reply</button><button type="button" class="btn ghost sm" style=${{color:"var(--muted)"}} onClick=${function(){ W.ui(function(u){ u.modal = {kind:"call", ref:ref}; }); }}><${Icon} n="phone" />Call Co-Pilot</button></div>`) : null}
  </div>`;
};

W.AiRead = function(p){
  var ai = p.m.ai, ref = p.refx;
  var unsaved = (ai.facts || []).filter(function(f){ return !f.saved; });
  var ccMatch = (p.m.text || "").match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  var ccAddr = ccMatch ? ccMatch[1] : null;
  var activeDraft = W.draftsFor(ref)[0] || null;
  var sitList = (W.SITUATIONS && W.SITUATIONS[ref.t === "brand" ? "brand" : "creator"]) || [];
  var curSitId = ai.situationId || (sitList[0] && sitList[0].id) || "";
  return html`<div class="ai-read" data-why="ai-read">
    <div class="row wrap">
      <${Icon} n="sparkle" />
      <b style=${{fontWeight:600}}>${W.maskMoney(ai.intent)}</b>
      <label class="row small muted" style=${{gap:"4px"}}><span>Reclassify:</span>
        <select class="sel sm" style=${{width:"auto", maxWidth:"230px", height:"24px", fontSize:"11.5px"}} value=${curSitId} onChange=${function(e){ W.A.reclassifyReply(ref, p.m.at, e.target.value); }} aria-label="Reclassify reply situation">
          ${sitList.map(function(s){ return html`<option key=${s.id} value=${s.id}>${s.label}</option>`; })}
        </select>
      </label>
      <span class="sp"></span>
      ${ref.t === "creator" && unsaved.length >= 2 ? html`<${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.saveAllFacts(ref, p.m.at); }}>Save all ${unsaved.length} to record</${Btn}>` : null}
      ${ccAddr && activeDraft && activeDraft.cc !== ccAddr ? html`<${Btn} size="sm" icon="plus" onClick=${function(){ W.A.addCcFromReply(ref, ccAddr); }}>+ CC ${ccAddr}</${Btn}>` : null}
    </div>
    <span class="small">${W.maskMoney(ai.summary)}</span>
    ${ai.facts && ai.facts.length ? html`<div class="row wrap" style=${{gap:"6px"}}>${ai.facts.map(function(f){ return html`<span key=${f.k} class=${W.cx("fact", f.saved ? "saved" : null)}><span class="muted small">${f.label}</span> ${W.maskMoney(f.show)}
      ${ref.t === "creator" ? html`<button type="button" disabled=${f.saved} onClick=${function(){ W.A.saveFact(ref, p.m.at, f.k); }}>${f.saved ? "Saved" : "Save to record"}</button>` : null}</span>`; })}</div>` : null}
    ${ai.next ? html`<span class="small ink2"><b style=${{fontWeight:600}}>Playbook move:</b> ${W.maskMoney(ai.next)}</span>` : null}
  </div>`;
};

/* ================= F3: Dual-Sided Deal Room (Brand Thread ⇄ Agency Margin Bridge ⇄ Creator Thread) ================= */
W.DualDealRoom = function(p){
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator);
  if (!b || !c) return null;
  var bRef = {t:"brand", id:b.id}, cRef = {t:"creator", id:c.id};
  var bDrafts = W.draftsFor(bRef), cDrafts = W.draftsFor(cRef);
  var margin = x.price - x.payout, marginPct = Math.round(100 * margin / Math.max(1, x.price));
  var draftDue = x.creatorDeadline || ((x.golive || W.at(14)) - 5 * W.DAY);
  return html`<div class="col" style=${{gap:"12px"}} data-why="dual-room">
    <div class="callout info" style=${{padding:"8px 12px"}}>
      <${Icon} n="shield" />
      <div class="grow small"><b>Dual-Sided Deal Room (BRD-REPLY-24 · INF-DELIV-13):</b> Brand and Creator threads stay strictly separated so agency margin (${W.money(margin)} · ${marginPct}%) is never leaked. Use the center bridge to relay updates cleanly across sides.</div>
      <${Btn} size="sm" icon="file" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"contract", dealId:x.id}; }); }}>Side-by-Side Contracts</${Btn}>
    </div>
    <div class="dual-room-3">
      <div class="card tight">
        <div class="row wrap"><${W.BAv} b=${b} size="s" /><div class="grow col t2"><h4>Brand Side · ${b.name}</h4><span class="tiny muted">${b.contact || "Buyer"} (${b.email}) · Gross: <b>${W.money(x.price)}</b></span></div><${Tag} hue="var(--close)">${b.status}</${Tag}></div>
        <hr class="divider" />
        <${W.Thread} refx=${bRef} limit=${4} />
        ${bDrafts.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}
      </div>

      <div class="bridge-col">
        <div class="row"><${Icon} n="compare" style=${{color:"var(--close)"}} /><h4>Agency Margin & Buffer Bridge</h4></div>
        ${W.canSeeMoney() ? html`<div class="col tight" style=${{padding:"8px 10px", background:"var(--panel)", borderRadius:"8px", border:"1px solid var(--line)"}}>
          <div class="row small"><span class="muted grow">Brand Gross (${b.name})</span><b class="num">${W.money(x.price)}</b></div>
          <div class="row small"><span class="muted grow">Creator Net (${c.name})</span><b class="num">${W.money(x.payout)}</b></div>
          <hr class="divider" />
          <div class="row small"><span class="b grow" style=${{color:"var(--money)"}}>Agency Spread (${marginPct}%)</span><b class="num" style=${{color:"var(--money)"}}>${W.money(margin)}</b></div>
          <span class="tiny muted">Model: ${x.dealModel === "exclusive_25" ? "Exclusive 25% Mgmt" : x.dealModel === "cpm" ? "CPM Performance" : "Brokered Markup"}</span>
        </div>` : null}
        <div class="col tight" style=${{padding:"8px 10px", background:"var(--panel)", borderRadius:"8px", border:"1px solid var(--line)"}}>
          <span class="tiny b ink2">Dual Deadline Buffer (BRD-DELIV-09)</span>
          <div class="row small"><span class="muted grow">Creator Draft Due:</span><b class="num" style=${{color:"var(--warn)"}}>${W.fmtShort(draftDue)} (-5d)</b></div>
          <div class="row small"><span class="muted grow">Brand Go-Live:</span><b class="num">${W.fmtShort(x.golive || W.at(14))}</b></div>
        </div>
        <div class="col tight">
          <${Btn} size="sm" kind="pri" icon="arrowR" onClick=${function(){ W.A.relayBrandToCreator(x.id); }} tip="Strips brand gross price and translates notes calmly into creator tasks">Relay Brand → ${c.name.split(" ")[0]}</${Btn}>
          <${Btn} size="sm" icon="arrowL" onClick=${function(){ W.A.relayCreatorToBrand(x.id); }} tip="Formats creator progress professionally for the brand buyer">Relay ${c.name.split(" ")[0]} → ${b.name}</${Btn}>
        </div>
      </div>

      <div class="card tight">
        <div class="row wrap"><${W.CAv} c=${c} size="s" /><div class="grow col t2"><h4>Creator Side · ${c.name}</h4><span class="tiny muted">${c.contact || c.name} (${c.email}) · Payout: <b>${W.money(x.payout)}</b></span></div><${Tag} hue="var(--reach)">${c.relationshipModel === "exclusive_25" ? "Exclusive 25%" : "Brokered"}</${Tag}></div>
        <hr class="divider" />
        <${W.Thread} refx=${cRef} limit=${4} />
        ${cDrafts.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}
      </div>
    </div>
  </div>`;
};

/* ================= contact ================= */
W.ContactBlock = function(p){
  var c = p.c;
  var cands = c.cands && c.cands.length ? c.cands.slice().sort(W.by(function(x){ return x.conf; }, -1)) : (c.email ? [{email:c.email, src:c.emailSrc, conf:c.emailConf}] : []);
  var st = useState(cands.length ? cands[0].email : ""), pick = st[0], setPick = st[1];
  var typed = useState(""), cname = useState(c.contact || "");
  function useTyped(){ if (!/^\S+@\S+\.\S+$/.test(typed[0])) return; W.bg(function(d){ var x = d.creators.filter(function(z){ return z.id === c.id; })[0]; if (x){ x.cands = (x.cands || []).concat([{email:typed[0], src:"Typed in by you", conf:.99}]); } }); W.A.confirmEmail(c.id, typed[0], cname[0]); typed[1](""); }
  W.useKeys({
    "1":function(){ if (cands[0]) setPick(cands[0].email); },
    "2":function(){ if (cands[1]) setPick(cands[1].email); },
    "3":function(){ if (cands[2]) setPick(cands[2].email); },
    "mod+enter":function(){ if (pick) W.A.confirmEmail(c.id, pick, cname[0]); else if (/^\S+@\S+\.\S+$/.test(typed[0])) useTyped(); }
  }, !c.confirmed && !c.finding);
  if (c.confirmed) return html`<div class="row wrap"><${Icon} n="checkc" style=${{color:"var(--good)"}} /><span class="mono">${c.email}</span>${c.contact ? html`<span class="small muted">(${c.contact})</span>` : null}<${Tag} tone="good">confirmed</${Tag}><span class="hint">${c.emailSrc || ""}</span><button type="button" class="btn ghost sm" onClick=${function(){ W.copy(c.email, "the address"); }}><${Icon} n="copy" />Copy</button><button type="button" class="btn ghost sm" onClick=${function(){ W.A.unconfirmEmail(c.id); }}>Change</button></div>`;
  if (c.finding) return html`<div class="row"><${Icon} n="refresh" cls="spin" /><span>Looking on the About page, video descriptions and linked sites…</span></div>`;
  var curMom = c.momentIdx || 0;
  return html`<div class="col tight" style=${{gap:"8px"}}>
    ${cands.length ? html`<div class="col tight" role="radiogroup" aria-label="Addresses found">${cands.map(function(k, idx){ var on = pick === k.email; return html`<label key=${k.email} class="ck" style=${{cursor:"pointer", borderColor:on ? "var(--accent)" : null}}>
        <input type="radio" name=${"cand-" + c.id} checked=${on} onChange=${function(){ setPick(k.email); }} />
        <span class="t"><span class="mono">${k.email}</span><small>${k.src}</small></span>
        <span class="kbd">${idx + 1}</span>
        <${W.Meter} v=${k.conf} max=${1} w=${54} tone=${k.conf >= .85 ? "good" : k.conf >= .7 ? "warn" : "crit"} label="How sure" /><span class="num small muted" style=${{width:"34px"}}>${Math.round(k.conf * 100)}%</span>
      </label>`; })}</div>` : html`<${W.Callout} tone="warn">No public email on the About page, descriptions or linked sites. Send a 2-line DM on Instagram or X asking for their best business email (INF-FIRST-23).</${W.Callout}>`}
    ${c.moments && c.moments.length ? html`<div class="col tight" style=${{padding:"6px 8px", background:"var(--sunk)", borderRadius:"var(--r-s)", gap:"4px"}}>
      <span class="tiny muted"><b style=${{color:"var(--ink-2)"}}>First-email hook (${c.videos && c.videos[0] ? c.videos[0].t.slice(0, 36) : "latest video"}):</b></span>
      <div class="row wrap" style=${{gap:"5px"}}>${c.moments.map(function(m, idx){ var on = curMom === idx; return html`<button key=${idx} type="button" class="chip" style=${{height:"24px", padding:"0 8px", fontSize:"11.5px"}} aria-pressed=${String(on)} onClick=${function(){ W.A.pickMoment(c.id, idx); }}><span class="mono" style=${{color:"var(--reach)"}}>${m.at}</span> ${m.kind}</button>`; })}</div>
      <span class="tiny ink2">${W.maskMoney(c.moments[curMom].point)}</span>
    </div>` : null}
    <div class="row wrap">
      <input class="inp sm" style=${{width:"150px"}} placeholder=${"First name or " + c.name} value=${cname[0]} onInput=${function(e){ cname[1](e.target.value); }} aria-label="Creator first name" />
      ${!cname[0] ? html`<button type="button" class="btn ghost sm" onClick=${function(){ cname[1](c.name.split(" ")[0]); }} data-tip="INF-FIRST-14: Use channel name when first name is unknown">Use "${c.name.split(" ")[0]}"</button>` : null}
      ${cands.length ? html`<${Btn} kind="pri" icon="check" onClick=${function(){ W.A.confirmEmail(c.id, pick, cname[0]); }} kbd="Ctrl Enter">Confirm ${pick.split("@")[0]}@…</${Btn}>` : null}
      <input class="inp sm" style=${{width:"200px"}} placeholder="Or type an address you found" value=${typed[0]} onInput=${function(e){ typed[1](e.target.value); }} onKeyDown=${function(e){ if (e.key === "Enter"){ e.preventDefault(); useTyped(); } }} aria-label="Type an address" />
      <${Btn} size="sm" disabled=${!/^\S+@\S+\.\S+$/.test(typed[0])} onClick=${useTyped}>Use it</${Btn}>
      ${!cands.length ? html`<${Btn} size="sm" kind="pri" icon="chat" onClick=${function(){ W.A.draftDm(c.id); }}>Copy 2-line DM (${c.socials ? c.socials.ig : "@handle"})</${Btn}><${Btn} size="sm" kind="ghost" icon="alarm" onClick=${function(){ W.A.park(c.id, W.at(30), "No public email found yet"); }}>Park 30d</${Btn}><${Btn} size="sm" kind="ghost" icon="x" onClick=${function(){ W.A.reject([c.id], "No email address found"); }}>Reject</${Btn}>` : null}
    </div>
  </div>`;
};

/* ================= audience check ================= */
W.AudienceCheck = function(p){
  var c = p.c, src = c.kit || c, a = W.audience({countries:src.countries, age:src.age, eng:src.eng || c.eng, rate:src.rate || c.rate});
  var ed = useState(false), fRate = useState(String(src.rate || c.rate || "")), fEng = useState(String(src.eng || c.eng || "")), fAge = useState(src.age || c.age || "18–34"), fRel = useState(c.relationshipModel || "brokered");
  var askRate = src.rate || c.rate || 0;
  var baseViews = c.trimmedAvgViews || c.median;
  var fairPayout = Math.round((baseViews / 1000 * (W.D().rules.cpm || 40)) / (1 + (W.D().rules.markup || 60) / 100) / 50) * 50;
  var counterTarget = askRate ? Math.max(fairPayout, Math.round(askRate * 0.85 / 50) * 50) : fairPayout;
  var rateHigh = askRate > fairPayout * 1.15;
  return html`<div class="col" style=${{gap:"10px"}} data-why="audience">
    ${c.kit && c.kit.file ? html`<div class="row small" style=${{padding:"6px 10px", background:"var(--sunk)", borderRadius:"8px"}}><${Icon} n="file" /><span class="mono grow ell">${c.kit.file}</span><span class="muted">Received ${W.ago(c.kit.at)}</span></div>` : null}
    <ul class="checks">${a.rows.map(function(r){ return html`<li key=${r.k} class="ck"><span class="box" style=${{background:r.ok === true ? "var(--good)" : r.ok === false ? "var(--crit)" : "var(--sunk-2)", borderColor:"transparent", color:r.ok === true ? "var(--good-ink)" : r.ok === false ? "var(--crit-ink)" : "var(--ink-2)"}}><${Icon} n=${r.ok === true ? "check" : r.ok === false ? "x" : "help"} s=${13} /></span><span class="t">${r.label}<small>${W.maskMoney(r.detail)}${r.k === "rate" && W.canSeeMoney() && fairPayout ? " · 12-vid trimmed benchmark (" + W.fmtK(baseViews) + " views): " + W.money(fairPayout) : ""}</small></span></li>`; })}</ul>
    ${c.kit && c.kit.fromReply ? html`<${W.Callout} tone="info">These numbers come from their email, not a screenshot. Ask for the YouTube Studio audience tab before you pitch them.</${W.Callout}>` : null}
    ${ed[0] ? html`<div class="card flat tight"><div class="grid2">${W.canSeeMoney() ? html`<${W.Field} label="Rate ($)"><input class="inp sm num" value=${fRate[0]} onInput=${function(e){ fRate[1](e.target.value.replace(/\D/g,"")); }} /></${W.Field}>` : null}<${W.Field} label="Engagement %"><input class="inp sm num" value=${fEng[0]} onInput=${function(e){ fEng[1](e.target.value); }} /></${W.Field}><${W.Field} label="Buying age"><select class="sel sm" value=${fAge[0]} onChange=${function(e){ fAge[1](e.target.value); }}>${["18–24","18–34","25–34","25–44","35–54"].map(function(ag){ return html`<option key=${ag} value=${ag}>${ag}</option>`; })}</select></${W.Field}><${W.Field} label="Roster Model (HC-04)"><select class="sel sm" value=${fRel[0]} onChange=${function(e){ fRel[1](e.target.value); }}><option value="brokered">Brokered Markup (15–30% added on top)</option><option value="exclusive_25">Exclusive Management (25% agency comm)</option></select></${W.Field}></div><div class="row wrap"><${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.updateCreatorAudience(c.id, {rate:+fRate[0] || c.rate, eng:parseFloat(fEng[0]) || c.eng, age:fAge[0], relationshipModel:fRel[0]}); ed[1](false); }}>Save numbers</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ ed[1](false); }}>Cancel</${Btn}></div></div>` : null}
    ${p.actions === false ? null : a.pass ? html`<div class="row wrap">
        <${Btn} kind="pri" icon="pen" onClick=${function(){ W.A.sign(c.id); }}>Everything passes: sign at ${W.money(src.rate || c.rate)}</${Btn}>
        ${W.canSeeMoney() && rateHigh ? html`<${Btn} size="sm" icon="dollar" onClick=${function(){ W.A.counterCreatorRate(c.id, counterTarget); }} tip="INF-NEG-01: Counter high creator rate with volume & zero-admin promise">Counter at ${W.money(counterTarget)} (-15%)</${Btn}>` : null}
        <${Btn} size="sm" kind="ghost" icon="edit" onClick=${function(){ ed[1](!ed[0]); }}>Edit numbers / tier</${Btn}>
        <span class="hint">They go on the roster and can be pitched right away.</span>
      </div>`
      : a.fail ? html`<div class="row wrap"><${Btn} kind="pri" icon="mail" onClick=${function(){ W.A.declineKit(c.id); }}>Decline kindly</${Btn}><${Btn} icon="alarm" onClick=${function(){ W.A.park(c.id, W.at(90), "Audience outside US/UK/CA/AU"); }}>Park for 90 days</${Btn}><${Btn} size="sm" kind="ghost" icon="edit" onClick=${function(){ ed[1](!ed[0]); }}>Edit numbers</${Btn}><span class="hint">Fails the audience rule, so brands won't buy it.</span></div>`
      : html`<div class="row wrap"><${Btn} kind="pri" icon="mail" onClick=${function(){ W.A.askMissingAudience(c.id); }}>Ask for what's missing</${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ ed[1](!ed[0]); }}>Enter numbers</${Btn}></div>`}
  </div>`;
};

/* ================= deals: 10-step ribbon, checklist, shipping, 5-point QC, hype cadence, money, ladder ================= */
W.DealSteps = function(p){ var x = p.x; return html`<${W.DealRibbon} x=${x} />`; };

var QC_ITEMS = [
  "Talking points hit naturally in creator's voice (INF-DELIV-07)",
  "60–90s duration & placed in first third of video (INF-DELIV-17)",
  "UTM tracking link in top 3 description lines + pinned comment",
  "Mandatory FTC #ad / Paid Promotion box enabled (FND-ETH-13)",
  "Zero copyrighted background music during sponsor segment (HC-33)"
];

W.DealChecklist = function(p){
  var x = p.x, st = W.DEAL_FLOW[x.step], firstOpen = x.checks.indexOf(false);
  var locked = st.lockedUntilPaid && !x.invoice.paid;
  var b = W.brand(x.brand), c = W.creator(x.creator);
  var ship = x.shipping || {};
  var qc = x.qcChecks || [false,false,false,false,false];
  var draftDue = x.creatorDeadline || ((x.golive || W.at(14)) - 5 * W.DAY);
  var trackSt = useState(ship.tracking || "");
  return html`<div class="col" style=${{gap:"10px"}} data-why="checklist">
    <div class="row wrap">
      <h3 class="grow">${st.name} <span class="muted small" style=${{fontWeight:400}}>· Step ${x.step + 1} of 10</span></h3>
      <${Tag} hue="var(--deliver)">Creator Draft Due: ${W.fmtShort(draftDue)} (-5d)</${Tag}>
      <${Tag} hue="var(--close)">Brand Go-Live: ${W.fmtShort(x.golive || W.at(14))}</${Tag}>
      <span class="small muted num">${x.checks.filter(Boolean).length} of ${x.checks.length} done</span>
    </div>
    ${st.note ? html`<p class="hint">${st.note}</p>` : null}
    <ul class="checks">${st.items.map(function(it, i){
      var lock = locked || (st.ordered && i > firstOpen && firstOpen >= 0 && !x.checks[i]);
      return html`<li key=${i} class=${W.cx("ck", x.checks[i] ? "done" : null, lock ? "locked" : null)}>
        <button type="button" class="box" onClick=${function(){ W.A.tickNote ? W.A.tickNote(x.id, i) : W.A.tick(x.id, i); }} aria-pressed=${String(!!x.checks[i])} aria-label=${(x.checks[i] ? "Untick " : "Tick ") + it}><${Icon} n=${lock && !x.checks[i] ? "lock" : "check"} s=${13} style=${lock && !x.checks[i] ? {color:"var(--faint)"} : null} /></button>
        <span class="t">${it}${lock && !x.checks[i] ? html`<small>${locked ? "Unlocks when " + b.name + " pays" : "Unlocks after the step above"}</small>` : null}</span>
      </li>`; })}</ul>

    ${x.step === 0 && x.neg ? html`<${W.Ladder} x=${x} />` : null}
    ${x.step === 1 ? html`<div class="row wrap"><${Btn} size="sm" kind="pri" icon="file" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"contract", dealId:x.id}; }); }}>Preview Side-by-Side Mirrored Contracts</${Btn}><${Btn} size="sm" icon="sparkle" onClick=${function(){ W.A.generateMirroredContract(x.id); }}>Generate Mirrored Contract & Email</${Btn}></div>` : null}

    ${x.step === 2 ? html`<div class="card flat tight" style=${{gap:"8px"}}>
      <div class="row wrap"><${Icon} n="truck" /><b class="grow">Physical Product Shipping & Provisioning Guard (INF-DELIV-08 · INF-MGR-16)</b>
        <label class="row small" style=${{gap:"5px"}}><input type="checkbox" checked=${!!ship.required} onChange=${function(){ W.A.updateShipping(x.id, {required:!ship.required}); }} />Requires physical product shipment</label>
      </div>
      ${ship.required ? html`<div class="row wrap">
        <input class="inp sm mono" style=${{width:"180px"}} placeholder="Carrier + tracking #" value=${trackSt[0]} onInput=${function(e){ trackSt[1](e.target.value); }} />
        <${Btn} size="sm" onClick=${function(){ W.A.updateShipping(x.id, {tracking:trackSt[0], shippedAt:W.now()}); }}>Save Tracking</${Btn}>
        <${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.updateShipping(x.id, {tracking:trackSt[0] || "DHL-99201", deliveredAt:W.now()}); }}>Mark Delivered (Starts Filming Clock)</${Btn}>
        <span class="tiny muted">${ship.deliveredAt ? "Delivered " + W.fmtShort(ship.deliveredAt) + " · Filming clock active" : "Filming countdown pauses until product is delivered (INF-DELIV-08)"}</span>
      </div>` : html`<div class="row wrap small muted"><span>Promo Code: <b class="mono">${ship.promoCode || c.handle.slice(1).toUpperCase()}</b></span><span>·</span><span>UTM Link: <b class="mono">${ship.utmLink || (b.name.toLowerCase()+".com/"+c.handle.slice(1))}</b></span></div>`}
      <div class="row wrap"><${Btn} size="sm" kind="pri" icon="mail" onClick=${function(){ W.A.draftStageEmail(x.id, "brief"); }}>Draft Creator Brief to ${c.name}</${Btn}><span class="hint">Includes Script Gate (INF-DELIV-09), first-third placement, and firm ${W.fmtShort(draftDue)} draft deadline.</span></div>
    </div>` : null}

    ${x.step === 3 ? html`<div class="card flat tight" style=${{gap:"8px"}}>
      <div class="row wrap"><${Icon} n="shield" /><b class="grow">5-Point Pre-Forwarding Video Draft QC Gate (INF-DELIV-07 · HC-33 · FND-ETH-13)</b><span class="small muted num">${qc.filter(Boolean).length}/5 passed</span></div>
      <div class="col tight">${QC_ITEMS.map(function(label, idx){
        return html`<label key=${idx} class="ck" style=${{padding:"6px 9px", cursor:"pointer"}}><input type="checkbox" checked=${!!qc[idx]} onChange=${function(){ W.A.tickQc(x.id, idx); }} /><span class="t small">${label}</span></label>`;
      })}</div>
      <div class="row wrap"><${Btn} size="sm" kind="pri" icon="mail" disabled=${qc.some(function(v){ return !v; })} onClick=${function(){ W.A.draftStageEmail(x.id, "draft"); }}>Forward QC-Verified Draft to ${b.name}</${Btn}><span class="hint">${qc.every(Boolean) ? "All 5 QC checks passed — ready to forward!" : "Complete all 5 checks above before forwarding to the brand."}</span></div>
    </div>` : null}

    ${x.step === 4 ? html`<div class="row wrap">
      ${x.link ? html`<${Btn} size="sm" icon="link" onClick=${function(){ W.toast({msg:"Link works", sub:x.link + " opens the brand's page with the creator's tag", icon:"check"}); if (!x.checks[0]) W.A.tick(x.id, 0); }}>Test ${x.link}</${Btn}>` : null}
      <${Btn} size="sm" icon="clock" onClick=${function(){ W.A.sendPreLiveCheckin(x.id, "7-day"); }}>7d Check-In</${Btn}>
      <${Btn} size="sm" icon="clock" onClick=${function(){ W.A.sendPreLiveCheckin(x.id, "72-hour"); }}>72h Check-In</${Btn}>
      <${Btn} size="sm" kind="pri" icon="clock" onClick=${function(){ W.A.sendPreLiveCheckin(x.id, "24-hour"); }}>24h Go-Live Check-In (INF-DELIV-11)</${Btn}>
    </div>` : null}

    ${x.step === 5 ? html`<div class="row wrap"><${Btn} size="sm" kind="pri" icon="send" onClick=${function(){ W.A.draftStageEmail(x.id, "golive"); }}>Email Live Link & Send All-In Net-30 Invoice</${Btn}><${Btn} size="sm" icon="file" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"invoice", dealId:x.id}; }); }}>Preview PDF Invoice</${Btn}></div>` : null}

    ${x.step >= 6 ? html`<div class="card flat tight" style=${{gap:"8px"}}>
      <div class="row wrap"><${Icon} n="trend" /><b class="grow">Post-Go-Live Hype Cadence & 30d ROI Engine (BRD-AFTER-08 · INF-AFTER-02 · HC-30)</b></div>
      <div class="row wrap" style=${{gap:"6px"}}>
        <${Btn} size="sm" icon="send" onClick=${function(){ W.A.sendHypeTouch(x.id, "d7"); }}>Day-7 Traction Snapshot</${Btn}>
        <${Btn} size="sm" icon="send" onClick=${function(){ W.A.sendHypeTouch(x.id, "d14"); }}>Day-14 Momentum Note</${Btn}>
        <${Btn} size="sm" icon="chart" onClick=${function(){ W.A.sendHypeTouch(x.id, "d30_creator"); }}>Pull 30d Studio Retention from ${c.name.split(" ")[0]}</${Btn}>
        <${Btn} size="sm" icon="dollar" onClick=${function(){ W.A.sendHypeTouch(x.id, "whitelist_renew"); }}>Renew 30d Paid Ad Whitelisting (+25%)</${Btn}>
      </div>
    </div>` : null}

    ${x.step === 7 && x.report ? html`<div class="col tight">
      <div class="stats">
        <${W.Stat} v=${W.fmtK(x.report.views)} l=${"views vs " + W.fmtK(x.report.targetViews || c.median) + " target"} />
        <${W.Stat} v=${(x.report.clicks || 0).toLocaleString()} l="UTM link clicks" />
        <${W.Stat} v=${(x.report.ctr || 0) + "%"} l="click rate" />
        <${W.Stat} v=${(x.report.retentionPct || 72) + "%"} l="sponsor segment retention" />
      </div>
      ${x.report.verdict === "underperformed" ? html`<${W.Callout} tone="warn">Underperformed target benchmark (${W.fmtK(x.report.views)} vs ${W.fmtK(x.report.targetViews)}). Use the Proactive Make-Good Engine (BRD-AFTER-07) to offer a complimentary YouTube Short cutdown before ${b.name} asks.</${W.Callout}>` : null}
      <div class="row wrap"><${Btn} kind="pri" icon="chart" onClick=${function(){ W.A.sendReport(x.id); }}>${x.report.verdict === "underperformed" ? "Send 30d Report + Proactive Make-Good Short" : "Send 30d ROI Report + Retainer / Droplet Pitch"}</${Btn}></div>
    </div>` : null}
    ${x.step === 9 ? html`<${W.NextDeal} x=${x} />` : null}
  </div>`;
};

W.NextDeal = function(p){
  var x = p.x, b = W.brand(x.brand);
  var picks = W.D().creators.filter(function(c){ return c.stage === "signed" && c.id !== x.creator; }).map(function(c){ return {c:c, m:W.match(b, c)}; }).filter(function(r){ return !r.m.warn.length; }).sort(W.by(function(r){ return r.m.score; }, -1)).slice(0, 2);
  return html`<div class="col tight"><p class="small ink2">${b.name} saw ${W.fmtK(x.report.views)} views and a ${x.report.ctr}% click rate. Best next creators for them (Droplet Cross-Sell BRD-AFTER-16):</p>
    ${picks.map(function(r){ return html`<div key=${r.c.id} class="row ck"><${W.CAv} c=${r.c} size="s" /><span class="t">${r.c.name}<small>${r.m.why.join(" · ")}</small></span><b class="num">${r.m.score}</b></div>`; })}
    <div class="row wrap"><${Btn} kind="pri" icon="sparkle" disabled=${!picks.length} onClick=${function(){ W.A.draftPitch(b.id, picks.map(function(r){ return r.c.id; }), {mode:"warm"}); W.A.tick(x.id, 0); }}>Draft Warm Next-Deal Pitch to ${b.name}</${Btn}></div></div>`;
};

W.Money = function(p){
  if (!W.canSeeMoney()) return html`<div class="callout" data-why="money"><${Icon} n="lock" /><div class="grow small">Invoices, payouts and margins are hidden for ${W.member(W.D().me).role}s. The owner decides this in Settings › Team and money.</div></div>`;
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), inv = x.invoice;
  var state = !inv.sent ? (x.step >= 6 ? "unsent" : "later") : inv.paid ? "paid" : W.dayDiff(inv.due) < 0 ? "late" : "open";
  var days = inv.sent ? W.clamp(Math.round((W.now() - inv.sent) / W.DAY), 0, 30) : 0;
  var payState = x.paidCreator ? "paid" : inv.paid ? "unlocked" : "locked";
  return html`<div class="col" style=${{gap:"10px"}} data-why="money">
    <div class="row wrap" style=${{gap:"18px"}}>
      <${W.Stat} v=${W.money(x.price)} l=${b.name + " pays (all-in)"} />
      <${W.Stat} v=${W.money(x.payout)} l=${c.name + " gets (" + (x.dealModel === "exclusive_25" ? "75% excl." : "net") + ")"} />
      <${W.Stat} v=${W.money(x.price - x.payout)} l=${"margin · " + Math.round(100 * (x.price - x.payout) / x.price) + "%"} />
      <span class="sp"></span>
      <${Btn} size="sm" icon="file" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"invoice", dealId:x.id}; }); }}>Official PDF Invoice</${Btn}>
    </div>
    <div class="card flat tight">
      <div class="row wrap"><${Icon} n="file" /><b class="grow" style=${{fontWeight:500}}>Invoice ${inv.no || "Draft"}</b>
        ${inv.partialPaid && !inv.paid ? html`<${Tag} tone="info" icon="check">${W.money(inv.partialPaid)} deposit paid</${Tag}>` : null}
        ${state === "paid" ? html`<${Tag} tone="good" icon="check">paid ${W.fmtShort(inv.paid)}</${Tag}>` : state === "late" ? html`<${Tag} tone="crit" icon="alert">${W.dueText(inv.due)}</${Tag}>` : state === "open" ? html`<${Tag} tone="info">due ${W.fmtShort(inv.due)}</${Tag}>` : state === "unsent" ? html`<${Tag} tone="warn" icon="alert">not sent</${Tag}>` : html`<${Tag}>sent on go-live day</${Tag}>`}</div>
      ${inv.sent ? html`<div class="row small"><span class="muted" style=${{width:"110px"}}>Net 30</span><${W.Meter} v=${days} max=${30} w=${160} tone=${state === "late" ? "crit" : state === "paid" ? "good" : null} label="Days of Net 30 used" /><span class="muted num">day ${days} of 30</span></div>` : null}
      <div class="row wrap">
        ${state === "unsent" ? html`<${Btn} kind="pri" icon="send" onClick=${function(){ W.A.sendInvoice(x.id); }}>Send invoice · ${W.money(x.price)}</${Btn}>` : null}
        ${state === "open" || state === "late" ? html`<${Btn} kind=${state === "late" ? "pri" : null} icon="mail" onClick=${function(){ W.A.nudge(x.id); }}>Draft a reminder</${Btn}><${Btn} icon="check" onClick=${function(){ W.A.markPaid(x.id); }}>Mark paid today</${Btn}>${!inv.partialPaid ? html`<${Btn} size="sm" kind="ghost" onClick=${function(){ W.A.markPaid(x.id, undefined, Math.round(x.price / 2)); }}>50% deposit</${Btn}>` : null}` : null}
      </div>
    </div>
    <div class="card flat tight">
      <div class="row wrap"><${Icon} n=${payState === "locked" ? "lock" : payState === "paid" ? "checkc" : "unlock"} /><b class="grow" style=${{fontWeight:500}}>Pay ${c.name} ${W.money(x.payout)}</b>
        ${payState === "locked" ? html`<${Tag}>locked until ${b.name} pays</${Tag}>` : payState === "paid" ? html`<${Tag} tone="good" icon="check">paid ${W.fmtShort(x.paidCreator)}</${Tag}>` : html`<${Tag} tone="good" icon="unlock">unlocked</${Tag}>`}</div>
      <span class="small muted">${c.pay || "Payment method not on file"} · ${(c.onboarding && c.onboarding.taxForm) || "W-9 verified"}</span>
      ${payState === "unlocked" ? html`<div class="row wrap"><${Btn} kind="pri" icon="wallet" onClick=${function(){ W.A.payCreator(x.id); }}>Mark ${c.name} paid</${Btn}><button type="button" class="btn ghost sm" onClick=${function(){ W.copy(c.pay || "", "payment details"); }}><${Icon} n="copy" />Copy details</button></div>` : null}
    </div>
  </div>`;
};

W.Ladder = function(p){
  var x = p.x, n = x.neg;
  var st = useState(n.ask), v = st[0], setV = st[1];
  var crSt = useState(n.rate), crRate = crSt[0], setCrRate = crSt[1];
  var delivSt = useState(x.deliverable || "60–90s integration"), deliv = delivSt[0], setDeliv = delivSt[1];
  var modSt = useState(x.dealModel || "brokered"), dealModel = modSt[0], setDealModel = modSt[1];
  useEffect(function(){ setV(n.ask); setCrRate(n.rate); }, [n.ask, n.rate]);
  if (!W.canSeeMoney()) return null;
  var floorPrice = Math.ceil(crRate / (1 - n.floor / 100) / 50) * 50;
  var lo = Math.min(crRate, n.rate), hi = Math.max(n.ask, n.offer, v) * 1.12;
  function pos(a){ return W.clamp(100 * (a - lo) / Math.max(1, hi - lo), 0, 100).toFixed(1) + "%"; }
  var margin = Math.round(100 * (v - crRate) / Math.max(1, v));
  var marks = [["Creator's rate", crRate, "var(--muted)"],["Your floor (" + n.floor + "% margin)", floorPrice, "var(--warn)"],["Their offer", n.offer, "var(--close)"],["Your ask", n.ask, "var(--accent)"]];
  var alts = W.D().creators.filter(function(c){ return c.stage === "signed" && c.id !== x.creator; });
  return html`<div class="card flat" style=${{gap:"14px"}} data-why="ladder">
    <div class="row wrap">
      <h4 class="grow">Two-sided price, model & scope ladder</h4>
      <${W.Seg} label="Deal model" cur=${dealModel} onPick=${function(m){ setDealModel(m); if (m === "exclusive_25") setCrRate(Math.round(v * 0.75 / 50) * 50); }} opts=${[["brokered","Brokered Markup"],["exclusive_25","Exclusive 25%"],["cpm","CPM + Guarantee"]]} />
    </div>
    <div style=${{position:"relative", height:"50px", margin:"0 22px"}} aria-hidden="true">
      <div style=${{position:"absolute", left:0, right:0, top:"22px", height:"6px", borderRadius:"3px", background:"linear-gradient(90deg, var(--crit-soft), var(--warn-soft) " + pos(floorPrice) + ", var(--good-soft))"}}></div>
      <div style=${{position:"absolute", left:pos(v), top:"16px", width:"3px", height:"18px", borderRadius:"2px", background:"var(--ink)", transform:"translateX(-50%)"}}></div>
      ${marks.map(function(m, i){ return html`<div key=${i} style=${{position:"absolute", left:pos(m[1]), top:i % 2 ? "30px" : "0", transform:"translateX(-50%)", textAlign:"center", whiteSpace:"nowrap", fontSize:"11px"}}>
        ${i % 2 ? html`<i style=${{display:"block", width:"2px", height:"8px", background:m[2], margin:"0 auto 1px"}}></i>` : null}<b class="num" style=${{color:m[2]}}>${W.money(m[1])}</b>${i % 2 ? null : html`<i style=${{display:"block", width:"2px", height:"8px", background:m[2], margin:"1px auto 0"}}></i>`}</div>`; })}
    </div>
    <div class="row wrap small" style=${{gap:"4px 14px"}}>${marks.map(function(m, i){ return html`<span key=${i} class="row" style=${{gap:"6px"}}><i style=${{width:"10px", height:"10px", borderRadius:"3px", background:m[2], display:"inline-block"}}></i><span class="ink2">${m[0]}</span> <b class="num">${W.money(m[1])}</b></span>`; })}</div>
    <div class="row wrap">
      <label class="field grow" style=${{minWidth:"190px"}}><span class="row"><span>Brand counter ($)</span><input class="inp sm num" style=${{width:"96px", fontWeight:600}} value=${v} onInput=${function(e){ var nv = +e.target.value.replace(/\D/g, ""); if (nv > 0) setV(nv); }} aria-label="Exact counter price" /></span>
        <input type="range" min=${crRate} max=${Math.round(hi / 50) * 50} step="50" value=${W.clamp(v, crRate, Math.round(hi / 50) * 50)} onInput=${function(e){ setV(+e.target.value); }} aria-label="Counter price" /></label>
      <label class="field" style=${{minWidth:"150px"}}><span class="row"><span>Creator payout ($)</span><input class="inp sm num" style=${{width:"88px"}} value=${crRate} onInput=${function(e){ var nr = +e.target.value.replace(/\D/g, ""); if (nr > 0) setCrRate(nr); }} aria-label="Creator payout" /></span>
        ${crRate !== n.rate ? html`<button type="button" class="btn ghost sm" onClick=${function(){ W.A.squeezeCreator(x.id, crRate); }}><${Icon} n="mail" s=${12} />Ask ${W.creator(x.creator).name.split(" ")[0]} for ${W.money(crRate)}</button>` : html`<span class="tiny muted">Adjust to squeeze creator side</span>`}</label>
      <div class="stats"><${W.Stat} v=${margin + "%"} l="margin" /><${W.Stat} v=${W.money(v - crRate)} l="agency keeps" /><${W.Stat} v=${(v >= n.offer ? "+" : "") + W.money(v - n.offer)} l="vs their offer" /></div>
    </div>
    <div class="col tight" style=${{gap:"5px"}}>
      <span class="tiny muted">Scope & multi-platform package levers (BRD-OFFER-21 / INF-PRICE-13 / HC-30 / HC-34):</span>
      <div class="row wrap" style=${{gap:"5px"}}>
        ${[["60–90s integration (1.0x)", n.ask], ["30s quick shoutout (0.7x)", Math.round(n.ask * 0.7 / 50) * 50], ["Dedicated 8–12m walkthrough (2.5x)", Math.round(n.ask * 1.6 / 50) * 50], ["60–90s + YouTube Short cutdown (+0.65x)", Math.round(n.ask * 1.35 / 50) * 50], ["60–90s + 30d paid ad whitelisting (+25%)", Math.round(n.ask * 1.25 / 50) * 50], ["3-video momentum bundle (-8%/vid)", Math.round(n.ask * 2.76 / 50) * 50]].map(function(sc){
          var on = deliv === sc[0];
          return html`<button key=${sc[0]} type="button" class="chip" style=${{height:"24px", fontSize:"11.5px"}} aria-pressed=${String(on)} onClick=${function(){ setDeliv(sc[0]); setV(sc[1]); }}>${sc[0]}</button>`;
        })}
      </div>
    </div>
    ${margin < n.floor ? html`<${W.Callout} tone="crit">Below your ${n.floor}% floor. Raise the brand ask, squeeze the creator payout to ${W.money(Math.floor(v * (1 - n.floor / 100) / 50) * 50)}, or swap to a replacement creator.</${W.Callout}>` : null}
    <div class="row wrap">
      <${Btn} kind="pri" icon="reply" onClick=${function(){ W.A.counter(x.id, v, {payout:crRate, deliverable:deliv, dealModel:dealModel}); }}>Use ${W.money(v)} in the reply</${Btn}>
      ${alts.length ? html`<select class="sel sm" style=${{width:"auto"}} value="" onChange=${function(e){ if (e.target.value) W.A.replaceDealCreator(x.id, e.target.value); }} aria-label="Swap replacement creator">
        <option value="">Swap creator if rate stalls (HC-23)…</option>
        ${alts.map(function(c){ return html`<option key=${c.id} value=${c.id}>Swap to ${c.name} (${W.money(c.rate)} rate · ${W.fmtK(c.trimmedAvgViews || c.median)} avg views)</option>`; })}
      </select>` : null}
      <span class="hint">Updates the deal & rewrites the drafted reply to ${W.brand(x.brand).name}.</span>
    </div>
    <ul class="timeline">${n.hist.slice().reverse().map(function(h, i){ return html`<li key=${i}><span class="td"><${Icon} n=${h.who === "us" ? "send" : "reply"} /></span><div class="tx"><b class="num">${W.money(h.amt)}</b> ${h.who === "us" ? "you asked" : W.brand(x.brand).name + " offered"}<small>${W.fmtDate(h.at)} · ${h.note || ""}</small></div></li>`; })}</ul>
  </div>`;
};

/* ================= triage (one channel at a time) ================= */
W.TriageCard = function(p){
  var c = p.c, last = c.videos[0];
  return html`<div class="card" style=${{gap:"14px"}} data-why="triage">
    ${W.hasBanner && W.hasBanner(c) ? html`<${W.Banner} c=${c} />` : null}
    <div class="grid3" style=${{gap:"10px"}}>${c.videos.slice(0, 3).map(function(v, i){ return html`<${W.Vid} key=${i} v=${v} />`; })}</div>
    <div class="row top" style=${{gap:"12px"}}>
      <${W.CAv} c=${c} size="l" />
      <div class="grow col t2">
        <div class="row wrap"><h2>${c.name}</h2><${W.Stars} n=${c.starRating || 4} /><${Tag}>${c.format || "Talking-head"}</${Tag}>
          ${c.botRisk && c.botRisk.level !== "clean" ? html`<${Tag} tone="crit" icon="alert" tip=${c.botRisk.note}>Bot/Eng. Risk: ${c.botRisk.level}</${Tag}>` : html`<${Tag} tone="good" icon="check">Organic comments verified</${Tag}>`}
        </div>
        <span class="muted">${c.handle} · ${W.fmtK(c.subs)} subscribers · last upload ${last ? (last.ago === 0 ? "today" : last.ago + " days ago") : "?"}</span>
      </div>
      <div data-why="fit"><${W.Fit} c=${c} label=${true} /></div>
    </div>
    ${c.before ? html`<${W.Callout} tone="warn" icon="users">${W.member(c.before.by).name} emailed this channel ${W.ago(c.before.at)}: ${c.before.note}. Shortlisting starts a fresh sequence.</${W.Callout}>` : null}
    ${c.up30 > 20 || (c.botRisk && c.botRisk.level === "high") ? html`<${W.Callout} tone="crit">${c.botRisk ? c.botRisk.note : "Mostly Shorts"}: ${c.up30} uploads in 30 days with a ${W.fmtK(c.median)} median. Fails INF-QUAL-08 / INF-QUAL-10.</${W.Callout}>` : null}
    <div class="grid2" style=${{alignItems:"start"}}>
      <div class="stats">
        <${W.Stat} v=${W.fmtK(c.trimmedAvgViews || c.median)} l="12-vid trimmed avg (INF-PRICE-07)" />
        <${W.Stat} v=${W.fmtK(c.median)} l=${"30d median (" + (c.viewStability || "stable") + ")"} />
        <${W.Stat} v=${c.up30} l="uploads in 30 days" />
        <${W.Stat} v=${(c.eng || "?") + "%"} l="engagement" />
      </div>
      <div class="col tight"><span class="small muted">Audience (estimated from comments)</span><${W.Countries} countries=${c.countries} /></div>
    </div>
    ${c.sponsors && c.sponsors.length ? html`<div class="row wrap" style=${{gap:"6px"}}><span class="small muted">Sponsors seen (click to add to Brands board):</span>${c.sponsors.map(function(s){
      var ex = W.D().brands.filter(function(b){ return b.name.toLowerCase() === s.toLowerCase(); })[0];
      return html`<button key=${s} type="button" class="chip" style=${{height:"24px", fontSize:"11.5px"}} onClick=${function(){ W.A.spotBrand(s, c.id); }} data-tip=${ex ? s + " is on your Brands board (" + ex.status + ") — click to link " + c.name : "Add " + s + " to Close › Brands as a Found prospect"}>
        <${Icon} n=${ex ? "check" : "plus"} s=${11} />${s}
      </button>`;
    })}</div>` : null}
    <details><summary class="small muted" style=${{cursor:"pointer"}}>How the fit score adds up</summary><div style=${{marginTop:"8px"}}><${W.FitParts} c=${c} /></div></details>
  </div>`;
};
W.Triage = function(p){
  var list = p.list;
  var st = useState(0), i = Math.min(st[0], Math.max(0, list.length - 1)), setI = st[1];
  var reason = useState(W.REJECT_REASONS[0]);
  var tally = useState({s:0, r:0}), t = tally[0];
  var c = list[i];
  function decide(kind, why){
    if (!c) return;
    if (kind === "s"){ W.A.shortlist([c.id], {quiet:true}); tally[1]({s:t.s + 1, r:t.r}); W.toast({msg:c.name + " shortlisted", sub:"Finding the email in the background.", icon:"check", ms:3500, actions:[{label:"Undo", run:W.undo}]}); }
    if (kind === "r"){ var rr = why || reason[0]; W.A.reject([c.id], rr, {quiet:true}); tally[1]({s:t.s, r:t.r + 1}); W.toast({msg:c.name + " rejected", sub:rr, icon:"x", tone:"info", ms:3500, actions:[{label:"Undo", run:W.undo}]}); }
    if (kind === "n"){ W.A.never(c.id, "Marked never contact during triage"); tally[1]({s:t.s, r:t.r + 1}); }
    if (kind === "skip") setI(i + 1 < list.length ? i + 1 : 0);
  }
  W.useKeys({
    s:function(){ decide("s"); }, r:function(){ decide("r"); }, n:function(){ decide("n"); },
    "1":function(){ decide("r", W.REJECT_REASONS[0]); }, "2":function(){ decide("r", W.REJECT_REASONS[1]); }, "3":function(){ decide("r", W.REJECT_REASONS[2]); }, "4":function(){ decide("r", W.REJECT_REASONS[3]); }, "5":function(){ if (W.REJECT_REASONS[4]) decide("r", W.REJECT_REASONS[4]); },
    arrowright:function(){ decide("skip"); }, arrowleft:function(){ setI(Math.max(0, i - 1)); },
    j:function(){ decide("skip"); }, k:function(){ setI(Math.max(0, i - 1)); },
    enter:function(){ if (c) W.peek("creator", c.id, list.map(function(x){ return x.id; })); }
  }, p.active !== false && !!c);
  if (!c) return html`<div class="card"><${W.Empty} icon="checkc" title="Every new channel is reviewed">${t.s + t.r ? "This session: " + t.s + " shortlisted, " + t.r + " rejected. Shortlisted channels are getting their emails found." : "Start a search to find more."}</${W.Empty}></div>`;
  return html`<div class="col">
    <div class="row wrap" style=${{gap:"10px"}}>
      <span class="num"><b>${i + 1}</b> <span class="muted">of ${list.length}</span></span>
      <${W.Meter} v=${i + 1} max=${list.length} w=${120} />
      ${t.s + t.r ? html`<span class="small muted">${t.s} shortlisted · ${t.r} rejected</span>` : null}
      <span class="sp"></span>
      <span class="hint row wrap" style=${{gap:"4px 6px"}}><span class="kbd">S</span> shortlist <span class="kbd">R</span> reject <span class="kbd">1</span>–<span class="kbd">5</span> reason <span class="kbd">N</span> never <span class="kbd">→</span> skip <span class="kbd">Enter</span> open</span>
    </div>
    <${W.TriageCard} key=${c.id} c=${c} />
    <div class="actionbar">
      <${Btn} kind="pri" icon="check" onClick=${function(){ decide("s"); }}>Shortlist <span class="kbd">S</span></${Btn}>
      <span class="btn-split"><${Btn} icon="x" onClick=${function(){ decide("r"); }}>Reject <span class="kbd">R</span></${Btn}>
        <select class="btn" style=${{paddingRight:"8px", maxWidth:"220px"}} value=${reason[0]} onChange=${function(e){ reason[1](e.target.value); }} aria-label="Reject reason">${W.REJECT_REASONS.map(function(r, k){ return html`<option key=${r} value=${r}>${k + 1} · ${r}</option>`; })}</select></span>
      <${Btn} kind="ghost" icon="ban" onClick=${function(){ decide("n"); }} tip="Block permanently (N)">Never <span class="kbd">N</span></${Btn}>
      <${Btn} kind="ghost" icon="arrowR" onClick=${function(){ decide("skip"); }}>Skip</${Btn}>
      <span class="sp"></span>
      <${Btn} kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", c.id, list.map(function(x){ return x.id; })); }}>Open</${Btn}>
    </div>
  </div>`;
};

/* ================= brands: System 6 Qualify & System 8/9 PitchPicker ================= */
W.Qualify = function(p){
  var b = p.b;
  var f = useState({contact:b.contact || "", role1:b.role1 || "Partnerships Manager", email:b.email || "", contact2:b.contact2 || "", role2:b.role2 || "Head of Growth / CMO", email2:b.email2 || "", headcount:b.headcount || 45, paidSpenderVerified:b.paidSpenderVerified !== false, pastCampaignHook:b.pastCampaignHook || "", lo:b.budget ? b.budget[0] : "", hi:b.budget ? b.budget[1] : ""}), v = f[0], setV = function(k, val){ var n = Object.assign({}, v); n[k] = val; f[1](n); };
  var finding = useState(false);
  var ok = /^\S+@\S+\.\S+$/.test(v.email);
  var isPersonalEmail = /@(gmail|yahoo|hotmail|outlook)\.com$/i.test(v.email || "");
  var boycottList = (W.D().rules && W.D().rules.boycott) || [];
  var isBoycott = boycottList.some(function(w){ return b.name.toLowerCase().indexOf(w.toLowerCase()) >= 0; });
  var recTitle = v.headcount < 50 ? "Founder / CEO / CMO (<50 employees)" : v.headcount <= 250 ? "VP Marketing / Head of Growth (50–250 employees)" : "Influencer Partnerships Manager (250+ employees)";
  function doQualify(andPitch){
    if (!ok) return;
    W.A.qualify(b.id, {contact:v.contact, role1:v.role1, email:v.email, contact2:v.contact2, role2:v.role2, email2:v.email2, headcount:+v.headcount || 45, recommendedTitle:recTitle, paidSpenderVerified:v.paidSpenderVerified, pastCampaignHook:v.pastCampaignHook, budget:v.lo ? [+v.lo, +(v.hi || v.lo)] : null});
    if (andPitch) W.go("close", "pitch", {pitchBrand:b.id});
  }
  W.useKeys({"mod+enter":function(){ doQualify(false); }}, ok);
  return html`<div class="col" data-why="qualify">
    <dl class="kv">
      <dt>Sells</dt><dd>${b.sells} · ${W.COUNTRY[b.country] || b.country}</dd>
      <dt>Seen with</dt><dd>${b.seen.map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(", ") || "none yet"}</dd>
      <dt>Title Router (BRD-QUAL-17)</dt><dd><b>${v.headcount} employees</b> → Target: <b>${recTitle}</b></dd>
    </dl>
    <ul class="checks">
      <li class=${W.cx("ck", v.paidSpenderVerified ? "done" : null)}>
        <button type="button" class="box" onClick=${function(){ setV("paidSpenderVerified", !v.paidSpenderVerified); }}><${Icon} n="check" s=${13} /></button>
        <span class="t">Verified Paid-Integration Spender (BRD-QUAL-19)<small>${v.paidSpenderVerified ? "Confirmed paying for dedicated/integrated YouTube spots (not affiliate-only)" : "Unverified — check if they pay flat fees vs affiliate-only"}</small></span>
      </li>
      <li class=${W.cx("ck", !isBoycott ? "done" : null)}><span class="box" style=${isBoycott ? {background:"var(--crit)", color:"var(--crit-ink)"} : null}><${Icon} n=${isBoycott ? "x" : "check"} s=${13} /></span><span class="t">Passes ethics & boycott screen (HC-09)<small>${isBoycott ? "Flagged on agency boycott list" : "Not on boycott list; clear for outreach"}</small></span></li>
      <li class=${W.cx("ck", v.lo ? "done" : null)}><span class="box"><${Icon} n="check" s=${13} /></span><span class="t">Budget range estimated<small>From past sponsorships or their partner page</small></span>
        ${W.canSeeMoney() ? html`<input class="inp sm num" style=${{width:"86px"}} placeholder="from $" value=${v.lo} onInput=${function(e){ setV("lo", e.target.value.replace(/\D/g, "")); }} aria-label="Budget from" />
        <input class="inp sm num" style=${{width:"86px"}} placeholder="to $" value=${v.hi} onInput=${function(e){ setV("hi", e.target.value.replace(/\D/g, "")); }} aria-label="Budget to" />` : null}</li>
      <li class=${W.cx("ck", ok ? "done" : null)}><span class="box"><${Icon} n="check" s=${13} /></span><span class="t">Decision-makers found (HC-25: 1–2 contacts per brand, max 2/domain/day)<small>Primary buyer + secondary growth/CMO contact</small></span></li>
    </ul>
    ${isPersonalEmail ? html`<${W.Callout} tone="warn">BRD-REPLY-30 Phishing Guard: ${v.email} is a personal email domain. Require a reply from @${b.site || b.name.toLowerCase()+".com"} before sharing the talent roster.</${W.Callout}>` : null}
    <div class="grid2">
      <${W.Field} label="Primary buyer name & title"><input class="inp sm" value=${v.contact} onInput=${function(e){ setV("contact", e.target.value); }} placeholder="Alex Morgan" /></${W.Field}>
      <${W.Field} label="Primary corporate email"><input class="inp sm mono" value=${v.email} onInput=${function(e){ setV("email", e.target.value); }} placeholder=${"alex@" + (b.site || b.name.toLowerCase() + ".com")} /></${W.Field}>
      <${W.Field} label="Second buyer (HC-25 role-tailored angle)"><input class="inp sm" value=${v.contact2} onInput=${function(e){ setV("contact2", e.target.value); }} placeholder="Jordan Lee (VP Growth)" /></${W.Field}>
      <${W.Field} label="Second corporate email"><input class="inp sm mono" value=${v.email2} onInput=${function(e){ setV("email2", e.target.value); }} placeholder=${"jordan@" + (b.site || b.name.toLowerCase() + ".com")} /></${W.Field}>
    </div>
    <${W.Field} label="Marketing campaign hook for cold opener (BRD-FIRST-04)">
      <input class="inp sm" value=${v.pastCampaignHook} onInput=${function(e){ setV("pastCampaignHook", e.target.value); }} placeholder="e.g. your recent workflow integration on Vector Shop" />
    </${W.Field}>
    <div class="row wrap">
      <${Btn} kind="pri" icon="flag" disabled=${!ok} onClick=${function(){ doQualify(false); }} tip=${ok ? "Qualify (Ctrl Enter)" : "Add a contact email first"}>Qualified</${Btn}>
      <${Btn} icon="pen" disabled=${!ok} onClick=${function(){ doQualify(true); }} tip="Qualify and jump straight to creator selection">Qualify & Pick Creators →</${Btn}>
      <${Btn} icon=${finding[0] ? "refresh" : "search"} iconCls=${finding[0] ? "spin" : null} onClick=${function(){ finding[1](true); setTimeout(function(){ finding[1](false); f[1](Object.assign({}, v, {contact:"Alex Morgan", email:"alex@" + (b.site || b.name.toLowerCase() + ".com"), contact2:"Jordan Lee", email2:"jordan@" + (b.site || b.name.toLowerCase() + ".com"), pastCampaignHook:"your recent creator integration on " + (b.seen[0] ? W.creator(b.seen[0]).name : "YouTube"), lo:v.lo || "2000", hi:v.hi || "4500"})); W.toast({msg:"Found 2 verified buyers & campaign hook", sub:"Matched to company headcount (" + recTitle + ").", icon:"search", tone:"info"}); }, 600); }}>Auto-enrich buyers</${Btn}>
      <span class="sp"></span>
      <${Btn} kind="ghost" icon="x" onClick=${function(){ W.A.notFit(b.id); }}>Not a fit</${Btn}>
    </div>
  </div>`;
};

W.PitchPicker = function(p){
  var b = p.b;
  var rows = W.D().creators.filter(function(c){ return c.stage === "signed"; }).map(function(c){ return {c:c, m:W.match(b, c)}; }).sort(W.by(function(r){ return r.m.score; }, -1));
  var pickedState = useState(p.pick && p.pick.length ? p.pick.slice(0, 2) : rows.filter(function(r){ return !r.m.warn.length; }).slice(0, 2).map(function(r){ return r.c.id; })), picked = pickedState[0], setPicked = pickedState[1];
  var modeSt = useState(b.status === "won" || b.status === "negotiating" ? "warm" : "cold"), mode = modeSt[0], setMode = modeSt[1];
  var fmtSt = useState("integration_60s"), fmt = fmtSt[0], setFmt = fmtSt[1];
  var wlSt = useState(false), wl = wlSt[0], setWl = wlSt[1];
  var buyer2St = useState(!!b.email2), buyer2 = buyer2St[0], setBuyer2 = buyer2St[1];
  function toggle(id){ setPicked(picked.indexOf(id) >= 0 ? picked.filter(function(x){ return x !== id; }) : picked.length >= 2 ? [picked[1], id] : picked.concat([id])); }
  return html`<div class="col" data-why="pitch">
    <div class="card flat tight" style=${{gap:"8px"}}>
      <div class="row wrap">
        <span class="small b ink2">1. Pitch Stage Mode (P1 Fix):</span>
        <${W.Seg} label="Pitch mode" cur=${mode} onPick=${setMode} opts=${[["cold","Mode A · Cold First Touch (HC-14 · No $ · Views Only)"],["warm","Mode B · Warm 3-Option Priced Offer (HC-26)"]]} />
      </div>
      ${mode === "warm" ? html`<div class="row wrap" style=${{gap:"8px"}}>
        <span class="small b ink2">2. Deliverable Format:</span>
        <${W.Seg} label="Format" cur=${fmt} onPick=${setFmt} opts=${[["integration_60s","60–90s (1.0x)"],["shoutout_30s","30s Shoutout (0.7x)"],["dedicated","Dedicated (2.5x)"],["short_reel","Short/Reel (0.65x)"]]} />
        <label class="row small" style=${{gap:"5px", cursor:"pointer"}}><input type="checkbox" checked=${wl} onChange=${function(){ setWl(!wl); }} />+25% 30d Whitelisting (HC-30)</label>
      </div>` : html`<span class="tiny muted">Cold First Touch (HC-14 / BRD-FIRST-04 / FND-WRITE-18): Opens with ${b.name}'s marketing campaign, leads with rounded average views (never subscriber count), omits dollar prices, and ends with "Should I send the details?".</span>`}
      ${b.email2 ? html`<label class="row small" style=${{gap:"6px", cursor:"pointer"}}><input type="checkbox" checked=${buyer2} onChange=${function(){ setBuyer2(!buyer2); }} /><b>Sequence 2nd Buyer (${b.contact2} · ${b.role2 || "VP Growth"})</b> with role-tailored ROI angle (HC-25 · max 2/domain/day; auto-pauses if ${b.contact.split(" ")[0]} replies)</label>` : null}
    </div>
    <div class="col tight">${rows.map(function(r){
      var on = picked.indexOf(r.c.id) >= 0;
      var quote = W.priceFor(r.c, {format:fmt, whitelisting30d:wl});
      return html`<label key=${r.c.id} class=${W.cx("ck", on ? "done" : null)} style=${{cursor:"pointer", borderColor:on ? "var(--accent)" : null, background:on ? "var(--accent-soft)" : null}}>
        <input type="checkbox" checked=${on} onChange=${function(){ toggle(r.c.id); }} aria-label=${"Pick " + r.c.name} />
        <${W.CAv} c=${r.c} size="s" />
        <span class="t" style=${{textDecoration:"none"}}>
          <b style=${{fontWeight:500}}>${r.c.name}</b> <${W.Stars} n=${r.c.starRating || 5} />
          <span class="muted small"> · ${W.fmtK(r.c.trimmedAvgViews || r.c.median)} 12-vid avg · ${r.c.relationshipModel === "exclusive_25" ? "Excl. 25%" : "rate " + W.money(r.c.rate)} · quote ${W.money(quote)} · slot ${W.fmtShort(r.c.nextOpenSlot || W.at(10))}</span>
          <small style=${{textDecoration:"none"}}>${r.m.why.join(" · ")}${r.m.warn.length ? html` <span style=${{color:"var(--crit)"}}>· ${r.m.warn.join(" · ")}</span>` : null}</small>
        </span>
        <b class="num" style=${{fontSize:"15px"}}>${r.m.score}</b>
      </label>`; })}</div>
    <div class="row wrap">
      <${Btn} kind="pri" icon="sparkle" disabled=${!picked.length} onClick=${function(){ W.A.draftPitch(b.id, picked, {mode:mode, format:fmt, whitelisting30d:wl, includeContact2:buyer2}); }}>
        ${mode === "cold" ? "Draft Cold First Touch to " + b.name : "Draft 3-Option Priced Proposal to " + b.name}
      </${Btn}>
      <${Btn} icon="file" disabled=${!picked.length} onClick=${function(){ W.ui(function(u){ u.modal = {kind:"mediakit", brandId:b.id, creatorIds:picked}; }); }}>Generate Brand Talent Packet</${Btn}>
      <${Btn} kind="ghost" icon="phone" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"call", ref:{t:"brand", id:b.id}}; }); }}>Call Co-Pilot</${Btn}>
      <span class="hint">${picked.length} of 2 picked</span>
    </div>
  </div>`;
};

/* ================= the record (peek and full page) ================= */
W.NextCard = function(p){
  var n = W.nextFor(p.refx); if (!n) return null;
  function go(){
    if (n.qid && W.U().route.s !== "today"){ W.openQuickDraft(n.qid); }
    else if (n.warmth){ W.A.sendWarmthUpdate(n.warmth); }
    else if (n.item){ W.go("today"); W.ui(function(u){ u.todaySel = n.item; }); }
    else if (n.pitch){ W.go("close", "pitch", {pitchBrand:n.pitch}); }
  }
  return html`<div class="nextcard" style=${{"--hue":n.hue}} data-why="nextcard">
    <span class="ni"><${Icon} n=${n.icon} /></span>
    <span class="nt"><b style=${{fontWeight:600}}>${n.waiting ? "" : "Next: "}${W.maskMoney(n.label)}</b><small>${W.maskMoney(n.sub)}</small></span>
    ${!n.waiting && (n.item || n.pitch || n.warmth || n.qid) ? html`<${Btn} size="sm" kind="pri" onClick=${go}>Do it</${Btn}>` : null}
  </div>`;
};

function CreatorBody(p){
  var c = p.c, tab = p.tab, ref = {t:"creator", id:c.id}, qs = W.draftsFor(ref);
  if (tab === "talk") return html`<div class="col"><${W.Thread} refx=${ref} limit=${6} />${qs.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}</div>`;
  if (tab === "deals"){ var ds = W.dealsFor(ref); return ds.length ? html`<div class="col tight">${ds.map(function(x){ return html`<button key=${x.id} type="button" class="kcard" onClick=${function(){ W.peek("deal", x.id); }}><b>${W.dealName(x)}</b><small>${W.DEAL_FLOW[x.step].name} · ${W.money(x.price)} → ${W.money(x.payout)}</small></button>`; })}</div>` : html`<${W.Empty} icon="box" title="No deals yet">${c.stage === "signed" ? "Pitch them to a brand from Close." : "Deals start after they are signed."}</${W.Empty}>`; }
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  return html`<div class="col">
    <div class="grid3" style=${{gap:"8px"}}>${c.videos.slice(0, 3).map(function(v, i){ return html`<${W.Vid} key=${i} v=${v} />`; })}</div>
    <div class="stats">
      <${W.Stat} v=${W.fmtK(c.trimmedAvgViews || c.median)} l="12-vid trimmed avg (INF-PRICE-07)" />
      <${W.Stat} v=${W.fmtK(c.median)} l=${"30d median (" + (c.viewStability || "stable") + ")"} />
      <${W.Stat} v=${c.up30} l="uploads / 30 days" />
      <${W.Stat} v=${(c.eng || "?") + "%"} l="engagement" />
      ${c.rate ? html`<${W.Stat} v=${W.money(c.rate)} l=${c.relationshipModel === "exclusive_25" ? "net rate (Excl. 25%)" : "creator rate"} />` : null}
    </div>
    ${c.stage === "signed" ? html`<div class="card flat tight">
      <div class="row wrap">
        <${Icon} n="coffee" />
        <span class="grow small"><b>Roster Retention & Warmth Pulse (HC-29):</b> Last update <b>${c.daysSinceUpdate || 0} days ago</b> · Next open upload slot: <b>${W.fmtDate(c.nextOpenSlot || W.at(10))}</b></span>
        <${Btn} size="sm" kind=${c.daysSinceUpdate >= 10 ? "pri" : null} icon="send" onClick=${function(){ W.A.sendWarmthUpdate(c.id); }}>Send 14d Warmth Update</${Btn}>
      </div>
      ${(c.exclusivityLocks && c.exclusivityLocks.length) ? html`<div class="row wrap small"><span class="muted">Active Category Exclusivity Locks (INF-REPLY-32):</span>${c.exclusivityLocks.map(function(lk, i){ return html`<${Tag} key=${i} tone="warn" icon="lock">${lk.cat} (${lk.brand}) until ${W.fmtShort(lk.until)}</${Tag}>`; })}</div>` : html`<span class="tiny muted">No active category exclusivity locks — open for all AI subcategories.</span>`}
    </div>` : null}
    ${c.onboarding && c.stage === "signed" ? html`<div class="card flat tight">
      <h4>Creator Onboarding & Preferences Profile (INF-ONB-06/08)</h4>
      <dl class="kv">
        <dt>Dream Brands</dt><dd>${(c.onboarding.dreamBrands || []).join(", ")}</dd>
        <dt>Hard-No Categories</dt><dd>${(c.onboarding.hardNos || []).join(", ")}</dd>
        <dt>Shipping Address</dt><dd class="small muted">${c.onboarding.address}</dd>
        <dt>Payment & Tax</dt><dd>${c.pay || c.onboarding.paymentRail} · <b>${c.onboarding.taxForm || "W-9 verified"}</b></dd>
      </dl>
    </div>` : null}
    <div class="col tight"><h4>Audience</h4><${W.Countries} countries=${c.countries} /></div>
    <div class="col tight"><h4>Contact</h4><${W.ContactBlock} c=${c} /></div>
    ${c.stage === "kit" ? html`<div class="col tight"><h4>Audience check</h4><${W.AudienceCheck} c=${c} /></div>` : null}
    <div class="col tight"><h4>Fit ${W.fit(c).score}/100</h4><${W.FitParts} c=${c} /></div>
    ${c.sponsors.length ? html`<div class="row wrap"><span class="small muted">Sponsored by</span>${c.sponsors.map(function(s){ return html`<button key=${s} type="button" class="chip" style=${{height:"24px", fontSize:"11.5px"}} onClick=${function(){ W.A.spotBrand(s, c.id); }}><${Icon} n="plus" s=${11} />${s}</button>`; })}</div>` : null}
    <${Notes} refx=${ref} />
  </div>`;
}

function BrandBody(p){
  var b = p.b, tab = p.tab, ref = {t:"brand", id:b.id}, qs = W.draftsFor(ref);
  if (tab === "talk") return html`<div class="col"><${W.Thread} refx=${ref} limit=${6} />${qs.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}</div>`;
  if (tab === "deals"){ var ds = W.dealsFor(ref); return ds.length ? html`<div class="col tight">${ds.map(function(x){ return html`<button key=${x.id} type="button" class="kcard" onClick=${function(){ W.peek("deal", x.id); }}><b>${W.dealName(x)}</b><small>${W.DEAL_FLOW[x.step].name} · ${W.money(x.price)}</small></button>`; })}</div>` : html`<${W.Empty} icon="box" title="No deals yet" />`; }
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  if (b.status === "found") return html`<${W.Qualify} b=${b} />`;
  return html`<div class="col">
    <div class="row wrap">
      <${Btn} size="sm" kind="pri" icon="file" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"mediakit", brandId:b.id}; }); }}>Generate Brand Talent Packet</${Btn}>
      <${Btn} size="sm" icon="phone" onClick=${function(){ W.ui(function(u){ u.modal = {kind:"call", ref:ref}; }); }}>Call Co-Pilot</${Btn}>
    </div>
    <dl class="kv">
      <dt>Sells</dt><dd>${b.sells} (${b.headcount || 60} employees · Target: ${b.recommendedTitle || "Head of Partnerships"})</dd>
      <dt>Primary Buyer</dt><dd>${b.contact || "none"} (${b.role1 || "Partnerships"}) <span class="mono small muted">${b.email}</span></dd>
      ${b.contact2 ? html`<dt>Second Buyer (HC-25)</dt><dd>${b.contact2} (${b.role2 || "Growth"}) <span class="mono small muted">${b.email2}</span></dd>` : null}
      <dt>Budget</dt><dd>${b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "unknown"}</dd>
      <dt>Campaign Hook</dt><dd>${b.pastCampaignHook || "Paid YouTube creator integrations"}</dd>
    </dl>
    <h4>Pitch creators to ${b.name}</h4>
    <${W.PitchPicker} b=${b} />
    <${Notes} refx=${ref} />
  </div>`;
}

function DealBody(p){
  var x = p.x, tab = p.tab, ref = {t:"deal", id:x.id};
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  if (tab === "talk") return html`<${W.DualDealRoom} x=${x} />`;
  return html`<div class="col">
    <${W.DealSteps} x=${x} />
    <${W.DealChecklist} x=${x} />
    <${W.Money} x=${x} />
    <dl class="kv">
      <dt>Deal Model</dt><dd>${x.dealModel === "exclusive_25" ? "Exclusive 25% Agency Commission (HC-04)" : x.dealModel === "cpm" ? "CPM Performance + View Guarantee (BRD-NEG-25)" : "Brokered Markup"}</dd>
      <dt>Deliverable</dt><dd>${x.deliverable} (${x.placementWindow || "First third of video"})</dd>
      <dt>Creator Draft Due</dt><dd><b style=${{color:"var(--warn)"}}>${W.fmtDate(x.creatorDeadline || ((x.golive || W.at(14)) - 5 * W.DAY))} (-5d buffer per BRD-DELIV-09)</b></dd>
      <dt>Brand Go-Live</dt><dd class="row wrap" style=${{gap:"6px"}}>${x.golive ? W.fmtDate(x.golive) : "not set"}${x.step < 6 ? html`<button type="button" class="btn ghost sm" style=${{height:"22px", padding:"0 6px"}} onClick=${function(){ W.A.slipGolive(x.id, 2); }}>+2d</button><button type="button" class="btn ghost sm" style=${{height:"22px", padding:"0 6px"}} onClick=${function(){ W.A.slipGolive(x.id, 5); }}>+5d</button>` : null}</dd>
      <dt>Terms</dt><dd>${x.terms}</dd>${x.live ? html`<dt>Video</dt><dd class="mono">${x.live}</dd>` : null}
    </dl>
    <${Notes} refx=${ref} />
  </div>`;
}

function Notes(p){
  var ref = p.refx, list = (W.D().notes[ref.id] || []), t = useState("");
  function addNote(){
    var txt = t[0].trim(); if (!txt) return;
    W.act("Added a note to " + W.refName(ref), function(d){
      (d.notes[ref.id] = d.notes[ref.id] || []).push({who:d.me, at:W.now(), text:txt});
      d.team.forEach(function(m){ if (m.id !== d.me && new RegExp("@" + m.name, "i").test(txt)) d.notifs.unshift({id:W.uid("n"), at:W.now(), icon:"chat", text:W.member(d.me).name + " mentioned " + m.name + " on " + W.refName(ref), sub:txt.slice(0, 60), go:{s:W.U().route.s, tab:W.U().route.tab}, read:false}); });
    }, {ref:ref, toast:{msg:"Note added to " + W.refName(ref), icon:"note", tone:"info", ms:3000}});
    t[1]("");
  }
  return html`<div class="col tight"><h4>Notes</h4>
    ${list.map(function(n, i){ return html`<div key=${i} class="callout"><${W.Av} id=${n.who} size="s" /><div class="grow small">${W.maskMoney(n.text)}<div class="tiny muted">${W.member(n.who).name} · ${W.ago(n.at)}</div></div></div>`; })}
    <div class="row wrap" style=${{gap:"6px"}}>
      <input class="inp sm grow" style=${{minWidth:"180px"}} placeholder="Add a note for the team (@Sara, @Omar to mention)" value=${t[0]} onInput=${function(e){ t[1](e.target.value); }} onKeyDown=${function(e){ if (e.key === "Enter"){ e.preventDefault(); addNote(); } }} aria-label="Add a note" />
      <${Btn} size="sm" disabled=${!t[0].trim()} onClick=${addNote}>Add note</${Btn}>
    </div>
  </div>`;
}

W.Record = function(p){
  var ref = p.refx, o = W.rec(ref);
  var tabSt = useState(p.tab || "overview"), tab = tabSt[0], setTab = tabSt[1];
  useEffect(function(){ setTab(p.tab || "overview"); }, [ref.t, ref.id]);
  if (!o) return html`<${W.Empty} icon="help" title="This record is gone">It may have been undone.</${W.Empty}>`;
  var isC = ref.t === "creator", isB = ref.t === "brand";
  var talkN = isB || isC ? W.threadOf(ref).length : (W.threadOf({t:"brand", id:o.brand}).length + W.threadOf({t:"creator", id:o.creator}).length);
  var tabs = [["overview", ref.t === "deal" ? "Steps and money" : "Overview"],["talk", ref.t === "deal" ? "Dual Deal Room" : "Emails", talkN || null]].concat(ref.t === "deal" ? [] : [["deals","Deals", W.dealsFor(ref).length || null]]).concat([["log","Activity"]]);
  var viewers = (W.U().viewers || {})[ref.id], banner = isC && W.hasBanner(o);
  return html`<div class="col" style=${{gap:"14px"}}>
    ${banner ? html`<${W.Banner} c=${o} />` : null}
    <div class=${W.cx("rec-h", banner ? "on-banner" : null)}>
      ${isC ? html`<${W.CAv} c=${o} size="xl" />` : isB ? html`<${W.BAv} b=${o} size="xl" />` : html`<span class="av xl sq" style=${{background:"var(--deliver)"}}><${Icon} n="box" s=${24} style=${{color:"var(--deliver-ink)"}} /></span>`}
      <div class="t">
        <div class="row wrap"><h2>${ref.t === "deal" ? W.dealName(o) : o.name}</h2>${isC ? html`<${W.Stars} n=${o.starRating || 4} />` : null}</div>
        <span class="muted small">${isC ? o.handle + " · " + W.fmtK(o.subs) + " subscribers · " + W.fmtK(o.trimmedAvgViews || o.median) + " 12-vid avg" : isB ? o.sells + " · " + (W.COUNTRY[o.country] || o.country) : W.money(o.price) + " → " + W.money(o.payout) + " · " + o.deliverable}</span>
        <div class="row wrap" style=${{marginTop:"6px"}}>
          ${isC ? html`<${Tag} hue=${o.stage === "signed" ? "var(--close)" : "var(--find)"}>${W.STAGE_LABEL[o.stage]}</${Tag}>` : isB ? html`<${Tag} hue="var(--close)">${o.status}</${Tag}>` : html`<${Tag} hue="var(--deliver)">${W.DEAL_FLOW[o.step].name}</${Tag}>`}
          ${isC && o.stage === "signed" ? html`<${Tag} tone="info">${o.relationshipModel === "exclusive_25" ? "Exclusive 25%" : "Brokered"}</${Tag}>` : null}
          ${isC ? html`<${W.Fit} c=${o} label=${true} />` : null}
          <${W.Owner} refx=${ref} />
          ${viewers ? html`<span class="row small muted" style=${{gap:"5px"}}><${W.Av} id=${viewers} size="s" status="online" />${W.member(viewers).name} is looking at this</span>` : null}
        </div>
      </div>
    </div>
    ${isC ? html`<${W.Steps} steps=${W.CREATOR_STEPS.map(function(s){ return s.name; })} at=${W.STAGE_INDEX[o.stage]} hue=${o.stage === "signed" ? "var(--close)" : "var(--reach)"} />` : isB ? html`<${W.Steps} steps=${W.BRAND_STEPS.map(function(s){ return s.name; })} at=${Math.max(0, W.BRAND_STEPS.map(function(s){ return s.k; }).indexOf(o.status))} hue="var(--close)" />` : null}
    <${W.NextCard} refx=${ref} />
    <${W.Tabs} tabs=${tabs} cur=${tab} onPick=${setTab} />
    ${isC ? html`<${CreatorBody} c=${o} tab=${tab} />` : isB ? html`<${BrandBody} b=${o} tab=${tab} />` : html`<${DealBody} x=${o} tab=${tab} />`}
  </div>`;
};
})();
