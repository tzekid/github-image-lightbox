// End-to-end tests against live github.com pages in Playwright's WebKit.
// The extension's content.js/content.css are injected at document start, the
// same way Safari injects the declared content scripts.
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const contentJS = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const contentCSS = readFileSync(new URL("../extension/content.css", import.meta.url), "utf8");

const ISSUE = "https://github.com/cli/cli/issues/11260"; // uploaded screenshots
const PR = "https://github.com/cli/cli/pull/14130"; // screenshot in a PR description
const README = "https://github.com/sharkdp/bat"; // repo image, Camo images, CI badge
const GIF_README = "https://github.com/charmbracelet/bubbletea"; // <animated-image>
const LINKED_LOGO_README = "https://github.com/astral-sh/uv"; // image linking to a website

const ATTACHMENT = '.markdown-body a[href^="https://private-user-images.githubusercontent.com/"] img';

const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript({ content: contentJS });
    // Safari injects declared CSS itself; here it goes in as soon as the DOM
    // exists, outside <head>/<body> so GitHub navigation keeps it.
    await page.addInitScript((css) => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = css;
        document.documentElement.append(style);
      });
    }, contentCSS);
    await use(page);
  },
});

const dialog = (page) => page.locator("#github-image-lightbox-root");
const preview = (page) => dialog(page).locator(".ghil-image");
const htmlOverflow = (page) => page.evaluate(() => getComputedStyle(document.documentElement).overflow);
const scrollY = (page) => page.evaluate(() => window.scrollY);

function trackNewPages(context) {
  const pages = [];
  context.on("page", (p) => pages.push(p));
  return pages;
}

// Live GitHub pages still shift layout after load (sticky headers, hydration),
// which occasionally makes a click land on a neighbour. Retry until it opens.
async function openViewer(page, image) {
  await expect(async () => {
    await image.scrollIntoViewIfNeeded();
    await image.click();
    await expect(dialog(page)).toHaveAttribute("data-state", "loaded", { timeout: 3_000 });
  }).toPass();
  return image;
}

const openFirstAttachment = (page) => openViewer(page, page.locator(ATTACHMENT).first());

test.describe("issue screenshot", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ISSUE);
    await page.locator(ATTACHMENT).first().waitFor();
  });

  test("opens in the current tab and Escape restores the page", async ({ page, context }) => {
    const newPages = trackNewPages(context);
    const url = page.url();
    const image = page.locator(ATTACHMENT).first();
    await image.scrollIntoViewIfNeeded();
    const before = await scrollY(page);

    await image.click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute("data-state", "loaded");
    await expect(dialog(page)).toHaveAccessibleName("Image preview");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    // Same (signed) URL GitHub rendered, query parameters included.
    const rendered = await image.evaluate((img) => img.currentSrc);
    expect(await preview(page).getAttribute("src")).toBe(rendered);
    expect(await preview(page).getAttribute("alt")).toBe(await image.getAttribute("alt"));
    await expect(dialog(page).getByRole("link", { name: "Open original link" })).toHaveAttribute(
      "href",
      await image.evaluate((img) => img.closest("a").href)
    );
    expect(await htmlOverflow(page)).toBe("hidden");

    await page.keyboard.press("Escape");

    await expect(dialog(page)).toBeHidden();
    expect(await htmlOverflow(page)).not.toBe("hidden");
    expect(await scrollY(page)).toBe(before);
    expect(page.url()).toBe(url);
    expect(newPages).toHaveLength(0);
    await expect(preview(page)).toHaveCount(0);
  });

  test("Close button and backdrop close; image clicks and drags keep it open", async ({ page }) => {
    await openFirstAttachment(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();

    await openFirstAttachment(page);
    await preview(page).click();
    await expect(dialog(page)).toBeVisible();

    const viewport = page.viewportSize();
    await page.mouse.click(4, viewport.height - 4);
    await expect(dialog(page)).toBeHidden();

    // Press on the image, release on the backdrop: not a backdrop click.
    await openFirstAttachment(page);
    const box = await preview(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(4, viewport.height - 4, { steps: 5 });
    await page.mouse.up();
    await expect(dialog(page)).toBeVisible();
  });

  test("keyboard: Enter opens, focus stays in the viewer, Escape returns focus", async ({ page }) => {
    const link = page.locator(ATTACHMENT).first().locator("xpath=..");
    await link.focus();
    await page.keyboard.press("Enter");

    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    // Safari only tabs to links with Option held (default "Press Tab to highlight" off).
    await page.keyboard.press("Alt+Shift+Tab");
    await expect(dialog(page).getByRole("link", { name: "Open original link" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(link).toBeFocused();
  });

  test("Cmd-click and middle-click keep normal browser behavior", async ({ page, context }) => {
    const image = page.locator(ATTACHMENT).first();
    await image.scrollIntoViewIfNeeded();

    const [cmdTab] = await Promise.all([context.waitForEvent("page"), image.click({ modifiers: ["Meta"] })]);
    expect(cmdTab).toBeTruthy();
    await expect(dialog(page)).toHaveCount(0);

    const [middleTab] = await Promise.all([context.waitForEvent("page"), image.click({ button: "middle" })]);
    expect(middleTab).toBeTruthy();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("broken image shows an error and keeps the controls usable", async ({ page, context }) => {
    const newPages = trackNewPages(context);
    const broken = "https://github.com/ghil-definitely-missing.png";
    await page.locator(ATTACHMENT).first().evaluate((img, url) => {
      img.closest("a").href = url;
      img.src = url;
    }, broken);

    await page.locator(".markdown-body a img").first().click();

    await expect(dialog(page)).toHaveAttribute("data-state", "error");
    await expect(dialog(page).getByRole("status")).toHaveText("Couldn't load this preview.");
    await expect(dialog(page).getByRole("link", { name: "Open original link" })).toHaveAttribute("href", broken);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(newPages).toHaveLength(0);
  });

  test("repeated opening and closing leaves no residue", async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await openFirstAttachment(page);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
    }
    await expect(dialog(page)).toHaveCount(1);
    await expect(preview(page)).toHaveCount(0);
    expect(await htmlOverflow(page)).not.toBe("hidden");
  });

  test("small window: image fits and controls stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 320 });
    await openFirstAttachment(page);
    const box = await preview(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(420);
    expect(box.y + box.height).toBeLessThanOrEqual(320);
    await expect(page.getByRole("button", { name: "Close" })).toBeInViewport({ ratio: 1 });
    await expect(dialog(page).getByRole("link", { name: "Open original link" })).toBeInViewport({ ratio: 1 });
  });
});

test("tall image fits within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(ISSUE);
  // Turn a real attachment into a tall image by constraining nothing but its
  // natural size: use a portrait SVG data URL as both source and link.
  const tall = "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="3000"><rect width="400" height="3000" fill="teal"/></svg>'
  );
  await page.locator(ATTACHMENT).first().evaluate((img, url) => {
    img.closest("a").href = url;
    img.src = url;
  }, tall);
  await page.locator(".markdown-body a img").first().click();
  await expect(dialog(page)).toHaveAttribute("data-state", "loaded");
  const box = await preview(page).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(400);
  expect(box.height).toBeGreaterThan(200);
  await expect(page.getByRole("button", { name: "Close" })).toBeInViewport({ ratio: 1 });
});

test("PR description screenshot opens", async ({ page }) => {
  await page.goto(PR);
  await openFirstAttachment(page);
});

test.describe("README", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(README);
    await page.locator(".markdown-body a img").first().waitFor();
  });

  test("repository image opens; original link stays the blob page", async ({ page }) => {
    const image = await openViewer(page, page.locator('.markdown-body a[href$="/blob/master/doc/logo-header.svg"] img'));
    expect(await preview(page).getAttribute("src")).toBe(await image.evaluate((img) => img.currentSrc));
    await expect(dialog(page).getByRole("link", { name: "Open original link" })).toHaveAttribute(
      "href",
      "https://github.com/sharkdp/bat/blob/master/doc/logo-header.svg"
    );
  });

  test("Camo-hosted screenshot keeps the proxy source", async ({ page }) => {
    await openViewer(page, page.locator('.markdown-body a[href^="https://camo.githubusercontent.com/"] img[data-canonical-src*="imgur"]').first());
    expect(await preview(page).getAttribute("src")).toMatch(/^https:\/\/camo\.githubusercontent\.com\//);
  });

  test("CI badge navigates normally", async ({ page }) => {
    await page.locator('.markdown-body a[href*="/actions"] img').first().click();
    await page.waitForURL(/\/sharkdp\/bat\/actions/);
    await expect(dialog(page)).toHaveCount(0);
  });

  test("context menu is left alone", async ({ page }) => {
    await page.locator('.markdown-body a[href$="/blob/master/doc/logo-header.svg"] img').click({ button: "right" });
    await expect(dialog(page)).toHaveCount(0);
  });
});

test("image linking to another website navigates normally", async ({ page }) => {
  await page.route("https://astral.sh/**", (route) => route.fulfill({ body: "astral" }));
  await page.goto(LINKED_LOGO_README);
  await page.locator('.markdown-body a[href="https://astral.sh"] img').first().click();
  await page.waitForURL("https://astral.sh/");
});

test("animated GIF opens", async ({ page }) => {
  await page.goto(GIF_README);
  const image = await openViewer(page, page.locator("animated-image a img").first());
  expect(await preview(page).getAttribute("src")).toBe(await image.evaluate((img) => img.currentSrc));
});

test("GitHub soft navigation and back/forward", async ({ page }) => {
  await page.goto(README);
  await page.evaluate(() => (window.__noReload = true));
  await page.locator('a[href="/sharkdp/bat/tree/master/doc"]:visible').first().click();
  await page.waitForURL("**/sharkdp/bat/tree/master/doc");
  await page.goBack();

  const logo = page.locator('.markdown-body a[href$="/blob/master/doc/logo-header.svg"] img');
  await openViewer(page, logo);
  await page.goForward();
  await expect(dialog(page)).toBeHidden();
  expect(await htmlOverflow(page)).not.toBe("hidden");

  await page.goBack();
  await openViewer(page, logo);
  await expect(dialog(page)).toHaveCount(1);
  // Everything above happened without a full page load.
  expect(await page.evaluate(() => window.__noReload)).toBe(true);
});
