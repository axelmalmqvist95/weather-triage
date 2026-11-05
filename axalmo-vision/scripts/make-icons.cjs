// Engångsskript: renderar icon.svg till PNG (kräver Playwright). Körs inte vid build.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const dir = path.resolve(__dirname, '../public/icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, name) });
    await page.close();
  }
  await browser.close();
})();
