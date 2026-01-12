import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { AIEvent, AIR, ClickEvent, InputEvent, NavEvent } from './types.js';
import { saveIR } from './utils.js';

export interface RecordOptions {
  url: string; // 可为空字符串，表示不主动导航，由用户手动输入/跳转
  outPath?: string;
  headless?: boolean;
}

export interface RecordSession {
  stop: () => Promise<string>;
}

export async function startRecording(options: RecordOptions): Promise<RecordSession> {
  // Playwright 会依据 PLAYWRIGHT_BROWSERS_PATH 自动解析内置浏览器
  // 运行时不再硬编码 executablePath，避免版本/目录变动导致失败
  const browser: Browser = await chromium.launch({
    headless: options.headless ?? false,
  });
  const context = await browser.newContext();

  const startedAt = Date.now();
  const events: AIEvent[] = [];
  let finished = false;
  let finalPath = '';
  let activePages = 0;
  let firstVisitedUrl: string | null = options.url?.trim() ? options.url.trim() : null;

  // 统一的事件桥接：多个 page 共用同一收集逻辑
  const attachPage = async (page: Page) => {
    // Collect navigation events
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const currentUrl = page.url();
        if (!firstVisitedUrl && currentUrl) {
          firstVisitedUrl = currentUrl;
        }
        events.push({
          type: 'navigation',
          url: currentUrl,
          ts: Date.now(),
        } as NavEvent);
      }
    });

    // Bridge from page -> node for DOM events
    await page.exposeFunction('aiRecordEvent', (payload: any) => {
      const now = Date.now();
      if (payload && payload.type === 'click') {
        const ev: ClickEvent = {
          type: 'click',
          selector: payload.selector ?? '',
          x: payload.x,
          y: payload.y,
          ts: now,
        };
        events.push(ev);
      } else if (payload && payload.type === 'input') {
        const ev: InputEvent = {
          type: 'input',
          selector: payload.selector ?? '',
          value: payload.value ?? '',
          ts: now,
        };
        events.push(ev);
      }
    });

    // Inject recorder for click/input
    await page.addInitScript(() => {
      // Build a simple selector for an element
      function buildSelector(el: Element | null): string {
        if (!el) return '';
        const id = (el as HTMLElement).id;
        if (id) {
          try {
            return `#${CSS.escape(id)}`;
          } catch {
            return `#${id}`;
          }
        }
        const tag = el.tagName.toLowerCase();
        const classes = (el as HTMLElement).classList ? Array.from((el as HTMLElement).classList) : [];
        const safeClasses = classes.map(c => {
          try {
            return CSS.escape(c);
          } catch {
            return c;
          }
        });
        let sel = tag;
        if (safeClasses.length) {
          sel += '.' + safeClasses.join('.');
        }
        return sel;
      }

      document.addEventListener('click', (e) => {
        try {
          const t = e.target as HTMLElement | null;
          const selector = buildSelector(t);
          (window as any).aiRecordEvent({
            type: 'click',
            selector,
            x: (e as MouseEvent).clientX,
            y: (e as MouseEvent).clientY,
          });
        } catch {
          // swallow
        }
      }, true);

      document.addEventListener('input', (e) => {
        try {
          const t = e.target as HTMLInputElement | HTMLTextAreaElement | null;
          const selector = buildSelector(t);
          const value = t && 'value' in (t as any) ? ((t as any).value ?? '') : '';
          (window as any).aiRecordEvent({
            type: 'input',
            selector,
            value,
          });
        } catch {
          // swallow
        }
      }, true);
    });

    // 记录活跃页面数，全部关闭后再结束
    activePages += 1;
    page.once('close', async () => {
      activePages -= 1;
      if (activePages <= 0) {
        console.log('[AI Tester] All pages closed, finalizing...');
        await finalize();
      }
    });
  };

  const finalize = async (): Promise<string> => {
    if (finished) return finalPath;
    finished = true;
    const ir: AIR = {
      version: '1.0',
      meta: {
        url: firstVisitedUrl ?? (options.url?.trim() ? options.url.trim() : 'about:blank'),
        startedAt,
        finishedAt: Date.now(),
      },
      steps: events,
    };
    // 兼容打包后不可写的工作目录，优先写入用户数据目录
    const defaultBase = (() => {
      if (process.versions?.electron) {
        try {
          const { app } = require('electron') as typeof import('electron');
          return path.join(app.getPath('userData'), 'recordings');
        } catch {
          return path.join(process.cwd(), 'recordings');
        }
      }
      return path.join(process.cwd(), 'recordings');
    })();
    finalPath = options.outPath ?? path.join(defaultBase, `session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    saveIR(finalPath, ir);
    try {
      await browser.close();
    } catch {
      // ignore
    }
    return finalPath;
  };

  // 新页面监听：用户手动打开新 Tab 也能被录制（上下文监听，更符合 Playwright 类型）
  context.on('page', async (p: Page) => {
    await attachPage(p);
  });

  // 创建首个页面并附加监听
  const page: Page = await context.newPage();
  await attachPage(page);

  // 若未提供起始 URL，则停留在 about:blank，用户可手动输入跳转
  if (options.url?.trim()) {
    await page.goto(options.url);
  } else {
    firstVisitedUrl = firstVisitedUrl ?? 'about:blank';
  }

  console.log('[AI Tester] Recording started.');
  console.log('[AI Tester] Press Ctrl+C to stop, or close the browser window.');

  return {
    stop: finalize
  };
}