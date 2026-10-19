# Helper scripts for the lead's checks

These lived in a session's scratch folder; they are kept here as text so a new session can recreate them. Accessibility is now checked by `apps/desktop/e2e/accessibility.spec.ts`, so the axe script below is only for a quick look outside Electron. Copy one into your scratch folder as a `.cjs` file and run it with `node` after `pnpm --filter @gratovo/desktop build`. They are dev aids, not part of the app.

The browser path is the cloud container's (`ls /opt/pw-browsers` if it differs). `<repo>` paths assume the clone is at `/home/user/gratovo_toolbox`.

## Toolchain on PATH (cloud container)

After installing Node 24.22.0, pnpm 12 and uv as [workflow.md](workflow.md#setting-up-and-things-to-know) says ("Tools a cloud container lacks"), each shell starts with:

```sh
export PATH=/root/.local/opt/uv-bin:/root/.local/opt/node-v24.22.0-linux-x64/bin:/root/.local/bin:$PATH
export UV_SYSTEM_CERTS=1
unset UV_NATIVE_TLS
export PATH=$PATH:/root/.local/bin   # gitleaks; append, never prepend
```

## Screenshots of the app next to the prototype (`p3-shots.cjs`)

Serves the built renderer (`apps/desktop/out/renderer`) with a stub `window.gratovo`, opens the prototype from `design/workbench-prototype/index.html` (its vendor scripts are routed to local files), runs the same scenes in both and writes `shots/p3/<app|proto>-<scene>-<width>-<scheme>.png` in the working directory, at 1440 px light and dark and 400 px light. Change `scenes()` for other screens (task R3 does this for Settings). Press `?` for the sheet: Playwright's `Shift+/` sends `/`. It also checks a toast stays above the open palette.

```js
const { chromium } = require("/home/user/gratovo_toolbox/apps/desktop/node_modules/@playwright/test");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const appRoot = "/home/user/gratovo_toolbox/apps/desktop/out/renderer";
const protoRoot = "/home/user/gratovo_toolbox/design/workbench-prototype";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
fs.mkdirSync("shots/p3", { recursive: true });
const server = http.createServer((req, res) => {
  const file = path.join(appRoot, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(appRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
});
const MAP = new Set(["react.production.min.js", "react-dom.production.min.js", "htm.umd.js"]);
async function scenes(page, tag, w, scheme, full) {
  const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `shots/p3/${tag}-${n}-${w}-${scheme}.png` }); };
  const esc = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(150); };
  await page.mouse.click(700, 500); // focus away from anything
  await page.keyboard.press("Control+k"); await shot("palette"); await esc();
  await page.keyboard.press("?"); await shot("sheet"); await esc();
  if (w < 500) { await page.locator(".top .iconbtn.only-narrow").click(); await page.waitForTimeout(400); }
  await page.locator(".me").click(); await shot("menu"); await esc();
  if (w < 500) { await page.keyboard.press("Escape"); await page.mouse.click(390, 400).catch(() => {}); await page.waitForTimeout(300); }
  await page.locator('.top .iconbtn[aria-label="Notifications"]').click(); await shot("tray");
  await page.locator(".tray button", { hasText: "Mark all read" }).click(); await page.waitForTimeout(100);
  await page.keyboard.press("Control+z"); await shot("toast"); await esc();
  await page.keyboard.press("Control+k"); await page.keyboard.type("prompt"); await page.keyboard.press("Enter"); await shot("peek");
  await esc();
  // A toast while the palette is open must sit above the scrim, as the prototype's z-index puts it.
  await page.locator('.top .iconbtn[aria-label="Notifications"]').click(); await page.waitForTimeout(150);
  await page.locator(".tray button", { hasText: "Mark all read" }).click(); await page.waitForTimeout(100);
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+k"); await shot("toast-over-palette");
  const top = await page.evaluate(() => { const t = document.querySelector(".toast"); if (!t) return "no toast"; const r = t.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return el && t.contains(el) ? "toast on top" : "covered by " + (el ? el.className : "nothing"); });
  console.log(tag, w, top);
}
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const errors = [];
  for (const [w, h, schemes] of [[1440, 900, ["light", "dark"]], [400, 800, ["light"]]]) {
    for (const scheme of schemes) {
      for (const tag of ["app", "proto"]) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
        page.on("pageerror", (e) => errors.push(`${tag} ${w} ${scheme}: ${e.message}`));
        page.on("console", (m) => { if (m.type() === "error") errors.push(`${tag} ${w} ${scheme}: ${m.text()}`); });
        if (tag === "app") {
          await page.addInitScript(() => { window.gratovo = { invoke: async () => ({ ok: false, reason: "stub" }) }; });
          await page.goto(`http://127.0.0.1:${port}/index.html`);
        } else {
          await page.route("**/*", (r) => { const n = r.request().url().split("/").pop(); return MAP.has(n) ? r.fulfill({ path: path.join(protoRoot, "vendor", n), contentType: "application/javascript" }) : r.continue(); });
          await page.goto("file://" + protoRoot + "/index.html"); await page.waitForSelector(".rail");
        }
        await page.waitForTimeout(900);
        try { await scenes(page, tag, w, scheme); } catch (e) { errors.push(`${tag} ${w} ${scheme}: scene failed ${e.message.split("\n")[0]}`); }
        await page.close();
      }
    }
  }
  console.log(errors.length ? errors.join("\n") : "no errors");
  await browser.close(); server.close();
});
```

## Accessibility check with axe in Chromium (`axe-check.cjs`)

Runs axe-core 4.14.0 (already in `node_modules/.pnpm`, from eslint-plugin-jsx-a11y) against the built renderer in light and dark at 1440 and 400 px, with each overlay open, and prints one line per violation (scene, impact, rule, count, first targets with contrast numbers). The first run (before 3c-3) found only the light `--muted` contrast and the label-in-name of the account button and the bell; F7 and F8 fix them. For the gate itself, use only the WCAG tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`); this script also prints best-practice notes.

```js
const { chromium } = require("/home/user/gratovo_toolbox/apps/desktop/node_modules/@playwright/test");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const appRoot = "/home/user/gratovo_toolbox/apps/desktop/out/renderer";
const axeSrc = fs.readFileSync("/home/user/gratovo_toolbox/node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js", "utf8");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const file = path.join(appRoot, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(appRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
});
async function audit(page, label) {
  await page.waitForTimeout(400);
  await page.evaluate(axeSrc);
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }));
  for (const v of r.violations) console.log(`${label} | ${v.impact} | ${v.id} | ${v.nodes.length} | ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio ? ` (${n.any[0].data.contrastRatio}:1 ${n.any[0].data.fgColor}/${n.any[0].data.bgColor})` : "")).join(" ; ")}`);
  if (!r.violations.length) console.log(`${label} | clean`);
}
server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  for (const [w, h] of [[1440, 900], [400, 800]]) for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
    await page.addInitScript(() => { window.gratovo = { invoke: async () => ({ ok: false }) }; });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForTimeout(800);
    const tag = `${w} ${scheme}`;
    await audit(page, `${tag} frame`);
    await page.keyboard.press("Control+k"); await audit(page, `${tag} palette`); await page.keyboard.press("Escape");
    await page.keyboard.press("?"); await audit(page, `${tag} sheet`); await page.keyboard.press("Escape");
    if (w > 500) {
      await page.locator('.top .iconbtn[aria-label="Notifications"]').click(); await audit(page, `${tag} tray`); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Your account/ }).click(); await audit(page, `${tag} menu`); await page.keyboard.press("Escape");
      await page.keyboard.press("Control+k"); await page.keyboard.type("prompt"); await page.keyboard.press("Enter"); await audit(page, `${tag} peek`); await page.keyboard.press("Escape");
    }
    await page.close();
  }
  await browser.close(); server.close();
});
```
