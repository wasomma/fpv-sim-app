/*
 * Regenerate the app icon rasters from the SVG masters in assets/icon/.
 *
 *   npm run icon                 — writes assets/icon/icon.ico + icon-256.png
 *   npm run icon -- --preview p  — additionally writes a montage PNG to p
 *
 * Runs under Electron (npx electron scripts/make-icon.mjs) so Chromium does
 * the SVG rasterization: each size is rendered from the vector at that size,
 * not downscaled from one big bitmap. Sizes ≤32px use icon-small.svg. The
 * .ico container holds PNG-compressed entries (supported since Vista), and
 * the outputs are committed — this script only reruns when the design does.
 */

import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = path.join(root, "assets", "icon");

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_MAX = 32;

function svgDataUrl(file) {
  const svg = fs.readFileSync(path.join(iconDir, file), "utf8");
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

async function renderPng(win, url, size) {
  const dataUrl = await win.webContents.executeJavaScript(
    `window.renderIcon(${JSON.stringify(url)}, ${size})`,
    true,
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** ICONDIR + one PNG-format ICONDIRENTRY per size. */
function packIco(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); // width (0 means 256)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bit depth
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([dir, ...entries.map((e) => e.png)]);
}

const PAGE_HELPERS = `
  window.renderIcon = async (url, size) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    c.getContext("2d").drawImage(img, 0, 0, size, size);
    return c.toDataURL("image/png");
  };
  window.renderMontage = async (fullUrl, smallUrl) => {
    const draw = async (ctx, url, x, y, size, scale) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, x, y, size * scale, size * scale);
    };
    const c = document.createElement("canvas");
    c.width = 744;
    c.height = 584;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1a2229";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#8fa0a8";
    ctx.font = "13px monospace";
    await draw(ctx, fullUrl, 24, 36, 512, 1);
    ctx.fillText("512px (icon.svg)", 24, 26);
    await draw(ctx, smallUrl, 576, 36, 16, 8);
    ctx.fillText("16px at 8x", 576, 26);
    await draw(ctx, smallUrl, 576, 220, 32, 4);
    ctx.fillText("32px at 4x", 576, 210);
    ctx.fillText("actual:", 576, 400);
    await draw(ctx, fullUrl, 576, 412, 48, 1);
    await draw(ctx, smallUrl, 636, 428, 32, 1);
    await draw(ctx, smallUrl, 680, 436, 24, 1);
    await draw(ctx, smallUrl, 716, 444, 16, 1);
    return c.toDataURL("image/png");
  };
  null; // executeJavaScript returns the last expression; a function can't cross IPC
`;

app.whenReady().then(async () => {
  try {
    const previewAt = process.argv.indexOf("--preview");
    const previewPath = previewAt === -1 ? null : process.argv[previewAt + 1];

    const win = new BrowserWindow({ show: false });
    await win.loadURL("about:blank");
    await win.webContents.executeJavaScript(PAGE_HELPERS, true);

    const full = svgDataUrl("icon.svg");
    const small = svgDataUrl("icon-small.svg");
    const entries = [];
    for (const size of SIZES) {
      entries.push({ size, png: await renderPng(win, size <= SMALL_MAX ? small : full, size) });
    }
    fs.writeFileSync(path.join(iconDir, "icon.ico"), packIco(entries));
    fs.writeFileSync(path.join(iconDir, "icon-256.png"), entries.find((e) => e.size === 256).png);
    console.log(`wrote assets/icon/icon.ico (${SIZES.join(", ")}) and icon-256.png`);

    if (previewPath !== null) {
      const dataUrl = await win.webContents.executeJavaScript(
        `window.renderMontage(${JSON.stringify(full)}, ${JSON.stringify(small)})`,
        true,
      );
      fs.writeFileSync(previewPath, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
      console.log(`wrote preview ${previewPath}`);
    }
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
