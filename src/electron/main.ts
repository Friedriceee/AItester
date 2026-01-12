import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let mainWindow: BrowserWindow | null = null;
let currentSession: any = null;

// 1) 最早设置 Playwright 浏览器路径（在任何 playwright 模块加载之前）
function ensurePlaywrightPath() {
  const candidatePaths = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'playwright-browsers'), // resources/playwright-browsers
        path.join(process.resourcesPath, 'app.asar.unpacked', 'playwright-browsers'),
        path.join(app.getAppPath(), 'playwright-browsers'),
      ]
    : [
        path.join(process.cwd(), 'playwright-browsers'),
        path.join(app.getAppPath(), 'playwright-browsers'),
      ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = p;
      console.log(`[pw] PLAYWRIGHT_BROWSERS_PATH = ${p}`);
      return;
    }
  }

  // 不存在也强制指定，避免回退到用户缓存；方便你从日志定位打包是否带上了浏览器
  process.env.PLAYWRIGHT_BROWSERS_PATH = candidatePaths[0];
  console.warn(`[pw] PLAYWRIGHT_BROWSERS_PATH not found, set to ${candidatePaths[0]}`);
}

// 必须在 app.whenReady 之前就调用（关键）
ensurePlaywrightPath();

// 2) 把主进程日志转发到渲染进程（保留你原来的逻辑）
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

// 3) 创建窗口
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

// 4) 你的 renderer 路径选择（整理了括号，避免语法错）
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

// 5) Electron 生命周期
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 6) IPC：用懒加载，确保 playwright 不会在 env 设置之前被加载
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
