import { dialog, IpcMain, WebContents } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { AppMessageType, MessageType } from '../../../test/TestIpcMessage';
import { AppState } from '../../application';
import { IpcMessages } from '../shared/ipcMessages';
import { deleteDir, ensureDirectoryExists, moveFiles } from './fileUtils';
import { Store, StoreKeys } from './store';
import { backups as str } from './strings';
import { handle, send } from './testing';
import { UpdateManager } from './updateManager';
import { isTesting, last } from './utils';

function log(...message: any) {
  console.log('ArchiveManager:', ...message);
}

function logError(...message: any) {
  console.error('ArchiveManager:', ...message);
}

export const enum EnsureRecentBackupExists {
  Success = 0,
  BackupsAreDisabled = 1,
  FailedToCreateBackup = 2,
}

export const BackupsDirectoryName = 'Standard Notes Backups';
const BackupFileExtension = '.txt';

function backupFileNameToDate(string: string): number {
  string = path.basename(string, '.txt');
  const dateTimeDelimiter = string.indexOf('T');
  const date = string.slice(0, dateTimeDelimiter);

  const time = string.slice(dateTimeDelimiter + 1).replace(/-/g, ':');
  return Date.parse(date + 'T' + time);
}

function dateToSafeFilename(date: Date) {
  return date.toISOString().replace(/:/g, '-');
}

export interface BackupsManager {
  backupsAreEnabled: boolean;
  toggleBackupsStatus(): void;
  backupsLocation: string;
  applicationDidBlur(): void;
  changeBackupsLocation(): void;
  beginBackups(): void;
  performBackup(): void;
}

export function createBackupsManager(
  webContents: WebContents,
  appState: AppState,
  ipcMain: IpcMain
): BackupsManager {
  let backupsLocation = appState.store.get(StoreKeys.BackupsLocation);
  let backupsDisabled = appState.store.get(StoreKeys.BackupsDisabled);
  let needsBackup = false;

  determineLastBackupDate(backupsLocation)
    .then((date) => (appState.lastBackupDate = date))
    .catch(console.error);

  async function setBackupsLocation(location: string) {
    const previousLocation = backupsLocation;
    if (previousLocation === location) {
      return;
    }

    const newLocation = path.join(location, BackupsDirectoryName);
    const backupFiles = (await fs.readdir(previousLocation))
      .filter((fileName) => fileName.endsWith(BackupFileExtension))
      .map((fileName) => path.join(previousLocation, fileName));

    await moveFiles(backupFiles, newLocation);

    if ((await fs.readdir(previousLocation)).length === 0) {
      await deleteDir(previousLocation);
    }

    /** Wait for the operation to be successful before saving new location */
    backupsLocation = newLocation;
    appState.store.set(StoreKeys.BackupsLocation, backupsLocation);
  }

  ipcMain.on(IpcMessages.DataArchive, (_event, data) => {
    archiveData(data);
  });

  async function archiveData(data: any) {
    if (backupsDisabled) return;
    let success: boolean;
    let name: string | undefined;
    try {
      name = await writeDataToFile(data);
      log(`Data backup successfully saved: ${name}`);
      success = true;
      appState.onBackupCreation();
    } catch (err) {
      success = false;
      logError('An error occurred saving backup file', err);
    }
    webContents.send(IpcMessages.FinishedSavingBackup, { success });
    if (isTesting()) {
      send(AppMessageType.SavedBackup);
    }
    return name;
  }

  function performBackup() {
    if (backupsDisabled) return;
    webContents.send(IpcMessages.DownloadBackup);
  }

  async function writeDataToFile(data: any): Promise<string> {
    await ensureDirectoryExists(backupsLocation);

    const name = dateToSafeFilename(new Date()) + BackupFileExtension;
    const filePath = path.join(backupsLocation, name);
    await fs.writeFile(filePath, data);
    return name;
  }

  let interval: NodeJS.Timeout | undefined;
  function beginBackups() {
    if (interval) {
      clearInterval(interval);
    }

    needsBackup = true;
    const hoursInterval = 12;
    const seconds = hoursInterval * 60 * 60;
    const milliseconds = seconds * 1000;
    interval = setInterval(performBackup, milliseconds);
  }

  function toggleBackupsStatus() {
    backupsDisabled = !backupsDisabled;
    appState.store.set(StoreKeys.BackupsDisabled, backupsDisabled);
    /** Create a backup on reactivation. */
    if (!backupsDisabled) {
      performBackup();
    }
  }

  if (isTesting()) {
    handle(MessageType.DataArchive, (data: any) => archiveData(data));
    handle(MessageType.BackupsAreEnabled, () => !backupsDisabled);
    handle(MessageType.ToggleBackupsEnabled, toggleBackupsStatus);
    handle(MessageType.BackupsLocation, () => backupsLocation);
    handle(MessageType.PerformBackup, performBackup);
    handle(MessageType.ChangeBackupsLocation, setBackupsLocation);
  }

  return {
    get backupsAreEnabled() {
      return !backupsDisabled;
    },
    get backupsLocation() {
      return backupsLocation;
    },
    performBackup,
    beginBackups,
    toggleBackupsStatus,
    applicationDidBlur() {
      if (needsBackup) {
        needsBackup = false;
        performBackup();
      }
    },
    async changeBackupsLocation() {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'showHiddenFiles', 'createDirectory'],
      });
      if (result.filePaths.length === 0) return;
      const path = result.filePaths[0];
      try {
        await setBackupsLocation(path);
        performBackup();
      } catch (e) {
        logError(e);
        dialog.showMessageBox({
          message: str().errorChangingDirectory(e),
        });
      }
    },
  };
}

async function determineLastBackupDate(
  backupsLocation: string
): Promise<number | null> {
  const files = (await fs.readdir(backupsLocation))
    .filter(
      (filename) =>
        filename.endsWith(BackupFileExtension) &&
        !Number.isNaN(backupFileNameToDate(filename))
    )
    .sort();
  const lastBackupFileName = last(files);
  if (!lastBackupFileName) {
    return null;
  }
  const backupDate = backupFileNameToDate(lastBackupFileName);
  if (Number.isNaN(backupDate)) {
    return null;
  }
  return backupDate;
}
