// Rune Kart desktop: a launcher that either hosts a LAN race (runs the bundled game server and plays on it)
// or joins someone else's (every host serves the game, so joining is just opening their address).
const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 2567;
let win = null;
let server = null;

// Packaged: server bundle and built client sit in resources/. Dev: straight from the repo build output.
const res = (packaged, dev) => (app.isPackaged ? path.join(process.resourcesPath, packaged) : path.join(__dirname, '..', dev));

/** First free port at or above `from`, so a second host on the same machine doesn't collide. */
function freePort(from) {
  return new Promise(resolve => {
    const probe = net.createServer().once('error', () => resolve(freePort(from + 1)));
    probe.listen(from, '0.0.0.0', () => probe.close(() => resolve(from)));
  });
}

async function waitForServer(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/server-info`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function host() {
  if (server) return { ok: true, url: server.url };
  const port = await freePort(DEFAULT_PORT);
  const child = utilityProcess.fork(res('server/index.js', 'server/dist/index.js'), [], {
    env: { ...process.env, PORT: String(port), CLIENT_DIR: res('client', 'client/dist') },
    stdio: 'pipe',
  });
  child.stdout?.on('data', d => console.log(`[server] ${String(d).trim()}`));
  child.stderr?.on('data', d => console.error(`[server] ${String(d).trim()}`));
  child.on('exit', code => { console.log(`[server] exited (${code})`); server = null; });
  if (!(await waitForServer(port))) { child.kill(); return { ok: false, error: 'The game server did not start.' }; }
  server = { child, url: `http://localhost:${port}` };
  win.loadURL(server.url);
  return { ok: true, url: server.url };
}

async function join(address) {
  const trimmed = String(address || '').trim();
  // Accept "192.168.1.20", "192.168.1.20:2568" or a full URL.
  const url = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed.includes(':') ? trimmed : `${trimmed}:${DEFAULT_PORT}`}`;
  try {
    new URL(url);
  } catch {
    return { ok: false, error: 'That doesn’t look like an address.' };
  }
  try {
    const r = await fetch(new URL('/api/server-info', url), { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error();
  } catch {
    return { ok: false, error: `No Rune Kart host answered at ${url}.` };
  }
  win.loadURL(url);
  return { ok: true, url };
}

ipcMain.handle('host', host);
ipcMain.handle('join', (_e, address) => join(address));

function createWindow() {
  // Don't pass `fullscreen: false`: on macOS an explicit false makes the window non-fullscreenable.
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 800, minHeight: 600,
    title: 'Rune Kart', backgroundColor: '#0b1020', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'launcher.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    // Back to the launcher (stops hosting).
    if (input.key === 'F1') { server?.child.kill(); server = null; win.loadFile(path.join(__dirname, 'launcher.html')); e.preventDefault(); }
  });
}

app.whenReady().then(() => {
  createWindow();
  // `--host` skips the launcher and hosts straight away (handy for a dedicated LAN machine).
  if (process.argv.includes('--host')) host();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.child.kill());
