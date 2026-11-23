// Run against the local preview; all lead requests are intercepted, never sent.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = process.env.SITE_URL || 'http://127.0.0.1:8080';

async function checkMenuCenter(page) {
  const offset = await page.locator('#site-nav > a').evaluateAll(links =>
    (links[0].getBoundingClientRect().left + links.at(-1).getBoundingClientRect().right) / 2 - innerWidth / 2);
  assert.ok(Math.abs(offset) < 1, 'Desktop menu is off-center by ' + offset + 'px');
}

async function checkMobileToolbar(browser) {
  const page = await browser.newPage({ isMobile: true, hasTouch: true });
  try {
    await page.addInitScript(() => localStorage.setItem('perfecto_cookie', 'no'));
    const cdp = await page.context().newCDPSession(page);
    for (const [width, height, difference] of [[320, 568, 64], [393, 795, 100], [430, 850, 120], [740, 400, 40]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/index.html');
      // Simulate browser chrome while leaving the area behind it visible.
      await cdp.send('Emulation.setSmallViewportHeightDifferenceOverride', { difference });
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.id = 'viewport-probe';
        probe.style.cssText = 'position:absolute;height:100svh;width:100lvh;visibility:hidden;pointer-events:none';
        document.body.append(probe);
      });
      await page.waitForFunction(difference => {
        const probe = document.getElementById('viewport-probe');
        return probe.offsetWidth - probe.offsetHeight === difference;
      }, difference, { timeout: 5000 });
      await page.locator('#viewport-probe').evaluate(probe => probe.remove());
      await page.evaluate(() => document.fonts.ready);
      const marquee = await page.locator('.marquee').boundingBox();
      const content = await page.locator('.hero-in').boundingBox();
      assert.ok(marquee.y >= height - 1, `Marquee shows behind the toolbar at ${width}×${height}`);
      assert.ok(content.y + content.height <= height - difference, 'Toolbar covers hero content');
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), difference + 60);
      assert.ok((await page.locator('.marquee').boundingBox()).y < height - difference, 'Marquee must appear after scrolling');
      console.log(`PASS mobile toolbar at ${width}×${height}`);
    }
  } finally {
    await page.close();
  }
}

async function checkShortBrowserViewport(browser) {
  // Some in-app browsers report a shorter CSS viewport than the area they paint.
  for (const [width, height, screenWidth, screenHeight] of [
    [320, 504, 320, 568], [393, 695, 393, 852], [440, 792, 440, 956], [760, 340, 852, 393],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height }, screen: { width: screenWidth, height: screenHeight }, isMobile: true, hasTouch: true,
    });
    try {
      await page.addInitScript(() => localStorage.setItem('perfecto_cookie', 'no'));
      await page.goto(base + '/index.html');
      await page.evaluate(() => document.fonts.ready);
      const marquee = page.locator('.marquee');
      assert.ok((await marquee.boundingBox()).y >= screenHeight - 1, `Marquee reaches the toolbar on a ${screenWidth}×${screenHeight} display`);
      const content = await page.locator('.hero-in').boundingBox();
      assert.ok(content.y + content.height <= height, 'First-screen text should fit in the browser viewport');
      await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), screenHeight - height + 60);
      assert.ok((await marquee.boundingBox()).y < height, 'Marquee must appear when scrolling past the first screen');
      console.log(`PASS first screen on ${screenWidth}×${screenHeight} display with ${width}×${height} browser viewport`);
    } finally {
      await page.close();
    }
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await checkShortBrowserViewport(browser);
    await checkMobileToolbar(browser);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('perfecto_cookie', 'no'));
    await page.route('**/mc.yandex.ru/**', route => route.abort());
    let lead;
    let leadStatus = 201;
    await page.route('**/lead', async route => {
      if (route.request().method() === 'POST') lead = route.request().postDataJSON();
      await route.fulfill({ status: route.request().method() === 'POST' ? leadStatus : 200,
        json: { ok: leadStatus === 201, code: leadStatus === 422 ? 'bad_phone' : undefined },
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
    });

    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [667, 375], [768, 1024], [1024, 768], [1101, 720], [1280, 720], [1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/index.html');
      assert.match(await page.locator('.hero h1').innerText(), /Мебель на заказ/i);
      assert.equal(await page.locator('#catalog, .hero-card').count(), 0);
      assert.equal(await page.locator('#works h2').innerText(), 'Наши работы');
      assert.equal(await page.locator('#workGrid img[src="images/work-01.jpg"]').count(), 1);
      assert.equal(await page.locator('img[src="images/kitchen.jpg"]').count(), 0);
      await page.locator('.site-header.brand-motion').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const marquee = await page.locator('.marquee').boundingBox();
      assert.ok(marquee.y >= height - 1, 'Marquee peeks into the hero');
      const logo = await page.locator('.site-header .logo').boundingBox();
      const title = await page.locator('.hero h1').boundingBox();
      assert.ok(Math.abs(logo.x + logo.width / 2 - width / 2) < 1, 'Hero logo must be centered');
      assert.ok(logo.y + logo.height < title.y, 'Hero logo must be above the title');
      await page.evaluate(() => window.scrollTo({ top: 80, behavior: 'instant' }));
      await page.waitForFunction(initialWidth => document.querySelector('.site-header .logo').getBoundingClientRect().width < initialWidth - 1, logo.width);
      const movingLogo = await page.locator('.site-header .logo').boundingBox();
      assert.ok(movingLogo.y < logo.y, 'Logo must move up as the page scrolls');
      await page.evaluate(() => window.scrollTo({ top: 340, behavior: 'instant' }));
      await page.waitForFunction(() => !document.querySelector('.header-brand-slot .logo').style.transform);
      const docked = await page.locator('.site-header .logo').boundingBox();
      const mobile = width <= 1100;
      assert.equal(await page.locator('.menu-toggle').isVisible(), mobile);
      if (mobile) {
        assert.ok(Math.abs(docked.x + docked.width / 2 - width / 2) < 1, 'Mobile header logo must be centered');
        await page.locator('.menu-toggle').click();
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.locator('#site-nav a').first().isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.menu-toggle').evaluate(e => e === document.activeElement), true);
        await page.locator('.menu-toggle').click();
        await page.locator('#site-nav > a[href="#works"]').click();
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
      } else {
        assert.ok(docked.x < width / 4, 'Desktop logo must dock on the left');
        await checkMenuCenter(page);
        const items = await page.locator('.site-header .header-brand-slot, .site-header nav, .site-header .header-actions').evaluateAll(elements => elements.map(e => {
          const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, scroll: e.scrollWidth, width: e.clientWidth };
        }));
        for (let i = 1; i < items.length; i++) assert.ok(items[i].left >= items[i - 1].right, 'Header items overlap');
        for (const item of items) assert.ok(item.scroll <= item.width + 1, 'Header content is clipped');
      }
      const works = page.locator('[data-f="kitchen"]');
      await works.click();
      assert.equal(await page.locator('.work-photo:visible').count(), 3);
      assert.equal(await works.getAttribute('aria-pressed'), 'true');
      console.log(`PASS hero, header, and works at ${width}×${height}`);
    }

    for (const category of ['kitchen', 'wardrobe', 'dressing', 'hallway', 'kids', 'bath', 'other']) {
      await page.locator(`[data-f="${category}"]`).click();
      const cards = page.locator('.work-photo:visible');
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
    await page.locator('[data-f="all"]').click();
    assert.equal(await page.locator('.work-photo:visible').count(), 17);
    await page.goto(base + '/raboty.html#kitchen');
    await page.waitForURL(url => url.searchParams.get('work') === 'kitchen' && url.hash === '#works');
    assert.equal(await page.locator('[data-f="kitchen"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.work-photo:visible').count(), 3);
    await page.goto(base + '/index.html?work=unknown#works');
    assert.equal(await page.locator('.work-photo:visible').count(), 17);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/index.html#contacts');
    assert.equal(await page.locator('#leadForm').evaluate(form => form.checkValidity()), false);
    await page.locator('[name="name"]').fill('Проверка сайта');
    await page.locator('#leadForm [type="checkbox"]').check();
    leadStatus = 422;
    await page.locator('[name="phone"]').fill('abc');
    await page.locator('#leadForm [type="submit"]').click();
    await page.locator('#lead-error:visible').waitFor();
    assert.equal(await page.locator('[name="phone"]').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#lead-error a').isVisible(), false);

    leadStatus = 503;
    await page.locator('[name="phone"]').fill('+7 900 000-00-00');
    await page.locator('#leadForm [type="submit"]').click();
    await page.locator('#lead-error a:visible').waitFor();
    assert.equal(await page.locator('#lead-error a').getAttribute('href'), 'tel:+79044952700');
    assert.equal(new URL(page.url()).hash, '#contacts');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('perfecto_accepted_lead')), null);
    const retryId = lead.requestId;

    leadStatus = 201;
    const request = page.waitForRequest(r => r.url().endsWith('/lead') && r.method() === 'POST');
    await page.locator('#leadForm [type="submit"]').click();
    await request;
    await page.waitForURL('**/spasibo.html');
    assert.equal(lead.requestId, retryId);
    assert.equal(lead.consent, true);
    assert.equal(lead.consentVersion, '2026-11-23');
    await page.locator('#lead-confirmation:visible').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS legacy links, invalid category, required consent, phone validation, error fallback, successful retry');

    const clean = await browser.newPage();
    let trackerRequests = 0;
    await clean.route('**/mc.yandex.ru/**', route => { trackerRequests++; return route.abort(); });
    await clean.goto(base + '/');
    await clean.locator('#ckbar:visible').waitFor();
    assert.equal(trackerRequests, 0);
    await clean.locator('#ckNo').click();
    await clean.reload();
    assert.equal(trackerRequests, 0);
    await clean.evaluate(() => localStorage.removeItem('perfecto_cookie'));
    await clean.reload();
    const tracker = clean.waitForRequest('**/mc.yandex.ru/metrika/tag.js');
    await clean.locator('#ckOk').click();
    await tracker;
    assert.equal(await clean.evaluate(() => window.ym.a.some(event => event[1] === 'reachGoal')), false);
    await clean.goto(base + '/spasibo.html');
    assert.equal(await clean.locator('#lead-confirmation').isVisible(), false);
    assert.equal(await clean.evaluate(() => window.ym.a.some(event => event[1] === 'reachGoal')), false);
    await clean.route('**/lead', route => route.fulfill({ status: 200, json: { ok: true },
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } }));
    await clean.goto(base + '/index.html#contacts');
    await clean.locator('[name="phone"]').fill('+7 900 000-00-00');
    await clean.locator('#leadForm [type="checkbox"]').check();
    await clean.locator('#leadForm [type="submit"]').click();
    await clean.waitForURL('**/spasibo.html');
    await clean.locator('#lead-confirmation:visible').waitFor();
    assert.equal(await clean.evaluate(() => window.ym.a.filter(event => event[1] === 'reachGoal' && event[2] === 'zayavka').length), 1);
    await clean.reload();
    assert.equal(await clean.evaluate(() => window.ym.a.some(event => event[1] === 'reachGoal')), false);
    await clean.close();
    console.log('PASS analytics after opt-in, conversion once after accepted lead only');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
