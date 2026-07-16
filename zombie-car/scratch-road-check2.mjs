import { chromium } from "playwright-core";

const executablePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on("console", (msg) => { if (msg.type() === "error") errs.push(msg.text().slice(0,200)); });
page.on("pageerror", (err) => errs.push(err.message.slice(0,200)));

await page.goto("http://localhost:5183/", { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.screenshot({ path: process.argv[2] || "road-check.png" });
console.log("errors:", [...new Set(errs)].slice(0, 5));
await browser.close();
