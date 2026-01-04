import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { startRecording, RecordSession } from '../core/record.js';
import { generateFromIR } from '../core/generate.js';

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

  // 智能路径判断：根据运行环境选择正确的renderer路径
  const getRendererPath = (): string => {
    if (app.isPackaged) {
      // 打包环境：使用 resources/dist/renderer
      const packagedPath = path.join(process.resourcesPath, 'dist', 'renderer', 'index.html');
      if (require('fs').existsSync(packagedPath)) {
        return packagedPath;
      }
      console.warn('Packaged renderer not found, falling back to development path');
    }
    
    // 开发环境：使用相对路径查找 renderer/index.html
    const devPaths = [
      path.join(__dirname, '../../renderer/index.html'),  // 标准路径
      path.join(__dirname, '../renderer/index.html'),     // 备用路径
      path.resolve(__dirname, '../../renderer/index.html'), // 绝对路径解析
    ];
    
    for (const devPath of devPaths) {
      if (require('fs').existsSync(devPath)) {
        console.log(`Loading renderer from: ${devPath}`);
        return devPath;
      }
    }
    
    // 如果都找不到，返回默认路径并记录错误
    console.error('Renderer index.html not found in any expected location');
    return devPaths[0]; // 返回第一个路径作为默认
  };
  
  const rendererPath = getRendererPath();
  mainWindow.loadFile(rendererPath);
}

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