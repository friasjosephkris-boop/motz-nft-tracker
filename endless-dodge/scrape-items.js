// Scrapes all land items from app.axieinfinity.com/marketplace/items/
// Run: cd endless-dodge && npm i puppeteer && node scrape-items.js
// Output: ./assets/items/<slug>.png  +  ./assets/items/_index.json

const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const OUT_DIR = path.join(__dirname, 'assets', 'items');
const URL = 'https://app.axieinfinity.com/marketplace/items/';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': 'https://app.axieinfinity.com/',
        'Origin': 'https://app.axieinfinity.com',
        'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    };
    https.get(url, opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
    }).on('error', reject);
  });
}

const stripId = s => s.replace(/\s*#\d+\s*$/, '').trim();

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36');

  console.log('Loading marketplace... (browser window opened — let it fully load)');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Wait for the item icons to actually render. The sidebar shows a long list of small icons + names.
  console.log('Waiting for items list to render (up to 60s)...');
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => /axieinfinity\.com|axiecdn/i.test(i.currentSrc || i.src || ''));
    return imgs.length > 10;
  }, { timeout: 60000 }).catch(() => console.log('  (timed out waiting — will harvest whatever rendered)'));
  await new Promise(r => setTimeout(r, 2000));

  // The items list is a virtualised scroll panel. Find it, then keep scrolling until item count stabilises.
  const seen = new Map(); // name -> imageUrl

  async function harvest() {
    const batch = await page.evaluate(() => {
      const out = [];
      // Each row has an <img> and a name. Grab every img on the page; filter by CDN host.
      for (const img of document.querySelectorAll('img')) {
        const src = img.currentSrc || img.src;
        if (!src) continue;
        // Item icons live on axieinfinity's CDN — accept any CDN png/webp
        if (!/axieinfinity\.com|axiecdn/i.test(src)) continue;
        // Walk up to find a name (text sibling)
        let name = (img.alt || '').trim();
        if (!name) {
          let el = img.parentElement;
          for (let i = 0; i < 4 && el && !name; i++, el = el.parentElement) {
            const t = el.innerText && el.innerText.trim().split('\n')[0];
            if (t && t.length < 80) name = t;
          }
        }
        if (name) out.push({ name, src });
      }
      return out;
    });
    for (const { name, src } of batch) {
      const key = stripId(name);
      if (key && !seen.has(key)) seen.set(key, src);
    }
  }

  // Find the scrollable container holding the list
  const containerHandle = await page.evaluateHandle(() => {
    const cands = Array.from(document.querySelectorAll('*')).filter(el => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 200;
    });
    cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return cands[0] || document.scrollingElement;
  });

  let lastCount = -1, stable = 0;
  for (let i = 0; i < 2000 && stable < 6; i++) {
    await harvest();
    await page.evaluate(el => { el.scrollBy(0, el.clientHeight * 0.9); }, containerHandle);
    await new Promise(r => setTimeout(r, 350));
    if (seen.size === lastCount) stable++; else { stable = 0; lastCount = seen.size; }
    if (i % 10 === 0) console.log(`  scrolled ${i}, items so far: ${seen.size}`);
  }
  await harvest();
  console.log(`Discovered ${seen.size} items. Downloading...`);

  const index = [];
  let i = 0;
  for (const [name, src] of seen) {
    i++;
    const ext = (src.match(/\.(png|webp|jpg|jpeg|gif)/i) || [, 'png'])[1].toLowerCase();
    const file = `${slug(name)}.${ext}`;
    const dest = path.join(OUT_DIR, file);
    try {
      if (!fs.existsSync(dest)) await download(src, dest);
      index.push({ name, file, src });
      if (i % 20 === 0) console.log(`  ${i}/${seen.size}`);
    } catch (e) {
      console.warn('  skip', name, e.message);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(index, null, 2));
  console.log(`Done. ${index.length} files in ${OUT_DIR}`);
  await browser.close();
})();
