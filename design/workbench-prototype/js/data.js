/* data.js — example data for Monday 19 October 2026, 10:24. AI-niche creators and AI-tool brands, all invented.
   Shapes here are the contract every screen reads (see .router/PLAN.md). */
(function(){
"use strict";
var W = window.W, at = W.at, DAY = W.DAY;

/* The deal journey. Money is tracked beside the steps (deal.invoice), and "Pay creator" stays locked until the brand has paid. */
W.DEAL_FLOW = [
  {k:"negotiate", name:"Negotiate", items:["Price the brand pays agreed","Creator's payout agreed","Payment terms set (Net 30)","Exclusivity and usage rights written down"]},
  {k:"contracts", name:"Contracts", items:["Brand's contract received","Mirrored for the creator","Creator signed","Agency signed with the brand"], ordered:true, note:"Runs in order: the creator signs before the agency signs with the brand."},
  {k:"brief", name:"Brief", items:["Brief sent to the creator","Creator confirmed the date"]},
  {k:"draft", name:"Draft review", items:["Draft received","Checked against the brief","Brand approved the draft"]},
  {k:"prelive", name:"Pre-live checks", items:["Tracking link opens the right page","Placement matches the brief","Promo code works"]},
  {k:"golive", name:"Go-live", items:["Video is live, link saved","Go-live email sent to the brand"]},
  {k:"invoice", name:"Invoice", items:["Invoice sent on go-live day (Net 30)"]},
  {k:"report", name:"30-day report", items:["Views and clicks read","Report sent to the brand"]},
  {k:"pay", name:"Pay creator", items:["Creator paid"], lockedUntilPaid:true},
  {k:"next", name:"Next deal", items:["Next creator pitched to this brand"]}
];
W.CREATOR_STEPS = [
  {k:"new", name:"Found"},{k:"shortlisted", name:"Qualified"},{k:"contact", name:"Contact"},{k:"emailed", name:"Emailed"},
  {k:"replied", name:"Replied"},{k:"kit", name:"Media kit"},{k:"audience", name:"Audience"},{k:"signed", name:"Signed"}
];
W.STAGE_INDEX = {new:0, shortlisted:1, contact:2, emailed:3, replied:4, kit:5, audience:6, signed:7, rejected:0, parked:4, never:0};
W.STAGE_LABEL = {new:"New find", shortlisted:"Needs contact", contact:"Contact confirmed", emailed:"In sequence", replied:"Replied", kit:"Media kit in", audience:"Audience checked", signed:"Signed", rejected:"Rejected", parked:"Parked", never:"Never contact"};
W.BRAND_STEPS = [{k:"found", name:"Found"},{k:"qualified", name:"Qualified"},{k:"pitched", name:"Pitched"},{k:"negotiating", name:"Negotiating"},{k:"won", name:"Won"}];
W.REJECT_REASONS = ["Not relevant to AI tools","Too few views","Not posting enough","Audience outside US/UK/CA/AU"];
W.COUNTRY = {US:"United States", GB:"United Kingdom", CA:"Canada", AU:"Australia", IN:"India", PK:"Pakistan", DE:"Germany", BR:"Brazil", PH:"Philippines", NG:"Nigeria", FR:"France", ES:"Spain"};

function V(t, views, ago, dur){ return {t:t, v:views, ago:ago, dur:dur}; }
function C(id, name, handle, subs, median, up30, o){
  return Object.assign({id:id, name:name, handle:handle, subs:subs, median:median, up30:up30, lastUp:2, videos:[], sponsors:[], email:null, emailSrc:null, emailConf:0, confirmed:false, contact:"",
    cands:[], countries:[], age:"", eng:0, stage:"new", owner:null, rate:0, moment:"", run:null, found:at(-1, 8), tags:[], notes:[], seq:null, kit:null, reject:null, before:null, pay:null}, o);
}

var creators = [
  /* ---- signed ---- */
  C("c1","Prompt Lab","@promptlab",182000,64000,6,{stage:"signed", owner:"u1", rate:1800, email:"hello@promptlab.tv", emailSrc:"About page", emailConf:.97, confirmed:true, contact:"Maya", countries:[["US",41],["GB",12],["CA",7]], age:"18–34", eng:5.1, sponsors:["VoxCraft","Pagewise"], pay:"PayPal · maya@promptlab.tv", found:at(-74), moment:"7:40 \"it booked 11 meetings without asking me once\"",
    videos:[V("I let 5 AI agents run my week",71000,3,"14:32"),V("The AI calendar that finally works",58000,9,"11:05"),V("Building a CRM in one hour, live",49000,15,"58:12")]}),
  C("c2","Neural Notes","@neuralnotes",96000,52000,4,{stage:"signed", owner:"u2", rate:1200, email:"team@neuralnotes.io", emailSrc:"Video description", emailConf:.94, confirmed:true, contact:"Theo", countries:[["US",36],["GB",14],["AU",6]], age:"18–34", eng:6.3, sponsors:["Lumen AI"], pay:"Wise · theo@neuralnotes.io", found:at(-61),
    videos:[V("Notion vs Obsidian with AI, 30 days later",61000,5,"16:40"),V("My second brain runs on 3 prompts",44000,12,"9:58"),V("AI summaries saved me 4 hours a week",52000,20,"12:05")]}),
  C("c3","Code with Kai","@codewithkai",240000,88000,5,{stage:"signed", owner:"u1", rate:2400, email:"kai@codewithkai.dev", emailSrc:"Website", emailConf:.98, confirmed:true, contact:"Kai", countries:[["US",44],["IN",13],["GB",8]], age:"18–34", eng:4.4, sponsors:["Codewell"], pay:"Bank transfer · US", found:at(-90),
    videos:[V("I built a SaaS in a weekend with Cursor",96000,4,"21:17"),V("Claude Code vs Copilot: one real project",83000,11,"18:44"),V("41 minutes to a working login page",77000,19,"13:02")]}),
  C("c4","Tensor Talk","@tensortalk",310000,120000,3,{stage:"signed", owner:"u1", rate:3100, email:"biz@tensortalk.com", emailSrc:"About page", emailConf:.99, confirmed:true, contact:"Lena", countries:[["US",39],["GB",10],["CA",8]], age:"25–44", eng:3.8, sponsors:["Clipforge","VoxCraft"], pay:"Bank transfer · DE", found:at(-120),
    videos:[V("Every AI video tool, ranked",146000,6,"24:51"),V("This one cut my edit time in half",112000,14,"15:30"),V("The open-source model nobody talks about",98000,25,"19:12")]}),
  C("c5","The AI Desk","@theaidesk",150000,58000,8,{stage:"signed", owner:"u2", rate:1500, email:"desk@theaidesk.news", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ruth", countries:[["US",33],["GB",15],["AU",9]], age:"25–44", eng:4.9, sponsors:["Pagewise","Lumen AI"], pay:"PayPal · ruth@theaidesk.news", found:at(-80),
    videos:[V("This week in AI: 9 launches that matter",64000,2,"17:08"),V("The only launch I would actually pay for",59000,9,"12:44"),V("AI news, minus the hype",55000,16,"15:01")]}),
  C("c17","Agent Arena","@agentarena",140000,61000,4,{stage:"signed", owner:"u1", rate:1900, email:"hi@agentarena.gg", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Jonas", countries:[["US",37],["GB",12],["CA",9]], age:"18–34", eng:5.4, sponsors:[], pay:"Wise · jonas@agentarena.gg", found:at(-40),
    videos:[V("5 agents race to build an app",88000,5,"22:10"),V("Which coding agent actually ships?",61000,13,"18:31"),V("I made agents argue about my startup",57000,21,"14:22")]}),

  /* ---- media kit in ---- */
  C("c7","AgentWorks","@agentworks",128000,67000,5,{stage:"kit", owner:"u1", rate:1700, email:"partnerships@agentworks.ai", emailSrc:"About page", emailConf:.97, confirmed:true, contact:"Dev", countries:[["US",38],["GB",11],["CA",9]], age:"18–34", eng:4.7, sponsors:["Codewell"], found:at(-30),
    kit:{at:at(-3,16,20), rate:1700, countries:[["US",38],["GB",11],["CA",9]], age:"18–34", eng:4.7, file:"AgentWorks media kit 2026.pdf"},
    videos:[V("I gave an agent my inbox for a week",79000,4,"13:48"),V("It unsubscribed me from 212 newsletters",64000,10,"9:02"),V("Agents that actually save time",58000,18,"16:15")]}),
  C("c18","Silicon Sage","@siliconsage",88000,39000,6,{stage:"kit", owner:"u1", rate:700, email:"sage@siliconsage.in", emailSrc:"Video description", emailConf:.9, confirmed:true, contact:"Arjun", countries:[["IN",31],["US",22],["PK",9]], age:"18–24", eng:3.4, found:at(-26),
    kit:{at:at(-2,11,5), rate:700, countries:[["IN",31],["US",22],["PK",9]], age:"18–24", eng:3.4, file:"Silicon Sage rate card.png"},
    videos:[V("The AI tools I actually pay for",42000,3,"12:30"),V("Free AI tools that beat paid ones",39000,10,"10:12"),V("My AI setup as a student",35000,17,"8:44")]}),

  /* ---- replied ---- */
  C("c6","Build with LLMs","@buildwithllms",74000,41000,7,{stage:"replied", owner:"u1", email:"contact@buildwithllms.dev", emailSrc:"Website", emailConf:.93, confirmed:true, contact:"Sam", countries:[["US",29],["IN",21],["DE",7]], age:"18–34", eng:5.6, found:at(-14), moment:"5:48 \"most RAG demos skip this step\"",
    seq:{steps:[{k:"first", at:at(-10,9,40), st:"sent"}], stopped:"replied"},
    videos:[V("RAG explained with one whiteboard",52000,6,"11:20"),V("Fine-tuning is not what you need",41000,12,"14:05"),V("My LLM app costs $3 a month",38000,19,"10:48")]}),
  C("c19","Latent Lounge","@latentlounge",112000,48000,5,{stage:"replied", owner:"u1", email:"collab@latentlounge.ai", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Mia", countries:[["US",40],["GB",13],["CA",6]], age:"25–34", eng:4.2, found:at(-15),
    seq:{steps:[{k:"first", at:at(-9,10,5), st:"sent"}], stopped:"replied"},
    videos:[V("Fine-tuning a 7B model on my laptop",57000,7,"19:40"),V("Local LLMs, one year in",46000,15,"16:02"),V("Why I stopped paying for ChatGPT",51000,23,"12:31")]}),
  C("c20","Copilot Corner","@copilotcorner",81000,46000,6,{stage:"replied", owner:"u1", email:"hello@copilotcorner.com", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ben", countries:[], age:"", eng:5.0, found:at(-12),
    seq:{steps:[{k:"first", at:at(-6,9,15), st:"sent"}], stopped:"replied"},
    videos:[V("Copilot vs Cursor: 30 day test",62000,4,"15:12"),V("AI pair programming, honestly",44000,11,"12:50"),V("The settings I change on every AI editor",39000,18,"8:31")]}),

  /* ---- in sequence ---- */
  C("c8","Pixel Diffusion","@pixeldiffusion",205000,73000,4,{stage:"emailed", owner:"u1", email:"studio@pixeldiffusion.art", emailSrc:"About page", emailConf:.96, confirmed:true, contact:"Ines", countries:[["US",31],["BR",14],["GB",9]], age:"18–34", eng:5.9, sponsors:["Clipforge"], found:at(-9), moment:"14:10 \"the open model won on hands, finally\"",
    seq:{steps:[{k:"first", at:at(-4,9,30), st:"sent"},{k:"fu1", at:at(0,10,0), st:"due"},{k:"fu2", at:at(4,10,0), st:"planned"},{k:"fu3", at:at(11,10,0), st:"planned"}]},
    videos:[V("Midjourney v8 vs the open models",82000,2,"22:19"),V("Hands, finally solved?",69000,9,"11:44"),V("I trained a style model on my art",61000,16,"17:03")]}),
  C("c21","Token Talks","@tokentalks",67000,45000,5,{stage:"emailed", owner:"u1", email:"tokentalks.yt@gmail.com", emailSrc:"Video description", emailConf:.91, confirmed:true, contact:"Ravi", countries:[["US",35],["GB",12],["CA",8]], age:"25–34", eng:4.8, found:at(-16),
    seq:{steps:[{k:"first", at:at(-11,9,5), st:"sent"},{k:"fu1", at:at(-7,9,30), st:"sent"},{k:"fu2", at:at(0,9,0), st:"due"},{k:"fu3", at:at(7,9,0), st:"planned"}]},
    videos:[V("I spent $500 on AI APIs so you don't",58000,5,"16:22"),V("Cheapest way to run GPT-class models",47000,13,"12:10"),V("Token prices are collapsing",43000,20,"9:40")]}),
  C("c22","Gradient Guy","@gradientguy",59000,46000,4,{stage:"emailed", owner:"u1", email:"gradientguy@proton.me", emailSrc:"About page", emailConf:.92, confirmed:true, contact:"Leo", countries:[["US",30],["GB",14],["AU",8]], age:"18–34", eng:6.1, found:at(-8),
    seq:{steps:[{k:"first", at:at(-2,10,40), st:"sent"},{k:"fu1", at:at(1,10,0), st:"planned"},{k:"fu2", at:at(5,10,0), st:"planned"},{k:"fu3", at:at(12,10,0), st:"planned"}]},
    videos:[V("Backprop explained with pizza",51000,6,"10:30"),V("Transformers in 12 minutes",48000,14,"12:00"),V("What a GPU actually does",42000,22,"9:15")]}),
  C("c23","Bot Builder","@botbuilder",101000,52000,6,{stage:"emailed", owner:"u2", email:"team@botbuilder.dev", emailSrc:"Website", emailConf:.95, confirmed:true, contact:"Ola", countries:[["US",42],["CA",10],["GB",8]], age:"25–44", eng:4.5, found:at(-20),
    seq:{steps:[{k:"first", at:at(-13,9,0), st:"sent"},{k:"fu1", at:at(-10,9,0), st:"sent"},{k:"fu2", at:at(-6,9,0), st:"sent"},{k:"fu3", at:at(4,9,0), st:"planned"}]},
    videos:[V("My AI support bot answered 4,000 tickets",63000,8,"14:05"),V("Bots that don't annoy customers",49000,16,"11:40"),V("No-code agents, tested",45000,24,"13:22")]}),
  C("c24","Diffusion Daily","@diffusiondaily",77000,50000,9,{stage:"emailed", owner:"u1", email:"hey@diffusiondaily.co", emailSrc:"About page", emailConf:.94, confirmed:true, contact:"Noor", countries:[["US",34],["GB",13],["CA",9]], age:"18–34", eng:5.3, found:at(-5),
    seq:{steps:[{k:"first", at:at(0,9,12), st:"sent"},{k:"fu1", at:at(3,9,30), st:"planned"},{k:"fu2", at:at(7,9,30), st:"planned"},{k:"fu3", at:at(14,9,30), st:"planned"}]},
    videos:[V("Flux vs Midjourney, blind test",57000,3,"13:30"),V("Prompting for product photos",50000,10,"11:12"),V("Every image model this month",46000,17,"15:48")]}),
  C("c25","Vector Vibes","@vectorvibes",64000,47000,5,{stage:"emailed", owner:"u1", email:"vectorvibes@outlook.com", emailSrc:"Video description", emailConf:.9, confirmed:true, contact:"Ana", countries:[["US",38],["GB",10],["AU",7]], age:"25–34", eng:5.7, found:at(-7),
    seq:{steps:[{k:"first", at:at(-4,11,0), st:"sent"},{k:"fu1", at:at(0,11,0), st:"due"},{k:"fu2", at:at(4,11,0), st:"planned"},{k:"fu3", at:at(11,11,0), st:"planned"}]},
    videos:[V("Vector databases in 8 minutes",54000,4,"8:12"),V("Search that understands meaning",47000,12,"10:41"),V("I rebuilt Google for my notes",44000,19,"14:03")]}),

  /* ---- contact confirmed, first email drafted ---- */
  C("c15","Agentic Ally","@agentically",54000,46000,7,{stage:"contact", owner:"u1", email:"ally@agentically.co", emailSrc:"About page", emailConf:.95, confirmed:true, contact:"Ally", countries:[["US",42],["CA",11],["GB",9]], age:"18–34", eng:6.1, found:at(-3), moment:"3:05 \"my whole support inbox runs itself now\"",
    videos:[V("My agent stack for a one-person business",49000,3,"15:44"),V("Agents for solo founders",46000,10,"12:20"),V("The $20 AI stack",41000,17,"9:58")]}),
  C("c28","Neural Nomad","@neuralnomad",92000,51000,6,{stage:"contact", owner:"u1", email:"hello@neuralnomad.travel", emailSrc:"Website", emailConf:.93, confirmed:true, contact:"Eli", countries:[["US",36],["GB",15],["AU",10]], age:"25–34", eng:5.2, found:at(-4), moment:"9:20 \"the AI planned 3 countries in one prompt\"",
    videos:[V("Running a business from a van with AI",58000,5,"18:20"),V("AI travel planning, tested",51000,12,"13:40"),V("Remote work tools I'd keep",47000,20,"11:02")]}),

  /* ---- shortlisted, contact needed ---- */
  C("c9","AutoFlow Daily","@autoflowdaily",58000,47000,9,{stage:"shortlisted", owner:"u1", email:"autoflowdaily@gmail.com", emailSrc:"Guessed from the channel name", emailConf:.55, confirmed:false, countries:[["US",34],["GB",13],["CA",10]], age:"25–44", eng:6.8, found:at(-2), moment:"1:30 \"this one replaced a part-time hire\"",
    cands:[{email:"autoflowdaily@gmail.com", src:"Guessed from the channel name", conf:.55},{email:"business@autoflowdaily.com", src:"Linked website footer", conf:.81}],
    videos:[V("12 Zapier + AI automations I use daily",52000,2,"14:18"),V("This one replaced a part-time hire",47000,9,"10:05"),V("Automate your inbox in 10 minutes",44000,16,"10:11")]}),
  C("c10","Bytewise AI","@bytewiseai",91000,55000,5,{stage:"shortlisted", owner:"u1", email:null, countries:[["US",37],["GB",9],["AU",8]], age:"18–34", eng:5.2, sponsors:["Lumen AI"], found:at(-1),
    cands:[], videos:[V("The AI note-taker test: 6 apps, 1 meeting",61000,4,"15:15"),V("Two of them invented action items",55000,11,"6:15"),V("Meeting notes that write themselves",50000,18,"12:44")]}),
  C("c26","Inference Inc","@inferenceinc",73000,49000,4,{stage:"shortlisted", owner:"u1", email:"team@inference.inc", emailSrc:"About page", emailConf:.92, confirmed:false, countries:[["US",39],["GB",11],["CA",7]], age:"25–44", eng:4.6, found:at(-1),
    cands:[{email:"team@inference.inc", src:"About page", conf:.92}],
    videos:[V("Why your AI app is slow (and the 3 fixes)",53000,5,"13:00"),V("Caching LLM calls the right way",49000,13,"11:35"),V("Latency budgets for AI products",44000,21,"14:50")]}),
  C("c27","Prompt Craft","@promptcraft",48000,45000,8,{stage:"shortlisted", owner:"u1", email:"promptcraft.studio@gmail.com", emailSrc:"Video description", emailConf:.74, confirmed:false, countries:[["US",33],["GB",12],["CA",9]], age:"18–34", eng:6.4, found:at(-1),
    cands:[{email:"promptcraft.studio@gmail.com", src:"Video description", conf:.74},{email:"hi@promptcraft.io", src:"Twitter/X bio", conf:.68}],
    videos:[V("The prompt pattern nobody uses",49000,3,"9:30"),V("Prompts that write prompts",45000,10,"11:18"),V("I tested 100 prompt tips",42000,17,"16:40")]}),

  /* ---- new finds from today's run (r3) ---- */
  C("c11","Model Matters","@modelmatters",67000,49000,6,{run:"r3", found:at(0,8,14), email:"modelmatters.yt@gmail.com", emailSrc:"Video description", emailConf:.88, countries:[["US",35],["GB",12],["CA",6]], age:"18–34", eng:5.0, sponsors:["Codewell"],
    videos:[V("Claude vs GPT for coding, honest results",58000,1,"17:22"),V("Benchmarks lie: test models yourself",49000,8,"12:40"),V("Which model for which job",46000,15,"14:12")]}),
  C("c12","Prompt Daily","@promptdaily",43000,12000,2,{run:"r3", found:at(0,8,15), countries:[["IN",38],["US",18],["PK",9]], age:"18–24", eng:2.1,
    videos:[V("100 prompts in 10 minutes",14000,12,"10:02"),V("ChatGPT tricks part 47",11000,26,"0:59"),V("Make money with AI (real)",9000,33,"8:12")]}),
  C("c13","Vector Shop","@vectorshop",112000,61000,5,{run:"r3", found:at(0,8,17), email:"vectorshop@proton.me", emailSrc:"About page", emailConf:.9, countries:[["US",40],["GB",11],["AU",7]], age:"25–44", eng:4.6, sponsors:["Pagewise","Lumen AI","Sheetsmith"],
    before:{by:"u2", at:at(-122), note:"3 follow-ups, no reply"},
    videos:[V("I replaced my CRM with an AI spreadsheet",72000,3,"13:55"),V("Spreadsheets that think",61000,10,"11:21"),V("My AI ops stack",55000,17,"15:30")]}),
  C("c14","Synth Studio","@synthstudio",88000,36000,3,{run:"r3", found:at(0,8,18), countries:[["US",30],["GB",10],["DE",9]], age:"18–34", eng:3.9, sponsors:["VoxCraft"],
    videos:[V("AI voices that fooled my family",41000,5,"9:45"),V("Cloning my voice, ethically",36000,16,"12:10"),V("Text to song, tested",31000,27,"10:30")]}),
  C("c16","Deep Learning Dad","@dldad",132000,23000,1,{run:"r3", found:at(0,8,20), countries:[["US",27],["IN",19],["GB",8]], age:"35–54", eng:2.8, lastUp:21,
    videos:[V("Teaching my kids about neural nets",26000,21,"18:40"),V("A dad's guide to AI homework",22000,48,"14:12"),V("Should kids use ChatGPT?",19000,70,"16:05")]}),
  C("c30","LLM Lab Notes","@llmlabnotes",71000,52000,6,{run:"r3", found:at(0,8,22), email:"notes@llmlab.dev", emailSrc:"About page", emailConf:.93, countries:[["US",43],["GB",10],["CA",8]], age:"25–34", eng:5.8,
    videos:[V("I read every AI paper this week",61000,2,"21:04"),V("Evals explained without math",52000,9,"13:33"),V("The paper that changes agents",49000,16,"15:10")]}),
  C("c31","AI Shorts Daily","@aishortsdaily",205000,9000,31,{run:"r3", found:at(0,8,23), countries:[["US",22],["PH",14],["IN",13]], age:"18–24", eng:1.6,
    videos:[V("This AI is insane 🤯",12000,0,"0:41"),V("ChatGPT secret mode",8000,1,"0:38"),V("AI did my homework",9000,1,"0:44")]}),
  C("c32","Workflow Wizard","@workflowwizard",62000,48000,7,{run:"r3", found:at(0,8,25), email:"wizard@workflowwizard.io", emailSrc:"Website", emailConf:.91, countries:[["US",37],["CA",12],["GB",10]], age:"25–44", eng:6.0, sponsors:["Inboxly"],
    videos:[V("My 7 AI automations for client work",55000,3,"16:01"),V("Make.com vs Zapier with AI",48000,11,"14:42"),V("Automations that broke (and fixes)",44000,18,"12:15")]}),
  C("c33","The Agent Shop","@theagentshop",93000,58000,5,{run:"r3", found:at(0,8,27), countries:[["US",41],["GB",12],["AU",8]], age:"25–34", eng:4.9,
    videos:[V("I hired 3 AI agents for my store",66000,4,"14:48"),V("Shopify + agents: what works",58000,12,"13:10"),V("The agent that answers DMs",51000,19,"9:52")]}),
  C("c34","Data Dojo","@datadojo",118000,54000,4,{run:"r3", found:at(0,8,29), email:"sensei@datadojo.academy", emailSrc:"About page", emailConf:.94, countries:[["US",32],["IN",17],["GB",11]], age:"18–34", eng:4.3,
    videos:[V("SQL with AI: 10x faster?",59000,5,"18:22"),V("Data analysis with one prompt",54000,13,"15:40"),V("AI for analysts, honestly",50000,21,"17:35")]}),
  C("c35","Ollama Ollie","@ollamaollie",52000,46000,6,{run:"r3", found:at(0,8,31), countries:[["US",38],["GB",13],["CA",10]], age:"25–34", eng:6.6,
    videos:[V("Local AI on a $300 mini PC",51000,3,"16:55"),V("Ollama setup in 5 minutes",46000,10,"7:41"),V("Private AI for your family",43000,17,"12:02")]}),

  /* ---- rejected / never ---- */
  C("c37","Crypto AI Signals","@cryptoaisignals",41000,15000,12,{stage:"rejected", run:"r2", found:at(-2), reject:{reason:"Not relevant to AI tools", at:at(-2,14), by:"u3"}, countries:[["NG",21],["US",19],["IN",12]],
    videos:[V("AI picks the next 100x coin",17000,1,"8:40"),V("My trading bot made $4,000",14000,4,"11:12"),V("Signals for this week",12000,6,"6:55")]}),
  C("c38","AI Gossip Hour","@aigossiphour",36000,8000,3,{stage:"rejected", run:"r2", found:at(-2), reject:{reason:"Too few views", at:at(-1,15), by:"u1"}, countries:[["US",28],["GB",11],["IN",10]],
    videos:[V("Which AI CEO is lying?",9000,3,"22:10"),V("AI drama of the week",8000,10,"25:40"),V("The OpenAI rumour",7000,17,"19:02")]}),
  C("c39","Hype Machine AI","@hypemachineai",150000,40000,9,{stage:"never", run:"r1", found:at(-60), email:"ops@hypemachine.ai", reject:{reason:"Asked us to stop emailing", at:at(-30), by:"u2"}, countries:[["US",35],["GB",9],["CA",8]],
    videos:[V("AI will replace you (here's how)",44000,2,"12:44"),V("10 AI side hustles",41000,9,"10:20"),V("The AI bubble",39000,16,"14:30")]})
];

var brands = [
  {id:"b1", name:"Codewell", sells:"AI code review", cat:"code", country:"US", budget:[3000,6000], contact:"Dana Brooks", email:"dana@codewell.dev", status:"won", seen:["c3","c7","c11"], since:at(-150)},
  {id:"b2", name:"Lumen AI", sells:"AI writing assistant", cat:"writing", country:"GB", budget:[1500,3000], contact:"Priya Shah", email:"priya@lumen.ai", status:"won", seen:["c2","c5","c10","c13"], since:at(-110)},
  {id:"b3", name:"VoxCraft", sells:"AI voice-over", cat:"voice", country:"US", budget:[2000,4000], contact:"Marco Diaz", email:"marco@voxcraft.io", status:"won", seen:["c1","c4","c14"], since:at(-95)},
  {id:"b4", name:"Pagewise", sells:"AI notes and docs", cat:"notes", country:"CA", budget:[1000,2500], contact:"Hana Kim", email:"hana@pagewise.app", status:"won", seen:["c1","c5","c13"], since:at(-130)},
  {id:"b5", name:"Clipforge", sells:"AI video editor", cat:"video", country:"US", budget:[3000,5000], contact:"Sam Ortiz", email:"sam@clipforge.video", status:"negotiating", seen:["c4","c8"], since:at(-12)},
  {id:"b6", name:"Sheetsmith", sells:"AI spreadsheets", cat:"sheets", country:"US", budget:null, contact:"", email:"", status:"found", seen:["c13"], since:at(0,8,17), site:"sheetsmith.ai"},
  {id:"b7", name:"Inboxly", sells:"AI email triage", cat:"email", country:"AU", budget:[1000,2000], contact:"Jo Park", email:"jo@inboxly.com", status:"qualified", seen:["c7","c32"], since:at(-6)},
  {id:"b8", name:"Slidecraft", sells:"AI presentations", cat:"slides", country:"US", budget:[1500,3500], contact:"Tom Reyes", email:"tom@slidecraft.ai", status:"pitched", seen:[], since:at(-9), pitched:{at:at(-3,11,20), creators:["c1","c5"]}},
  {id:"b9", name:"Transcribo", sells:"AI transcription", cat:"transcription", country:"GB", budget:null, contact:"", email:"", status:"found", seen:["c10","c30"], since:at(-1), site:"transcribo.co.uk"},
  {id:"b10", name:"Agentic HQ", sells:"Agent platform for teams", cat:"agents", country:"US", budget:[4000,8000], contact:"Rina Patel", email:"rina@agentichq.com", status:"qualified", seen:["c17","c33"], since:at(-4)}
];

function inv(no, sent, due, paid){ return {no:no, sent:sent, due:due, paid:paid}; }
var deals = [
  {id:"d1", brand:"b1", creator:"c3", step:1, checks:[true,true,false,false], price:4800, payout:2400, owner:"u1", golive:at(16), due:at(1), deliverable:"60–90 s integration in the first third", terms:"Net 30", created:at(-9), invoice:inv(null,null,null,null), report:null, paidCreator:null},
  {id:"d2", brand:"b2", creator:"c2", step:3, checks:[true,false,false], price:2600, payout:1200, owner:"u2", golive:at(6), due:at(2), deliverable:"Integration in the first 3 minutes", terms:"Net 30", created:at(-21), invoice:inv(null,null,null,null), report:null, paidCreator:null},
  {id:"d3", brand:"b3", creator:"c1", step:6, checks:[false], price:3400, payout:1800, owner:"u1", golive:at(-2,15), due:at(-2), deliverable:"Integration + pinned comment", terms:"Net 30", created:at(-34), invoice:inv("GR-2026-031",null,null,null), report:null, paidCreator:null, live:"youtu.be/pl-agents-week"},
  {id:"d4", brand:"b4", creator:"c5", step:7, checks:[false,false], price:2200, payout:1500, owner:"u1", golive:at(-31,14), due:at(-1), deliverable:"Integration", terms:"Net 30", created:at(-60), invoice:inv("GR-2026-024",at(-31,16),at(-1),null), report:{due:at(-1), views:94200, clicks:1310, ctr:1.39}, paidCreator:null, live:"youtu.be/aidesk-9-launches"},
  {id:"d5", brand:"b5", creator:"c4", step:0, checks:[false,false,true,false], price:5200, payout:3100, owner:"u1", golive:at(30), due:at(0), deliverable:"Dedicated video, 8–12 min", terms:"Net 30", created:at(-12), invoice:inv(null,null,null,null), report:null, paidCreator:null,
    neg:{ask:5200, offer:4500, rate:3100, floor:25, hist:[{who:"us", amt:5200, at:at(-9,10,0), note:"Opening ask with last video's 120K views"},{who:"brand", amt:4500, at:at(-2,17,40), note:"\"Our budget is $4,500 for a dedicated video\""}]}},
  {id:"d6", brand:"b2", creator:"c5", step:8, checks:[false], price:2600, payout:1500, owner:"u2", golive:at(-34), due:at(0), deliverable:"Integration", terms:"Net 30", created:at(-70), invoice:inv("GR-2026-021",at(-34,12),at(-4),at(-4,15)), report:{due:at(-4), sent:at(-4,11), views:71800, clicks:902, ctr:1.26}, paidCreator:null, live:"youtu.be/aidesk-lumen"},
  {id:"d7", brand:"b3", creator:"c4", step:4, checks:[true,false,false], price:4200, payout:3100, owner:"u1", golive:at(3,17), due:at(2), deliverable:"Integration at 2:00–3:30", terms:"Net 30", created:at(-25), invoice:inv(null,null,null,null), report:null, paidCreator:null, link:"vox.cr/tensortalk"},
  {id:"d8", brand:"b4", creator:"c1", step:9, checks:[false], price:2100, payout:1300, owner:"u1", golive:at(-52), due:at(1), deliverable:"Integration", terms:"Net 30", created:at(-90), invoice:inv("GR-2026-017",at(-52),at(-22),at(-20)), report:{due:at(-22), sent:at(-22,10), views:88400, clicks:1520, ctr:1.72}, paidCreator:at(-18), live:"youtu.be/pl-pagewise"}
];

function M(dir, when, text, ai, by){ return {dir:dir, at:when, text:text, ai:ai || null, by:by || null}; }
var threads = {
  c6:[M("out", at(-10,9,40), "Hi Sam,\n\nYour RAG whiteboard video was the clearest I've seen, especially the step most demos skip at 5:48. We're building a small roster of AI educators for tool sponsors. Open to hearing about paid integrations?\n\nMoustafa, Gratovo", null, "u1"),
      M("in", at(-1,18,2), "Hey, thanks! Yes, open to it. What do these usually pay? I've never done a sponsor before and I don't want to sound like an ad.", {intent:"Interested · asks about pay", summary:"Open to sponsors, first time. Worried the integration will sound like an ad. Asked what it pays.", facts:[], next:"Give a range, reassure on fit, ask for YouTube Studio numbers."})],
  c19:[M("out", at(-9,10,5), "Hi Mia,\n\nThe 7B-on-a-laptop video was a great watch. We pair AI creators with tools they'd use anyway. Open to hearing about paid integrations?", null, "u1"),
       M("in", at(-3,13,30), "Thanks, but I'm fully booked until the new year. Maybe ping me in January?", {intent:"Not now · try in January", summary:"Booked until the new year. Asked to be contacted in January.", facts:[{k:"park", label:"Come back", v:at(79), show:"Early January"}], next:"Thank her, park until 6 January with a reminder."})],
  c20:[M("out", at(-6,9,15), "Hi Ben,\n\nThe 30-day Copilot vs Cursor test was the fairest comparison I've seen. We help AI creators land paid integrations with tools they'd use on camera anyway. Open to it?", null, "u1"),
       M("in", at(0,8,42), "Hey! Thanks for reaching out. My rate for a 60-second integration is $900. Audience is US 46%, UK 9%, Canada 8%, mostly 25–34. Happy to chat.", {intent:"Interested · sent rate and audience", summary:"Interested. Shared a rate and the audience split in the first reply.", facts:[{k:"rate", label:"Rate", v:900, show:"$900 per 60 s integration"},{k:"countries", label:"Top countries", v:[["US",46],["GB",9],["CA",8]], show:"US 46% · GB 9% · CA 8%"},{k:"age", label:"Age", v:"25–34", show:"Mostly 25–34"}], next:"Save the facts, ask for a screenshot from YouTube Studio to confirm, then sign."})],
  c8:[M("out", at(-4,9,30), "Hi Ines,\n\nThe hands comparison at 14:10 settled an argument in our team. We work with AI tool brands looking for creators like you. Would paid integrations be of interest?", null, "u1")],
  c21:[M("out", at(-11,9,5), "Hi Ravi,\n\n\"I spent $500 on AI APIs so you don't\" is the most useful title I've read this month. We match AI creators with tool sponsors. Interested?", null, "u1"),
       M("out", at(-7,9,30), "Hi Ravi, floating this back up in case it got buried. Two AI API brands are booking this month.", null, "u1")],
  c25:[M("out", at(-4,11,0), "Hi Ana,\n\nVector databases in 8 minutes is the version I'll send people from now on. We help AI creators land sponsors they'd use anyway. Open to hearing more?", null, "u1")],
  c22:[M("out", at(-2,10,40), "Hi Leo,\n\nBackprop explained with pizza is brilliant. Open to paid integrations with AI tools?", null, "u1")],
  c23:[M("out", at(-13,9,0), "Hi Ola, the 4,000-ticket support bot video is exactly what support-tool brands want to show. Open to sponsors?", null, "u2"),
       M("out", at(-10,9,0), "Following up in case this got buried.", null, "u2"), M("out", at(-6,9,0), "Last nudge from me on this one, happy to share which brands are booking.", null, "u2")],
  c24:[M("out", at(0,9,12), "Hi Noor,\n\nThe blind Flux vs Midjourney test was so well run. We pair AI creators with image-tool sponsors. Open to it?", null, "u1")],
  c7:[M("out", at(-17,10,0), "Hi Dev, the inbox-agent video was brilliant. Open to paid integrations?", null, "u1"),
      M("in", at(-14,12,0), "Thanks! Happy to talk. What do you need from me?", {intent:"Interested", summary:"Interested, asked what we need.", facts:[], next:"Ask for analytics and rate."}),
      M("out", at(-13,9,0), "Could you share your audience analytics (top countries, age) and your rate for a 60–90 s integration?", null, "u1"),
      M("in", at(-3,16,20), "Here's my media kit: US 38%, GB 11%, CA 9%, mostly 18–34. Rate is $1,700 for an integration.", {intent:"Media kit sent", summary:"Sent the media kit with rate and audience.", facts:[{k:"rate", label:"Rate", v:1700, show:"$1,700 per integration", saved:true},{k:"countries", label:"Top countries", v:[["US",38],["GB",11],["CA",9]], show:"US 38% · GB 11% · CA 9%", saved:true}], next:"Check the audience, then sign."})],
  c18:[M("out", at(-12,10,0), "Hi Arjun, love the honest tool reviews. Open to sponsors?", null, "u1"),
       M("in", at(-2,11,5), "Sure! Rate card attached. $700 per video. Audience mostly India and US.", {intent:"Media kit sent", summary:"Rate card sent. Audience led by India.", facts:[{k:"rate", label:"Rate", v:700, show:"$700 per video", saved:true}], next:"Audience fails the US/UK/CA/AU rule. Decline politely or keep for non-US brands."})],
  b5:[M("out", at(-9,10,0), "Hi Sam,\n\nTensor Talk (310K, 120K median views, 39% US) just ranked every AI video tool. Want him for Clipforge's November push? A dedicated video is $5,200.", null, "u1"),
      M("in", at(-2,17,40), "Interested. Our budget is $4,500 for a dedicated video, can you work with that?", {intent:"Counter-offer · $4,500", summary:"Wants Tensor Talk. Offered $4,500 against our $5,200 ask.", facts:[{k:"offer", label:"Their offer", v:4500, show:"$4,500 dedicated video"}], next:"Hold near $5,200 with proof, or meet at $4,900 with a usage limit."})],
  b8:[M("out", at(-3,11,20), "Hi Tom,\n\nTwo creators your buyers already watch: Prompt Lab (182K, 41% US) and The AI Desk (150K, weekly news). Both have run productivity-tool integrations that beat 1.3% CTR. Worth a call?", null, "u1")],
  b7:[], b10:[]
};

var drafts = [
  {id:"q1", kind:"reply", to:{t:"creator", id:"c6"}, mailbox:"m1", created:at(-1,18,6), subject:"Re: AI educators roster",
    body:"Hi Sam,\n\nTotally fair. For a channel your size, a 60–90 second integration usually pays in the low thousands, and we only bring you tools you'd actually use on camera, so it never reads like an ad.\n\nCould you send your top countries and age range from YouTube Studio? Then I can come back with a real number.\n\nMoustafa",
    why:"They asked about pay and worry about sounding like an ad. Answer with a range, reassure on fit, ask for analytics.", rules:["INF-REPLY-07","INF-PRICE-02"], gates:[]},
  {id:"q2", kind:"reply", to:{t:"brand", id:"b5"}, deal:"d5", mailbox:"m1", created:at(-2,18,0), subject:"Re: Tensor Talk for Clipforge",
    body:"Hi Sam,\n\nThanks for coming back quickly. Tensor Talk's dedicated videos run at $5,200, and his last one passed 146K views in six days. I can hold his late-November slot for you at that rate. Shall I send the details?\n\nMoustafa",
    why:"The brand offered under our ask. Hold the price, give the proof, keep the next step easy.", rules:["BRD-NEG-04","BRD-PRICE-09"], gates:[{k:"price", text:"This email names a price: $5,200. Confirm it before sending."}]},
  {id:"q3", kind:"first", to:{t:"creator", id:"c9"}, mailbox:"m2", created:at(-1,16,0), subject:"the automation that replaced a part-time hire",
    body:"Hi there,\n\nYour Zapier + AI video landed at the perfect time. The automation at 1:30 that replaced a part-time hire is exactly the kind of result AI tool brands want to show.\n\nWe help AI creators land paid integrations with tools they'd use anyway. Would you be open to hearing about a couple?\n\nMoustafa, Gratovo",
    why:"First email: one real moment from their latest video, a short bridge, one yes-or-no question.", rules:["INF-FIRST-02","FND-WRITE-11"], gates:[{k:"unconfirmed", text:"The address was guessed from the channel name and nobody has confirmed it."}]},
  {id:"q4", kind:"first", to:{t:"creator", id:"c15"}, mailbox:"m1", created:at(0,8,50), subject:"a support inbox that runs itself",
    body:"Hi Ally,\n\n\"My whole support inbox runs itself now\" at 3:05 is the line I keep repeating to people. Solo founders are exactly who the AI tools we work with want to reach.\n\nWe help AI creators land paid integrations with tools they'd use anyway. Open to hearing about one or two?\n\nMoustafa, Gratovo",
    why:"First email: quotes the strongest line from the latest video and asks one easy question.", rules:["INF-FIRST-02"], gates:[]},
  {id:"q5", kind:"first", to:{t:"creator", id:"c28"}, mailbox:"m1", created:at(0,8,52), subject:"three countries in one prompt",
    body:"Hi Eli,\n\nThe bit at 9:20 where the AI planned three countries in one prompt sold me on the whole van setup. Travel and remote-work AI tools are booking creators like you right now.\n\nWould you be open to a paid integration or two?\n\nMoustafa, Gratovo",
    why:"First email: a specific moment, the brand angle, one question.", rules:["INF-FIRST-02","FND-WRITE-11"], gates:[]},
  {id:"q6", kind:"followup", n:1, to:{t:"creator", id:"c8"}, mailbox:"m1", created:at(0,7,0), subject:"Re: the hands comparison",
    body:"Hi Ines, just floating this back up in case it got buried. Happy to share which AI video brands are booking this month if that's useful.",
    why:"Follow-up 1 of 3, four days after the first email with no reply. Short, adds one new reason.", rules:["INF-FU-03"], gates:[]},
  {id:"q7", kind:"followup", n:2, to:{t:"creator", id:"c21"}, mailbox:"m3", created:at(0,7,0), subject:"Re: $500 on AI APIs",
    body:"Hi Ravi, one more from me. An AI API platform asked us this morning for creators who test costs honestly, and your channel was the first I thought of. Worth a quick chat?",
    why:"Follow-up 2 of 3. Brings a concrete, timely reason rather than repeating the ask.", rules:["INF-FU-05"], gates:[{k:"cap", text:"outreach3 is slowed to 20 a day after bounces; this send uses 1 of the 3 left."}]},
  {id:"q8", kind:"followup", n:1, to:{t:"creator", id:"c25"}, mailbox:"m1", created:at(0,7,0), subject:"Re: vector databases in 8 minutes",
    body:"Hi Ana, bumping this in case it slipped past. Two search-tool brands are looking for explainers like yours this month.",
    why:"Follow-up 1 of 3, four days after the first email.", rules:["INF-FU-03"], gates:[]},
  {id:"q9", kind:"reply", to:{t:"creator", id:"c20"}, mailbox:"m1", created:at(0,8,45), subject:"Re: Copilot vs Cursor",
    body:"Hi Ben,\n\nThanks, that's really helpful. $900 for 60 seconds works as a starting point. Could you send a screenshot of the audience tab in YouTube Studio (countries and age, last 90 days)? Brands ask for it, and then I can bring you the first offer this week.\n\nMoustafa",
    why:"He shared a rate and audience. Accept the rate as a start and ask for proof from YouTube Studio before signing.", rules:["INF-REPLY-03","INF-KIT-01"], gates:[]},
  {id:"q10", kind:"reply", to:{t:"creator", id:"c19"}, mailbox:"m1", created:at(-3,13,40), subject:"Re: paid integrations",
    body:"Hi Mia, totally understood, congrats on the busy season. I'll check back in early January.\n\nMoustafa",
    why:"Not now. Keep it short and warm, and set a reminder for January.", rules:["INF-NOTNOW-01"], gates:[], after:{park:at(79)}}
];

/* today's search run */
var KW = [["ai agents for small business",14,4],["claude vs gpt coding",11,3],["ai note taker review",9,2],["best ai video editor 2026",16,5],["rag tutorial beginners",8,2],["ai automation zapier",12,4],["cursor ai tutorial",10,3],["ai voice cloning review",7,1],
  ["local llm setup",0,0],["ai for youtube creators",0,0],["midjourney vs flux",0,0],["ai sales tools",0,0],["notebooklm tutorial",0,0],["ai spreadsheet tools",0,0],["perplexity vs google",0,0],["ai coding agents",0,0],
  ["ai productivity stack",0,0],["agentic workflows explained",0,0],["ai image editing app",0,0],["whisper transcription tutorial",0,0],["llm fine tuning beginner",0,0],["ai email assistant",0,0],["ai meeting notes",0,0],["open source ai models",0,0]];
var runs = [
  {id:"r3", at:at(0,8,10), by:"u1", status:"paused", cur:8, kws:KW.map(function(k, i){ return {q:k[0], st:i < 8 ? "done" : "queued", found:k[1], kept:k[2]}; }), found:87, kept:24, gold:9, archived:61, videos:412,
    log:[[at(0,8,10,2),"Run started on this computer · 24 keywords"],[at(0,8,10,40),"\"ai agents for small business\" · 14 channels, 4 kept"],[at(0,8,13,5),"\"claude vs gpt coding\" · 11 channels, 3 kept"],[at(0,8,31,52),"Paused after keyword 8 by you · everything found is saved"]]},
  {id:"r2", at:at(-2,9,0), by:"u2", status:"done", cur:20, kws:[], found:240, kept:61, gold:17, archived:179, videos:1180},
  {id:"r1", at:at(-7,8,30), by:"u1", status:"done", cur:30, kws:[], found:362, kept:97, gold:31, archived:265, videos:1702}
];
/* a teammate's run in progress, so duplicate keywords can be caught before they are searched twice */
var mateRun = {by:"u3", at:at(0,9,2), cur:12, total:40, kws:["ai agents for small business","ai sales tools","notion ai review","ai for real estate","chatgpt for teachers"]};

/* channels a live run can "find", in order */
var POOL = [["Latent Space Lab","@latentspacelab","Inside a 70B training run",58000,77000],["Copilot Campus","@copilotcampus","Teaching CS with AI tutors",47000,61000],["Neural Kitchen","@neuralkitchen","AI meal planning for a month",52000,83000],
  ["Agent Atlas","@agentatlas","Mapping every agent framework",49000,70000],["Prompt Pilot","@promptpilot","Prompts for pilots and planners",13000,51000],["Synthetic Sam","@syntheticsam","AI avatars for YouTube, tested",61000,104000],
  ["Loop & Logic","@loopandlogic","n8n + AI for ops teams",46000,58000],["The Token Times","@tokentimes","AI news in 6 minutes",55000,99000],["Bits & Bots","@bitsandbots","Robot vacuums with LLM brains",21000,64000],["Model Garden","@modelgarden","Open models for small teams",48000,66000]];

var notifs = [
  {id:"n1", at:at(0,8,42), icon:"reply", text:"Copilot Corner replied with a rate and audience", sub:"Reach · Replies", go:{s:"today", item:"reply:q9"}, read:false},
  {id:"n2", at:at(0,8,31), icon:"pause", text:"Today's search paused after keyword 8", sub:"24 kept so far · everything is saved", go:{s:"find", tab:"search"}, read:false},
  {id:"n3", at:at(-1,17,0), icon:"alert", text:"outreach3 slowed to 20 sends a day", sub:"Bounces reached 3.2% this week", go:{s:"reach", tab:"mailboxes"}, read:false},
  {id:"n4", at:at(0,0,5), icon:"wallet", text:"Pagewise invoice GR-2026-024 is 1 day overdue", sub:"$2,200 · due 18 Oct", go:{s:"deliver", tab:"money"}, read:true},
  {id:"n5", at:at(-4,15,10), icon:"unlock", text:"Lumen AI paid $2,600, so The AI Desk can be paid", sub:"Payout $1,500 unlocked", go:{s:"deliver", tab:"money"}, read:true},
  {id:"n6", at:at(-1,11,0), icon:"forward", text:"Sara handed you Clipforge × Tensor Talk", sub:"\"Brand countered at $4,500, your call on price\"", go:{s:"close", tab:"negotiate"}, read:true}
];

var log = [
  {id:"l1", at:at(0,9,12), who:"u1", text:"Sent the first email to Diffusion Daily", ref:{t:"creator", id:"c24"}},
  {id:"l2", at:at(0,9,2), who:"u3", text:"Started a search: 40 keywords", ref:null},
  {id:"l3", at:at(0,8,31), who:"u1", text:"Paused today's search after keyword 8", ref:null},
  {id:"l4", at:at(-1,17,30), who:"u2", text:"Marked Lumen AI × Neural Notes draft as received", ref:{t:"deal", id:"d2"}},
  {id:"l5", at:at(-1,11,0), who:"u2", text:"Handed Clipforge × Tensor Talk to you", ref:{t:"deal", id:"d5"}},
  {id:"l6", at:at(-2,14,0), who:"u3", text:"Rejected Crypto AI Signals (not relevant)", ref:{t:"creator", id:"c37"}}
];

var team = [
  {id:"u1", name:"You", role:"Owner", status:"online", doing:"Today"},
  {id:"u2", name:"Sara", role:"Account manager", status:"online", doing:"Reach · replies"},
  {id:"u3", name:"Omar", role:"VA", status:"online", doing:"Search · keyword 12 of 40"},
  {id:"u4", name:"Lina", role:"VA · first week", status:"away", doing:"Away until 13:00"}
];
var mail = [
  {id:"m1", addr:"outreach1@gratovo.co", cap:35, sent:13, warm:{done:true, day:41}, bounce:.8, reply:6.1, inbox:9, status:"good"},
  {id:"m2", addr:"outreach2@gratovo.co", cap:20, sent:4, warm:{done:false, day:9, of:14}, bounce:.4, reply:5.2, inbox:9, status:"warming"},
  {id:"m3", addr:"outreach3@gratovo.co", cap:20, capNormal:35, sent:17, warm:{done:true, day:63}, bounce:3.2, reply:3.9, inbox:7, status:"slowed", note:"Bounces passed 3% this week, so sends are held at 20 a day until they fall under 2%."}
];

/* thirty days of sends and replies for Insights (oldest first) */
var hist = {sent:[], replies:[]};
for (var i = 29; i >= 0; i--){
  var dow = new Date(at(-i)).getDay(), weekend = dow === 0 || dow === 6;
  var s = weekend ? 4 + (W.hash("s"+i) % 6) : 28 + (W.hash("s"+i) % 22);
  hist.sent.push({at:at(-i), v:i === 0 ? 13 : s});
  hist.replies.push({at:at(-i), v:Math.round(s * (0.04 + (W.hash("r"+i) % 5) / 100))});
}
hist.months = [{m:"May", sent:610, replies:31, signed:2, revenue:4100},{m:"Jun", sent:780, replies:41, signed:3, revenue:7300},{m:"Jul", sent:920, replies:47, signed:4, revenue:9800},
  {m:"Aug", sent:1010, replies:52, signed:5, revenue:12600},{m:"Sep", sent:1040, replies:58, signed:6, revenue:15200},{m:"Oct", sent:690, replies:39, signed:2, revenue:8700}];

W.seed = function(){
  return {
    creators:creators, brands:brands, deals:deals, threads:threads, drafts:drafts, runs:runs, mateRun:mateRun, pool:POOL, poolI:0,
    notifs:notifs, log:log, team:team, mail:mail, hist:hist,
    me:"u1", snoozed:{}, handed:{}, done:[], notes:{},
    day:{budget:240, started:null},
    rules:{countries:["US","GB","CA","AU"], minMedian:45000, minUploads:3, perKeyword:40, archiveDays:7, audience:{top3:["US","GB","CA","AU"], ages:["18–24","18–34","25–34","25–44"], minEng:3}, marginFloor:25, sendWindow:"9:00–11:00 their time"},
    settings:{density:"comfortable"}
  };
};
})();
