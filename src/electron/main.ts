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

  // dist/electron/electron/main.js -> ../../renderer/index.html
  // Because 'scripts/copy-renderer.mjs' copies renderer to dist/renderer
  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
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