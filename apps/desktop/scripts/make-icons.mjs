// Draws resources/logo.svg into resources/icon.png (256 px) and resources/icon.ico (16 to 256 px).
// Run once after the logo changes: `pnpm exec electron scripts/make-icons.mjs` from apps/desktop.
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const resources = join(import.meta.dirname, "../resources");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const svg = readFileSync(join(resources, "logo.svg"));
// The Electron here refuses file:// pages (the fuses), so a one-time local server hands the logo over.
let port = 0;
const server = createServer((request, response) => {
  const logo = request.url === "/logo.svg";
  response.setHeader("Content-Type", logo ? "image/svg+xml" : "text/html");
  response.end(
    logo
      ? svg
      : '<body style="margin:0;background:transparent"><img style="width:256px;height:256px;display:block" src="/logo.svg"></body>',
  );
});

async function render() {
  const window = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await window.webContents.capturePage();
  window.destroy();
  return image;
}

/** An .ico that holds PNG images, which Windows reads from Vista on. */
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size === 256 ? 0 : size, at);
    head.writeUInt8(size === 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(({ png }) => png)]);
}

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  const big = await render();
  const images = sizes.map((size) => ({
    size,
    png: big.resize({ width: size, height: size, quality: "best" }).toPNG(),
  }));
  writeFileSync(join(resources, "icon.png"), images[images.length - 1].png);
  writeFileSync(join(resources, "icon.ico"), ico(images));
  server.close();
  app.quit();
});
