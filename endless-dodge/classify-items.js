// Classifies each downloaded item by environment (Savannah / Forest / Arctic / Mystic).
// Run after scrape-items.js. Updates assets/items/_index.json with an `environments` array per item.
// Run: node classify-items.js

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const OUT_DIR = path.join(__dirname, 'assets', 'items');
const INDEX = path.join(OUT_DIR, '_index.json');
const URL = 'https://app.axieinfinity.com/marketplace/items/';
const ENVS = ['Savannah', 'Forest', 'Arctic', 'Mystic'];

const stripId = s => s.replace(/\s*#\d+\s*$/, '').trim();

(async () => {
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const byName = new Map(index.map(x => [x.name, x]));
  for (const x of index) x.environments = x.environments || [];

  const browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: ['--start-maximized'] });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log('Loading marketplace... clear any Cloudflare challenge in the visible window.');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => /axieinfinity\.com|axiecdn/i.test(i.currentSrc || i.src || ''));
    return imgs.length > 10;
  }, { timeout: 90000 }).catch(() => console.log('  (timed out, continuing)'));
  await new Promise(r => setTimeout(r, 2500));

  async function clickEnv(name) {
    // Try Puppeteer's text selector first (most reliable for visible text)
    try {
      const el = await page.waitForSelector(`::-p-text(${name})`, { timeout: 4000, visible: true });
      if (el) {
        // Walk up to a clickable ancestor (the chip wrapper)
        await el.evaluate(node => {
          let click = node;
          for (let i = 0; i < 5 && click; i++) {
            const cs = getComputedStyle(click);
            if (click.tagName === 'BUTTON' || click.getAttribute('role') === 'button' || cs.cursor === 'pointer') break;
            click = click.parentElement;
          }
          (click || node).scrollIntoView({ block: 'center' });
        });
        await new Promise(r => setTimeout(r, 300));
        // Use mouse click at element center for real event dispatching
        const box = await el.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          console.log(`  clicked ${name}`);
          await new Promise(r => setTimeout(r, 2500));
          return true;
        }
      }
    } catch (e) {
      console.log(`  ::-p-text failed for ${name}: ${e.message.split('\n')[0]}`);
    }
    console.log(`  (couldn't click ${name})`);
    return false;
  }

  async function harvestNames() {
    const container = await page.evaluateHandle(() => {
      const cands = Array.from(document.querySelectorAll('*')).filter(el => {
        const s = getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200;
      });
      cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      return cands[0] || document.scrollingElement;
    });

    const found = new Set();
    const grab = async () => {
      const batch = await page.evaluate(() => {
        const out = [];
        for (const img of document.querySelectorAll('img')) {
          const src = img.currentSrc || img.src;
          if (!src || !/axieinfinity\.com|axiecdn/i.test(src)) continue;
          let name = (img.alt || '').trim();
          if (!name) {
            let el = img.parentElement;
            for (let i = 0; i < 4 && el && !name; i++, el = el.parentElement) {
              const t = el.innerText && el.innerText.trim().split('\n')[0];
              if (t && t.length < 80) name = t;
            }
          }
          if (name) out.push(name);
        }
        return out;
      });
      for (const n of batch) {
        const k = stripId(n);
        if (k) found.add(k);
      }
    };

    let last = -1, stable = 0;
    for (let i = 0; i < 2000 && stable < 6; i++) {
      await grab();
      await page.evaluate(el => el.scrollBy(0, el.clientHeight * 0.9), container);
      await new Promise(r => setTimeout(r, 300));
      if (found.size === last) stable++; else { stable = 0; last = found.size; }
      if (i % 15 === 0) console.log(`    scrolled ${i}, found ${found.size}`);
    }
    await grab();
    return found;
  }

  for (const env of ENVS) {
    console.log(`\n[${env}] applying filter...`);
    await clickEnv(env);
    // Scroll list back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 800));
    const names = await harvestNames();
    console.log(`[${env}] ${names.size} items`);
    for (const n of names) {
      const item = byName.get(n);
      if (item) { if (!item.environments.includes(env)) item.environments.push(env); }
    }
    // Toggle off before next env
    await clickEnv(env);
  }

  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));
  const unclassified = index.filter(x => !x.environments.length).map(x => x.name);
  console.log(`\nDone. Classified ${index.length - unclassified.length}/${index.length}.`);
  if (unclassified.length) console.log('Unclassified:', unclassified.join(', '));
  await browser.close();
})();
