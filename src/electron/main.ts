import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { startRecording, RecordSession } from '../core/record.js';
import { generateFromIR } from '../core/generate.js';

const ensurePlaywrightPath = () => {
  const fs = require('fs');

  // 优先选择真实存在的目录，保证相对路径在打包/开发环境均可用
  const candidatePaths = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'playwright-browsers'),               // 打包后 resources 相对路径
        path.join(app.getAppPath(), 'playwright-browsers'),                    // app 根目录（asar 外 unpacked）
      ]
    : [
        path.join(process.cwd(), 'playwright-browsers'),                       // 开发：工作目录
        path.join(app.getAppPath(), 'playwright-browsers'),                    // 开发：应用根目录
      ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = p;
      console.log(`PLAYWRIGHT_BROWSERS_PATH set to: ${p}`);
      return;
    }
  }

  // 如果都不存在，仍设置为首选路径便于日志诊断
  process.env.PLAYWRIGHT_BROWSERS_PATH = candidatePaths[0];
  console.warn(`PLAYWRIGHT_BROWSERS_PATH set but path not found: ${candidatePaths[0]}`);
};

let mainWindow: BrowserWindow | null = null;
let currentSession: RecordSession | null = null;

// Hook console.log/error to send to renderer
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  originalLog(...args);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { type: 'info', message: args.join(' ') });
  }
};

console.error = (...args) => {
  originalError(...args);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { type: 'error', message: args.join(' ') });
  }
};

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

  // 智能路径判断：根据运行环境选择正确的renderer路径，并优先基于相对路径检测
  const getRendererPath = (): string => {
    const fs = require('fs');

    const resolveDevPaths = (): string => {
      const devPaths = [
        path.join(process.cwd(), 'renderer', 'index.html'),     // 工作目录相对路径
        path.join(__dirname, '../../renderer/index.html'),      // 标准相对路径
        path.join(__dirname, '../renderer/index.html'),         // 备用相对路径
        path.join(app.getAppPath(), 'renderer', 'index.html'),  // 应用根路径相对
      ];

      for (const devPath of devPaths) {
        if (fs.existsSync(devPath)) {
          const rel = path.relative(process.cwd(), devPath) || devPath;
          console.log(`Loading renderer from relative path: ${rel}`);
          return devPath;
        }
      }

      console.error('Renderer index.html not found in any expected location');
      return devPaths[0]; // 返回第一个路径作为默认
    };

    if (app.isPackaged) {
      // 打包环境：使用 resources/dist/renderer
      const packagedPath = path.join(process.resourcesPath, 'dist', 'renderer', 'index.html');
      if (fs.existsSync(packagedPath)) {
        return packagedPath;
      }
      console.warn('Packaged renderer not found, falling back to relative development paths');
      return resolveDevPaths();
    }

    // 开发环境：使用相对路径查找 renderer/index.html
    return resolveDevPaths();
  };
  
  const rendererPath = getRendererPath();
  mainWindow.loadFile(rendererPath);
  }
  
  // 在应用就绪前设置 Playwright 浏览器路径（打包/开发均设置）
  ensurePlaywrightPath();

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('start-recording', async (event, url: string) => {
  console.log(`Starting recording for: ${url}`);
  try {
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

ipcMain.handle('generate-cases', async (event, { irPath, format, outPath }) => {
  console.log(`Generating cases from ${irPath} in format ${format} to ${outPath ?? '[default]'}`);
  try {
    await generateFromIR(irPath, format, outPath);
    return { success: true };
  } catch (error) {
    console.error(`Generation failed: ${String(error)}`);
    return { success: false, error: String(error) };
  }
});