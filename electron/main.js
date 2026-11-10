'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const { analyze, transform } = require('../src/core/rapid');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 680,
    title: 'ABB Point Reorder',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(() => {
  app.setName('ABB Point Reorder');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openInput', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleziona programma RAPID ABB',
    properties: ['openFile'],
    filters: [
      { name: 'Programmi RAPID ABB', extensions: ['modx', 'mod', 'prg'] },
      { name: 'Tutti i file', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const text = await fs.readFile(filePath, 'utf8');

  return {
    filePath,
    fileName: path.basename(filePath),
    dir: path.dirname(filePath),
    text
  };
});

ipcMain.handle('dialog:openFolder', async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleziona area di lavoro (cartella progetto)',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('rapid:analyze', async (_event, text) => analyze(text));

ipcMain.handle('rapid:transform', async (_event, payload) => {
  const { text, options } = payload || {};
  if (typeof text !== 'string') throw new Error('Testo RAPID mancante.');
  return transform(text, options || {});
});

async function writeUniqueFile(folder, sourceName, content) {
  const extension = path.extname(sourceName) || '.modx';
  const baseName = path.basename(sourceName, extension);

  for (let counter = 0; counter < 10000; counter += 1) {
    const suffix = counter === 0 ? '_reordered' : `_reordered_${counter}`;
    const target = path.join(folder, `${baseName}${suffix}${extension}`);
    try {
      await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  throw new Error('Impossibile trovare un nome file disponibile nella cartella scelta.');
}

ipcMain.handle('file:save', async (_event, payload) => {
  const { folder, sourceName, content } = payload || {};
  if (!folder || !sourceName) throw new Error('Cartella di destinazione o nome file mancante.');
  if (typeof content !== 'string') throw new Error('Contenuto del file mancante.');

  await fs.mkdir(folder, { recursive: true });
  return writeUniqueFile(folder, sourceName, content);
});

ipcMain.handle('shell:reveal', async (_event, filePath) => {
  if (!filePath) return false;
  shell.showItemInFolder(filePath);
  return true;
});
