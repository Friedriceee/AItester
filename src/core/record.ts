import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'child_process';
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

// 确保浏览器已安装，如果没有则自动安装
async function ensureBrowserInstalled(): Promise<void> {
  try {
    // 尝试启动浏览器检查是否已安装
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    console.log('[AI Tester] Browser already installed.');
  } catch (error: any) {
    if (error.message && error.message.includes('Executable doesn\'t exist')) {
      console.log('[AI Tester] Browser not found, installing...');
      try {
        // 在Electron环境中，使用用户数据目录作为浏览器安装位置
        let browsersPath = 'playwright-browsers';
        if (process.versions?.electron) {
          try {
            const { app } = require('electron') as typeof import('electron');
            browsersPath = path.join(app.getPath('userData'), 'playwright-browsers');
          } catch {
            browsersPath = path.join(process.cwd(), 'playwright-browsers');
          }
        }
        
        // 设置环境变量并安装浏览器
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
        console.log(`[AI Tester] Installing browser to: ${browsersPath}`);
        
        // 使用Playwright CLI安装Chromium
        execSync('npx playwright install chromium', {
          stdio: 'inherit',
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath }
        });
        
        console.log('[AI Tester] Browser installation completed.');
      } catch (installError: any) {
        console.error('[AI Tester] Failed to install browser:', installError.message);
        throw new Error(`无法安装浏览器: ${installError.message}`);
      }
    } else {
      throw error;
    }
  }
}

export async function startRecording(options: RecordOptions): Promise<RecordSession> {
  // 确保浏览器已安装
  await ensureBrowserInstalled();
  
  // 根据环境变量确定浏览器路径
  let executablePath: string | undefined;
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    // 根据平台确定正确的可执行文件路径
    const platform = process.platform;
    if (platform === 'win32') {
      executablePath = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1200', 'chrome-win64', 'chrome.exe');
    } else if (platform === 'darwin') {
      executablePath = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1200', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    } else {
      executablePath = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1200', 'chrome-linux', 'chrome');
    }
  }

  // 启动浏览器
  const browser: Browser = await chromium.launch({
    headless: options.headless ?? false,
    executablePath: executablePath,
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