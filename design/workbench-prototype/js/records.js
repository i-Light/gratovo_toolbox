/* records.js — the work surfaces shared by Today, the phase screens and the peek panel:
   draft card, conversation, contact confirmation, audience check, deal checklist, money, negotiation,
   triage, brand qualification, pitch picker, and the record itself. Same component, same behaviour, everywhere. */
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
  if (g.ok) return html`<div class="gate ok"><${Icon} n="checkc" /><span class="grow">${g.k === "price" ? "Price confirmed" : "Noted"}</span></div>`;
  if (g.k === "unconfirmed" && q.to.t === "creator"){
    var cands = (o.cands && o.cands.length ? o.cands : [{email:o.email, src:o.emailSrc, conf:o.emailConf}]).filter(function(c){ return c.email; });
    return html`<div class="gate" data-why="gates"><${Icon} n="alert" /><div class="grow col tight" style=${{gap:"6px"}}>
      <span><b>Address not confirmed.</b> ${g.text}</span>
      <div class="row wrap">
        <select class="sel sm" style=${{width:"auto", maxWidth:"100%"}} value=${pick} onChange=${function(e){ setPick(e.target.value); }} aria-label="Address to confirm">
          ${cands.map(function(c){ return html`<option key=${c.email} value=${c.email}>${c.email} · ${c.src} · ${Math.round(c.conf * 100)}%</option>`; })}
        </select>
        <${Btn} size="sm" kind="pri" icon="check" onClick=${function(){ W.A.confirmEmail(o.id, pick); }}>Confirm this address</${Btn}>
      </div></div></div>`;
  }
  return html`<div class=${W.cx("gate", g.k === "never" ? "block" : null)} data-why="gates"><${Icon} n="alert" /><span class="grow">${g.text}</span>
    <${Btn} size="sm" onClick=${function(){ W.A.confirmGate(q.id, g.k); }}>${g.k === "price" ? "Confirm price" : "Send anyway"}</${Btn}></div>`;
}
W.DraftCard = function(p){
  var q = p.q, o = W.rec(q.to);
  var open = q.gates.filter(function(g){ return !g.ok; });
  var whyOpen = useState(false);
  var key = p.itemKey || W.itemKeyForDraft(q);
  W.useKeys({"mod+enter":function(){ if (!open.length) W.A.sendDraft(q.id, {key:key}); else W.toast({msg:"This email still needs you", sub:open[0].text, icon:"alert", tone:"warn"}); }}, !!p.primary);
  if (!o) return null;
  var mb = W.mailbox(q.mailbox), left = mb.cap - mb.sent;
  var title = W.KIND[q.kind] + (q.n ? " " + q.n + " of 3" : "");
  var theirMorning = W.at(1, 15, 0);
  function schedule(e){ W.menu(e, [{head:"Send later"},
    {label:"Their morning", hint:W.fmtDate(theirMorning) + " · 09:00 their time", icon:"sun", run:function(){ W.A.sendDraft(q.id, {at:theirMorning, key:key}); }},
    {label:"Tomorrow, 09:00 yours", hint:W.fmtDate(W.at(1)), icon:"clock", run:function(){ W.A.sendDraft(q.id, {at:W.at(1, 9), key:key}); }},
    {label:"Monday, 09:00", icon:"calendar", run:function(){ W.A.sendDraft(q.id, {at:W.at(7, 9), key:key}); }}]); }
  function more(e){ W.menu(e, W.snoozeItems(key, title + " to " + o.name).concat([{sep:true}], W.handItems(key, q.to, title + " to " + o.name), [{sep:true},
    {label:"Skip this email", icon:"arrowR", run:function(){ W.A.skipDraft(q.id, key); }},
    q.to.t === "creator" ? {label:"Never contact " + o.name, icon:"ban", danger:true, run:function(){ W.A.never(o.id, "Owner chose never contact"); }} : null].filter(Boolean)), {align:"end"}); }
  return html`<div class=${W.cx("draft", q.rewriting ? "rewriting" : null)} data-why="draft">
    <div class="dh">
      <div class="row">
        <${Tag} hue="var(--reach)" icon=${q.kind === "reply" ? "reply" : q.kind === "followup" ? "clock" : "send"}>${title}</${Tag}>
        <span class="small muted">Drafted by Gemini · ${W.ago(q.created)}${q.edited ? " · edited by you" : ""}</span>
        <span class="sp"></span>
        <button type="button" class="btn ghost sm" onClick=${function(){ whyOpen[1](!whyOpen[0]); }} aria-expanded=${String(whyOpen[0])}><${Icon} n="sparkle" />Why this email</button>
      </div>
      <div class="dline"><span>To</span><span class="row" style=${{gap:"6px", minWidth:0}}><b class="ell" style=${{fontWeight:500}}>${o.contact || o.name}</b><span class="mono small ell muted">${o.email || "no address"}</span>
        ${q.to.t === "creator" ? (o.confirmed ? html`<${Tag} tone="good" icon="check">confirmed</${Tag}>` : html`<${Tag} tone="warn" icon="alert">not confirmed</${Tag}>`) : null}
        ${o.email ? html`<button type="button" class="iconbtn" style=${{width:"26px", height:"26px"}} onClick=${function(){ W.copy(o.email, "the address"); }} aria-label="Copy address" data-tip="Copy address"><${Icon} n="copy" s=${14} /></button>` : null}</span></div>
      <div class="dline"><span>From</span><span class="row" style=${{gap:"8px", minWidth:0}}>
        <select class="sel sm" style=${{width:"auto", maxWidth:"60%"}} value=${q.mailbox} onChange=${function(e){ W.A.setMailbox(q.id, e.target.value); }} aria-label="Send from">
          ${W.D().mail.map(function(m){ var why = W.mailboxBlocked(m); return html`<option key=${m.id} value=${m.id}>${m.addr}${why ? " (" + (m.status === "error" ? "signed out" : m.paused ? "paused" : "full today") + ")" : ""}</option>`; })}
        </select>
        <${W.Meter} v=${mb.sent} max=${mb.cap} w=${64} tone=${left <= 3 ? "crit" : left <= 8 ? "warn" : null} label="Sends used today" />
        <span class="small muted num">${left} left today</span>
        ${mb.status === "error" ? html`<${Tag} tone="crit" icon="alert" tip=${mb.err || ""}>signed out</${Tag}>` : mb.paused ? html`<${Tag} icon="pause">paused</${Tag}>` : mb.status !== "good" ? html`<${Tag} tone="warn" tip=${mb.note || ""}>${mb.status === "warming" ? "warming up · day " + mb.warm.day + " of " + mb.warm.of : "slowed"}</${Tag}>` : null}
      </span></div>
    </div>
    <div class="db">
      <input class="subj" value=${q.subject} onInput=${function(e){ W.A.editDraft(q.id, {subject:e.target.value}); }} aria-label="Subject" id=${"subj-" + q.id} />
      <${AutoText} id=${"body-" + q.id} cls="bodyta" value=${q.body} label="Email text" onChange=${function(v){ W.A.editDraft(q.id, {body:v}); }} />
      ${whyOpen[0] ? html`<div class="callout info"><${Icon} n="sparkle" /><div class="grow col tight" style=${{gap:"6px"}}><span>${q.why}</span><span class="row wrap" style=${{gap:"4px"}}>${(q.rules || []).map(function(r){ return html`<span key=${r} class="tag line mono" data-tip="House rule the draft followed">${r}</span>`; })}</span></div></div>` : null}
      ${q.gates.length ? html`<div class="col tight">${q.gates.map(function(g, i){ return html`<${Gate} key=${g.k + i} q=${q} g=${g} />`; })}</div>` : null}
    </div>
    <div class="df">
      <span class="btn-split">
        <${Btn} kind="pri" icon="send" disabled=${open.length > 0 || !!q.rewriting} onClick=${function(){ W.A.sendDraft(q.id, {key:key}); }} tip=${open.length ? "Clear the warning above first" : "Send now"} kbd="Ctrl Enter">Send</${Btn}>
        <${Btn} kind="pri" label="Send later" disabled=${open.length > 0} onClick=${schedule} tip="Send later"><${Icon} n="chevD" s=${14} /></${Btn}>
      </span>
      <span class="row" style=${{gap:"2px"}} data-why="steer">
        <span class="small muted" style=${{padding:"0 4px 0 8px"}}>Rewrite</span>
        ${[["shorter","Shorter"],["warmer","Warmer"],["direct","More direct"],["redo","New angle"]].map(function(s){ var down = (W.D().health || {}).gemini === "offline"; return html`<button key=${s[0]} type="button" class="btn ghost sm" disabled=${!!q.rewriting || down} data-tip=${down ? "The Gemini bridge is offline. Edit the text by hand, or reconnect it." : null} onClick=${function(){ W.A.steer(q.id, s[0]); }}>${q.rewriting === s[0] ? html`<${Icon} n="refresh" cls="spin" />` : null}${s[1]}</button>`; })}
      </span>
      <span class="sp"></span>
      <${Btn} kind="ghost" size="sm" icon="arrowR" onClick=${function(){ W.A.skipDraft(q.id, key); }} tip="Skip: drop this draft">Skip</${Btn}>
      <button type="button" class="iconbtn" onClick=${more} aria-label="More actions" data-tip="Snooze, hand off, never contact"><${Icon} n="more" /></button>
    </div>
  </div>`;
};

/* ================= conversation ================= */
W.Thread = function(p){
  var ref = p.refx, th = W.threadOf(ref), lim = p.limit || 3;
  var all = useState(false), paste = useState(false), txt = useState("");
  var shown = all[0] ? th : th.slice(-lim);
  var lastIn = W.lastIn(ref), o = W.rec(ref);
  return html`<div class="col" style=${{gap:"10px"}}>
    ${th.length > shown.length ? html`<button type="button" class="btn ghost sm" style=${{alignSelf:"center"}} onClick=${function(){ all[1](true); }}>Show ${th.length - shown.length} earlier</button>` : null}
    ${!th.length ? html`<p class="hint">No emails yet.</p>` : null}
    <div class="thread">
      ${shown.map(function(m, i){ return html`<div key=${m.at + "-" + i} class=${W.cx("msg", m.dir)}>
        <div class="mh"><span>${m.dir === "in" ? (o.contact || o.name) : (m.by ? W.member(m.by).name : "You")}</span><span>${W.fmtDate(m.at)} ${W.fmtTime(m.at)}</span>${m.scheduled ? html`<span>· scheduled</span>` : null}${m.pasted ? html`<span>· pasted in</span>` : null}</div>${m.text}</div>`; })}
    </div>
    ${lastIn && lastIn.ai && p.ai !== false ? html`<${W.AiRead} refx=${ref} m=${lastIn} />` : null}
    ${p.paste !== false && th.some(function(m){ return m.dir === "out"; }) ? (paste[0] ? html`<div class="col tight" data-why="paste">
        <textarea class="ta" rows="4" placeholder=${"Paste " + (o.contact || o.name) + "'s reply here"} value=${txt[0]} onInput=${function(e){ txt[1](e.target.value); }} aria-label="Pasted reply" autoFocus=${true}
          onKeyDown=${function(e){ if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); e.stopPropagation(); if (txt[0].trim()){ W.A.pasteReply(ref, txt[0]); txt[1](""); paste[1](false); } } else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); paste[1](false); } }}></textarea>
        <div class="row"><${Btn} size="sm" kind="pri" icon="paste" disabled=${!txt[0].trim()} onClick=${function(){ W.A.pasteReply(ref, txt[0]); txt[1](""); paste[1](false); }}>Add reply <span class="kbd">Ctrl Enter</span></${Btn}><${Btn} size="sm" kind="ghost" onClick=${function(){ paste[1](false); }}>Cancel</${Btn}><span class="hint">Gemini reads it like any other reply.</span></div>
      </div>` : html`<button type="button" class="btn ghost sm" style=${{alignSelf:"flex-start", color:"var(--muted)"}} onClick=${function(){ paste[1](true); }} data-why="paste"><${Icon} n="paste" />Paste a reply by hand</button>`) : null}
  </div>`;
};
W.AiRead = function(p){
  var ai = p.m.ai, ref = p.refx;
  return html`<div class="ai-read" data-why="ai-read">
    <div class="row"><${Icon} n="sparkle" /><b style=${{fontWeight:600}}>${ai.intent}</b><span class="small muted">Gemini's reading of their reply</span></div>
    <span class="small">${ai.summary}</span>
    ${ai.facts && ai.facts.length ? html`<div class="row wrap" style=${{gap:"6px"}}>${ai.facts.map(function(f){ return html`<span key=${f.k} class=${W.cx("fact", f.saved ? "saved" : null)}><span class="muted small">${f.label}</span> ${f.show}
      ${ref.t === "creator" ? html`<button type="button" disabled=${f.saved} onClick=${function(){ W.A.saveFact(ref, p.m.at, f.k); }}>${f.saved ? "Saved" : "Save to record"}</button>` : null}</span>`; })}</div>` : null}
    ${ai.next ? html`<span class="small ink2"><b style=${{fontWeight:600}}>Suggested next:</b> ${ai.next}</span>` : null}
  </div>`;
};

/* ================= contact ================= */
W.ContactBlock = function(p){
  var c = p.c;
  var cands = c.cands && c.cands.length ? c.cands : (c.email ? [{email:c.email, src:c.emailSrc, conf:c.emailConf}] : []);
  var st = useState(cands.length ? cands.slice().sort(W.by(function(x){ return x.conf; }, -1))[0].email : ""), pick = st[0], setPick = st[1];
  var typed = useState("");
  if (c.confirmed) return html`<div class="row wrap"><${Icon} n="checkc" style=${{color:"var(--good)"}} /><span class="mono">${c.email}</span><${Tag} tone="good">confirmed</${Tag}><span class="hint">${c.emailSrc || ""}</span><button type="button" class="btn ghost sm" onClick=${function(){ W.copy(c.email, "the address"); }}><${Icon} n="copy" />Copy</button></div>`;
  if (c.finding) return html`<div class="row"><${Icon} n="refresh" cls="spin" /><span>Looking on the About page, video descriptions and linked sites…</span></div>`;
  return html`<div class="col tight" style=${{gap:"8px"}}>
    ${cands.length ? html`<div class="col tight" role="radiogroup" aria-label="Addresses found">${cands.map(function(k){ var on = pick === k.email; return html`<label key=${k.email} class="ck" style=${{cursor:"pointer", borderColor:on ? "var(--accent)" : null}}>
        <input type="radio" name=${"cand-" + c.id} checked=${on} onChange=${function(){ setPick(k.email); }} />
        <span class="t"><span class="mono">${k.email}</span><small>${k.src}</small></span>
        <${W.Meter} v=${k.conf} max=${1} w=${54} tone=${k.conf >= .85 ? "good" : k.conf >= .7 ? "warn" : "crit"} label="How sure" /><span class="num small muted" style=${{width:"34px"}}>${Math.round(k.conf * 100)}%</span>
      </label>`; })}</div>` : html`<${W.Callout} tone="warn">No address found on the About page, descriptions or linked sites.</${W.Callout}>`}
    <div class="row wrap">
      ${cands.length ? html`<${Btn} kind="pri" icon="check" onClick=${function(){ W.A.confirmEmail(c.id, pick); }}>Confirm ${pick.split("@")[0]}@…</${Btn}>` : null}
      <input class="inp sm" style=${{width:"220px"}} placeholder="Or type an address you found" value=${typed[0]} onInput=${function(e){ typed[1](e.target.value); }} aria-label="Type an address" />
      <${Btn} size="sm" disabled=${!/^\S+@\S+\.\S+$/.test(typed[0])} onClick=${function(){ W.bg(function(d){ var x = d.creators.filter(function(z){ return z.id === c.id; })[0]; if (x){ x.cands = (x.cands || []).concat([{email:typed[0], src:"Typed in by you", conf:.99}]); } }); W.A.confirmEmail(c.id, typed[0]); typed[1](""); }}>Use it</${Btn}>
    </div>
  </div>`;
};

/* ================= audience check ================= */
W.AudienceCheck = function(p){
  var c = p.c, src = c.kit || c, a = W.audience({countries:src.countries, age:src.age, eng:src.eng || c.eng, rate:src.rate || c.rate});
  return html`<div class="col" style=${{gap:"10px"}} data-why="audience">
    <ul class="checks">${a.rows.map(function(r){ return html`<li key=${r.k} class="ck"><span class="box" style=${{background:r.ok === true ? "var(--good)" : r.ok === false ? "var(--crit)" : "var(--sunk-2)", borderColor:"transparent", color:"#fff"}}><${Icon} n=${r.ok === true ? "check" : r.ok === false ? "x" : "help"} s=${13} /></span><span class="t">${r.label}<small>${r.detail}</small></span></li>`; })}</ul>
    ${c.kit && c.kit.fromReply ? html`<${W.Callout} tone="info">These numbers come from their email, not a screenshot. Ask for the YouTube Studio audience tab before you pitch them.</${W.Callout}>` : null}
    ${p.actions === false ? null : a.pass ? html`<div class="row wrap"><${Btn} kind="pri" icon="pen" onClick=${function(){ W.A.sign(c.id); }}>Everything passes: sign at ${W.money(src.rate || c.rate)}</${Btn}><span class="hint">They go on the roster and can be pitched right away.</span></div>`
      : a.fail ? html`<div class="row wrap"><${Btn} kind="pri" icon="mail" onClick=${function(){ W.A.declineKit(c.id); }}>Decline kindly</${Btn}><${Btn} icon="alarm" onClick=${function(){ W.A.park(c.id, W.at(90), "Audience outside US/UK/CA/AU"); }}>Park for 90 days</${Btn}><span class="hint">Fails the audience rule, so brands won't buy it.</span></div>`
      : html`<div class="row wrap"><${Btn} icon="mail" onClick=${function(){ W.toast({msg:"Ask for what's missing", sub:"Gemini would draft a one-line request for the missing numbers.", icon:"sparkle", tone:"info"}); }}>Ask for what's missing</${Btn}></div>`}
  </div>`;
};

/* ================= deals: checklist, money, negotiation ================= */
W.DealSteps = function(p){ var x = p.x; return html`<${W.Steps} steps=${W.DEAL_FLOW.map(function(s){ return s.name; })} at=${x.step} hue="var(--deliver)" />`; };
W.DealChecklist = function(p){
  var x = p.x, st = W.DEAL_FLOW[x.step], firstOpen = x.checks.indexOf(false);
  var locked = st.lockedUntilPaid && !x.invoice.paid;
  return html`<div class="col" style=${{gap:"10px"}} data-why="checklist">
    <div class="row"><h3 class="grow">${st.name}</h3><span class="small muted num">${x.checks.filter(Boolean).length} of ${x.checks.length} done</span></div>
    ${st.note ? html`<p class="hint">${st.note}</p>` : null}
    <ul class="checks">${st.items.map(function(it, i){
      var lock = locked || (st.ordered && i > firstOpen && firstOpen >= 0 && !x.checks[i]);
      return html`<li key=${i} class=${W.cx("ck", x.checks[i] ? "done" : null, lock ? "locked" : null)}>
        <button type="button" class="box" onClick=${function(){ W.A.tickNote(x.id, i); }} aria-pressed=${String(!!x.checks[i])} aria-label=${(x.checks[i] ? "Untick " : "Tick ") + it}><${Icon} n=${lock && !x.checks[i] ? "lock" : "check"} s=${13} style=${lock && !x.checks[i] ? {color:"var(--faint)"} : null} /></button>
        <span class="t">${it}${lock && !x.checks[i] ? html`<small>${locked ? "Unlocks when " + W.brand(x.brand).name + " pays" : "Unlocks after the step above"}</small>` : null}</span>
      </li>`; })}</ul>
    ${x.step === 0 && x.neg ? html`<${W.Ladder} x=${x} />` : null}
    ${x.step === 4 && x.link ? html`<div class="row wrap"><${Btn} size="sm" icon="link" onClick=${function(){ W.toast({msg:"Link works", sub:x.link + " opens the brand's page with the creator's tag", icon:"check"}); if (!x.checks[0]) W.A.tick(x.id, 0); }}>Test ${x.link}</${Btn}><span class="hint">Opens the link and checks the tag.</span></div>` : null}
    ${x.step === 7 && x.report ? html`<div class="col tight"><div class="stats"><${W.Stat} v=${W.fmtK(x.report.views)} l="views in 30 days" /><${W.Stat} v=${(x.report.clicks || 0).toLocaleString()} l="clicks" /><${W.Stat} v=${(x.report.ctr || 0) + "%"} l="click rate" /></div>
      <div class="row wrap"><${Btn} kind="pri" icon="chart" onClick=${function(){ W.A.sendReport(x.id); }}>Send the 30-day report</${Btn}><span class="hint">Numbers read from the video and the tracking link.</span></div></div>` : null}
    ${x.step === 9 ? html`<${W.NextDeal} x=${x} />` : null}
  </div>`;
};
W.NextDeal = function(p){
  var x = p.x, b = W.brand(x.brand);
  var picks = W.D().creators.filter(function(c){ return c.stage === "signed" && c.id !== x.creator; }).map(function(c){ return {c:c, m:W.match(b, c)}; }).filter(function(r){ return !r.m.warn.length; }).sort(W.by(function(r){ return r.m.score; }, -1)).slice(0, 2);
  return html`<div class="col tight"><p class="small ink2">${b.name} saw ${W.fmtK(x.report.views)} views and a ${x.report.ctr}% click rate. Best next creators for them:</p>
    ${picks.map(function(r){ return html`<div key=${r.c.id} class="row ck"><${W.CAv} c=${r.c} size="s" /><span class="t">${r.c.name}<small>${r.m.why.join(" · ")}</small></span><b class="num">${r.m.score}</b></div>`; })}
    <div class="row"><${Btn} kind="pri" icon="sparkle" disabled=${!picks.length} onClick=${function(){ W.A.draftPitch(b.id, picks.map(function(r){ return r.c.id; })); W.A.tick(x.id, 0); }}>Draft the next pitch to ${b.name}</${Btn}></div></div>`;
};
W.Money = function(p){
  if (!W.canSeeMoney()) return html`<div class="callout" data-why="money"><${Icon} n="lock" /><div class="grow small">Invoices, payouts and margins are hidden for ${W.member(W.D().me).role}s. The owner decides this in Settings › Team and money.</div></div>`;
  var x = p.x, b = W.brand(x.brand), c = W.creator(x.creator), inv = x.invoice;
  var state = !inv.sent ? (x.step >= 6 ? "unsent" : "later") : inv.paid ? "paid" : W.dayDiff(inv.due) < 0 ? "late" : "open";
  var days = inv.sent ? W.clamp(Math.round((W.now() - inv.sent) / W.DAY), 0, 30) : 0;
  var payState = x.paidCreator ? "paid" : inv.paid ? "unlocked" : "locked";
  return html`<div class="col" style=${{gap:"10px"}} data-why="money">
    <div class="row wrap" style=${{gap:"18px"}}><${W.Stat} v=${W.money(x.price)} l=${b.name + " pays"} /><${W.Stat} v=${W.money(x.payout)} l=${c.name + " gets"} /><${W.Stat} v=${W.money(x.price - x.payout)} l=${"margin · " + Math.round(100 * (x.price - x.payout) / x.price) + "%"} /></div>
    <div class="card flat tight">
      <div class="row"><${Icon} n="file" /><b class="grow" style=${{fontWeight:500}}>Invoice ${inv.no || ""}</b>
        ${state === "paid" ? html`<${Tag} tone="good" icon="check">paid ${W.fmtShort(inv.paid)}</${Tag}>` : state === "late" ? html`<${Tag} tone="crit" icon="alert">${W.dueText(inv.due)}</${Tag}>` : state === "open" ? html`<${Tag} tone="info">due ${W.fmtShort(inv.due)}</${Tag}>` : state === "unsent" ? html`<${Tag} tone="warn" icon="alert">not sent</${Tag}>` : html`<${Tag}>sent on go-live day</${Tag}>`}</div>
      ${inv.sent ? html`<div class="row small"><span class="muted" style=${{width:"110px"}}>Net 30</span><${W.Meter} v=${days} max=${30} w=${160} tone=${state === "late" ? "crit" : state === "paid" ? "good" : null} label="Days of Net 30 used" /><span class="muted num">day ${days} of 30</span></div>` : null}
      <div class="row wrap">
        ${state === "unsent" ? html`<${Btn} kind="pri" icon="send" onClick=${function(){ W.A.sendInvoice(x.id); }}>Send invoice · ${W.money(x.price)}</${Btn}>` : null}
        ${state === "open" || state === "late" ? html`<${Btn} kind=${state === "late" ? "pri" : null} icon="mail" onClick=${function(){ W.A.nudge(x.id); }}>Draft a reminder</${Btn}><${Btn} icon="check" onClick=${function(){ W.A.markPaid(x.id); }}>Mark paid today</${Btn}>` : null}
      </div>
    </div>
    <div class="card flat tight">
      <div class="row"><${Icon} n=${payState === "locked" ? "lock" : payState === "paid" ? "checkc" : "unlock"} /><b class="grow" style=${{fontWeight:500}}>Pay ${c.name} ${W.money(x.payout)}</b>
        ${payState === "locked" ? html`<${Tag}>locked until ${b.name} pays</${Tag}>` : payState === "paid" ? html`<${Tag} tone="good" icon="check">paid ${W.fmtShort(x.paidCreator)}</${Tag}>` : html`<${Tag} tone="good" icon="unlock">unlocked</${Tag}>`}</div>
      <span class="small muted">${c.pay || "Payment method not on file"}</span>
      ${payState === "unlocked" ? html`<div class="row"><${Btn} kind="pri" icon="wallet" onClick=${function(){ W.A.payCreator(x.id); }}>Mark ${c.name} paid</${Btn}><button type="button" class="btn ghost sm" onClick=${function(){ W.copy(c.pay || "", "payment details"); }}><${Icon} n="copy" />Copy details</button></div>` : null}
    </div>
  </div>`;
};
/* negotiation ladder: every number that matters on one line, and the margin of any counter before you send it */
W.Ladder = function(p){
  var x = p.x, n = x.neg, floorPrice = Math.ceil(n.rate / (1 - n.floor / 100) / 50) * 50;
  var st = useState(n.ask), v = st[0], setV = st[1];
  if (!W.canSeeMoney()) return null;
  var lo = n.rate, hi = Math.max(n.ask, n.offer) * 1.12;
  function pos(a){ return (100 * (a - lo) / (hi - lo)).toFixed(1) + "%"; }
  var margin = Math.round(100 * (v - n.rate) / v);
  var marks = [["Creator's rate", n.rate, "var(--muted)"],["Your floor (" + n.floor + "% margin)", floorPrice, "var(--warn)"],["Their offer", n.offer, "var(--close)"],["Your ask", n.ask, "var(--accent)"]];
  return html`<div class="card flat" style=${{gap:"14px"}} data-why="ladder">
    <div class="row"><h4 class="grow">Price ladder</h4><span class="small muted">Margin = what's left after the creator's ${W.money(n.rate)}</span></div>
    <div style=${{position:"relative", height:"50px", margin:"0 22px"}} aria-hidden="true">
      <div style=${{position:"absolute", left:0, right:0, top:"22px", height:"6px", borderRadius:"3px", background:"linear-gradient(90deg, var(--crit-soft), var(--warn-soft) " + pos(floorPrice) + ", var(--good-soft))"}}></div>
      <div style=${{position:"absolute", left:pos(v), top:"16px", width:"3px", height:"18px", borderRadius:"2px", background:"var(--ink)", transform:"translateX(-50%)"}}></div>
      ${marks.map(function(m, i){ return html`<div key=${i} style=${{position:"absolute", left:pos(m[1]), top:i % 2 ? "30px" : "0", transform:"translateX(-50%)", textAlign:"center", whiteSpace:"nowrap", fontSize:"11px"}}>
        ${i % 2 ? html`<i style=${{display:"block", width:"2px", height:"8px", background:m[2], margin:"0 auto 1px"}}></i>` : null}<b class="num" style=${{color:m[2]}}>${W.money(m[1])}</b>${i % 2 ? null : html`<i style=${{display:"block", width:"2px", height:"8px", background:m[2], margin:"1px auto 0"}}></i>`}</div>`; })}
    </div>
    <div class="row wrap small" style=${{gap:"4px 14px"}}>${marks.map(function(m, i){ return html`<span key=${i} class="row" style=${{gap:"6px"}}><i style=${{width:"10px", height:"10px", borderRadius:"3px", background:m[2], display:"inline-block"}}></i><span class="ink2">${m[0]}</span> <b class="num">${W.money(m[1])}</b></span>`; })}</div>
    <div class="row wrap">
      <label class="field grow" style=${{minWidth:"220px"}}>Counter at <b class="num" style=${{fontSize:"15px", color:"var(--ink)"}}>${W.money(v)}</b>
        <input type="range" min=${floorPrice} max=${Math.round(hi / 50) * 50} step="50" value=${v} onInput=${function(e){ setV(+e.target.value); }} aria-label="Counter price" /></label>
      <div class="stats"><${W.Stat} v=${margin + "%"} l="margin" /><${W.Stat} v=${W.money(v - n.rate)} l="agency keeps" /><${W.Stat} v=${(v >= n.offer ? "+" : "") + W.money(v - n.offer)} l="vs their offer" /></div>
    </div>
    ${margin < n.floor ? html`<${W.Callout} tone="crit">Below your ${n.floor}% floor.</${W.Callout}>` : null}
    <div class="row wrap"><${Btn} kind="pri" icon="reply" onClick=${function(){ W.A.counter(x.id, v); }}>Use ${W.money(v)} in the reply</${Btn}><span class="hint">Rewrites the drafted reply to ${W.brand(x.brand).name} with this number.</span></div>
    <ul class="timeline">${n.hist.slice().reverse().map(function(h, i){ return html`<li key=${i}><span class="td"><${Icon} n=${h.who === "us" ? "send" : "reply"} /></span><div class="tx"><b class="num">${W.money(h.amt)}</b> ${h.who === "us" ? "you asked" : W.brand(x.brand).name + " offered"}<small>${W.fmtDate(h.at)} · ${h.note || ""}</small></div></li>`; })}</ul>
  </div>`;
};

/* ================= triage (one channel at a time) ================= */
W.TriageCard = function(p){
  var c = p.c, f = W.fit(c), last = c.videos[0];
  return html`<div class="card" style=${{gap:"14px"}} data-why="triage">
    <div class="grid3" style=${{gap:"10px"}}>${c.videos.slice(0, 3).map(function(v, i){ return html`<${W.Vid} key=${i} v=${v} />`; })}</div>
    <div class="row top" style=${{gap:"12px"}}>
      <${W.CAv} c=${c} size="l" />
      <div class="grow col t2"><h2>${c.name}</h2><span class="muted">${c.handle} · ${W.fmtK(c.subs)} subscribers · last upload ${last ? (last.ago === 0 ? "today" : last.ago + " days ago") : "?"}</span></div>
      <div data-why="fit"><${W.Fit} c=${c} label=${true} /></div>
    </div>
    ${c.before ? html`<${W.Callout} tone="warn" icon="users">${W.member(c.before.by).name} emailed this channel ${W.ago(c.before.at)}: ${c.before.note}. Shortlisting starts a fresh sequence.</${W.Callout}>` : null}
    ${c.up30 > 20 ? html`<${W.Callout} tone="warn">Mostly Shorts: ${c.up30} uploads in 30 days with a ${W.fmtK(c.median)} median. Integrations rarely work here.</${W.Callout}>` : null}
    <div class="grid2" style=${{alignItems:"start"}}>
      <div class="stats">
        <${W.Stat} v=${W.fmtK(c.median)} l="median views" tip="Typical views per long video, last 10 uploads" />
        <${W.Stat} v=${c.up30} l="uploads in 30 days" />
        <${W.Stat} v=${(c.eng || "?") + "%"} l="engagement" />
        <${W.Stat} v=${c.sponsors.length ? c.sponsors.length : "none"} l=${c.sponsors.length ? "sponsors seen: " + c.sponsors.join(", ") : "sponsors seen"} />
      </div>
      <div class="col tight"><span class="small muted">Audience (estimated from comments)</span><${W.Countries} countries=${c.countries} /></div>
    </div>
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
    if (kind === "skip") setI(i + 1 < list.length ? i + 1 : 0);
  }
  W.useKeys({
    s:function(){ decide("s"); }, r:function(){ decide("r"); },
    "1":function(){ decide("r", W.REJECT_REASONS[0]); }, "2":function(){ decide("r", W.REJECT_REASONS[1]); }, "3":function(){ decide("r", W.REJECT_REASONS[2]); }, "4":function(){ decide("r", W.REJECT_REASONS[3]); },
    arrowright:function(){ decide("skip"); }, arrowleft:function(){ setI(Math.max(0, i - 1)); },
    enter:function(){ if (c) W.peek("creator", c.id, list.map(function(x){ return x.id; })); }
  }, p.active !== false && !!c);
  if (!c) return html`<div class="card"><${W.Empty} icon="checkc" title="Every new channel is reviewed">${t.s + t.r ? "This session: " + t.s + " shortlisted, " + t.r + " rejected. Shortlisted channels are getting their emails found." : "Start a search to find more."}</${W.Empty}></div>`;
  return html`<div class="col">
    <div class="row wrap" style=${{gap:"10px"}}>
      <span class="num"><b>${i + 1}</b> <span class="muted">of ${list.length}</span></span>
      <${W.Meter} v=${i + 1} max=${list.length} w=${120} />
      ${t.s + t.r ? html`<span class="small muted">${t.s} shortlisted · ${t.r} rejected</span>` : null}
      <span class="sp"></span>
      <span class="hint row wrap" style=${{gap:"4px 6px"}}><span class="kbd">S</span> shortlist <span class="kbd">R</span> reject <span class="kbd">1</span>–<span class="kbd">4</span> reason <span class="kbd">→</span> skip <span class="kbd">Enter</span> open</span>
    </div>
    <${W.TriageCard} key=${c.id} c=${c} />
    <div class="actionbar">
      <${Btn} kind="pri" icon="check" onClick=${function(){ decide("s"); }}>Shortlist <span class="kbd">S</span></${Btn}>
      <span class="btn-split"><${Btn} icon="x" onClick=${function(){ decide("r"); }}>Reject <span class="kbd">R</span></${Btn}>
        <select class="btn" style=${{paddingRight:"8px", maxWidth:"220px"}} value=${reason[0]} onChange=${function(e){ reason[1](e.target.value); }} aria-label="Reject reason">${W.REJECT_REASONS.map(function(r, k){ return html`<option key=${r} value=${r}>${k + 1} · ${r}</option>`; })}</select></span>
      <${Btn} kind="ghost" icon="arrowR" onClick=${function(){ decide("skip"); }}>Skip</${Btn}>
      <span class="sp"></span>
      <${Btn} kind="ghost" icon="eye" onClick=${function(){ W.peek("creator", c.id, list.map(function(x){ return x.id; })); }}>Open</${Btn}>
    </div>
  </div>`;
};

/* ================= brands: qualify and pitch ================= */
W.Qualify = function(p){
  var b = p.b;
  var f = useState({contact:b.contact || "", email:b.email || "", lo:b.budget ? b.budget[0] : "", hi:b.budget ? b.budget[1] : ""}), v = f[0], setV = function(k, val){ var n = Object.assign({}, v); n[k] = val; f[1](n); };
  var finding = useState(false);
  var ok = /^\S+@\S+\.\S+$/.test(v.email);
  return html`<div class="col" data-why="qualify">
    <dl class="kv"><dt>Sells</dt><dd>${b.sells}</dd><dt>Based in</dt><dd>${W.COUNTRY[b.country] || b.country}</dd><dt>Seen with</dt><dd>${b.seen.map(function(id){ var c = W.creator(id); return c ? c.name : id; }).join(", ") || "none yet"}</dd>${b.site ? html`<dt>Website</dt><dd class="mono">${b.site}</dd>` : null}</dl>
    <ul class="checks">
      <li class="ck done"><span class="box"><${Icon} n="check" s=${13} /></span><span class="t">Sells an AI tool your creators already use<small>Seen sponsoring ${W.plural(b.seen.length, "of your channels", "of your channels")}</small></span></li>
      <li class=${W.cx("ck", v.lo ? "done" : null)}><span class="box"><${Icon} n="check" s=${13} /></span><span class="t">Budget known<small>From past sponsorships or their partner page</small></span>
        <input class="inp sm num" style=${{width:"86px"}} placeholder="from $" value=${v.lo} onInput=${function(e){ setV("lo", e.target.value.replace(/\D/g, "")); }} aria-label="Budget from" />
        <input class="inp sm num" style=${{width:"86px"}} placeholder="to $" value=${v.hi} onInput=${function(e){ setV("hi", e.target.value.replace(/\D/g, "")); }} aria-label="Budget to" /></li>
      <li class=${W.cx("ck", ok ? "done" : null)}><span class="box"><${Icon} n="check" s=${13} /></span><span class="t">Contact found<small>A named person in partnerships or marketing</small></span></li>
    </ul>
    <div class="grid2"><${W.Field} label="Contact name"><input class="inp" value=${v.contact} onInput=${function(e){ setV("contact", e.target.value); }} /></${W.Field}>
      <${W.Field} label="Email"><input class="inp mono" value=${v.email} onInput=${function(e){ setV("email", e.target.value); }} placeholder=${"name@" + (b.site || b.name.toLowerCase() + ".com")} /></${W.Field}></div>
    <div class="row wrap">
      <${Btn} kind="pri" icon="flag" disabled=${!ok} onClick=${function(){ W.A.qualify(b.id, {contact:v.contact, email:v.email, budget:v.lo ? [+v.lo, +(v.hi || v.lo)] : null}); }} tip=${ok ? "Qualify" : "Add a contact email first"}>Qualified</${Btn}>
      <${Btn} icon=${finding[0] ? "refresh" : "search"} iconCls=${finding[0] ? "spin" : null} onClick=${function(){ finding[1](true); setTimeout(function(){ finding[1](false); f[1]({contact:"Alex Morgan", email:"partners@" + (b.site || b.name.toLowerCase() + ".com"), lo:v.lo || "1500", hi:v.hi || "3000"}); W.toast({msg:"Found a partnerships contact", sub:"From " + (b.site || "their website") + "/partners. Check it before qualifying.", icon:"search", tone:"info"}); }, 1200); }}>Look on their site</${Btn}>
      <span class="sp"></span>
      <${Btn} kind="ghost" icon="x" onClick=${function(){ W.A.notFit(b.id); }}>Not a fit</${Btn}>
    </div>
  </div>`;
};
W.PitchPicker = function(p){
  var b = p.b;
  var rows = W.D().creators.filter(function(c){ return c.stage === "signed"; }).map(function(c){ return {c:c, m:W.match(b, c)}; }).sort(W.by(function(r){ return r.m.score; }, -1));
  var pickedState = useState(p.pick && p.pick.length ? p.pick.slice(0, 2) : rows.filter(function(r){ return !r.m.warn.length; }).slice(0, 1).map(function(r){ return r.c.id; })), picked = pickedState[0], setPicked = pickedState[1];
  function toggle(id){ setPicked(picked.indexOf(id) >= 0 ? picked.filter(function(x){ return x !== id; }) : picked.length >= 2 ? [picked[1], id] : picked.concat([id])); }
  return html`<div class="col" data-why="pitch">
    <p class="hint">Pick one or two. Ranked by how well they fit ${b.name}: audience, price against budget, past sponsors, and clashes with live deals.</p>
    <div class="col tight">${rows.map(function(r){ var on = picked.indexOf(r.c.id) >= 0; return html`<label key=${r.c.id} class=${W.cx("ck", on ? "done" : null)} style=${{cursor:"pointer", borderColor:on ? "var(--accent)" : null, background:on ? "var(--accent-soft)" : null}}>
      <input type="checkbox" checked=${on} onChange=${function(){ toggle(r.c.id); }} aria-label=${"Pick " + r.c.name} />
      <${W.CAv} c=${r.c} size="s" />
      <span class="t" style=${{textDecoration:"none"}}><b style=${{fontWeight:500}}>${r.c.name}</b> <span class="muted small">${W.fmtK(r.c.median)} median · rate ${W.money(r.c.rate)} · quote ${W.money(r.m.price)}</span>
        <small style=${{textDecoration:"none"}}>${r.m.why.join(" · ")}${r.m.warn.length ? html` <span style=${{color:"var(--crit)"}}>· ${r.m.warn.join(" · ")}</span>` : null}</small></span>
      <b class="num" style=${{fontSize:"15px"}}>${r.m.score}</b>
    </label>`; })}</div>
    <div class="row"><${Btn} kind="pri" icon="sparkle" disabled=${!picked.length} onClick=${function(){ W.A.draftPitch(b.id, picked); }}>Draft the pitch to ${b.name}</${Btn}><span class="hint">${picked.length} of 2 picked</span></div>
  </div>`;
};

/* ================= the record (peek and full page) ================= */
W.NextCard = function(p){
  var n = W.nextFor(p.refx); if (!n) return null;
  function go(){
    if (n.item){ W.go("today"); W.ui(function(u){ u.todaySel = n.item; }); }
    else if (n.pitch){ W.go("close", "pitch", {pitchBrand:n.pitch}); }
  }
  return html`<div class="nextcard" style=${{"--hue":n.hue}} data-why="nextcard">
    <span class="ni"><${Icon} n=${n.icon} /></span>
    <span class="nt"><b style=${{fontWeight:600}}>${n.waiting ? "" : "Next: "}${n.label}</b><small>${n.sub}</small></span>
    ${!n.waiting && (n.item || n.pitch) ? html`<${Btn} size="sm" kind="pri" onClick=${go}>Do it</${Btn}>` : null}
  </div>`;
};
function CreatorBody(p){
  var c = p.c, tab = p.tab, ref = {t:"creator", id:c.id}, qs = W.draftsFor(ref);
  if (tab === "talk") return html`<div class="col"><${W.Thread} refx=${ref} limit=${6} />${qs.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}</div>`;
  if (tab === "deals"){ var ds = W.dealsFor(ref); return ds.length ? html`<div class="col tight">${ds.map(function(x){ return html`<button key=${x.id} type="button" class="kcard" onClick=${function(){ W.peek("deal", x.id); }}><b>${W.dealName(x)}</b><small>${W.DEAL_FLOW[x.step].name} · ${W.money(x.price)} → ${W.money(x.payout)}</small></button>`; })}</div>` : html`<${W.Empty} icon="box" title="No deals yet">${c.stage === "signed" ? "Pitch them to a brand from Close." : "Deals start after they are signed."}</${W.Empty}>`; }
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  return html`<div class="col">
    <div class="grid3" style=${{gap:"8px"}}>${c.videos.slice(0, 3).map(function(v, i){ return html`<${W.Vid} key=${i} v=${v} />`; })}</div>
    <div class="stats"><${W.Stat} v=${W.fmtK(c.subs)} l="subscribers" /><${W.Stat} v=${W.fmtK(c.median)} l="median views" /><${W.Stat} v=${c.up30} l="uploads / 30 days" /><${W.Stat} v=${(c.eng || "?") + "%"} l="engagement" />${c.rate ? html`<${W.Stat} v=${W.money(c.rate)} l="rate" />` : null}</div>
    <div class="col tight"><h4>Audience</h4><${W.Countries} countries=${c.countries} /></div>
    <div class="col tight"><h4>Contact</h4><${W.ContactBlock} c=${c} /></div>
    ${c.stage === "kit" ? html`<div class="col tight"><h4>Audience check</h4><${W.AudienceCheck} c=${c} /></div>` : null}
    <div class="col tight"><h4>Fit ${W.fit(c).score}/100</h4><${W.FitParts} c=${c} /></div>
    ${c.sponsors.length ? html`<div class="row wrap"><span class="small muted">Sponsored by</span>${c.sponsors.map(function(s){ return html`<${Tag} key=${s}>${s}</${Tag}>`; })}</div>` : null}
    <${Notes} refx=${ref} />
  </div>`;
}
function BrandBody(p){
  var b = p.b, tab = p.tab, ref = {t:"brand", id:b.id}, qs = W.draftsFor(ref);
  if (tab === "talk") return html`<div class="col"><${W.Thread} refx=${ref} limit=${6} />${qs.map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}</div>`;
  if (tab === "deals"){ var ds = W.dealsFor(ref); return ds.length ? html`<div class="col tight">${ds.map(function(x){ return html`<button key=${x.id} type="button" class="kcard" onClick=${function(){ W.peek("deal", x.id); }}><b>${W.dealName(x)}</b><small>${W.DEAL_FLOW[x.step].name} · ${W.money(x.price)}</small></button>`; })}</div>` : html`<${W.Empty} icon="box" title="No deals yet" />`; }
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  if (b.status === "found") return html`<${W.Qualify} b=${b} />`;
  if (b.status === "qualified") return html`<div class="col"><dl class="kv"><dt>Sells</dt><dd>${b.sells}</dd><dt>Contact</dt><dd>${b.contact} <span class="mono small muted">${b.email}</span></dd><dt>Budget</dt><dd>${b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "unknown"}</dd></dl><h4>Pitch creators</h4><${W.PitchPicker} b=${b} /></div>`;
  return html`<div class="col"><dl class="kv"><dt>Sells</dt><dd>${b.sells}</dd><dt>Contact</dt><dd>${b.contact || "none"} <span class="mono small muted">${b.email}</span></dd><dt>Budget</dt><dd>${b.budget ? W.money(b.budget[0]) + "–" + W.money(b.budget[1]) : "unknown"}</dd><dt>Working with us since</dt><dd>${W.fmtDate(b.since)}</dd></dl>
    <h4>Best signed creators for ${b.name}</h4>
    <div class="col tight">${W.D().creators.filter(function(c){ return c.stage === "signed"; }).map(function(c){ return {c:c, m:W.match(b, c)}; }).sort(W.by(function(r){ return r.m.score; }, -1)).slice(0, 3).map(function(r){ return html`<div key=${r.c.id} class="ck"><${W.CAv} c=${r.c} size="s" /><span class="t">${r.c.name}<small>${r.m.why.concat(r.m.warn).join(" · ")}</small></span><b class="num">${r.m.score}</b></div>`; })}</div>
    <${Notes} refx=${ref} /></div>`;
}
function DealBody(p){
  var x = p.x, tab = p.tab, ref = {t:"deal", id:x.id};
  if (tab === "log") return html`<${W.Timeline} events=${W.eventsFor(ref)} />`;
  if (tab === "talk") return html`<div class="col"><h4>With ${W.brand(x.brand).name}</h4><${W.Thread} refx=${{t:"brand", id:x.brand}} limit=${4} />${W.draftsFor({t:"brand", id:x.brand}).map(function(q){ return html`<${W.DraftCard} key=${q.id} q=${q} />`; })}</div>`;
  return html`<div class="col">
    <${W.DealSteps} x=${x} />
    <${W.DealChecklist} x=${x} />
    <${W.Money} x=${x} />
    <dl class="kv"><dt>Deliverable</dt><dd>${x.deliverable}</dd><dt>Go-live</dt><dd>${x.golive ? W.fmtDate(x.golive) : "not set"}</dd><dt>Terms</dt><dd>${x.terms}</dd>${x.live ? html`<dt>Video</dt><dd class="mono">${x.live}</dd>` : null}</dl>
    <${Notes} refx=${ref} />
  </div>`;
}
function Notes(p){
  var ref = p.refx, list = (W.D().notes[ref.id] || []), t = useState("");
  return html`<div class="col tight"><h4>Notes</h4>
    ${list.map(function(n, i){ return html`<div key=${i} class="callout"><${W.Av} id=${n.who} size="s" /><div class="grow small">${n.text}<div class="tiny muted">${W.ago(n.at)}</div></div></div>`; })}
    <div class="row"><input class="inp sm" placeholder="Add a note for the team (@Sara to mention)" value=${t[0]} onInput=${function(e){ t[1](e.target.value); }} onKeyDown=${function(e){ if (e.key === "Enter" && t[0].trim()){ var txt = t[0].trim(); W.act("Added a note to " + W.refName(ref), function(d){ (d.notes[ref.id] = d.notes[ref.id] || []).push({who:d.me, at:W.now(), text:txt}); }, {ref:ref}); t[1](""); } }} aria-label="Add a note" /></div>
  </div>`;
}
W.Record = function(p){
  var ref = p.refx, o = W.rec(ref);
  var tabSt = useState(p.tab || "overview"), tab = tabSt[0], setTab = tabSt[1];
  useEffect(function(){ setTab(p.tab || "overview"); }, [ref.t, ref.id]);
  if (!o) return html`<${W.Empty} icon="help" title="This record is gone">It may have been undone.</${W.Empty}>`;
  var isC = ref.t === "creator", isB = ref.t === "brand";
  var talkN = W.threadOf(isB || isC ? ref : {t:"brand", id:o.brand}).length;
  var tabs = [["overview", ref.t === "deal" ? "Steps and money" : "Overview"],["talk","Emails", talkN || null]].concat(ref.t === "deal" ? [] : [["deals","Deals", W.dealsFor(ref).length || null]]).concat([["log","Activity"]]);
  var viewers = (W.U().viewers || {})[ref.id], banner = isC && W.hasBanner(o);
  return html`<div class="col" style=${{gap:"14px"}}>
    ${banner ? html`<${W.Banner} c=${o} />` : null}
    <div class=${W.cx("rec-h", banner ? "on-banner" : null)}>
      ${isC ? html`<${W.CAv} c=${o} size="xl" />` : isB ? html`<${W.BAv} b=${o} size="xl" />` : html`<span class="av xl sq" style=${{background:"var(--deliver)"}}><${Icon} n="box" s=${24} style=${{color:"#fff"}} /></span>`}
      <div class="t">
        <h2>${ref.t === "deal" ? W.dealName(o) : o.name}</h2>
        <span class="muted small">${isC ? o.handle + " · " + W.fmtK(o.subs) + " subscribers" : isB ? o.sells + " · " + (W.COUNTRY[o.country] || o.country) : W.money(o.price) + " → " + W.money(o.payout) + " · " + o.deliverable}</span>
        <div class="row wrap" style=${{marginTop:"6px"}}>
          ${isC ? html`<${Tag} hue=${o.stage === "signed" ? "var(--close)" : "var(--find)"}>${W.STAGE_LABEL[o.stage]}</${Tag}>` : isB ? html`<${Tag} hue="var(--close)">${o.status}</${Tag}>` : html`<${Tag} hue="var(--deliver)">${W.DEAL_FLOW[o.step].name}</${Tag}>`}
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
