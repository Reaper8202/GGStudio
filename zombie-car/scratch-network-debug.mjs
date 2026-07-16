import { chromium } from "playwright-core";

const executablePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let requestCount = 0;
let maxConcurrent = 0;
let inFlight = 0;
const failed = [];

page.on("request", (req) => {
  if (req.url().includes("/assets/graveyard/") || req.url().includes("/assets/zombies/")) {
    requestCount++;
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
  }
});
page.on("requestfinished", (req) => {
  if (req.url().includes("/assets/graveyard/") || req.url().includes("/assets/zombies/")) inFlight--;
});
page.on("requestfailed", (req) => {
  if (req.url().includes("/assets/graveyard/") || req.url().includes("/assets/zombies/")) {
    inFlight--;
    failed.push({ url: req.url(), error: req.failure()?.errorText });
  }
});

await page.goto("http://localhost:5183/", { waitUntil: "load" });
await page.waitForTimeout(4000);

console.log("total asset requests:", requestCount);
console.log("max concurrent:", maxConcurrent);
console.log("failed:", failed.length);
console.log(JSON.stringify(failed.slice(0, 10), null, 2));

await browser.close();
