// Run against the local preview; all lead requests are intercepted, never sent.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.SITE_URL || 'http://127.0.0.1:8080';

async function checkMenuCenter(page) {
  const offset = await page.locator('#site-nav > a').evaluateAll(links =>
    (links[0].getBoundingClientRect().left + links.at(-1).getBoundingClientRect().right) / 2 - innerWidth / 2);
  assert.ok(Math.abs(offset) < 1, 'Desktop menu is off-center by ' + offset + 'px');
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('perfecto_cookie', 'no'));
    await page.route('**/mc.yandex.ru/**', route => route.abort());
    let lead;
    await page.route('**/lead', async route => {
      if (route.request().method() === 'POST') lead = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true }, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
    });

    for (const width of [320, 375, 390, 768, 1024, 1101, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(base + '/index.html');
      assert.match(await page.locator('.hero h1').innerText(), /Мебель на заказ/i);
      assert.equal(await page.locator('#works').count(), 0);
      assert.equal(await page.locator('.cat-photo img[src="images/work-01.jpg"]').count(), 1);
      assert.equal(await page.locator('img[src="images/kitchen.jpg"]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const mobile = width <= 1100;
      assert.equal(await page.locator('.menu-toggle').isVisible(), mobile);
      if (mobile) {
        const logo = await page.locator('.site-header .logo').boundingBox();
        assert.ok(Math.abs(logo.x + logo.width / 2 - width / 2) < 1, 'Mobile logo must be centered');
        await page.locator('.menu-toggle').click();
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#site-nav a').first().isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.menu-toggle').evaluate(e => e === document.activeElement), true);
        await page.locator('.menu-toggle').click();
        await page.locator('#site-nav > a[href="#catalog"]').click();
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
      } else {
        await checkMenuCenter(page);
        const items = await page.locator('.site-header .hrow > .logo, .site-header nav, .site-header .header-actions').evaluateAll(elements => elements.map(e => {
          const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, scroll: e.scrollWidth, width: e.clientWidth };
        }));
        for (let i = 1; i < items.length; i++) assert.ok(items[i].left >= items[i - 1].right, 'Header items overlap');
        for (const item of items) assert.ok(item.scroll <= item.width + 1, 'Header content is clipped');
      }
      await page.locator('.cat .go').first().click();
      await page.waitForURL(url => url.pathname.endsWith('/raboty.html') && url.hash === '#kitchen');
      assert.equal(await page.locator('#category-title').innerText(), 'Кухни');
      assert.equal(await page.locator('.card:visible').count(), 3);
      assert.equal(await page.locator('.cta .btn-lime').innerText(), 'Записаться на встречу');
      if (!mobile) await checkMenuCenter(page);
      console.log('PASS home → kitchens, width ' + width);
    }

    for (const category of ['kitchen', 'wardrobe', 'dressing', 'hallway', 'kids', 'bath', 'other']) {
      await page.goto(base + '/raboty.html#' + category);
      const cards = page.locator('.card:visible');
      assert.ok(await cards.count() > 0);
      assert.ok((await cards.evaluateAll(elements => elements.map(e => e.dataset.cat))).every(value => value === category));
      assert.ok(await cards.evaluateAll(elements => elements.every(e => e.querySelector('img').getAttribute('src') !== 'images/kitchen.jpg')));
      await cards.first().locator('button').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#photo-dialog').evaluate(e => e.open), true);
      await page.locator('#photo-full').evaluate(img => img.decode());
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#photo-dialog').evaluate(e => e.open), false);
      assert.equal(await cards.first().locator('button').evaluate(e => e === document.activeElement), true);
      console.log('PASS category + keyboard photo viewer: ' + category);
    }
    await page.locator('[data-f="kitchen"]').click();
    await page.waitForURL(url => url.pathname.endsWith('/raboty.html') && url.hash === '#kitchen');
    await page.locator('[data-f="wardrobe"]').click();
    await page.waitForURL(url => url.pathname.endsWith('/raboty.html') && url.hash === '#wardrobe');
    await page.goBack();
    assert.equal(await page.locator('#category-title').innerText(), 'Кухни');
    await page.goto(base + '/raboty.html#unknown');
    assert.equal(await page.locator('.card:visible').count(), 17);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/index.html#contacts');
    assert.equal(await page.locator('#leadForm').evaluate(form => form.checkValidity()), false);
    await page.locator('[name="name"]').fill('Проверка сайта');
    await page.locator('[name="phone"]').fill('+7 900 000-00-00');
    await page.locator('#leadForm [type="checkbox"]').check();
    const request = page.waitForRequest(r => r.url().endsWith('/lead') && r.method() === 'POST');
    await page.locator('#leadForm [type="submit"]').click();
    await request;
    await page.waitForURL('**/spasibo.html');
    assert.equal(lead['Источник'], 'запись на встречу в студии');
    assert.match(await page.locator('main').innerText(), /время встречи в студии/);
    assert.deepEqual(errors, []);
    console.log('PASS history, invalid category, required consent, meeting form (mocked), no JavaScript errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
