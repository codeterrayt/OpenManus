// check_browser_console.js
import puppeteer from 'puppeteer';

async function main() {
  console.log('Connecting to browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    const type = msg.type().toUpperCase();
    if (type === 'ERROR' || type === 'WARNING') {
      console.log(`[CONSOLE ${type}]:`, msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]:', err.toString());
  });

  try {
    console.log('Navigating to http://localhost:5173/...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 15000 });
    
    console.log('Waiting for session buttons...');
    await page.waitForSelector('button.w-full.flex.flex-col', { timeout: 10000 });
    
    console.log('Clicking the first session button...');
    await page.click('button.w-full.flex.flex-col');
    
    console.log('Waiting 3 seconds for messages to render...');
    await new Promise(r => setTimeout(r, 3000));

    // Check if GenUI forms rendered
    const forms = await page.$$('form');
    console.log(`Found ${forms.length} form element(s) on page`);

    // Scroll the main content area to the bottom to show the form
    await page.evaluate(() => {
      const scrollContainers = document.querySelectorAll('[class*="overflow"]');
      scrollContainers.forEach(el => {
        el.scrollTop = el.scrollHeight;
      });
    });
    await new Promise(r => setTimeout(r, 1000));

    // Take a screenshot focusing on the form area
    await page.screenshot({ path: 'genui_form.png', fullPage: false });
    console.log('Screenshot saved to genui_form.png');

    // Check for specific GenUI labels
    const labels = await page.$$eval('label', els => els.map(el => el.textContent).filter(t => t && t.trim()));
    console.log('Labels found:', labels);

    // Check for submit buttons
    const buttons = await page.$$eval('button[type="submit"]', els => els.map(el => el.textContent));
    console.log('Submit buttons found:', buttons);

    console.log('Done.');
  } catch (err) {
    console.error('Error during run:', err);
  } finally {
    await browser.close();
  }
}

main();
