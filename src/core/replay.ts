import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { ClickEvent, InputEvent, NavEvent } from './types.js';
import { loadIR } from './utils.js';

export async function replayIR(irPath: string) {
  const ir = loadIR(irPath);
  const browser: Browser = await chromium.launch({ headless: false });
  const page: Page = await browser.newPage();

  console.log(`[AI Tester] Replaying IR from: ${irPath}`);
  await page.goto(ir.meta.url);

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  for (const step of ir.steps) {
    try {
      if (step.type === 'navigation') {
        console.log(` -> navigation: ${step.url}`);
        await page.goto((step as NavEvent).url);
      } else if (step.type === 'click') {
        const s = step as ClickEvent;
        console.log(` -> click: ${s.selector}`);
        if (s.selector) {
          await page.click(s.selector);
        }
      } else if (step.type === 'input') {
        const s = step as InputEvent;
        console.log(` -> input: ${s.selector} = "${s.value}"`);
        if (s.selector) {
          // prefer fill over type to match final value
          await page.fill(s.selector, s.value ?? '');
        }
      }
      await delay(200);
    } catch (err) {
      console.warn(`Step failed: ${JSON.stringify(step)} - ${String(err)}`);
    }
  }

  console.log('[AI Tester] Replay finished.');
  await browser.close();
}