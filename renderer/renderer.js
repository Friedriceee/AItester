const btnRecord = document.getElementById('btn-record');
const btnStop = document.getElementById('btn-stop');
const btnGenerate = document.getElementById('btn-generate');
const inputUrl = document.getElementById('url');
const selectFormat = document.getElementById('format');
const inputOutPath = document.getElementById('out-path');
const logContainer = document.getElementById('logs');
const statusBar = document.getElementById('status-bar');

let currentIRPath = null;

function appendLog(message, type = 'info') {
  const div = document.createElement('div');
  div.classList.add('log-entry');
  if (type === 'error') {
    div.classList.add('log-error');
  }
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(div);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Basic preload readiness check
if (!window.electronAPI) {
  appendLog('Error: electronAPI not available. Preload script may have failed to load.', 'error');
} else {
  appendLog('Renderer connected to main process via preload.');
}

// Receive logs from main process
window.electronAPI?.onLogMessage(({ type, message }) => {
  appendLog(message, type);
});

btnRecord.addEventListener('click', async () => {
  const url = inputUrl.value;
  if (!url) {
    appendLog('Error: URL cannot be empty', 'error');
    return;
  }

  if (!window.electronAPI) {
    appendLog('Error: electronAPI not available. Cannot start recording.', 'error');
    return;
  }

  btnRecord.disabled = true;
  btnStop.disabled = false;
  btnGenerate.disabled = true;
  statusBar.textContent = 'Recording...';
  appendLog(`Requesting start recording for: ${url}`);

  try {
    const result = await window.electronAPI.startRecording(url);
    if (!result.success) {
      appendLog(`Start failed: ${result.error}`, 'error');
      btnRecord.disabled = false;
      btnStop.disabled = true;
      statusBar.textContent = 'Error';
    } else {
      appendLog('Recording started.');
    }
  } catch (e) {
    appendLog(`IPC error on start-recording: ${String(e)}`, 'error');
    btnRecord.disabled = false;
    btnStop.disabled = true;
    statusBar.textContent = 'Error';
  }
});

btnStop.addEventListener('click', async () => {
  if (!window.electronAPI) {
    appendLog('Error: electronAPI not available. Cannot stop recording.', 'error');
    return;
  }

  btnStop.disabled = true;
  statusBar.textContent = 'Stopping...';
  
  try {
    const result = await window.electronAPI.stopRecording();
    if (result.success) {
      currentIRPath = result.irPath;
      appendLog(`Recording stopped. IR saved to: ${currentIRPath}`);
      btnRecord.disabled = false;
      btnGenerate.disabled = false;
      statusBar.textContent = 'Recorded';
    } else {
      appendLog(`Stop failed: ${result.error}`, 'error');
      btnStop.disabled = false; // allow retry
      statusBar.textContent = 'Error stopping';
    }
  } catch (e) {
    appendLog(`IPC error on stop-recording: ${String(e)}`, 'error');
    btnStop.disabled = false;
    statusBar.textContent = 'Error';
  }
});

btnGenerate.addEventListener('click', async () => {
  if (!currentIRPath) {
    appendLog('Error: No recording available to generate cases', 'error');
    return;
  }

  if (!window.electronAPI) {
    appendLog('Error: electronAPI not available. Cannot generate cases.', 'error');
    return;
  }

  const format = selectFormat.value;
  const outPathRaw = (inputOutPath?.value || '').trim();
  const outPath = outPathRaw.length > 0 ? outPathRaw : undefined;
  btnGenerate.disabled = true;
  statusBar.textContent = 'Generating...';
  appendLog(`Generating cases in ${format} format...${outPath ? ` (out: ${outPath})` : ''}`);

  try {
    const result = await window.electronAPI.generateCases(currentIRPath, format, outPath);
    btnGenerate.disabled = false;
    
    if (result.success) {
      appendLog('Generation completed successfully.');
      statusBar.textContent = 'Generated';
    } else {
      appendLog(`Generation failed: ${result.error}`, 'error');
      statusBar.textContent = 'Generation Error';
    }
  } catch (e) {
    btnGenerate.disabled = false;
    appendLog(`IPC error on generate-cases: ${String(e)}`, 'error');
    statusBar.textContent = 'Error';
  }
});