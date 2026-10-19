// Builds docs/product/parity-checklist.md from the prototype's plan data (plan.js) and the task map (framework-tasks.md).
// Usage (from the repo root): node docs/product/gen-parity-checklist.js .
// Sections 1-5 are generated. Section 6 (the old app's other capabilities) is hand-written and kept as it is.
const fs = require("fs"), path = require("path");
const root = process.argv[2] || ".";
const plan = fs.readFileSync(path.join(root, "design/workbench-prototype/js/plan.js"), "utf8").replace(/\r\n/g, "\n");
const block = plan.slice(plan.indexOf("var P = ["), plan.indexOf("var SHOW = {"));
const data = new Function(block + "\nreturn {P, COV, TODAY, ST_LABEL, PL_LABEL, QOL, FEEDBACK, CAUSES, ROADMAP, QUESTIONS};")();
const map = fs.readFileSync(path.join(root, "docs/product/framework-tasks.md"), "utf8").replace(/\r\n/g, "\n");
const steps = [];
for (const line of map.split("\n")) {
  const m = line.match(/^## (\w+) \| (\w+) \| (.+?) — (.+)$/);
  if (m) steps.push({k: m[1], phase: m[2], name: m[3], verdict: m[4]});
}
const esc = s => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const out = [];
out.push("# Parity checklist", "");
out.push("The list that step 10 of the [migration plan](../migration-plan.md) walks, item by item. Nothing ships with an unticked row unless the row says why (a decision changed it, or the owner deferred it).", "");
out.push("Sections 1 to 5 are generated from the prototype's plan data (`design/workbench-prototype/js/plan.js`) and the task map ([framework-tasks.md](framework-tasks.md)). If those change, regenerate with `node docs/product/gen-parity-checklist.js .` rather than editing them by hand. Section 6 is written by hand and is kept when regenerating.", "");
out.push("Columns: **Old app** is how today's Flutter app handles the task (from the 18 Oct UI map). **Plan** is what the new app does. **Prototype** is whether the Workbench prototype already shows it. **New app** is the box to tick in step 10.", "");
out.push("## 1. The framework tasks, step by step");
let n = 0;
for (const s of steps) {
  const today = data.TODAY[s.k] || [], cov = data.COV[s.k] || [];
  out.push("", `### ${s.name} (${s.phase})`, "", `Old app overall: ${esc(s.verdict)}`, "");
  out.push("| # | Task | Old app | Plan | Prototype | New app |", "|---|---|---|---|---|---|");
  today.forEach((t, i) => { n++; const c = cov[i] || ["", ""]; out.push(`| ${n} | ${esc(t[1])} | ${data.ST_LABEL[t[0]] || t[0]} | ${esc(c[0])} | ${data.PL_LABEL[c[1]] || c[1] || ""} | ☐ |`); });
}
out.push("", `${n} tasks in all.`, "");
out.push("## 2. Quality of life", "", "| Area | Item | Priority | Prototype | New app |", "|---|---|---|---|---|");
for (const q of data.QOL) out.push(`| ${esc(q[0])} | ${esc(q[1])} | ${esc(q[2])} | ${data.PL_LABEL[q[3]] || q[3]} | ☐ |`);
out.push("", "## 3. Feedback: what every action must say back", "", "| Action | What you see | What changes elsewhere | How to take it back | New app |", "|---|---|---|---|---|");
for (const f of data.FEEDBACK) out.push(`| ${esc(f[0])} | ${esc(f[1])} | ${esc(f[2])} | ${esc(f[3])} | ☐ |`);
out.push("", "## 4. Speed: what made the old app lag, and the rule that prevents it", "", "| Cause in the old app | Rule in the new app | New app |", "|---|---|---|");
for (const c of data.CAUSES) out.push(`| ${esc(c[0])} | ${esc(c[1])} | ☐ |`);
out.push("", "## 5. Design principles", "");
for (const p of data.P) out.push(`- **${esc(p.t)}.** ${esc(p.d)}`);
out.push("", "");
const file = path.join(root, "docs/product/parity-checklist.md");
let keep = "";
if (fs.existsSync(file)) { const old = fs.readFileSync(file, "utf8"); const at = old.indexOf("## 6. "); if (at >= 0) keep = old.slice(at); }
fs.writeFileSync(file, out.join("\n") + keep);
console.log("tasks", n, "qol", data.QOL.length, "feedback", data.FEEDBACK.length, "causes", data.CAUSES.length, "principles", data.P.length, "kept section 6:", !!keep);
