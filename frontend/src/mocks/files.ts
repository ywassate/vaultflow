/**
 * Files Data Service
 * Uses real API calls via apiService with local cache for UI reactivity
 */
import type { EncryptedFile } from '../types';
import { apiService } from '../services/apiService';

// Local cache for reactive UI updates
let filesCache: EncryptedFile[] = [];
let cacheInitialized = false;

// Initialize cache from API
const initCache = async (): Promise<void> => {
  if (!cacheInitialized) {
    try {
      filesCache = await apiService.getFiles();
      cacheInitialized = true;
    } catch {
      console.warn('[Files] API not available, using empty cache');
      filesCache = [];
    }
  }
};

// Refresh cache from API
export const refreshFilesCache = async (): Promise<EncryptedFile[]> => {
  try {
    filesCache = await apiService.getFiles();
    cacheInitialized = true;
    return filesCache;
  } catch (error) {
    console.error('[Files] Failed to refresh cache:', error);
    return filesCache;
  }
};

// Helper functions - sync versions use cache, async versions call API
export const getFileById = (id: string): EncryptedFile | undefined => {
  return filesCache.find(file => file.id === id);
};

export const getFileByIdAsync = async (id: string): Promise<EncryptedFile | undefined> => {
  try {
    return await apiService.getFile(id);
  } catch {
    return getFileById(id);
  }
};

export const getAllFiles = (): EncryptedFile[] => {
  // Return cache, trigger background refresh
  if (!cacheInitialized) {
    initCache();
  }
  return filesCache;
};

export const getAllFilesAsync = async (): Promise<EncryptedFile[]> => {
  return refreshFilesCache();
};

export const getFilesByFolder = (folderId: string): EncryptedFile[] => {
  return filesCache.filter(file => file.folderId === folderId);
};

export const getFilesByUser = (userId: string): EncryptedFile[] => {
  return filesCache.filter(file => file.uploadedBy === userId || file.userId === userId);
};

export const deleteFileById = (id: string): EncryptedFile[] => {
  // Optimistic update
  const index = filesCache.findIndex(file => file.id === id);
  if (index > -1) {
    filesCache.splice(index, 1);
  }
  // Call API in background
  apiService.deleteFile(id).catch(error => {
    console.error('[Files] Failed to delete file:', error);
    // Refresh cache on error
    refreshFilesCache();
  });
  return filesCache;
};

export const deleteFileByIdAsync = async (id: string): Promise<void> => {
  await apiService.deleteFile(id);
  // Update cache
  const index = filesCache.findIndex(file => file.id === id);
  if (index > -1) {
    filesCache.splice(index, 1);
  }
};

export const addFile = (file: EncryptedFile): void => {
  filesCache.push(file);
};

export const toggleFileStarred = (id: string): EncryptedFile | undefined => {
  const file = filesCache.find(f => f.id === id);
  if (file) {
    file.starred = !file.starred;
    // TODO: Add API endpoint for starring files
    // apiService.toggleFileStarred(id);
  }
  return file;
};

export const getStarredFiles = (): EncryptedFile[] => {
  return filesCache.filter(file => file.starred === true);
};

export const getSharedWithMeFiles = (userId: string = 'current-user-id'): EncryptedFile[] => {
  return filesCache.filter(file => file.sharedWith?.includes(userId));
};

export const getSharedWithMeFilesAsync = async (): Promise<EncryptedFile[]> => {
  try {
    const shares = await apiService.getSharedFiles();
    // Map shares to files
    const sharedFiles: EncryptedFile[] = [];
    for (const share of shares) {
      try {
        const file = await apiService.getFile(share.fileId);
        sharedFiles.push(file);
      } catch {
        // File not accessible
      }
    }
    return sharedFiles;
  } catch {
    return getSharedWithMeFiles();
  }
};

// Initialize cache on module load
initCache();
