/**
 * Folders Data Service
 * Uses real backend API for folder operations
 */
import type { Folder } from '../types/folder';

// Local cache for reactive UI updates
let foldersCache: Folder[] = [];
let cacheInitialized = false;

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Get auth token
const getAuthHeaders = () => {
  const token = localStorage.getItem('authToken');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

// Initialize cache from API
const initCache = async (): Promise<void> => {
  if (!cacheInitialized) {
    try {
      const response = await fetch(`${API_URL}/folders`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        foldersCache = await response.json();
        cacheInitialized = true;
      }
    } catch {
      console.warn('[Folders] API not available, using empty cache');
      foldersCache = [];
    }
  }
};

// Refresh cache from API
export const refreshFoldersCache = async (): Promise<Folder[]> => {
  try {
    const response = await fetch(`${API_URL}/folders`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      foldersCache = await response.json();
      cacheInitialized = true;
    }
    return foldersCache;
  } catch (error) {
    console.error('[Folders] Failed to refresh cache:', error);
    return foldersCache;
  }
};

// Helper functions
export const getFolderById = (id: string): Folder | undefined => {
  return foldersCache.find(folder => folder.id === id);
};

export const getFolderByIdAsync = async (id: string): Promise<Folder | undefined> => {
  try {
    const response = await fetch(`${API_URL}/folders/${id}`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('[Folders] Failed to get folder:', error);
  }
  return getFolderById(id);
};

export const getRootFolders = (): Folder[] => {
  if (!cacheInitialized) {
    initCache();
  }
  return foldersCache.filter(folder => !folder.parentFolderId);
};

export const getRootFoldersAsync = async (): Promise<Folder[]> => {
  try {
    const response = await fetch(`${API_URL}/folders`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      const folders = await response.json();
      foldersCache = folders;
      cacheInitialized = true;
      return folders;
    }
  } catch (error) {
    console.error('[Folders] Failed to get root folders:', error);
  }
  return getRootFolders();
};

export const getSubFolders = (parentId: string): Folder[] => {
  return foldersCache.filter(folder => folder.parentFolderId === parentId);
};

export const getSubFoldersAsync = async (parentId: string): Promise<Folder[]> => {
  try {
    const response = await fetch(`${API_URL}/folders/${parentId}/subfolders`, {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('[Folders] Failed to get subfolders:', error);
  }
  return getSubFolders(parentId);
};

export const getAllFolders = (): Folder[] => {
  if (!cacheInitialized) {
    initCache();
  }
  return foldersCache;
};

export const getAllFoldersAsync = async (): Promise<Folder[]> => {
  return refreshFoldersCache();
};

export const addFolder = (folder: Folder): void => {
  // Optimistic update
  foldersCache.push(folder);

  // Call API
  fetch(`${API_URL}/folders`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: folder.name,
      description: folder.description,
      color: folder.color,
      parentFolderId: folder.parentFolderId
    })
  }).then(response => {
    if (response.ok) {
      return response.json();
    }
    throw new Error('Failed to create folder');
  }).then(created => {
    // Update cache with server-generated ID
    const index = foldersCache.findIndex(f => f.id === folder.id);
    if (index > -1) {
      foldersCache[index] = created;
    }
  }).catch(error => {
    console.error('[Folders] Failed to create folder:', error);
    // Rollback
    const index = foldersCache.findIndex(f => f.id === folder.id);
    if (index > -1) {
      foldersCache.splice(index, 1);
    }
  });
};

export const addFolderAsync = async (folder: Partial<Folder>): Promise<Folder> => {
  const response = await fetch(`${API_URL}/folders`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      name: folder.name,
      description: folder.description,
      color: folder.color,
      parentFolderId: folder.parentFolderId
    })
  });

  if (!response.ok) {
    throw new Error('Failed to create folder');
  }

  const created = await response.json();
  foldersCache.push(created);
  return created;
};

export const updateFolder = (id: string, updates: Partial<Folder>): Folder | undefined => {
  const index = foldersCache.findIndex(folder => folder.id === id);
  if (index > -1) {
    foldersCache[index] = { ...foldersCache[index], ...updates };

    // Call API
    fetch(`${API_URL}/folders/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    }).catch(error => {
      console.error('[Folders] Failed to update folder:', error);
    });

    return foldersCache[index];
  }
  return undefined;
};

export const deleteFolderById = (id: string): Folder[] => {
  // Optimistic update
  const index = foldersCache.findIndex(folder => folder.id === id);
  const deleted = index > -1 ? foldersCache.splice(index, 1)[0] : null;

  // Call API
  fetch(`${API_URL}/folders/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  }).catch(error => {
    console.error('[Folders] Failed to delete folder:', error);
    // Rollback
    if (deleted) {
      foldersCache.push(deleted);
    }
  });

  return foldersCache;
};

export const deleteFolderByIdAsync = async (id: string): Promise<void> => {
  const response = await fetch(`${API_URL}/folders/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });

  if (!response.ok) {
    throw new Error('Failed to delete folder');
  }

  const index = foldersCache.findIndex(folder => folder.id === id);
  if (index > -1) {
    foldersCache.splice(index, 1);
  }
};

// Initialize cache on module load
initCache();
