/* The toolbox modules every version mounts: the Search console, the Creator gallery (image cards + latest upload),
   Insights (stats, funnels, keyword evaluation) and the Toolbox hub. Kept from the current app and rebuilt.
   A version gives its ctx: {d, render, openCreator(id), showFinds(filter), openBrand?(id), openDeal?(id)}
   and sets ctx.tbVisible to "search" | "gallery" | "insights" | "tools" while one is on screen. */
(function(){
"use strict";
var esc = P.esc;
var CTX = {};
function hash(s){ var h = 2166136261; for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
var HUES = [[205,250],[330,280],[150,195],[25,355],[265,215],[42,12],[182,222],[300,338]];
function grad(seed){ var p = HUES[hash(seed)%HUES.length]; return "linear-gradient(135deg,hsl("+p[0]+" 72% 44%),hsl("+p[1]+" 66% 26%))"; }
function meta(c){
  if (!c._m){ var h = hash(c.id+c.name); c._m = {ago:[1,2,3,4,5,6,9,12][h%8], views:Math.round(c.median*(0.55+(h%90)/100)), dur:(6+h%19)+":"+String(10+h%49), found:["12 Oct","13 Oct","15 Oct","17 Oct"][h%4]}; }
  if (!c.run) c.run = c.stage==="new" ? "r3" : "r1";
  return c._m;
}
function thumb(c, small){ var m = meta(c), words = c.video.replace(/[^A-Za-z0-9 ,:+]/g,"").split(" ").slice(0, small?4:6).join(" ");
  return '<div class="thumb'+(small?' sm':'')+'" style="background:'+grad(c.video)+'" role="img" aria-label="Latest upload: '+esc(c.video)+'"><b>'+esc(words)+'</b><span class="dur">'+m.dur+'</span></div>'; }
function av(c, cls){ return '<span class="av '+(cls||'')+'" style="background:'+grad(c.name+"a")+'" aria-hidden="true">'+esc(c.name.replace(/[^A-Za-z]/g,"").slice(0,2).toUpperCase())+'</span>'; }

/* ---------------- state ---------------- */
var KW = ["ai agents for small business","claude vs gpt coding","ai note taker review","best ai video editor 2026","rag tutorial beginners","ai automation zapier","cursor ai tutorial","ai voice cloning review",
  "local llm setup","ai for youtube creators","midjourney vs flux","ai sales tools","notebooklm tutorial","ai spreadsheet tools","perplexity vs google","ai coding agents","ai productivity stack","agentic workflows explained","ai image editing app","whisper transcription tutorial","llm fine tuning beginner","ai email assistant","ai meeting notes","open source ai models"];
var POOL = [["Latent Lounge","@latentlounge","Fine-tuning a 7B model on my laptop"],["Inference Inc","@inferenceinc","Why your AI app is slow (and the 3 fixes)"],["Copilot Corner","@copilotcorner","Copilot vs Cursor: 30 day test"],["Gradient Guy","@gradientguy","Backprop explained with pizza"],["Token Talks","@tokentalks","I spent $500 on AI APIs so you don't"],["Neural Nomad","@neuralnomad","Running a business from a van with AI"],["Prompt Craft","@promptcraft","The prompt pattern nobody uses"],["Bot Builder","@botbuilder","My AI support bot answered 4,000 tickets"],["Diffusion Daily","@diffusiondaily","Flux vs Midjourney, blind test"],["Agent Arena","@agentarena","5 agents race to build an app"],["Silicon Sage","@siliconsage","The AI tools I actually pay for"],["Vector Vibes","@vectorvibes","Vector databases in 8 minutes"]];
function st(ctx){
  if (!ctx.tb){
    ctx.tb = {
      search:{kws:KW.slice(), done:8, cur:-1, running:false, timer:null, found:0, kept:0, arch:0, vids:0, batch:0, kwStats:{0:[14,4],1:[11,3],2:[9,2],3:[16,5],4:[8,2],5:[12,4],6:[10,3],7:[7,1]},
        log:["08:10:02  Run started on this computer · 24 keywords","08:10:40  \"ai agents for small business\" · 14 channels, 4 kept","08:13:05  \"claude vs gpt coding\" · 11 channels, 3 kept","08:31:52  Run paused after keyword 8 · everything found is saved"],
        tab:"log", route:"This computer", rulesOpen:false, genOpen:false, gen:[], genPick:{}, add:"",
        rules:{sort:"Relevance", type:"Channels", countries:{US:true,GB:true,CA:true,AU:true}, max:"40", subsMin:"", subsMax:"", viewsMin:"45000", upMin:"3", rejects:"Archive after 7 days"},
        runs:[{id:"r3", when:"Today 08:10", kws:8, found:87, kept:24, gold:9, by:"You"},{id:"r2", when:"17 Oct", kws:20, found:240, kept:61, gold:17, by:"Sara"},{id:"r1", when:"12 Oct", kws:30, found:362, kept:97, gold:31, by:"You"}],
        mates:[["Sara","searching · keyword 12 of 40"],["Omar","idle"]], poolI:0},
      gal:{q:"", sort:"median", view:"gallery", size:"m", images:true, latest:true, sig:true, f:{}, sel:{}, brush:null, facetsOpen:true, saved:[]},
      ins:{period:"30", owner:"all", tables:{}},
      tools:{open:null, calc:{views:60000, niche:"tech", cpm:40, markup:60}}
    };
  }
  return ctx.tb;
}

/* ---------------- search console ---------------- */
function rulesChips(R){ return '<span class="tag">Sort: '+esc(R.sort)+'</span><span class="tag">'+esc(R.type)+'</span><span class="tag">'+esc(Object.keys(R.countries).filter(function(k){ return R.countries[k]; }).join(" · ")||"Any country")+'</span><span class="tag">'+esc(R.max)+' per keyword</span>'+
  (R.viewsMin?'<span class="tag good">Keep: '+P.fmtK(+R.viewsMin)+'+ median views</span>':'')+(R.upMin?'<span class="tag good">Keep: '+esc(R.upMin)+'+ uploads in 30 days</span>':'')+(R.subsMin||R.subsMax?'<span class="tag good">Subscribers '+esc(R.subsMin||"0")+'–'+esc(R.subsMax||"any")+'</span>':'<span class="tag">No size cap</span>')+'<span class="tag">Rejects: '+esc(R.rejects.toLowerCase())+'</span>'; }
function kwRows(S){
  return S.kws.map(function(k,i){
    var state = i<S.done ? "done" : (S.running && i===S.done) ? "cur" : "";
    var ks = S.kwStats[i];
    return '<li class="kw '+state+'"><span class="ln mono">'+(i+1)+'</span><span class="kt">'+esc(k)+'</span>'+(ks?'<span class="ks mono">'+ks[0]+' found · '+ks[1]+' kept</span>':state==="cur"?'<span class="ks mono">searching…</span>':'')+
      '<span class="ka">'+(i<S.done?'<button class="btn sm ghost" type="button" data-tb-redo="'+i+'" title="Search this keyword again">Redo</button>':'<button class="btn sm ghost" type="button" data-tb-startat="'+i+'" title="Start the next run here"'+(S.running?' disabled':'')+'>Start here</button>')+'<button class="btn sm ghost" type="button" data-tb-rmkw="'+i+'" aria-label="Remove '+esc(k)+'"'+(S.running&&i===S.done?' disabled':'')+'>✕</button></span></li>';
  }).join("");
}
function liveHtml(S){
  var n = S.kws.length, pct = Math.round(S.done/n*100);
  var head = S.running ? 'Keyword '+(S.done+1)+' of '+n+' · "'+esc(S.kws[S.done]||"")+'"' : S.done>=n ? 'Every keyword is done' : (S.batch ? 'Run complete · '+S.kept+' kept' : 'Paused at keyword '+(S.done+1)+' of '+n+' · everything found is saved');
  return '<div class="row"><span class="dot '+(S.running?'run':'')+'" aria-hidden="true"></span><b>'+head+'</b><span class="sp"></span><span class="mono muted">'+S.done+'/'+n+'</span></div><div class="pbar" role="progressbar" aria-valuenow="'+pct+'" aria-valuemin="0" aria-valuemax="100"><i style="width:'+pct+'%"></i></div>'+
    '<div class="ctr"><div><b class="num">'+S.found+'</b><span>channels found</span></div><div><b class="num">'+S.kept+'</b><span>kept by your rules</span></div><div><b class="num">'+S.arch+'</b><span>archived</span></div><div><b class="num">'+S.vids+'</b><span>videos read</span></div></div>'+
    '<div class="tabs">'+[["log","Live log"],["backfill","Video backfill"],["freed","Freed from the archive"],["missing","Filling in missing videos"]].map(function(t){ return '<button type="button" data-tb-ltab="'+t[0]+'" aria-current="'+(S.tab===t[0])+'">'+t[1]+'</button>'; }).join("")+'</div>'+
    (S.tab==="log" ? '<pre class="log">'+esc(S.log.slice(-9).join("\n"))+'</pre>' : S.tab==="backfill" ? '<p class="hint">3 channels getting their second month of videos · 41 of 90 videos read.</p>' : S.tab==="freed" ? '<p class="hint">1 channel brought back from the archive is being re-read: @synthstudio.</p>' : '<p class="hint">Catching up on 12 channels whose videos never loaded. Runs quietly in the background.</p>');
}
function searchConsole(ctx){
  var S = st(ctx).search, R = S.rules;
  var h = '<div class="ph"><div class="col" style="gap:2px"><h2>Search</h2><p>Find AI channels on YouTube. Rules are applied while it runs, and every run ends with a link to what it kept.</p></div><span class="sp"></span>'+
    '<div class="row">'+S.mates.map(function(m){ return '<span class="mate">'+P.avatar(m[0],m[0].length)+'<span><b>'+esc(m[0])+'</b><small>'+esc(m[1])+'</small></span><button class="btn sm" type="button" data-tb-send="'+esc(m[0])+'">Send keywords</button></span>'; }).join("")+'</div></div>';
  h += '<div class="sgrid"><section class="card"><div class="row"><h3>Keywords</h3><span class="mono muted">'+S.kws.length+' · '+S.done+' done</span><span class="sp"></span><button class="btn sm pri" type="button" data-tb-gen>Generate with Gemini</button><button class="btn sm" type="button" data-tb-toast="Keywords saved to the team list (example).">Save list</button></div>';
  if (S.genOpen){
    h += '<div class="gen"><div class="g2"><label class="field">Topic<input class="input" id="tb-gt" value="AI tools for solo founders"></label><label class="field">How many<select class="input" id="tb-gn"><option>10</option><option selected>20</option><option>40</option></select></label><label class="field">Language<select class="input" id="tb-gl"><option>English</option><option>Arabic</option></select></label><label class="field">Leave out<input class="input" id="tb-gx" value="music, crypto"></label></div><div class="row"><span class="hint">Styles:</span><span class="tag">how-to</span><span class="tag">vs / comparison</span><span class="tag">review</span><span class="tag">"I tried"</span><span class="sp"></span><button class="btn sm pri" type="button" data-tb-gogen>Suggest</button><button class="btn sm ghost" type="button" data-tb-gen>Close</button></div>'+
      (S.gen.length ? '<ul class="gl">'+S.gen.map(function(g,i){ return '<li><label><input type="checkbox" data-tb-gpick="'+i+'"'+(S.genPick[i]!==false?' checked':'')+'> '+esc(g)+'</label></li>'; }).join("")+'</ul><div class="row"><button class="btn sm pri" type="button" data-tb-addgen>Add '+S.gen.filter(function(g,i){ return S.genPick[i]!==false; }).length+' to the list</button></div>' : '')+'</div>';
  }
  h += '<ol class="kwl" id="tb-kwl">'+kwRows(S)+'</ol><div class="row"><textarea class="input" id="tb-add" rows="2" placeholder="Add keywords, one per line"></textarea><button class="btn" type="button" data-tb-add>Add</button></div></section>';
  h += '<section class="col" style="gap:14px"><div class="card"><div class="row"><h3>Rules for every run</h3><span class="sp"></span><button class="btn sm" type="button" data-tb-rules aria-expanded="'+S.rulesOpen+'">'+(S.rulesOpen?'Done':'Edit rules')+'</button></div><div class="row">'+rulesChips(R)+'</div>';
  if (S.rulesOpen){
    h += '<div class="g2"><label class="field">Sort results by<select class="input" data-tb-rule="sort">'+["Relevance","Upload date","View count"].map(function(o){ return '<option'+(R.sort===o?' selected':'')+'>'+o+'</option>'; }).join("")+'</select></label><label class="field">Results<select class="input" data-tb-rule="type">'+["Channels","Videos"].map(function(o){ return '<option'+(R.type===o?' selected':'')+'>'+o+'</option>'; }).join("")+'</select></label>'+
      '<label class="field">Keep median views from<input class="input" data-tb-rule="viewsMin" value="'+esc(R.viewsMin)+'"></label><label class="field">Keep uploads in 30 days from<input class="input" data-tb-rule="upMin" value="'+esc(R.upMin)+'"></label><label class="field">Subscribers from<input class="input" data-tb-rule="subsMin" value="'+esc(R.subsMin)+'" placeholder="no minimum"></label><label class="field">Subscribers up to<input class="input" data-tb-rule="subsMax" value="'+esc(R.subsMax)+'" placeholder="no cap"></label>'+
      '<label class="field">Results per keyword<input class="input" data-tb-rule="max" value="'+esc(R.max)+'"></label><label class="field">Channels outside the rules<select class="input" data-tb-rule="rejects">'+["Archive after 7 days","Tag only, keep them","Archive now"].map(function(o){ return '<option'+(R.rejects===o?' selected':'')+'>'+o+'</option>'; }).join("")+'</select></label></div>'+
      '<div class="row"><span class="hint">Countries:</span>'+["US","GB","CA","AU","IN","DE"].map(function(k){ return '<button class="chip" type="button" data-tb-country="'+k+'" aria-pressed="'+!!R.countries[k]+'">'+k+'</button>'; }).join("")+'<span class="sp"></span><button class="btn sm" type="button" data-tb-house>House rule: about 50K views, no size cap</button></div>';
  }
  h += '</div><div class="card live" id="tb-live">'+liveHtml(S)+'</div><div class="row"><label class="field" style="min-width:200px">Run through<select class="input" data-tb-route>'+["This computer","AWS gateway (rotating IPs)","Proxies"].map(function(o){ return '<option'+(S.route===o?' selected':'')+'>'+o+'</option>'; }).join("")+'</select></label><span class="sp"></span>'+
    (S.running ? '<button class="btn" type="button" data-tb-stop style="min-width:170px">Stop searching</button>' : '<button class="btn pri" type="button" data-tb-start style="min-width:170px; min-height:44px">'+(S.done>0&&S.done<S.kws.length?'Resume at keyword '+(S.done+1):'Start searching')+'</button>')+'</div></section></div>';
  h += '<div class="card"><h3>Runs</h3><div class="tw" style="border:0"><table><thead><tr><th>When</th><th>By</th><th>Keywords</th><th>Found</th><th>Kept</th><th>Gold mines</th><th></th></tr></thead><tbody>'+S.runs.map(function(r){ return '<tr style="cursor:default"><td>'+esc(r.when)+'</td><td>'+esc(r.by)+'</td><td class="num">'+r.kws+'</td><td class="num">'+r.found+'</td><td class="num">'+r.kept+'</td><td class="num">'+r.gold+'</td><td><button class="btn sm pri" type="button" data-tb-review="'+r.id+'">Review results</button></td></tr>'; }).join("")+'</tbody></table></div></div>';
  return h;
}
function paintLive(ctx){ var S = st(ctx).search, a = document.getElementById("tb-live"), b = document.getElementById("tb-kwl"); if (a) a.innerHTML = liveHtml(S); if (b) b.innerHTML = kwRows(S); var btn = document.querySelector("[data-tb-stop],[data-tb-start]"); if (btn && ((S.running && btn.hasAttribute("data-tb-start")) || (!S.running && btn.hasAttribute("data-tb-stop")))) ctx.render(); }
function now(){ var d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function(x){ return String(x).padStart(2,"0"); }).join(":"); }
function start(ctx, v){
  var S = st(ctx).search; if (S.running) return;
  if (S.done>=S.kws.length){ P.toast("Every keyword is done. Add more, or redo one."); return; }
  S.running = true; S.batch = 0; S.found = 0; S.kept = 0; S.arch = 0; S.vids = 0; S.runId = "r"+(S.runs.length+1+Math.floor(Math.random()*900));
  S.log.push(now()+"  Run started through "+S.route+" · keyword "+(S.done+1)+" of "+S.kws.length);
  S.timer = setInterval(function(){ tick(ctx, v); }, 900);
  if (ctx.tbVisible==="search" && P.current===v) ctx.render();
}
function tick(ctx, v){
  var S = st(ctx).search; if (!S.running){ clearInterval(S.timer); return; }
  var i = S.done, k = S.kws[i], h = hash(k), found = 6+h%11, kept = Math.max(1, Math.round(found*(0.2+(h%20)/100)));
  S.found += found; S.kept += kept; S.arch += found-kept; S.vids += kept*15; S.kwStats[i] = [found, kept];
  S.log.push(now()+"  \""+k+"\" · "+found+" channels, "+kept+" kept, "+(found-kept)+" archived by your rules");
  if (h%7===3) S.log.push(now()+"  YouTube slowed us down · waited 20 s and carried on");
  var add = Math.min(2, kept);
  for (var a=0; a<add && S.poolI<POOL.length; a++){
    var p = POOL[S.poolI++], hh = hash(p[1]);
    ctx.d.creators.push({id:"n"+S.poolI, name:p[0], handle:p[1], subs:40000+hh%260000, median:45000+hh%90000, up30:3+hh%7, sponsors:hh%3?[]:[["Codewell","Lumen AI","VoxCraft","Pagewise"][hh%4]], email:hh%2?p[1].slice(1)+"@gmail.com":null, confirmed:false, contactName:"", top:["US 41% · GB 12% · CA 7%","US 33% · IN 18% · GB 9%","US 36% · GB 14% · AU 8%"][hh%3], age:"18–34", eng:3+(hh%40)/10, stage:"new", gold:hh%3!==1, owner:"", rate:0, video:p[2], moment:"", run:S.runId});
  }
  S.done++; S.batch++;
  if (S.done>=S.kws.length || S.batch>=5){
    S.running = false; clearInterval(S.timer);
    S.log.push(now()+"  Run complete · "+S.kept+" kept from "+S.found+" channels");
    S.runs.unshift({id:S.runId, when:"Today "+now().slice(0,5), kws:S.batch, found:S.found, kept:S.kept, gold:Math.round(S.kept*0.4), by:"You"});
    var rid = S.runId;
    P.toast("Search finished: "+S.kept+" new channels kept.", "Review them", function(){ P.tourDone(v,"finds"); ctx.showFinds({run:rid}); });
    if (P.current===v) ctx.render();
    return;
  }
  if (ctx.tbVisible==="search" && P.current===v) paintLive(ctx);
}

/* ---------------- gallery ---------------- */
var STAGES = [["new","New"],["shortlisted","Shortlisted"],["emailed","Emailed"],["replied","Replied"],["mediakit","Media kit"],["signed","Signed"],["rejected","Rejected"]];
var SIGS = [["gold","Gold mine",function(c){ return c.gold; }],["sponsored","Sponsored before",function(c){ return c.sponsors.length>0; }],["email","Has an email",function(c){ return !!c.email; }],["confirmed","Email confirmed",function(c){ return c.email && c.confirmed; }],["ready","Ready to pitch",function(c){ return c.stage==="signed"; }],["never","Never contacted",function(c){ return ["new","shortlisted"].indexOf(c.stage)>=0; }]];
var COUNTRIES = ["US","GB","CA","AU","IN"];
function fval(G, k){ return G.f[k] || {}; }
function passes(G, c, skip){
  var f = G.f;
  if (skip!=="stage" && f.stage && Object.keys(f.stage).some(function(k){ return f.stage[k]; }) && !f.stage[c.stage]) return false;
  if (!(f.stage && f.stage.rejected) && c.stage==="rejected" && skip!=="stage") return false;
  if (skip!=="sig" && f.sig) for (var i=0;i<SIGS.length;i++) if (f.sig[SIGS[i][0]] && !SIGS[i][2](c)) return false;
  if (skip!=="country" && f.country && Object.keys(f.country).some(function(k){ return f.country[k]; })){ var top3 = c.top.split("·").slice(0,3).join(" "); if (!Object.keys(f.country).some(function(k){ return f.country[k] && top3.indexOf(k)>=0; })) return false; }
  if (f.minViews && c.median < f.minViews) return false;
  if (f.minUp && c.up30 < f.minUp) return false;
  if (skip!=="owner" && f.owner && Object.keys(f.owner).some(function(k){ return f.owner[k]; }) && !f.owner[c.owner||"nobody"]) return false;
  if (f.run && f.run!=="all"){ meta(c); if (c.run!==f.run) return false; }
  if (G.q){ var q = G.q.toLowerCase(); if ((c.name+" "+c.handle+" "+c.video+" "+c.sponsors.join(" ")).toLowerCase().indexOf(q)<0) return false; }
  return true;
}
var SORTS = {median:["Median views",function(a,b){ return b.median-a.median; }], subs:["Subscribers",function(a,b){ return b.subs-a.subs; }], recent:["Recently found",function(a,b){ return (b.id>a.id?1:-1); }], up:["Uploads in 30 days",function(a,b){ return b.up30-a.up30; }], latest:["Latest upload",function(a,b){ return meta(a).ago-meta(b).ago; }], eng:["Engagement",function(a,b){ return b.eng-a.eng; }]};
function results(ctx){ var G = st(ctx).gal; return ctx.d.creators.filter(function(c){ return passes(G,c); }).sort(SORTS[G.sort][1]); }
function activeChips(ctx){
  var G = st(ctx).gal, f = G.f, out = [];
  ["stage","sig","country","owner"].forEach(function(k){ if (f[k]) Object.keys(f[k]).forEach(function(x){ if (f[k][x]){ var lbl = k==="stage" ? STAGES.filter(function(s){ return s[0]===x; })[0][1] : k==="sig" ? SIGS.filter(function(s){ return s[0]===x; })[0][1] : k==="owner" ? "Owner: "+x : "Top 3: "+x; out.push('<button class="chip" type="button" data-tb-unf="'+k+':'+x+'" aria-pressed="true">'+esc(lbl)+' ✕</button>'); } }); });
  if (f.minViews) out.push('<button class="chip" type="button" data-tb-unf="minViews" aria-pressed="true">'+P.fmtK(f.minViews)+'+ views ✕</button>');
  if (f.minUp) out.push('<button class="chip" type="button" data-tb-unf="minUp" aria-pressed="true">'+f.minUp+'+ uploads ✕</button>');
  if (f.run && f.run!=="all") out.push('<button class="chip" type="button" data-tb-unf="run" aria-pressed="true">Run: '+esc(f.run==="r3"?"today 08:10":f.run)+' ✕</button>');
  return out;
}
function facetBox(ctx){
  var G = st(ctx).gal, d = ctx.d;
  function cnt(key, test){ return d.creators.filter(function(c){ return passes(G,c,key) && test(c); }).length; }
  var h = '<div class="fg"><h4>Stage</h4>'+STAGES.map(function(s){ return '<label class="fo"><input type="checkbox" data-tb-f="stage:'+s[0]+'"'+(fval(G,"stage")[s[0]]?' checked':'')+'><span>'+s[1]+'</span><span class="mono muted">'+cnt("stage",function(c){ return c.stage===s[0]; })+'</span></label>'; }).join("")+'</div>';
  h += '<div class="fg"><h4>Signals</h4>'+SIGS.map(function(s){ return '<label class="fo"><input type="checkbox" data-tb-f="sig:'+s[0]+'"'+(fval(G,"sig")[s[0]]?' checked':'')+'><span>'+s[1]+'</span><span class="mono muted">'+cnt("sig",s[2])+'</span></label>'; }).join("")+'</div>';
  h += '<div class="fg"><h4>In the top 3 countries</h4><div class="row">'+COUNTRIES.map(function(k){ return '<button class="chip" type="button" data-tb-fc="'+k+'" aria-pressed="'+!!fval(G,"country")[k]+'">'+k+'</button>'; }).join("")+'</div></div>';
  h += '<div class="fg"><h4>Median views at least</h4><div class="row">'+[0,25000,45000,100000].map(function(v){ return '<button class="chip" type="button" data-tb-fv="'+v+'" aria-pressed="'+((G.f.minViews||0)===v)+'">'+(v?P.fmtK(v):"Any")+'</button>'; }).join("")+'</div></div>';
  h += '<div class="fg"><h4>Uploads in 30 days at least</h4><div class="row">'+[0,3,5,8].map(function(v){ return '<button class="chip" type="button" data-tb-fu="'+v+'" aria-pressed="'+((G.f.minUp||0)===v)+'">'+(v||"Any")+'</button>'; }).join("")+'</div></div>';
  h += '<div class="fg"><h4>Owner</h4>'+["You","Sara","Omar","nobody"].map(function(o){ return '<label class="fo"><input type="checkbox" data-tb-f="owner:'+o+'"'+(fval(G,"owner")[o]?' checked':'')+'><span>'+(o==="nobody"?"Nobody yet":o)+'</span><span class="mono muted">'+cnt("owner",function(c){ return (c.owner||"nobody")===o; })+'</span></label>'; }).join("")+'</div>';
  h += '<div class="fg"><h4>Search run</h4><select class="input" data-tb-frun><option value="all">All runs</option>'+st(ctx).search.runs.map(function(r){ return '<option value="'+r.id+'"'+(G.f.run===r.id?' selected':'')+'>'+esc(r.when)+' · '+r.kept+' kept</option>'; }).join("")+'</select></div>';
  return h;
}
function card(ctx, c){
  var G = st(ctx).gal, m = meta(c), sel = !!G.sel[c.id];
  return '<article class="gc'+(sel?' sel':'')+(c.stage==="rejected"?' dim':'')+'" data-tb-card="'+c.id+'" tabindex="0" aria-label="'+esc(c.name)+'">'+
    (G.images?'<div class="gb" style="background:'+grad(c.name+"b")+'"></div>':'')+
    '<div class="gh'+(G.images?'':' noimg')+'">'+(G.images?av(c,"lg"):'')+'<label class="gsel"><input type="checkbox" data-tb-sel="'+c.id+'"'+(sel?' checked':'')+' aria-label="Select '+esc(c.handle)+'"></label></div>'+
    '<div class="gt"><b>'+esc(c.name)+'</b><span class="muted">'+esc(c.handle)+' · '+P.fmtK(c.subs)+'</span></div>'+
    '<div class="gs"><span><b class="num">'+P.fmtK(c.median)+'</b> median</span><span><b class="num">'+c.up30+'</b> in 30 d</span><span>'+esc(c.top.split("·")[0].trim())+'</span></div>'+
    (G.sig?'<div class="row gsig">'+(c.gold?'<span class="tag good">Gold</span>':'')+(c.sponsors.length?'<span class="tag mag">'+esc(c.sponsors[0])+(c.sponsors.length>1?' +'+(c.sponsors.length-1):'')+'</span>':'')+(c.email?(c.confirmed?'<span class="tag good">Email ✓</span>':'<span class="tag warn">Email found</span>'):'<span class="tag">No email</span>')+(c.stage!=="new"?'<span class="tag pri">'+esc(P.CREATOR_STEPS[P.STAGE_STEP[c.stage]]||c.stage)+'</span>':'')+'</div>':'')+
    (G.latest?'<div class="gl2">'+(G.images?thumb(c):'')+'<span class="muted gm">'+esc(c.video)+'</span><span class="mono muted gm">'+m.ago+' d ago · '+P.fmtK(m.views)+' views</span></div>':'')+
    '<div class="ga">'+(c.stage==="new"||c.stage==="rejected"?'<button class="btn sm pri" type="button" data-tb-short="'+c.id+'">Shortlist</button><button class="btn sm" type="button" data-tb-rej="'+c.id+'">Reject</button>':'')+'<button class="btn sm ghost" type="button" data-tb-open="'+c.id+'">Open</button></div></article>';
}
function gallery(ctx, opts){
  opts = opts || {};
  var G = st(ctx).gal, list = results(ctx), sel = Object.keys(G.sel).filter(function(k){ return G.sel[k]; }), chips = activeChips(ctx);
  var h = (opts.title===false?'':'<div class="ph"><div class="col" style="gap:2px"><h2>'+esc(opts.title||"Creators")+'</h2><p>Scan by picture and latest upload, filter on the left, act on many at once.</p></div></div>')+
    '<div class="gtool"><input class="input" id="tb-q" data-tb-q value="'+esc(G.q)+'" placeholder="Filter by name, handle, video or sponsor" style="max-width:300px"><label class="row" style="gap:6px"><span class="hint">Sort</span><select class="input" data-tb-sort style="width:auto">'+Object.keys(SORTS).map(function(k){ return '<option value="'+k+'"'+(G.sort===k?' selected':'')+'>'+SORTS[k][0]+'</option>'; }).join("")+'</select></label>'+
    '<span class="seg" role="group" aria-label="View"><button type="button" data-tb-view="gallery" aria-pressed="'+(G.view==="gallery")+'">Gallery</button><button type="button" data-tb-view="table" aria-pressed="'+(G.view==="table")+'">Table</button></span>'+
    (G.view==="gallery"?'<span class="seg" role="group" aria-label="Card size">'+["s","m","l"].map(function(z){ return '<button type="button" data-tb-size="'+z+'" aria-pressed="'+(G.size===z)+'">'+z.toUpperCase()+'</button>'; }).join("")+'</span>':'')+
    '<button class="chip" type="button" data-tb-tog="images" aria-pressed="'+G.images+'">Pictures</button><button class="chip" type="button" data-tb-tog="latest" aria-pressed="'+G.latest+'">Latest upload</button><button class="chip" type="button" data-tb-tog="sig" aria-pressed="'+G.sig+'">Signals</button>'+
    '<span class="sp"></span><label class="row brush" style="gap:6px"><span class="hint">Quick-tag</span><select class="input" data-tb-brush style="width:auto"><option value="">Off</option>'+[["short","Shortlist"],["irrelevant","Reject: irrelevant"],["inactive","Reject: inactive"],["sara","Assign to Sara"]].map(function(b){ return '<option value="'+b[0]+'"'+(G.brush===b[0]?' selected':'')+'>'+b[1]+'</option>'; }).join("")+'</select></label>'+
    '<button class="btn sm" type="button" data-tb-facets aria-expanded="'+G.facetsOpen+'">'+(G.facetsOpen?'Hide filters':'Filters')+(chips.length?' ('+chips.length+')':'')+'</button></div>'+
    (G.brush?'<p class="brushnote">Quick-tag is on: clicking a card applies "'+esc({short:"Shortlist",irrelevant:"Reject: irrelevant",inactive:"Reject: inactive",sara:"Assign to Sara"}[G.brush])+'". Turn it off to open cards again.</p>':'')+
    (chips.length?'<div class="row">'+chips.join("")+'<button class="btn sm ghost" type="button" data-tb-clear>Clear all</button><button class="btn sm ghost" type="button" data-tb-saveview>Save this view</button>'+G.saved.map(function(sv,i){ return '<button class="chip" type="button" data-tb-loadview="'+i+'">'+esc(sv.name)+'</button>'; }).join("")+'</div>':(G.saved.length?'<div class="row"><span class="hint">Saved views:</span>'+G.saved.map(function(sv,i){ return '<button class="chip" type="button" data-tb-loadview="'+i+'">'+esc(sv.name)+'</button>'; }).join("")+'</div>':''))+
    '<div class="gwrap'+(G.facetsOpen?'':' nof')+'">'+(G.facetsOpen?'<aside class="facets" aria-label="Filters">'+facetBox(ctx)+'</aside>':'')+'<div class="gres"><p class="hint" style="margin-bottom:8px">'+list.length+' creator'+(list.length===1?'':'s')+(sel.length?' · '+sel.length+' selected · <button class="linkbtn" type="button" data-tb-selall="0">clear</button>':' · <button class="linkbtn" type="button" data-tb-selall="1">select all '+list.length+'</button>')+'</p>';
  if (!list.length) h += '<div class="card"><p>No creator matches these filters.</p><div class="row"><button class="btn" type="button" data-tb-clear>Clear filters</button></div></div>';
  else if (G.view==="gallery") h += '<div class="gal size-'+G.size+'">'+list.map(function(c){ return card(ctx,c); }).join("")+'</div>';
  else h += '<div class="tw"><table><thead><tr><th><span class="sr">Select</span></th>'+(G.images?'<th>Latest</th>':'')+'<th>Creator</th><th>Median</th><th>Uploads 30 d</th><th>Top country</th><th>Sponsors</th><th>Email</th><th>Step</th><th>Owner</th></tr></thead><tbody>'+list.map(function(c){ return '<tr data-tb-card="'+c.id+'" class="'+(G.sel[c.id]?'sel':'')+'"><td><input type="checkbox" data-tb-sel="'+c.id+'"'+(G.sel[c.id]?' checked':'')+' aria-label="Select '+esc(c.handle)+'"></td>'+(G.images?'<td style="width:110px">'+thumb(c,true)+'</td>':'')+'<td class="who"><b>'+esc(c.name)+(c.gold?' <span class="tag good">Gold</span>':'')+'</b><span>'+esc(c.handle)+'</span></td><td class="num">'+P.fmtK(c.median)+'</td><td class="num">'+c.up30+'</td><td>'+esc(c.top.split("·")[0])+'</td><td>'+esc(c.sponsors.join(", ")||"—")+'</td><td>'+(c.email?(c.confirmed?'<span class="tag good">confirmed</span>':'<span class="tag warn">found</span>'):'<span class="tag">none</span>')+'</td><td>'+esc(P.CREATOR_STEPS[P.STAGE_STEP[c.stage]]||c.stage)+'</td><td>'+esc(c.owner||"—")+'</td></tr>'; }).join("")+'</tbody></table></div>';
  h += '</div></div>';
  if (sel.length) h += '<div class="bulk" role="toolbar" aria-label="Bulk actions"><b>'+sel.length+' selected</b><button class="btn pri sm" type="button" data-tb-bulk="short">Shortlist</button><select class="btn sm" id="tb-rr" aria-label="Reject reason"><option>Irrelevant</option><option>Inactive</option><option>Low views</option><option>Out of scope</option><option>Haram content</option></select><button class="btn sm" type="button" data-tb-bulk="rej">Reject</button><button class="btn sm" type="button" data-tb-bulk="assign">Assign to Sara</button><button class="btn sm" type="button" data-tb-bulk="campaign">Add to a campaign</button><button class="btn sm" type="button" data-tb-bulk="clear">Clear</button></div>';
  return h;
}

/* ---------------- insights ---------------- */
var SHARE = {all:1, You:.38, Sara:.42, Omar:.2}, PER = {"7":.25, "30":1, "90":3};
function sc(ctx, n){ var I = st(ctx).ins; return Math.round(n*SHARE[I.owner]*PER[I.period]); }
function hbars(rows, unit){
  var max = Math.max.apply(null, rows.map(function(r){ return r[1]; })) || 1;
  return '<div class="hb">'+rows.map(function(r){ return '<div class="hr" data-tip="'+esc(r[0]+": "+r[1].toLocaleString("en-US")+(unit||"")+(r[2]?" · "+r[2]:""))+'"><span class="hl">'+esc(r[0])+'</span><span class="ht"><i style="width:'+Math.max(1.5, r[1]/max*100)+'%"></i></span><span class="hv num">'+r[1].toLocaleString("en-US")+(unit||"")+(r[2]?' <small>'+esc(r[2])+'</small>':'')+'</span></div>'; }).join("")+'</div>';
}
function numbers(id, ctx, head, rows){
  var open = !!st(ctx).ins.tables[id];
  return '<button class="linkbtn" type="button" data-tb-tbl="'+id+'" aria-expanded="'+open+'">'+(open?'Hide the numbers':'See the numbers')+'</button>'+(open?'<div class="tw"><table><thead><tr>'+head.map(function(x){ return '<th>'+esc(x)+'</th>'; }).join("")+'</tr></thead><tbody>'+rows.map(function(r){ return '<tr style="cursor:default">'+r.map(function(x){ return '<td>'+esc(x)+'</td>'; }).join("")+'</tr>'; }).join("")+'</tbody></table></div>':'');
}
function lineChart(ctx){
  var n = st(ctx).ins.period==="7" ? 7 : st(ctx).ins.period==="90" ? 90 : 30, pts = [];
  for (var i=0;i<n;i++){ var dow = (i+3)%7; var base = dow>=5 ? 6 : 28; pts.push(Math.round((base + (hash("e"+i)%9) - 4 + i*0.15) * SHARE[st(ctx).ins.owner])); }
  var W = 640, H = 190, L = 34, R = 10, T = 12, B = 26, max = Math.max(10, Math.ceil(Math.max.apply(null,pts)/10)*10);
  function x(i){ return L + (W-L-R)*(n===1?0:i/(n-1)); } function y(v){ return T + (H-T-B)*(1-v/max); }
  var line = pts.map(function(v,i){ return (i?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1); }).join(" ");
  var area = line+" L"+x(n-1).toFixed(1)+","+y(0)+" L"+x(0)+","+y(0)+" Z";
  var grid = [0, max/2, max].map(function(g){ return '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(g)+'" y2="'+y(g)+'" class="cg"/><text x="'+(L-6)+'" y="'+(y(g)+4)+'" class="ct" text-anchor="end">'+g+'</text>'; }).join("");
  var hits = pts.map(function(v,i){ var w = (W-L-R)/n; return '<rect x="'+(x(i)-w/2).toFixed(1)+'" y="'+T+'" width="'+w.toFixed(1)+'" height="'+(H-T-B)+'" fill="transparent" data-tip="'+(n-i-1===0?"Today":(n-i-1)+" days ago")+': '+v+' emails"/>'; }).join("");
  var lastX = x(n-1), lastY = y(pts[n-1]);
  return '<svg viewBox="0 0 '+W+' '+H+'" class="chart" role="img" aria-label="Emails sent per day over the last '+n+' days, latest '+pts[n-1]+'">'+grid+'<path d="'+area+'" class="ca"/><path d="'+line+'" class="cl"/><circle cx="'+lastX+'" cy="'+lastY+'" r="4.5" class="cd"/><text x="'+L+'" y="'+(H-6)+'" class="ct">'+n+' days ago</text><text x="'+(W-R)+'" y="'+(H-6)+'" class="ct" text-anchor="end">Today</text>'+hits+'</svg>';
}
function pipelineTab(ctx){
  var I = st(ctx).ins;
  var f1 = [["Channels found",sc(ctx,1820)],["Kept by your rules",sc(ctx,610)],["Shortlisted",sc(ctx,240)],["Emailed",sc(ctx,228)],["Replied",sc(ctx,34)],["Audience checked",sc(ctx,14)],["Signed",sc(ctx,6)]];
  var f2 = [["Brands found",sc(ctx,41)],["Qualified",sc(ctx,18)],["Pitched",sc(ctx,12)],["Negotiating",sc(ctx,5)],["Deals won",sc(ctx,4)],["Paid",sc(ctx,3)]];
  function rate(a,b){ return b ? Math.round(a/b*1000)/10 : 0; }
  var reply = rate(f1[4][1], f1[3][1]), per1000 = f1[3][1] ? Math.round(f1[6][1]/f1[3][1]*1000) : 0;
  var h = '<div class="row"><span class="hint">How outreach, deals and money are going. Example numbers.</span><span class="sp"></span>'+
    '<span class="seg" role="group" aria-label="Period">'+[["7","7 days"],["30","30 days"],["90","90 days"]].map(function(p){ return '<button type="button" data-tb-per="'+p[0]+'" aria-pressed="'+(I.period===p[0])+'">'+p[1]+'</button>'; }).join("")+'</span>'+
    '<span class="seg" role="group" aria-label="Person">'+["all","You","Sara","Omar"].map(function(o){ return '<button type="button" data-tb-own="'+o+'" aria-pressed="'+(I.owner===o)+'">'+(o==="all"?"Everyone":o)+'</button>'; }).join("")+'</span></div>';
  var tiles = [["Channels in the pool","2,373","104,341 archived"],["Emails sent",sc(ctx,228).toLocaleString("en-US"),"target "+sc(ctx,1050).toLocaleString("en-US")],["Reply rate",reply+"%","course: about 5%"],["Signed per 1,000 emails",String(per1000),"course: about 5"],["Revenue paid",P.money(sc(ctx,12600)),"margin "+P.money(sc(ctx,5100))],["Waiting to be paid",P.money(sc(ctx,7000)),"2 invoices, 1 due in 4 days"],["Owed to creators",P.money(sc(ctx,3300)),"pay once the brand has paid"]];
  h += '<div class="tiles">'+tiles.map(function(t){ return '<div class="tile"><span class="tl">'+esc(t[0])+'</span><b class="num">'+esc(t[1])+'</b><span class="ts">'+esc(t[2])+'</span></div>'; }).join("")+'</div>';
  h += '<div class="grid2"><div class="card"><h3>Creator funnel</h3><p class="hint">Each bar is a count in this period. Conversion from the step above is on the right.</p>'+hbars(f1.map(function(r,i){ return [r[0], r[1], i?rate(r[1],f1[i-1][1])+"%":""]; }))+numbers("f1",ctx,["Step","Count"],f1.map(function(r){ return [r[0], r[1].toLocaleString("en-US")]; }))+'</div>'+
    '<div class="card"><h3>Brand and deal funnel</h3><p class="hint">Brands move from found to paid; the course expects 1–2 creators pitched per brand.</p>'+hbars(f2.map(function(r,i){ return [r[0], r[1], i?rate(r[1],f2[i-1][1])+"%":""]; }))+numbers("f2",ctx,["Step","Count"],f2.map(function(r){ return [r[0], r[1].toLocaleString("en-US")]; }))+'</div></div>';
  h += '<div class="card"><div class="row"><h3>Emails sent per day</h3><span class="sp"></span><span class="hint">Weekends dip by design</span></div>'+lineChart(ctx)+'</div>';
  h += '<div class="grid2"><div class="card"><h3>Revenue paid by month</h3><div class="vb" role="img" aria-label="Revenue grew from nothing in May to $12,600 in October">'+[["May",0],["Jun",2200],["Jul",4800],["Aug",6100],["Sep",9400],["Oct",12600]].map(function(m){ var v = sc(ctx,m[1]); return '<div class="vc2" data-tip="'+m[0]+': '+P.money(v)+'"><span class="vv num">'+(v?P.fmtK(v):"0")+'</span><i style="height:'+(m[1]/12600*100)+'%"></i><span class="vl">'+m[0]+'</span></div>'; }).join("")+'</div></div>'+
    '<div class="card"><h3>Team this week</h3><div class="tw" style="border:0"><table><thead><tr><th>Person</th><th>Emails</th><th>Replies</th><th>Reply rate</th><th>First answer</th></tr></thead><tbody><tr style="cursor:default"><td><b>You</b></td><td class="num">58</td><td class="num">9</td><td class="num">16%</td><td>3 h</td></tr><tr style="cursor:default"><td><b>Sara</b></td><td class="num">71</td><td class="num">12</td><td class="num">17%</td><td>2 h</td></tr><tr style="cursor:default"><td><b>Omar (VA)</b></td><td class="num">40</td><td class="num">5</td><td class="num">13%</td><td>5 h</td></tr></tbody></table></div></div></div>';
  return h;
}

/* ---------------- channel analytics (the current app's analytics, rebuilt) ---------------- */
var POOLN = null;
var CTRY = ["US","US","US","US","GB","GB","IN","IN","CA","AU","DE","PH","BR","PK","NG","FR","US","GB","CA","US"];
var STG = [["new",55],["shortlisted",15],["emailed",12],["replied",6],["mediakit",3],["signed",4],["lost",5]];
var TAGS = ["Qualified","Undecided","Irrelevant","Inactive","Haram stuff"];
var MONTHS6 = ["May","Jun","Jul","Aug","Sep","Oct"];
var TIERS = [["<10K",0,1e4],["10–50K",1e4,5e4],["50–100K",5e4,1e5],["100–250K",1e5,2.5e5],["250K–1M",2.5e5,1e6],["1M+",1e6,1e12]];
var SER = {live:"Live", due:"Archive due", arch:"Archived"};
function pool(){
  if (POOLN) return POOLN; POOLN = [];
  for (var i=0;i<640;i++){
    var h = hash("p"+i), h2 = hash("q"+i), r = (h%1000)/1000;
    var subs = Math.round(Math.pow(10, 3.2 + r*3.4)), med = Math.round(subs*(0.04 + (h2%55)/100));
    var sr = h2%100, status = sr<70 ? "live" : sr<80 ? "due" : "arch";
    var acc = 0, stage = "new", pick = (h>>7)%100;
    for (var j=0;j<STG.length;j++){ acc += STG[j][1]; if (pick<acc){ stage = STG[j][0]; break; } }
    var tags = [], tt = (h>>11)%10;
    if (tt<3) tags.push("Qualified"); else if (tt<5) tags.push("Undecided");
    if (status!=="live" || tt===9) tags.push(["Irrelevant","Inactive","Haram stuff"][(h>>13)%3]);
    POOLN.push({subs:subs, med:(status==="live" && h%9===0) ? 0 : med, ctry:(h%23===0) ? "" : CTRY[(h>>3)%CTRY.length], stage:status==="live" ? stage : "new", tags:tags, status:status, month:MONTHS6[Math.min(5,(h2>>5)%7)], up:(h>>9)%12, deal:stage==="signed" && h%3===0, kw:(h2>>9)%24, name:"Channel "+(i+1)});
  }
  return POOLN;
}
function ast(ctx){ var I = st(ctx).ins; if (!I.f){ I.f = {ctry:"", stage:"", tag:"", minSubs:"", maxSubs:"", minMed:"", maxMed:"", minUp:""}; I.series = {live:true, due:true, arch:true}; I.tab = "channels"; I.kSort = "score"; I.kDir = -1; I.kQ = ""; I.kOpen = {}; } return I; }
function apass(f, c){
  if (f.ctry && c.ctry!==f.ctry) return false;
  if (f.stage && c.stage!==f.stage) return false;
  if (f.tag && (f.tag==="none" ? c.tags.length : c.tags.indexOf(f.tag)<0)) return false;
  if (f.minSubs!=="" && c.subs < +f.minSubs) return false;
  if (f.maxSubs!=="" && c.subs > +f.maxSubs) return false;
  if (f.minMed!=="" && c.med < +f.minMed) return false;
  if (f.maxMed!=="" && c.med > +f.maxMed) return false;
  if (f.minUp!=="" && c.up < +f.minUp) return false;
  return true;
}
function median(a){ if (!a.length) return 0; var b = a.slice().sort(function(x,y){ return x-y; }), m = Math.floor(b.length/2); return b.length%2 ? b[m] : Math.round((b[m-1]+b[m])/2); }
/* grouped bars: one scale, one bar per series per tier, a 2px gap between bars, legend above, tooltip per bar */
function grouped(label, rows, I, drillKey){
  var keys = ["live","due","arch"].filter(function(k){ return I.series[k]; });
  var max = 1; rows.forEach(function(r){ keys.forEach(function(k){ max = Math.max(max, r[1][k]); }); });
  return '<div class="gbars" role="img" aria-label="'+esc(label)+'">'+rows.map(function(r, ri){
    return '<div class="gcol"><div class="gstack">'+keys.map(function(k){ var v = r[1][k]; return '<button type="button" class="gbar s-'+k+'" style="height:'+(v ? Math.max(2, v/max*100) : 0)+'%" data-tip="'+esc(r[0]+" · "+SER[k]+": "+v)+'" data-tb-drill="'+drillKey+':'+ri+'" aria-label="'+esc(r[0]+", "+SER[k]+", "+v)+'"></button>'; }).join("")+'</div><span class="vl">'+esc(r[0])+'</span></div>';
  }).join("")+'</div>';
}
function legend(I){ return '<div class="legend3" role="group" aria-label="Series">'+["live","due","arch"].map(function(k){ return '<button type="button" class="chip" data-tb-series="'+k+'" aria-pressed="'+I.series[k]+'"><i class="sw s-'+k+'" aria-hidden="true"></i>'+SER[k]+'</button>'; }).join("")+'</div>'; }
function hbarsDrill(rows, key){
  var max = Math.max.apply(null, rows.map(function(r){ return r[1]; })) || 1;
  return '<div class="hb">'+rows.map(function(r){ return '<button type="button" class="hr" data-tip="'+esc(r[0]+": "+r[1]+" channels")+'" data-tb-drill="'+key+':'+esc(r[0])+'"><span class="hl">'+esc(r[0])+'</span><span class="ht"><i style="width:'+Math.max(1.5, r[1]/max*100)+'%"></i></span><span class="hv num">'+r[1]+'</span></button>'; }).join("")+'</div>';
}
function analyticsTab(ctx){
  var I = ast(ctx), f = I.f, all = pool().filter(function(c){ return apass(f,c); });
  var live = all.filter(function(c){ return c.status==="live"; }), due = all.filter(function(c){ return c.status==="due"; }), arch = all.filter(function(c){ return c.status==="arch"; });
  var subsLive = live.map(function(c){ return c.subs; }), meas = live.filter(function(c){ return c.med>0; });
  var mean = live.length ? Math.round(subsLive.reduce(function(a,b){ return a+b; },0)/live.length) : 0;
  function sel(key, label, opts){ return '<label class="field">'+label+'<select class="input" data-tb-af="'+key+'"><option value="">Any</option>'+opts.map(function(o){ return '<option value="'+esc(o[0])+'"'+(f[key]===o[0]?' selected':'')+'>'+esc(o[1])+'</option>'; }).join("")+'</select></label>'; }
  function num(key, label){ return '<label class="field">'+label+'<input class="input" inputmode="numeric" data-tb-af="'+key+'" value="'+esc(f[key])+'" placeholder="Any"></label>'; }
  var h = '<div class="afbar">'+sel("ctry","Country",["US","GB","IN","CA","AU","DE","PH","BR"].map(function(x){ return [x,x]; }))+sel("stage","Pipeline stage",STG.map(function(s){ return [s[0], s[0][0].toUpperCase()+s[0].slice(1)]; }))+sel("tag","Tag",TAGS.map(function(t){ return [t,t]; }).concat([["none","No tag"]]))+
    num("minSubs","Min subscribers")+num("maxSubs","Max subscribers")+num("minMed","Min median views (30 d)")+num("maxMed","Max median views (30 d)")+num("minUp","Min uploads last month")+'<button class="btn sm" type="button" data-tb-aclear style="align-self:end">Clear filters</button></div>'+
    '<p class="hint">Filters only change what is counted here; they never archive anything. Click any bar to open those channels in the gallery.</p>';
  if (!all.length) return h+'<div class="card"><p>No channel matches this filter.</p></div>';
  var tiles = [["Channels",live.length.toLocaleString("en-US"),"+"+arch.length+" archived · "+due.length+" archive due"],["Median subscribers",P.fmtK(median(subsLive)),"mean "+P.fmtK(mean)+", pulled up by a few big channels"],["Combined reach",P.fmtK(subsLive.reduce(function(a,b){ return a+b; },0)),"subscribers across live channels"],["Found this month",String(live.filter(function(c){ return c.month==="Oct"; }).length),"October"],["Uploads this month",live.reduce(function(a,c){ return a+c.up; },0).toLocaleString("en-US"),"across live channels"],["Median views (30 d)",P.fmtK(median(meas.map(function(c){ return c.med; }))),meas.length+" of "+live.length+" measured"],["Have had a deal",String(live.filter(function(c){ return c.deal; }).length),"live channels"]];
  h += '<div class="tiles">'+tiles.map(function(t){ return '<div class="tile"><span class="tl">'+esc(t[0])+'</span><b class="num">'+esc(t[1])+'</b><span class="ts">'+esc(t[2])+'</span></div>'; }).join("")+'</div>';
  function tierRows(field){ return TIERS.map(function(t){ var o = {}; [["live",live],["due",due],["arch",arch]].forEach(function(p){ o[p[0]] = p[1].filter(function(c){ return c[field]>=t[1] && c[field]<t[2]; }).length; }); return [t[0], o]; }); }
  var subsRows = tierRows("subs"), medRows = tierRows("med");
  h += '<div class="grid2"><div class="card"><div class="row"><h3>Subscriber distribution</h3><span class="sp"></span>'+legend(I)+'</div>'+grouped("Subscriber distribution by status", subsRows, I, "subs")+numbers("subs",ctx,["Subscribers","Live","Archive due","Archived"],subsRows.map(function(r){ return [r[0],r[1].live,r[1].due,r[1].arch]; }))+'</div>'+
    '<div class="card"><div class="row"><h3>Median views distribution</h3><span class="sp"></span>'+legend(I)+'</div>'+grouped("Median views distribution by status", medRows, I, "med")+'<p class="hint">'+meas.length+' of '+live.length+' live channels have a measured 30-day median; the rest count under 10K.</p>'+numbers("med",ctx,["Median views","Live","Archive due","Archived"],medRows.map(function(r){ return [r[0],r[1].live,r[1].due,r[1].arch]; }))+'</div></div>';
  var ct = {}; live.forEach(function(c){ var k = c.ctry||"Not recorded"; ct[k] = (ct[k]||0)+1; });
  var crow = Object.keys(ct).map(function(k){ return [k, ct[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0,12);
  var sg = STG.map(function(s){ return [s[0][0].toUpperCase()+s[0].slice(1), live.filter(function(c){ return c.stage===s[0]; }).length]; });
  var tg = TAGS.map(function(t){ return [t, live.filter(function(c){ return c.tags.indexOf(t)>=0; }).length]; }).concat([["No tag", live.filter(function(c){ return !c.tags.length; }).length]]);
  var fm = MONTHS6.map(function(m){ return [m, all.filter(function(c){ return c.month===m; }).length]; }), fmax = Math.max.apply(null, fm.map(function(x){ return x[1]; })) || 1;
  h += '<div class="grid3"><div class="card"><h3>Countries</h3>'+hbarsDrill(crow, "ctry")+'<p class="hint">Top 12 by channel count.</p></div><div class="card"><h3>Pipeline stage</h3>'+hbarsDrill(sg, "stage")+'</div><div class="card"><h3>Tags</h3>'+hbarsDrill(tg, "tag")+'<p class="hint">A channel with two tags counts under both.</p></div></div>';
  h += '<div class="card"><h3>Found per month</h3><div class="vb" role="img" aria-label="Channels found per month">'+fm.map(function(m){ return '<div class="vc2" data-tip="'+m[0]+': '+m[1]+' channels found"><span class="vv num">'+m[1]+'</span><i style="height:'+(m[1]/fmax*100)+'%"></i><span class="vl">'+m[0]+'</span></div>'; }).join("")+'</div></div>';
  return h;
}
/* ---------------- keyword evaluation ---------------- */
var KTIERS = [["Under 50K",0,5e4,1],["50K–250K",5e4,2.5e5,3],["250K–1M",2.5e5,1e6,6],["1M+",1e6,1e12,10]];
function keywordsTab(ctx){
  var I = ast(ctx), kws = st(ctx).search.kws, p = pool().filter(function(c){ return c.med>0; });
  var rows = kws.map(function(k, i){
    var ch = p.filter(function(c){ return c.kw===i%24; }), tiers = KTIERS.map(function(t){ return ch.filter(function(c){ return c.med>=t[1] && c.med<t[2]; }).length; });
    var score = ch.length ? Math.round(tiers.reduce(function(a,n,j){ return a+n*KTIERS[j][3]; },0)/ch.length*10)/10 : 0;
    return {k:k, i:i, ch:ch, n:ch.length, tiers:tiers, med:median(ch.map(function(c){ return c.med; })), score:score};
  }).filter(function(r){ return r.n && (!I.kQ || r.k.indexOf(I.kQ.toLowerCase())>=0); });
  var key = {score:"score", med:"med", n:"n"}[I.kSort];
  rows.sort(function(a,b){ return (a[key]-b[key])*I.kDir; });
  var h = '<div class="row"><input class="input" data-tb-kq id="tb-kq" value="'+esc(I.kQ)+'" placeholder="Filter keywords" style="max-width:260px"><label class="row" style="gap:6px"><span class="hint">Sort</span><select class="input" data-tb-ksort style="width:auto"><option value="score"'+(I.kSort==="score"?' selected':'')+'>Tier-weighted score</option><option value="med"'+(I.kSort==="med"?' selected':'')+'>Median views</option><option value="n"'+(I.kSort==="n"?' selected':'')+'>Channel count</option></select></label><button class="btn sm" type="button" data-tb-kdir>'+(I.kDir<0?'Highest first':'Lowest first')+'</button><span class="sp"></span><span class="hint">Showing '+rows.length+' of '+kws.length+'</span></div>'+
    '<div class="legend3">'+KTIERS.map(function(t,j){ return '<span class="chip" style="cursor:default"><i class="sw q'+(j+1)+'" aria-hidden="true"></i>'+t[0]+' median views</span>'; }).join("")+'</div>'+
    '<p class="hint">Each channel sits in a tier by its 30-day median views. The score weights the tiers 1, 3, 6 and 10, so keywords that bring watched channels rank first.</p><div class="kev"><div class="krow khead"><span>Keyword</span><span>Channels by tier</span><span>Channels</span><span>Median</span><span>Score</span><span></span></div>';
  rows.forEach(function(r){
    var open = !!I.kOpen[r.i];
    h += '<div class="kr"><div class="krow"><b class="kn">'+esc(r.k)+'</b><span class="kbar" role="img" aria-label="'+esc(r.tiers.map(function(n,j){ return KTIERS[j][0]+": "+n; }).join(", "))+'">'+r.tiers.map(function(n,j){ return n ? '<i class="q'+(j+1)+'" style="flex:'+n+'" data-tip="'+esc(KTIERS[j][0]+": "+n+" channels")+'"></i>' : ''; }).join("")+'</span><span class="num kx">'+r.n+'</span><span class="num kx">'+P.fmtK(r.med)+'</span><span class="num kx"><b>'+r.score+'</b></span><span class="row" style="gap:4px; flex-wrap:nowrap"><button class="btn sm ghost" type="button" data-tb-kopen="'+r.i+'" aria-expanded="'+open+'">'+(open?'Hide':'Channels')+'</button><button class="btn sm" type="button" data-tb-like="'+esc(r.k)+'">More like this</button></span></div>'+
      (open ? '<div class="kch">'+r.ch.slice().sort(function(a,b){ return b.med-a.med; }).slice(0,8).map(function(c){ return '<span class="tag">'+esc(c.name)+' · '+P.fmtK(c.med)+'</span>'; }).join("")+'<button class="btn sm" type="button" data-tb-drill="kw:'+r.i+'">Open in the gallery</button></div>' : '')+'</div>';
  });
  return h+'</div>';
}
function insights(ctx){
  var I = ast(ctx);
  var T = [["channels","Channel analytics"],["keywords","Keyword evaluation"],["pipeline","Pipeline and money"]];
  var h = '<div class="ph"><div class="col" style="gap:2px"><h2>Insights</h2><p>What the pipeline has found, which keywords bring watched channels, and how outreach and money are going. Example numbers.</p></div></div>'+
    '<div class="tabs">'+T.map(function(t){ return '<button type="button" data-tb-itab="'+t[0]+'" aria-current="'+(I.tab===t[0])+'">'+t[1]+'</button>'; }).join("")+'</div>';
  return h + (I.tab==="channels" ? analyticsTab(ctx) : I.tab==="keywords" ? keywordsTab(ctx) : pipelineTab(ctx));
}

/* ---------------- toolbox hub ---------------- */
var TOOLS = [
  ["calc","Price calculator","Median views × CPM → brand price, payout, margin"],["archive","Archive","Rejected channels, countdowns, bring one back"],["sends","Scheduled emails","Sends waiting for a time or a decision"],
  ["conflicts","Edit conflicts","Two people changed the same field"],["log","Activity log","Who did what, filterable"],["notes","Notifications","Every alert, with its link"],
  ["rules","Writing rules","House choices and rules the drafts follow"],["report","30-day report","Build and send a brand's report"],["facts","Agency facts","What drafts may claim, boycott list, targets"],["setup","Setup health","Gemini, Python, Gmail, AWS, sync, updates"]
];
var CPM = {tech:[30,50], finance:[40,80], education:[25,40], entertainment:[10,20]};
function toolBody(ctx, k){
  var T = st(ctx).tools, d = ctx.d;
  if (k==="calc"){ var c = T.calc, r = CPM[c.niche], lo = Math.round(c.views/1000*r[0]), hi = Math.round(c.views/1000*r[1]), mid = Math.round(c.views/1000*c.cpm), pay = Math.round(mid/(1+c.markup/100));
    return '<div class="g2"><label class="field">Median views (30 days)<input class="input" type="number" data-tb-calc="views" value="'+c.views+'"></label><label class="field">Niche<select class="input" data-tb-calc="niche">'+Object.keys(CPM).map(function(n){ return '<option'+(c.niche===n?' selected':'')+'>'+n+'</option>'; }).join("")+'</select></label><label class="field">CPM you will quote ($)<input class="input" type="number" data-tb-calc="cpm" value="'+c.cpm+'"></label><label class="field">Your markup over the creator (%)<input class="input" type="number" data-tb-calc="markup" value="'+c.markup+'"></label></div>'+
      '<div class="tiles"><div class="tile"><span class="tl">Market range</span><b class="num">'+P.money(lo)+'–'+P.money(hi)+'</b><span class="ts">'+esc(c.niche)+' CPM $'+r[0]+'–'+r[1]+'</span></div><div class="tile"><span class="tl">Brand pays</span><b class="num">'+P.money(mid)+'</b><span class="ts">at $'+c.cpm+' CPM</span></div><div class="tile"><span class="tl">Creator receives</span><b class="num">'+P.money(pay)+'</b><span class="ts">'+c.markup+'% markup</span></div><div class="tile"><span class="tl">Agency margin</span><b class="num">'+P.money(mid-pay)+'</b><span class="ts">per video</span></div></div><p class="hint">Instagram reels about half the YouTube CPM; TikTok about a third (INF-PRICE-04).</p>'; }
  if (k==="archive"){ var rej = d.creators.filter(function(c){ return c.stage==="rejected"; });
    return '<p class="hint">Rejected channels stay here for 7 days, then are archived for good. Bringing one back re-reads its videos.</p><div class="tw"><table><thead><tr><th>Channel</th><th>Reason</th><th>Archives in</th><th></th></tr></thead><tbody>'+rej.map(function(c){ return '<tr style="cursor:default"><td class="who"><b>'+esc(c.name)+'</b><span>'+esc(c.handle)+'</span></td><td>Irrelevant</td><td>7 days</td><td><button class="btn sm" type="button" data-tb-restore="'+c.id+'">Bring back</button></td></tr>'; }).join("")+'<tr style="cursor:default"><td class="who"><b>Prompt Spam TV</b><span>@promptspamtv</span></td><td>Low views</td><td>archived 3 Oct</td><td><button class="btn sm" type="button" data-tb-toast="Brought back and queued for a re-read (example).">Bring back</button></td></tr></tbody></table></div>'; }
  if (k==="sends") return '<ul class="checks"><li><span class="t">Follow-up 2 to @pixeldiffusion<small>Tomorrow 09:00 · from outreach1@gratovo.co</small></span><button class="btn sm" type="button" data-tb-toast="Sent now (example).">Send now</button><button class="btn sm ghost" type="button" data-tb-toast="Time changed (example).">Change time</button><button class="btn sm ghost" type="button" data-tb-toast="Cancelled (example).">Don\'t send</button></li><li><span class="t">Go-live email to Lumen AI<small>Waiting: the video is not live yet</small></span><button class="btn sm ghost" type="button" data-tb-toast="Opened (example).">Open</button></li></ul>';
  if (k==="conflicts") return '<div class="card" style="background:var(--surface-2)"><b>@agentworks · Rate</b><div class="g2"><div class="card"><span class="hint">Yours, 10:42</span><b>$1,700 · agreed</b><button class="btn sm pri" type="button" data-tb-toast="Kept yours (example).">Keep mine</button></div><div class="card"><span class="hint">Omar, 10:44</span><b>$1,850 · not agreed</b><button class="btn sm" type="button" data-tb-toast="Took Omar\'s (example).">Take theirs</button></div></div></div>';
  if (k==="log") return '<div class="row"><span class="chip" aria-pressed="true">Everyone</span><span class="chip">Emails</span><span class="chip">Deals</span><span class="chip">Creators</span></div><ul class="checks">'+[["Sara","sent a first email to @pixeldiffusion","14 Oct 10:12"],["You","moved Codewell × @codewithkai to Contracts","18 Oct 16:40"],["Omar","confirmed autoflowdaily@gmail.com","19 Oct 09:05"],["You","shortlisted 4 channels from today's search","19 Oct 08:52"]].map(function(a){ return '<li><span class="t"><b>'+a[0]+'</b> '+esc(a[1])+'<small>'+a[2]+'</small></span></li>'; }).join("")+'</ul>';
  if (k==="notes") return '<ul class="checks">'+[["@buildwithllms replied","Answer it",""],["Invoice to VoxCraft due in 28 days","Open deal",""],["Search finished: 24 kept","Review",""],["outreach2 is still warming up (day 9 of 14)","Mailbox",""]].map(function(n){ return '<li><span class="t">'+esc(n[0])+'<small>Today</small></span><button class="btn sm" type="button" data-tb-toast="Opened (example).">'+esc(n[1])+'</button></li>'; }).join("")+'</ul>';
  if (k==="rules") return '<ul class="checks">'+[["HC-20","A cold email ends on one yes-or-no question"],["HC-17","Three follow-ups, then stop"],["HC-02","About 50 sends a day per mailbox, 35 of them outreach"],["HC-14","A brand pitch names the creator with one key fact"],["HC-08","Female and couple creators are out of scope"]].map(function(r){ return '<li><span class="t"><span class="mono muted">'+r[0]+'</span> '+esc(r[1])+'</span><button class="btn sm ghost" type="button" data-tb-toast="Choice editor (example).">Change</button></li>'; }).join("")+'</ul>';
  if (k==="report") return '<div class="g2"><div class="card"><h3>Pagewise × @theaidesk</h3><dl class="kv"><dt>Views at 30 days</dt><dd class="num">94,200</dd><dt>Tracking clicks</dt><dd class="num">1,310</dd><dt>Effective CPM</dt><dd class="num">$23</dd><dt>Click rate</dt><dd class="num">1.4%</dd></dl></div><div class="card"><h3>Send it</h3><p class="hint">A short email with the numbers and a link to the report page, to Hana Kim.</p><div class="row"><button class="btn pri" type="button" data-tb-toast="Report email drafted to Hana (example).">Draft the email</button><button class="btn" type="button" data-tb-toast="Copied (example).">Copy numbers</button></div></div></div>';
  if (k==="facts") return '<div class="g2"><label class="field">Sender name<input class="input" value="Moustafa, Gratovo"></label><label class="field">Emails a day (team target)<input class="input" value="35"></label><label class="field">True claims drafts may use<textarea class="input">We work with AI education creators.\nWe have run integrations for AI writing and coding tools.</textarea></label><label class="field">Boycott list<textarea class="input">(none)</textarea></label></div>';
  if (k==="setup") return '<ul class="checks">'+[["Gemini bridge","2 accounts · 3 tabs each · thinking: high","good"],["Python pipeline","Ready · yt-dlp up to date","good"],["Gmail","2 mailboxes · outreach2 renews in 5 days","warn"],["AWS gateway","Rotating IPs · 0 blocks today","good"],["Team sync","Up to date · 19 Oct 09:41","good"],["App update","1.9.0 is ready","warn"]].map(function(s){ return '<li><span class="tag '+s[2]+'">'+(s[2]==="good"?"OK":"Check")+'</span><span class="t">'+esc(s[0])+'<small>'+esc(s[1])+'</small></span>'+(s[2]==="warn"?'<button class="btn sm" type="button" data-tb-toast="Fixing (example).">Fix</button>':'')+'</li>'; }).join("")+'</ul>';
  return "";
}
function tools(ctx){
  var T = st(ctx).tools;
  return '<div class="ph"><div class="col" style="gap:2px"><h2>Toolbox</h2><p>Everything that is not a daily step but you need on hand.</p></div></div><div class="ttiles">'+TOOLS.map(function(t){ return '<button class="tt" type="button" data-tb-tool="'+t[0]+'" aria-pressed="'+(T.open===t[0])+'"><b>'+esc(t[1])+'</b><span>'+esc(t[2])+'</span></button>'; }).join("")+'</div>'+
    (T.open ? '<div class="card"><div class="row"><h3>'+esc(TOOLS.filter(function(t){ return t[0]===T.open; })[0][1])+'</h3><span class="sp"></span><button class="btn sm ghost" type="button" data-tb-tool="'+T.open+'">Close</button></div>'+toolBody(ctx, T.open)+'</div>' : '<p class="hint">Pick a tool.</p>');
}

/* ---------------- events ---------------- */
function ctxNow(){ return CTX[P.current]; }
function applyBrush(ctx, v, id){
  var G = st(ctx).gal, c = P.creator(ctx.d, id);
  if (G.brush==="short") P.shortlist(v, ctx.d, [id]); else if (G.brush==="sara") c.owner = "Sara"; else P.reject(v, ctx.d, [id]);
  P.toast(c.handle+": "+({short:"shortlisted",irrelevant:"rejected (irrelevant)",inactive:"rejected (inactive)",sara:"assigned to Sara"}[G.brush])+".", "Undo", function(){ c.stage = "new"; ctx.render(); });
}
document.addEventListener("click", function(e){
  var ctx = ctxNow(); if (!ctx) return; var v = P.current, t = e.target, el, S = st(ctx).search, G = st(ctx).gal;
  function a(sel){ return (el = t.closest(sel)); }
  if (a("[data-tb-start]")){ start(ctx, v); return; }
  if (a("[data-tb-stop]")){ S.running = false; clearInterval(S.timer); S.log.push(now()+"  Stopped after keyword "+S.done+" · everything found is saved"); S.runs.unshift({id:S.runId, when:"Today "+now().slice(0,5), kws:S.batch, found:S.found, kept:S.kept, gold:Math.round(S.kept*0.4), by:"You"}); ctx.render(); return; }
  if (a("[data-tb-review]")){ P.tourDone(v,"finds"); ctx.showFinds({run:el.getAttribute("data-tb-review")}); return; }
  if (a("[data-tb-gen]")){ S.genOpen = !S.genOpen; ctx.render(); return; }
  if (a("[data-tb-gogen]")){ var topic = (document.getElementById("tb-gt")||{}).value||"ai tools"; S.gen = ["best "+topic+" 2026",topic+" honest review",topic+" vs chatgpt","i tried "+topic+" for 30 days",topic+" tutorial for beginners","cheap "+topic,topic+" mistakes","how i use "+topic+" daily"]; S.genPick = {}; ctx.render(); return; }
  if (a("[data-tb-gpick]")){ S.genPick[el.getAttribute("data-tb-gpick")] = el.checked; return; }
  if (a("[data-tb-addgen]")){ var add = S.gen.filter(function(g,i){ return S.genPick[i]!==false; }); S.kws = S.kws.concat(add); S.gen = []; S.genOpen = false; ctx.render(); P.toast(add.length+" keywords added to the end of the list."); return; }
  if (a("[data-tb-add]")){ var ta = document.getElementById("tb-add"), lines = (ta.value||"").split("\n").map(function(x){ return x.trim(); }).filter(Boolean); S.kws = S.kws.concat(lines); ctx.render(); if (lines.length) P.toast(lines.length+" keywords added."); return; }
  if (a("[data-tb-rmkw]")){ var ri = +el.getAttribute("data-tb-rmkw"); S.kws.splice(ri,1); if (ri<S.done) S.done--; ctx.render(); return; }
  if (a("[data-tb-startat]")){ S.done = +el.getAttribute("data-tb-startat"); ctx.render(); P.toast("The next run starts at keyword "+(S.done+1)+"."); return; }
  if (a("[data-tb-redo]")){ var k = S.kws[+el.getAttribute("data-tb-redo")]; S.kws.push(k); ctx.render(); P.toast("\""+k+"\" queued again at the end."); return; }
  if (a("[data-tb-rules]")){ S.rulesOpen = !S.rulesOpen; ctx.render(); return; }
  if (a("[data-tb-country]")){ var cc = el.getAttribute("data-tb-country"); S.rules.countries[cc] = !S.rules.countries[cc]; ctx.render(); return; }
  if (a("[data-tb-house]")){ S.rules.viewsMin = "45000"; S.rules.subsMin = ""; S.rules.subsMax = ""; S.rules.upMin = "3"; ctx.render(); return; }
  if (a("[data-tb-ltab]")){ S.tab = el.getAttribute("data-tb-ltab"); paintLive(ctx); return; }
  if (a("[data-tb-send]")){ P.toast("Your unfinished keywords were sent to "+el.getAttribute("data-tb-send")+" (example)."); return; }
  if (a("[data-tb-toast]")){ P.toast(el.getAttribute("data-tb-toast")); return; }
  /* gallery */
  if (a("[data-tb-sel]")){ G.sel[el.getAttribute("data-tb-sel")] = el.checked; ctx.render(); return; }
  if (a("[data-tb-selall]")){ if (el.getAttribute("data-tb-selall")==="1") results(ctx).forEach(function(c){ G.sel[c.id] = true; }); else G.sel = {}; ctx.render(); return; }
  if (a("[data-tb-short]")){ P.shortlist(v, ctx.d, [el.getAttribute("data-tb-short")]); P.toast(P.creator(ctx.d,el.getAttribute("data-tb-short")).handle+" shortlisted."); ctx.render(); return; }
  if (a("[data-tb-rej]")){ var rc = P.creator(ctx.d,el.getAttribute("data-tb-rej")); P.reject(v, ctx.d, [rc.id]); P.toast(rc.handle+" rejected. Archived in 7 days.", "Undo", function(){ rc.stage = "new"; ctx.render(); }); ctx.render(); return; }
  if (a("[data-tb-open]")){ ctx.openCreator(el.getAttribute("data-tb-open")); return; }
  if (a("[data-tb-view]")){ G.view = el.getAttribute("data-tb-view"); ctx.render(); return; }
  if (a("[data-tb-size]")){ G.size = el.getAttribute("data-tb-size"); ctx.render(); return; }
  if (a("[data-tb-tog]")){ var tk = el.getAttribute("data-tb-tog"); G[tk] = !G[tk]; ctx.render(); return; }
  if (a("[data-tb-facets]")){ G.facetsOpen = !G.facetsOpen; ctx.render(); return; }
  if (a("[data-tb-fc]")){ G.f.country = G.f.country||{}; var fc = el.getAttribute("data-tb-fc"); G.f.country[fc] = !G.f.country[fc]; ctx.render(); return; }
  if (a("[data-tb-fv]")){ G.f.minViews = +el.getAttribute("data-tb-fv"); ctx.render(); return; }
  if (a("[data-tb-fu]")){ G.f.minUp = +el.getAttribute("data-tb-fu"); ctx.render(); return; }
  if (a("[data-tb-unf]")){ var u = el.getAttribute("data-tb-unf").split(":"); if (u.length===2) G.f[u[0]][u[1]] = false; else G.f[u[0]] = u[0]==="run" ? "all" : 0; ctx.render(); return; }
  if (a("[data-tb-clear]")){ G.f = {}; G.q = ""; ctx.render(); return; }
  if (a("[data-tb-saveview]")){ G.saved.push({name:"My view "+(G.saved.length+1), f:JSON.parse(JSON.stringify(G.f)), q:G.q}); ctx.render(); P.toast("View saved. It sits next to the filters."); return; }
  if (a("[data-tb-loadview]")){ var sv = G.saved[+el.getAttribute("data-tb-loadview")]; G.f = JSON.parse(JSON.stringify(sv.f)); G.q = sv.q; ctx.render(); return; }
  if (a("[data-tb-bulk]")){
    var ids = Object.keys(G.sel).filter(function(k){ return G.sel[k]; }), b = el.getAttribute("data-tb-bulk");
    if (b==="short"){ P.shortlist(v, ctx.d, ids); P.toast(ids.length+" shortlisted."); }
    if (b==="rej"){ P.reject(v, ctx.d, ids); P.toast(ids.length+" rejected as "+((document.getElementById("tb-rr")||{}).value||"Irrelevant")+".", "Undo", function(){ ids.forEach(function(id){ P.creator(ctx.d,id).stage = "new"; }); ctx.render(); }); }
    if (b==="assign"){ ids.forEach(function(id){ P.creator(ctx.d,id).owner = "Sara"; }); P.toast(ids.length+" assigned to Sara."); }
    if (b==="campaign") P.toast(ids.length+" added to \"Codewell · Q4 push\" (example).");
    G.sel = {}; ctx.render(); return;
  }
  if (a("[data-tb-card]") && !t.closest("button,input,label,select,a")){ var id = el.getAttribute("data-tb-card"); if (G.brush){ applyBrush(ctx, v, id); ctx.render(); } else ctx.openCreator(id); return; }
  /* insights */
  if (a("[data-tb-per]")){ st(ctx).ins.period = el.getAttribute("data-tb-per"); ctx.render(); return; }
  if (a("[data-tb-own]")){ st(ctx).ins.owner = el.getAttribute("data-tb-own"); ctx.render(); return; }
  if (a("[data-tb-tbl]")){ var tid = el.getAttribute("data-tb-tbl"); st(ctx).ins.tables[tid] = !st(ctx).ins.tables[tid]; ctx.render(); return; }
  if (a("[data-tb-itab]")){ ast(ctx).tab = el.getAttribute("data-tb-itab"); ctx.render(); return; }
  if (a("[data-tb-series]")){ var I2 = ast(ctx), sk = el.getAttribute("data-tb-series"), on = Object.keys(I2.series).filter(function(k){ return I2.series[k]; }); if (on.length===1 && I2.series[sk]) { P.toast("At least one series stays on."); return; } I2.series[sk] = !I2.series[sk]; ctx.render(); return; }
  if (a("[data-tb-aclear]")){ var I3 = ast(ctx); Object.keys(I3.f).forEach(function(k){ I3.f[k] = ""; }); ctx.render(); return; }
  if (a("[data-tb-kdir]")){ ast(ctx).kDir *= -1; ctx.render(); return; }
  if (a("[data-tb-kopen]")){ var ko = ast(ctx).kOpen, ki = el.getAttribute("data-tb-kopen"); ko[ki] = !ko[ki]; ctx.render(); return; }
  if (a("[data-tb-drill]")){
    var dp = el.getAttribute("data-tb-drill").split(":"), kind = dp[0], val = dp.slice(1).join(":"), flt = {};
    if (kind==="med") flt.minViews = TIERS[+val][1];
    if (kind==="subs") flt.sort = "subs";
    if (kind==="ctry" && COUNTRIES.indexOf(val)>=0) flt.country = val;
    if (kind==="stage") flt.stage = val.toLowerCase()==="lost" ? "rejected" : val.toLowerCase();
    if (kind==="tag" && /Irrelevant|Inactive|Haram/.test(val)) flt.stage = "rejected";
    P.toast("In the real app this opens exactly those channels. Here the gallery's small sample is filtered the nearest way.");
    ctx.showFinds(flt); return;
  }
  if (a("[data-tb-like]")){ var base = el.getAttribute("data-tb-like"); S.kws = S.kws.concat([base+" 2026", base+" review", "best "+base]); P.toast("3 similar keywords added to Search."); return; }
  /* tools */
  if (a("[data-tb-tool]")){ var T = st(ctx).tools, tk2 = el.getAttribute("data-tb-tool"); T.open = T.open===tk2 ? null : tk2; ctx.render(); if (tk2==="setup") P.tourDone(v,"team"); return; }
  if (a("[data-tb-restore]")){ var rc2 = P.creator(ctx.d, el.getAttribute("data-tb-restore")); rc2.stage = "new"; ctx.render(); P.toast(rc2.handle+" brought back. It is in New finds again."); return; }
});
document.addEventListener("change", function(e){
  var ctx = ctxNow(); if (!ctx) return; var t = e.target, S = st(ctx).search, G = st(ctx).gal;
  if (t.matches("[data-tb-rule]")){ S.rules[t.getAttribute("data-tb-rule")] = t.value; ctx.render(); }
  else if (t.matches("[data-tb-route]")){ S.route = t.value; }
  else if (t.matches("[data-tb-sort]")){ G.sort = t.value; ctx.render(); }
  else if (t.matches("[data-tb-brush]")){ G.brush = t.value || null; ctx.render(); }
  else if (t.matches("[data-tb-f]")){ var p = t.getAttribute("data-tb-f").split(":"); G.f[p[0]] = G.f[p[0]] || {}; G.f[p[0]][p[1]] = t.checked; ctx.render(); }
  else if (t.matches("[data-tb-frun]")){ G.f.run = t.value; ctx.render(); }
  else if (t.matches("[data-tb-af]")){ ast(ctx).f[t.getAttribute("data-tb-af")] = t.value.replace(/[^0-9A-Za-z ]/g,""); ctx.render(); }
  else if (t.matches("[data-tb-ksort]")){ ast(ctx).kSort = t.value; ctx.render(); }
  else if (t.matches("[data-tb-calc]")){ var c = st(ctx).tools.calc, k = t.getAttribute("data-tb-calc"); c[k] = k==="niche" ? t.value : +t.value || 0; if (k==="niche"){ var r = CPM[c.niche]; c.cpm = Math.round((r[0]+r[1])/2); } ctx.render(); }
});
var qTimer = null;
document.addEventListener("input", function(e){
  var ctx = ctxNow(); if (!ctx) return;
  var isG = e.target.matches("[data-tb-q]"), isK = e.target.matches("[data-tb-kq]"); if (!isG && !isK) return;
  if (isG) st(ctx).gal.q = e.target.value; else ast(ctx).kQ = e.target.value;
  var fid = isG ? "tb-q" : "tb-kq"; clearTimeout(qTimer);
  qTimer = setTimeout(function(){ var pos = e.target.selectionStart; ctx.render(); var q = document.getElementById(fid); if (q){ q.focus(); try { q.setSelectionRange(pos,pos); } catch(err){} } }, 160);
});
/* tooltip for charts */
var tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener("mouseover", function(e){ var el = e.target.closest && e.target.closest("[data-tip]"); if (!el){ tip.hidden = true; return; } tip.textContent = el.getAttribute("data-tip"); tip.hidden = false; });
document.addEventListener("mousemove", function(e){ if (tip.hidden) return; var x = Math.min(e.clientX+14, window.innerWidth-tip.offsetWidth-8); tip.style.left = x+"px"; tip.style.top = (e.clientY+16)+"px"; });

P.TB = {
  bind:function(v, ctx){ CTX[v] = ctx; st(ctx); },
  setFilter:function(ctx, f){ var G = st(ctx).gal; G.f = {}; G.q = ""; G.sel = {}; f = f || {};
    if (f.run) G.f.run = f.run; if (f.stage){ G.f.stage = {}; G.f.stage[f.stage] = true; } if (f.country){ G.f.country = {}; G.f.country[f.country] = true; }
    if (f.minViews) G.f.minViews = f.minViews; if (f.sort) G.sort = f.sort; },
  searchConsole:searchConsole, gallery:gallery, insights:insights, tools:tools, thumb:thumb, av:av, meta:meta,
  running:function(ctx){ return st(ctx).search.running; }
};
})();
