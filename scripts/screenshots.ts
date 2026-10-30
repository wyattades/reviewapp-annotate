// The README's images, from the playground:
//
//   docs/hero.png     the review app with a thread open, beside its PR on GitHub
//   docs/mobile.png   the widget on a phone, with the comments list open
//
// Each page is shot on its own, at its own size, by driving the real widget
// (so a comment's screenshot is the widget's own), then framed as browser
// windows and composed. `#screenshot` leaves out the playground's toolbar,
// and the clock is fixed so the times (and so the images) come out the same
// every run.
//
//   pnpm screenshots
//
// Uses the installed Google Chrome, or Playwright's Chromium
// (`pnpm exec playwright install chromium`) when there's none.
import { writeFileSync } from "node:fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { servePlayground } from "./playground.ts";

/** "now", for every shot: the threads' times are minutes before it */
const NOW = new Date("2026-10-30T16:30:00Z");

/** Ada's thread, made by the screenshots, and the reply Grace is writing to her own */
const NEW_COMMENT =
  "This wraps on smaller screens. Can we shorten it to “Start free trial”?";
const DRAFT_REPLY = "Looks great in the new build, thanks!";

const { url, stop } = await servePlayground(4398);

const people = {
  ada: { author: "Ada", authorId: "ada" },
  grace: { author: "Grace", authorId: "grace" },
};

/** A browser context for the playground: fixed clock, and the widget's shadow root open to the script. */
async function playground(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0],
) {
  const context = await browser.newContext(options);
  await context.clock.setFixedTime(NOW);
  // the widget's shadow root is closed; open it so the script can reach in
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
  return context;
}

/** Starts the playground over, signed in as `as`, with the seed threads (plus any `threads`). */
async function reset(page: Page, as: (typeof people)[keyof typeof people]) {
  await page.goto(`${url}/#screenshot`);
  await page.evaluate((user) => {
    localStorage.clear();
    localStorage.setItem("playground-user", JSON.stringify(user));
  }, as);
}

async function signInAs(page: Page, as: (typeof people)[keyof typeof people]) {
  await page.evaluate(
    (user) => localStorage.setItem("playground-user", JSON.stringify(user)),
    as,
  );
}

/** Loaded afresh (a new hash alone wouldn't reload), with the widget showing the PR's threads. */
async function open(page: Page, path: string) {
  await page.goto("about:blank");
  await page.goto(`${url}${path}`);
  await page.locator(".seg.round.main .count").waitFor();
}

/** Ada comments on the Team plan's button the way anyone would: select it, write, send. */
async function addAdasThread(context: BrowserContext) {
  const page = await context.newPage();
  // the same thread whatever is shot next: made on a laptop-sized page
  await page.setViewportSize({ width: 1440, height: 900 });
  await reset(page, people.ada);
  await open(page, "/#screenshot");
  await page.locator(".seg.round.main").click();
  const button = (await page.locator("#plan-team .btn").boundingBox())!;
  await page.mouse.move(button.x - 6, button.y - 6);
  await page.mouse.down();
  await page.mouse.move(
    button.x + button.width + 6,
    button.y + button.height + 6,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  const composer = page.locator(".composer");
  await composer.locator("textarea").fill(NEW_COMMENT);
  // the region's screenshot is attached once it's taken
  await composer.locator(".attachment").waitFor();
  await composer.locator(".primary").click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("playground-threads") ?? "[]").length ===
      3,
  );
  // written a few minutes ago, not at "now"
  await page.evaluate((now) => {
    const threads = JSON.parse(localStorage.getItem("playground-threads")!);
    threads[2].createdAt = new Date(now - 4 * 60_000).toISOString();
    localStorage.setItem("playground-threads", JSON.stringify(threads));
  }, NOW.getTime());
  await page.close();
}

/** The review app: Grace's thread open, her reply half written. */
async function shootApp(browser: Browser) {
  const context = await playground(browser, {
    viewport: { width: 960, height: 842 },
    deviceScaleFactor: 2,
  });
  await addAdasThread(context);
  const page = await context.newPage();
  await page.goto(`${url}/#screenshot`);
  await signInAs(page, people.grace);
  // dragged in from the corner, which the PR's window covers in the hero
  await page.evaluate(() =>
    localStorage.setItem(
      "reviewapp-annotate-bar",
      JSON.stringify({ right: 150, bottom: 20 }),
    ),
  );
  await open(page, "/#screenshot");
  await page.locator('.pin[aria-label^="Thread by Grace"]').click();
  await page.locator(".thread .reply-box textarea").fill(DRAFT_REPLY);
  // nothing hovered
  await page.mouse.move(2, 300);
  await page.waitForTimeout(300);
  const shot = await page.screenshot();
  await context.close();
  return shot;
}

/** The PR on GitHub, scrolled to the review comment. */
async function shootPr(browser: Browser) {
  const context = await playground(browser, {
    viewport: { width: 1100, height: 945 },
    deviceScaleFactor: 2,
  });
  await addAdasThread(context);
  const page = await context.newPage();
  await page.goto(`${url}/pr.html#screenshot`);
  await page
    .locator(
      "#review-comment img[src^='data:image/jpeg'], #review-comment img[src^='data:image/png']",
    )
    .first()
    .waitFor();
  // down to the review comment (GitHub pins a compact title above it)
  await page.evaluate(() => {
    const comment = document.getElementById("review-comment")!;
    scrollTo(0, comment.getBoundingClientRect().top + scrollY - 84);
  });
  await page.waitForTimeout(200);
  const shot = await page.screenshot();
  await context.close();
  return shot;
}

/** On a phone: the list button, with the comments list open. */
async function shootPhone(browser: Browser) {
  const context = await playground(browser, {
    // an iPhone's screen, less its status bar (the frame draws that)
    viewport: { width: 390, height: 797 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await addAdasThread(context);
  const page = await context.newPage();
  await page.goto(`${url}/#screenshot`);
  await signInAs(page, people.grace);
  await open(page, "/#screenshot");
  await page.locator(".seg.round.main").tap();
  await page.locator(".seg.side").tap();
  await page.locator(".panel").waitFor();
  await page.waitForTimeout(300);
  const shot = await page.screenshot();
  await context.close();
  return shot;
}

async function compose(
  browser: Browser,
  path: string,
  html: string,
  width: number,
  height: number,
) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  await page.setContent(html, { waitUntil: "load" });
  writeFileSync(path, await page.screenshot({ omitBackground: false }));
  await page.close();
}

const dataUrl = (png: Buffer) =>
  `data:image/png;base64,${png.toString("base64")}`;

/** A browser window around a screenshot shown `width` wide. */
function windowHtml({
  shot,
  width,
  height,
  tab,
  favicon,
  host,
  path,
}: {
  shot: Buffer;
  width: number;
  height: number;
  tab: string;
  favicon: string;
  host: string;
  path: string;
}) {
  return `
    <div class="window" style="width:${width}px">
      <div class="chrome">
        <div class="tabs"><div class="lights"><i></i><i></i><i></i></div>
          <div class="tab"><span class="fav" style="${favicon}"></span>${tab}</div></div>
        <div class="bar"><span class="nav">← → ↻</span>
          <div class="url"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#6b6490" stroke-width="2.4"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span><b>${host}</b>${path}</span></div></div>
      </div>
      <img src="${dataUrl(shot)}" style="display:block;width:${width}px;height:${height}px" />
    </div>`;
}

const frameCss = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 100vw; height: 100vh; overflow: hidden; position: relative;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: radial-gradient(1200px 700px at 10% 0%, #f3e9cc 0%, transparent 60%),
      radial-gradient(900px 700px at 100% 100%, #e9e7e2 0%, transparent 60%), #f8f6f0; }
  body::before { content: ""; position: absolute; inset: 0;
    background-image: radial-gradient(rgba(28,25,23,.08) 1px, transparent 1px); background-size: 22px 22px; }
  .window { position: absolute; border-radius: 14px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 80px rgba(28,25,23,.22), 0 4px 14px rgba(28,25,23,.10), 0 0 0 1px rgba(28,25,23,.08); }
  .chrome { background: #efedf3; border-bottom: 1px solid #dcd8e4; }
  .tabs { height: 38px; display: flex; align-items: flex-end; gap: 8px; padding: 0 12px; }
  .lights { display: flex; gap: 8px; align-self: center; margin-right: 10px; }
  .lights i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; }
  .lights i:nth-child(2) { background: #febc2e; } .lights i:nth-child(3) { background: #28c840; }
  .tab { height: 31px; min-width: 210px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
    border-radius: 9px 9px 0 0; background: #fff; font-size: 12px; color: #3b3450; }
  .fav { width: 14px; height: 14px; border-radius: 4px; }
  .bar { height: 40px; display: flex; align-items: center; gap: 12px; padding: 0 14px; background: #fff; }
  .nav { color: #8a849a; font-size: 15px; letter-spacing: 8px; }
  .url { flex: 1; height: 28px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
    border-radius: 999px; background: #f1eff5; color: #5c566c; }
  .url b { color: #1f1235; font-weight: 500; }`;

function heroHtml(app: Buffer, pr: Buffer) {
  return `<!doctype html><style>${frameCss}</style>
    <div style="position:absolute;left:32px;top:40px">${windowHtml({
      shot: app,
      width: 960,
      height: 842,
      tab: "Pricing · Lumen",
      favicon: "background:linear-gradient(135deg,#0f766e,#34d399)",
      host: "lumen-web-git-new-pricing-lumen.vercel.app",
      path: "/pricing",
    })}</div>
    <div style="position:absolute;left:864px;top:96px">${windowHtml({
      shot: pr,
      // the PR page is shot at 1100 wide, so GitHub keeps its sidebar
      width: 904,
      height: (945 * 904) / 1100,
      tab: "Redesign the pricing page · Pull Request #128",
      favicon: "background:#1f2328;border-radius:50%",
      host: "github.com",
      path: "/lumen/web/pull/128",
    })}</div>`;
}

function phoneHtml(phone: Buffer) {
  return `<!doctype html><style>${frameCss}
    .phone { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 14px;
      border-radius: 60px; background: #1c1b1f; box-shadow: 0 30px 80px rgba(28,25,23,.3), inset 0 0 0 2px #3a383f; }
    .screen { width: 390px; height: 844px; border-radius: 46px; overflow: hidden; background: #fbfaf7; }
    .screen img { display: block; width: 390px; height: 797px; }
    .status { position: relative; height: 47px; display: flex; align-items: center; justify-content: space-between;
      padding: 4px 30px 0 44px; font: 600 16px -apple-system, sans-serif; color: #14261f; }
    .island { position: absolute; left: 50%; top: 11px; transform: translateX(-50%); width: 120px; height: 34px;
      border-radius: 20px; background: #000; }
    .icons { display: flex; align-items: center; gap: 6px; }
    .battery { width: 25px; height: 12px; border: 1.5px solid #14261f; border-radius: 4px; padding: 1.5px; opacity: .9; }
    .battery i { display: block; height: 100%; width: 75%; border-radius: 1.5px; background: #14261f; }
  </style>
  <div class="phone"><div class="screen">
    <div class="status"><span>9:41</span><span class="island"></span>
      <span class="icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="#14261f"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="#14261f" stroke-width="1.8" stroke-linecap="round"><path d="M1.5 4.5a9.5 9.5 0 0 1 13 0M4 7.2a6 6 0 0 1 8 0"/><circle cx="8" cy="10" r="1" fill="#14261f"/></svg>
        <span class="battery"><i></i></span>
      </span></div>
    <img src="${dataUrl(phone)}" />
  </div></div>`;
}

// after everything above is defined
const browser = await chromium
  .launch({ channel: "chrome" })
  .catch(() => chromium.launch());

try {
  const app = await shootApp(browser);
  const pr = await shootPr(browser);
  const phone = await shootPhone(browser);
  await compose(browser, "docs/hero.png", heroHtml(app, pr), 1800, 1000);
  await compose(browser, "docs/mobile.png", phoneHtml(phone), 520, 1000);
  console.log("wrote docs/hero.png, docs/mobile.png");
} finally {
  await browser.close();
  await stop();
}
