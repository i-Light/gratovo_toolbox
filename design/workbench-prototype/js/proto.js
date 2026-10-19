/* proto.js — everything here sits beside the app, not inside it.
   1. Who is using the app: the display name comes from the signed-in account (or a name set in Settings).
   2. Prototype mode, owner only and off by default. Turning it on sets the live data aside untouched and runs the
      same screens on an example copy: pick a scenario (a normal day, a first day, a week later, something broken)
      or see the app as a teammate. Turning it off puts the live data back exactly as it was.
   3. The comment store behind the comment tool (comments.js draws it).
   When prototype mode is off, nothing in this file draws anything or listens to any key. */
(function(){
"use strict";
var W = window.W, S = W.S;
var clone = window.structuredClone ? function(o){ return window.structuredClone(o); } : function(o){ return JSON.parse(JSON.stringify(o)); };

/* ---------- this computer's small preferences ---------- */
W.LS = {
  get:function(k, def){ try { var v = localStorage.getItem(k); return v == null ? def : v; } catch (e){ return def; } },
  set:function(k, v){ try { if (v == null || v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e){} }
};

/* ---------- the platform's capabilities, when this page runs inside a viewer that offers them ---------- */
function use(name){
  try { return window.claude && window.claude.use ? window.claude.use(name).catch(function(){ return null; }) : Promise.resolve(null); }
  catch (e){ return Promise.resolve(null); }
}

/* ---------- who is using it ---------- */
W.loadProfile = function(){
  W.ui(function(u){ u.profile = {local:W.LS.get("wb-name", "") || "", acct:"", avatar:"", id:null}; });
  use("user").then(function(usr){
    if (!usr) return;
    usr.me().then(function(me){
      if (!me) return;
      W.ui(function(u){ u.profile = Object.assign({}, u.profile, {acct:me.name || "", avatar:me.name ? me.avatarUrl : "", id:me.id || null}); });
    }, function(){});
  });
};
/* the name the app shows for the owner's account: what you typed in Settings, else your account's name */
W.myName = function(){ var p = S.state.ui.profile || {}; return p.local || p.acct || ""; };
W.setMyName = function(v){
  var before = W.myName(); v = (v || "").trim();
  W.LS.set("wb-name", v);
  W.ui(function(u){ u.profile = Object.assign({}, u.profile, {local:v}); });
  return before;
};

/* ---------- prototype mode ---------- */
W.SCENARIOS = [
  {k:"normal", name:"A normal Monday", short:"Normal Monday", icon:"sun", sub:"The example business mid-flow: replies waiting, deals moving, an overdue invoice, a paused search."},
  {k:"first", name:"First day", short:"First day", icon:"sparkle", sub:"Nothing yet. No creators, one mailbox just starting its warm-up, your first search ready to start."},
  {k:"later", name:"A week later", short:"A week later", icon:"clock", sub:"The same business seven days on with nothing done in between, so everything that slips shows up late."},
  {k:"broke", name:"Something broke", short:"Something broke", icon:"alert", sub:"A mailbox is signed out, the Gemini bridge is offline and today's search stopped on YouTube's daily limit."}
];
var P = W.proto = {live:null};
W.protoOn = function(){ var u = S.state && S.state.ui; return !!(u && u.proto && u.proto.on); };
/* the person actually signed in, even while seeing the app as someone else */
W.accountIsOwner = function(){ var d = P.live ? P.live.data : S.state.data; return W.member(d.me).role === "Owner"; };

function build(k){
  var d = clone(W.PRISTINE), now = W.NOW0;
  if (k === "later"){
    now = W.NOW0 + 7 * W.DAY;
    d.mail.forEach(function(m){ m.sent = 0; });
  }
  if (k === "first"){
    d.creators = []; d.brands = []; d.deals = []; d.threads = {}; d.drafts = []; d.notes = {}; d.log = []; d.done = []; d.snoozed = {}; d.handed = {};
    d.team = d.team.filter(function(m){ return m.id === "u1"; });
    d.mail = [{id:"m1", addr:"outreach1@gratovo.co", cap:5, sent:0, warm:{done:false, day:1, of:14}, bounce:0, reply:0, inbox:0, status:"warming"}];
    d.mateRun = null;
    var r = d.runs.filter(function(x){ return x.id === "r3"; })[0];
    r.at = now; r.status = "ready"; r.cur = 0; r.found = 0; r.kept = 0; r.gold = 0; r.archived = 0; r.videos = 0; r.log = [];
    r.kws.forEach(function(kw){ kw.st = "queued"; kw.found = 0; kw.kept = 0; });
    d.runs = [r];
    d.hist = {sent:d.hist.sent.map(function(x){ return {at:x.at, v:0}; }), replies:d.hist.replies.map(function(x){ return {at:x.at, v:0}; }), months:[]};
    d.notifs = [];
    d.poolI = 0;
  }
  if (k === "broke"){
    var m1 = d.mail[0];
    m1.status = "error"; m1.err = "Gmail sign-in expired on " + W.fmtDate(W.NOW0 - W.DAY);
    m1.note = "Nothing is sent from " + m1.addr.split("@")[0] + " until it is signed in again. Approved emails wait or go from the other mailboxes.";
    d.health = {gemini:"offline", geminiAt:W.at(0, 8, 52), youtube:"quota"};
    var r3 = d.runs.filter(function(x){ return x.id === "r3"; })[0];
    r3.status = "failed"; r3.err = "YouTube's daily search limit ran out";
    r3.log.push([W.at(0, 9, 40), "Stopped at keyword " + (r3.cur + 1) + ": YouTube's daily search limit ran out · everything found is saved"]);
    d.notifs.unshift(
      {id:"nx1", at:W.at(0, 9, 40), icon:"alert", text:"Today's search stopped: YouTube's daily limit", sub:"Resets at midnight Pacific time · everything found is saved", go:{s:"find", tab:"search"}, read:false},
      {id:"nx2", at:W.at(0, 8, 52), icon:"alert", text:"The Gemini bridge stopped answering", sub:"Drafts can't be written or rewritten until it's back", go:{s:"settings", tab:"connections"}, read:false},
      {id:"nx3", at:W.at(-1, 18, 5), icon:"alert", text:"outreach1 is signed out of Gmail", sub:"Nothing is sent from it until it is signed in again", go:{s:"reach", tab:"mailboxes"}, read:false});
  }
  return {d:d, now:now};
}
function freshUi(u){
  u.toasts = [];   /* an Undo toast must never reach across to the other data */
  u.peek = null; u.todaySel = null; u.todayIdx = 0; u.focus = false; u.wrap = false; u.menu = null; u.tray = null;
  u.find = null; u.findui = null;
}
function load(k){
  var b = build(k);
  if (S.state.ui.proto.viewAs && b.d.team.some(function(m){ return m.id === S.state.ui.proto.viewAs; })) b.d.me = S.state.ui.proto.viewAs;
  else S.state.ui.proto.viewAs = b.d.me;
  W.NOW = b.now; S.state.data = b.d; S.undo = []; S.redo = [];
}
/* on: set the live data aside (with its undo history and running jobs) and switch to an example copy */
W.setProto = function(on, quiet){
  var u = S.state.ui;
  if (!!on === W.protoOn()) return;
  if (on && !W.accountIsOwner()) return;   /* owner only */
  if (on){
    P.live = {data:S.state.data, undo:S.undo, redo:S.redo, now:W.NOW, jobs:u.jobs};
    u.proto = {on:true, scenario:W.LS.get("wb-proto-scn", "normal"), viewAs:null, mode:false, panel:false, open:null, showDone:false};
    u.jobs = [];
    load(u.proto.scenario);
  } else {
    var l = P.live; P.live = null;
    if (l){ S.state.data = l.data; S.undo = l.undo; S.redo = l.redo; W.NOW = l.now; u.jobs = l.jobs; }
    u.proto = {on:false};
    W.commentsStop();
  }
  freshUi(u);
  W.LS.set("wb-proto", on ? "1" : "");
  W.emit();
  if (on) W.commentsStart();
  if (!quiet) W.toast(on ? {msg:"Prototype mode is on", sub:"You're on an example copy. Your live data is set aside untouched, and nothing is sent.", icon:"flask", tone:"info"}
    : {msg:"Prototype mode is off", sub:"Back on your live data, exactly as you left it.", icon:"check", tone:"info"});
};
W.setScenario = function(k){
  var u = S.state.ui; if (!W.protoOn()) return;
  u.proto = Object.assign({}, u.proto, {scenario:k});
  W.LS.set("wb-proto-scn", k);
  u.jobs = [];
  load(k); freshUi(u); W.emit();
  var s = W.SCENARIOS.filter(function(x){ return x.k === k; })[0];
  W.toast({msg:"Scenario: " + s.name, sub:"A fresh example copy. Changes you make stay in this copy until you switch again.", icon:s.icon, tone:"info", ms:4500});
};
/* see the app as a teammate: their Today, and money hidden if their role hides it */
W.setViewAs = function(id){
  var u = S.state.ui; if (!W.protoOn()) return;
  u.proto = Object.assign({}, u.proto, {viewAs:id});
  W.bg(function(d){ d.me = id; });
  W.ui(function(uu){ freshUi(uu); });
  var m = W.member(id);
  W.toast({msg:id === "u1" ? "Back to your own view" : "Seeing the app as " + m.name, sub:id === "u1" ? null : m.role + ". Their Today list, and what their role lets them see.", icon:"eye", tone:"info", ms:4000});
};

/* ---------- comments: stored with this artifact when it can be, else in this browser ---------- */
var CM = W.CM = {list:[], src:"local", started:false, db:null, err:null, unsub:null};
/* off means off: no listener and no writes while prototype mode is off */
W.commentsStop = function(){ if (CM.unsub){ try { CM.unsub(); } catch (e){} } CM.unsub = null; CM.db = null; CM.started = false; CM.src = "local"; };
function saveLocal(){ W.LS.set("wb-comments", CM.list.length ? JSON.stringify(CM.list) : ""); }
function readLocal(){ try { return JSON.parse(W.LS.get("wb-comments", "[]")) || []; } catch (e){ return []; } }
W.commentsStart = function(){
  if (CM.started) return; CM.started = true;
  CM.list = readLocal(); W.emit();
  use("db").then(function(db){
    if (!db || !CM.started) return;
    var first = true;
    try {
      CM.unsub = db.collection("comments").onSnapshot(function(snap){
        CM.db = db; CM.src = "shared";
        var rows = snap.docs.map(function(x){ return Object.assign({}, x.data(), {id:x.id}); });
        if (first){
          first = false;
          /* comments made before sharing was possible move up once, then the browser copy is cleared */
          var have = {}; rows.forEach(function(r){ have[r.id] = 1; });
          var up = CM.list.filter(function(c){ return !have[c.id]; });
          if (up.length){ rows = rows.concat(up); up.reduce(function(p, c){ return p.then(function(){ return db.doc("comments/" + c.id).set(strip(c)); }); }, Promise.resolve()).then(function(){ W.LS.set("wb-comments", ""); }, function(){}); }
          else W.LS.set("wb-comments", "");
        }
        CM.list = rows.sort(W.by(function(c){ return c.at; })); W.emit();
      }, function(e){ CM.db = null; CM.src = "local"; CM.err = e && e.code; W.emit(); });
    } catch (e){ CM.db = null; }
  });
};
function strip(c){ var o = Object.assign({}, c); delete o.id; return o; }
function write(id, body){
  if (!W.protoOn()) return;
  if (!CM.db) { saveLocal(); return; }
  var ref = CM.db.doc("comments/" + id);
  (body ? ref.set(body) : ref.delete()).catch(function(e){
    W.toast({msg:"That comment didn't save to the shared copy", sub:e && e.code === "quota_exceeded" ? "The comment store is full. Delete some done comments." : "It's kept in this browser for now.", icon:"alert", tone:"warn"});
    CM.db = null; CM.src = "local"; saveLocal(); W.emit();
  });
}
W.commentAdd = function(c){
  c.id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  c.at = Date.now(); c.status = "open"; c.by = (S.state.ui.profile || {}).id || null;
  CM.list = CM.list.concat([c]); write(c.id, strip(c)); W.emit();
  return c;
};
W.commentPatch = function(id, patch){
  var c = CM.list.filter(function(x){ return x.id === id; })[0]; if (!c) return;
  var n = Object.assign({}, c, patch);
  CM.list = CM.list.map(function(x){ return x.id === id ? n : x; }); write(id, strip(n)); W.emit();
};
W.commentDelete = function(id){
  var c = CM.list.filter(function(x){ return x.id === id; })[0]; if (!c) return null;
  CM.list = CM.list.filter(function(x){ return x.id !== id; }); write(id, null); W.emit();
  return c;
};
W.commentRestore = function(c){ CM.list = CM.list.concat([c]).sort(W.by(function(x){ return x.at; })); write(c.id, strip(c)); W.emit(); };
})();
