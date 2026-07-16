import { chromium } from "playwright-core";

const executablePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:5183/debug-road-viewer.html", { waitUntil: "load" });
await page.waitForFunction(() => window.__viewerDone === true, { timeout: 20000 });
await page.waitForTimeout(300);
await page.screenshot({ path: process.argv[2] || "viewer.png", fullPage: true });
await browser.close();
