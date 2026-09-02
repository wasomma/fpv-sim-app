/*
 * Electron entry used by scripts/build-manual.mjs: load the rendered manual
 * HTML in a hidden window, wait for images and fonts, print to PDF with
 * page numbers, exit. Plain CJS so `electron <this file>` needs no build.
 *
 *   electron scripts/manual-pdf-main.cjs <manual.html> <out.pdf>
 */

const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");

const [htmlPath, pdfPath] = process.argv.slice(-2);
if (!htmlPath || !pdfPath) {
  console.error("usage: electron scripts/manual-pdf-main.cjs <manual.html> <out.pdf>");
  app.exit(2);
}

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1400,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await win.loadFile(htmlPath);
    await win.webContents.executeJavaScript(
      `Promise.all([...document.images].map((i) => (i.complete ? true : new Promise((r) => { i.onload = i.onerror = () => r(true); }))))` +
        `.then(() => document.fonts.ready).then(() => true)`,
    );
    const missing = await win.webContents.executeJavaScript(
      `[...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"))`,
    );
    if (missing.length > 0) console.warn(`warning: ${missing.length} image(s) failed to load:\n  ${missing.join("\n  ")}`);
    const buf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.55, bottom: 0.7, left: 0.55, right: 0.55 },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        `<div style="font-size:8px;width:100%;text-align:center;color:#5b6650;font-family:Segoe UI,Arial,sans-serif">` +
        `FPV Sim — User Manual &nbsp;·&nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    writeFileSync(pdfPath, buf);
    console.log(`wrote ${pdfPath} (${buf.length} bytes)`);
    win.destroy();
    app.exit(0);
  })
  .catch((err) => {
    console.error("manual-pdf failed:", err);
    app.exit(1);
  });
