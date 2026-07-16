import { chromium } from "playwright-core";

const executablePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("console", (msg) => { if (msg.type() === "error") errs.push(msg.text().split("\n")[0]); });

await page.goto("http://localhost:5183/", { waitUntil: "load" });
await page.waitForTimeout(5000);
console.log("errors:", [...new Set(errs)]);
await page.screenshot({ path: process.argv[2] || "road-check.png" });
await browser.close();
