const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const os = require('os');

function createWindow() {
  const isWindows = os.platform() === 'win32';

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    // Barre de titre native Windows avec juste le titre — pas de menus
    autoHideMenuBar: true,
    frame: true,
    title: 'JS-Innov.IA Cockpit',
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: isWindows ? 'default' : 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    backgroundColor: '#0a0a1a',
    show: false,
  });

  // Supprimer le menu (File, Edit, View, Window, Help)
  win.setMenuBarVisibility(false);
  win.removeMenu();

  // Charger le cockpit
  win.loadURL('https://cockpit.jsinnovia.com');

  win.once('ready-to-show', () => {
    win.show();
  });

  // Liens externes -> navigateur
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
