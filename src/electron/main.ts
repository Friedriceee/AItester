import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let currentSession: any = null;

/**
 * 检查目录是否存在
 */
function dirExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 最早设置 Playwright 浏览器路径（在任何 playwright 模块加载之前）
 * 目标：在打包后，也能找到你随包带的 browsers 目录
 */
function ensurePlaywrightPath() {
  const packagedCandidates = [
    // resources/app/playwright-browsers
    path.join(process.resourcesPath, 'app', 'playwright-browsers'),

    // app.asar.unpacked/app/playwright-browsers
    path.join(process.resourcesPath, 'app.asar.unpacked', 'app', 'playwright-browsers'),

    // 保留，兼容旧结构
    path.join(process.resourcesPath, 'playwright-browsers'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'playwright-browsers'),

    // 有些场景会把资源放到 appPath 下
    path.join(app.getAppPath(), 'playwright-browsers'),
  ];

  const devCandidates = [
    path.join(process.cwd(), 'playwright-browsers'),
    path.join(app.getAppPath(), 'playwright-browsers'),
  ];

  const candidatePaths = app.isPackaged ? packagedCandidates : devCandidates;

  // 把候选路径都打出来（你 UI 里能看到）
  console.log('[pw] app.isPackaged =', app.isPackaged);
  console.log('[pw] process.resourcesPath =', process.resourcesPath);
  console.log('[pw] app.getAppPath() =', app.getAppPath());
  console.log('[pw] candidates:\n' + candidatePaths.join('\n'));

  for (const p of candidatePaths) {
    if (dirExists(p)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = p;
      console.log(`[pw] ✅ Using PLAYWRIGHT_BROWSERS_PATH = ${p}`);
      return;
    }
  }

  // ❗关键改动：找不到就不要强行指到一个不存在的目录
  // 否则 Playwright 会直接报 “Browser directory not found ...”
  console.error('[pw] ❌ No bundled Playwright browsers directory found.');
  console.error('[pw] ❌ Will NOT set PLAYWRIGHT_BROWSERS_PATH (fallback to Playwright default cache).');

  // 如果你之前设置过环境变量，这里清掉，避免污染
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

// 必须在 app.whenReady 之前就调用（关键）
ensurePlaywrightPath();

// 把主进程日志转发到渲染进程
const originalLog = console.log;
const originalError = console.error;

console.log = (...args: any[]) => {
  originalLog(...args);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { type: 'info', message: args.join(' ') });
  }
};

console.error = (...args: any[]) => {
  originalError(...args);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { type: 'error', message: args.join(' ') });
  }
};

// 创建窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const rendererPath = getRendererPath();
  mainWindow.loadFile(rendererPath);
}

// renderer 路径选择
function getRendererPath(): string {
  const resolveDevPaths = (): string => {
    const devPaths = [
      path.join(process.cwd(), 'renderer', 'index.html'),
      path.join(__dirname, '../../renderer/index.html'),
      path.join(__dirname, '../renderer/index.html'),
      path.join(app.getAppPath(), 'renderer', 'index.html'),
    ];

    for (const p of devPaths) {
      if (fs.existsSync(p)) {
        const rel = path.relative(process.cwd(), p) || p;
        console.log(`Loading renderer from: ${rel}`);
        return p;
      }
    }

    console.error('Renderer index.html not found, fallback to first dev path');
    return devPaths[0];
  };

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'dist', 'renderer', 'index.html');
    if (fs.existsSync(packagedPath)) return packagedPath;
    console.warn('Packaged renderer not found, fallback to dev paths');
  }

  return resolveDevPaths();
}

// Electron 生命周期
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC：懒加载，确保 playwright 不会在 env 设置之前被加载
ipcMain.handle('start-recording', async (_event, url: string) => {
  console.log(`Starting recording for: ${url}`);
  try {
    const { startRecording } = await import('../core/record.js');
    currentSession = await startRecording({ url });
    return { success: true };
  } catch (error) {
    console.error(`Failed to start recording: ${String(error)}`);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('stop-recording', async () => {
  console.log('Stopping recording...');
  if (!currentSession) {
    console.error('No active recording session');
    return { success: false, error: 'No active recording session' };
  }
  try {
    const irPath = await currentSession.stop();
    currentSession = null;
    console.log(`Recording saved to: ${irPath}`);
    return { success: true, irPath };
  } catch (error) {
    console.error(`Failed to stop recording: ${String(error)}`);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('generate-cases', async (_event, { irPath, format, outPath }) => {
  console.log(`Generating cases from ${irPath} in format ${format} to ${outPath ?? '[default]'}`);
  try {
    const { generateFromIR } = await import('../core/generate.js');
    await generateFromIR(irPath, format, outPath);
    return { success: true };
  } catch (error) {
    console.error(`Generation failed: ${String(error)}`);
    return { success: false, error: String(error) };
  }
});
