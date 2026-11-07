import React, { useState, useEffect } from "react";
import {
  Plus,
  Folder as FolderIcon,
  Search,
  Grid3x3,
  List,
  FileIcon,
  HardDrive,
  Users,
  Loader2,
} from "lucide-react";
import type { Folder } from "../types/folder";
import { FolderCard } from "../components/folders/FolderCard";
import { CreateFolderModal } from "../components/folders/CreateFolderModal";
import { apiService } from "../services/apiService";
import { calculateStorageByCategory } from "../utils/fileCategories";
import type { EncryptedFile } from "../types";

type FolderResponse = Folder & {
  folder_id?: Folder['id'];
  parent_folder_id?: Folder['parentFolderId'];
  created_at?: Folder['createdAt'];
  updated_at?: Folder['updatedAt'];
};

// Helper function to format file size
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const FoldersPage: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<EncryptedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageStats, setStorageStats] = useState({ used: 0, total: 10 * 1024 * 1024 * 1024 });

  // Load folders and files on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [foldersData, filesData, statsData] = await Promise.all([
        apiService.getFolders(),
        apiService.getFiles(),
        apiService.getStorageStats(),
      ]);

      // Adapt folders to match Folder type
      const adaptedFolders: Folder[] = foldersData.map((f: FolderResponse) => ({
        id: f.id || f.folder_id,
        name: f.name,
        description: f.description,
        color: f.color || 'blue',
        parentFolderId: f.parentFolderId || f.parent_folder_id,
        createdAt: f.createdAt || f.created_at,
        updatedAt: f.updatedAt || f.updated_at,
        fileCount: f.fileCount || 0,
        size: f.size || 0,
      }));

      setFolders(adaptedFolders);
      setFiles(filesData);
      setStorageStats({ used: statsData.used, total: statsData.total });
    } catch (err) {
      console.error('[FoldersPage] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async (folder: Folder) => {
    try {
      await apiService.createFolder(folder.name, folder.parentFolderId || undefined);
      await loadData();
    } catch (err) {
      console.error('[FoldersPage] Error creating folder:', err);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await apiService.deleteFolder(folderId);
      setFolders(folders.filter(f => f.id !== folderId));
    } catch (err) {
      console.error('[FoldersPage] Error deleting folder:', err);
    }
  };

  const handleEditFolder = (folder: Folder) => {
    // TODO: Implement edit functionality
    console.log("Edit folder:", folder);
  };

  // Only show root folders (folders without a parent)
  const rootFolders = folders.filter((folder) => !folder.parentFolderId);

  const filteredFolders = rootFolders.filter(
    (folder) =>
      folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      folder.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get counts from state
  const totalFolders = folders.length;
  const totalFiles = files.length;
  // Calculate storage by category using the utility function
  const storageByCategory = calculateStorageByCategory(files);
  const totalStorage = storageStats.used;

  // Calculate percentages and create segments for the circle
  const segments = Object.entries(storageByCategory)
    .filter(([, data]) => data.size > 0)
    .map(([key, data]) => ({
      key,
      ...data,
      percentage: (data.size / totalStorage) * 100,
    }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Folders</h1>
          <p className="text-gray-600 mt-1">Organize your files with folders</p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-all shadow-sm hover:shadow-md"
        >
          <Plus className="h-5 w-5" />
          New Folder
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Files & Folders Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Overview</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary-50 rounded-lg flex items-center justify-center">
                  <FolderIcon className="h-5 w-5 text-primary-600" />
                </div>
                <span className="text-sm text-gray-600">Folders</span>
              </div>
              <span className="text-xl font-bold text-gray-900">{totalFolders}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary-50 rounded-lg flex items-center justify-center">
                  <FileIcon className="h-5 w-5 text-secondary-400" />
                </div>
                <span className="text-sm text-gray-600">Files</span>
              </div>
              <span className="text-xl font-bold text-gray-900">{totalFiles}</span>
            </div>
          </div>
        </div>

        {/* Quick Stats Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Quick Stats</h3>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-primary-600">{totalFolders}</p>
              <p className="text-sm text-gray-600">Total Folders</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-secondary-500">{totalFiles}</p>
              <p className="text-sm text-gray-600">Total Files</p>
            </div>
          </div>
        </div>

        {/* Storage by Category Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                  <HardDrive className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Storage</p>
                  <p className="text-xl font-bold text-gray-900">
                    {formatSize(totalStorage)}
                  </p>
                </div>
              </div>

              {/* Storage Categories Legend */}
              <div className="space-y-1.5">
                {segments.map(segment => (
                  <div key={segment.key} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: segment.color }}
                      />
                      <span className="text-gray-600">{segment.label}</span>
                    </div>
                    <span className="font-medium text-gray-900">
                      {formatSize(segment.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Circular Chart */}
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="transform -rotate-90" viewBox="0 0 100 100">
                {(() => {
                  let currentAngle = 0;
                  return segments.map((segment) => {
                    const angle = (segment.percentage / 100) * 360;
                    const startAngle = currentAngle;
                    currentAngle += angle;

                    // Calculate path for segment
                    const radius = 40;
                    const centerX = 50;
                    const centerY = 50;

                    const startRad = (startAngle * Math.PI) / 180;
                    const endRad = (currentAngle * Math.PI) / 180;

                    const x1 = centerX + radius * Math.cos(startRad);
                    const y1 = centerY + radius * Math.sin(startRad);
                    const x2 = centerX + radius * Math.cos(endRad);
                    const y2 = centerY + radius * Math.sin(endRad);

                    const largeArc = angle > 180 ? 1 : 0;

                    return (
                      <path
                        key={segment.key}
                        d={`M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                        fill={segment.color}
                        className="transition-opacity hover:opacity-80"
                      />
                    );
                  });
                })()}
                {/* Center white circle */}
                <circle cx="50" cy="50" r="25" fill="white" />
              </svg>
              {/* Center icon */}
              <div className="absolute inset-0 flex items-center justify-center">
                <HardDrive className="h-5 w-5 text-gray-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and View Toggle */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search folders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <button
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded transition-colors ${
              viewMode === "grid"
                ? "bg-primary-50 text-primary-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
            title="Grid view"
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded transition-colors ${
              viewMode === "list"
                ? "bg-primary-50 text-primary-600"
                : "text-gray-400 hover:text-gray-600"
            }`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Folders Grid/List */}
      {filteredFolders.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
            <FolderIcon className="h-10 w-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? "No folders found" : "No folders yet"}
          </h3>
          <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
            {searchQuery
              ? "Try adjusting your search terms"
              : "Create your first folder to organize your files"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-all"
            >
              <Plus className="h-5 w-5" />
              Create Your First Folder
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Column Headers for List View */}
          {viewMode === "list" && (
            <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="w-8"></div>
                <span>Name</span>
              </div>
              <div className="hidden md:flex items-center px-4 w-32">
                <span>Items</span>
              </div>
              <div className="hidden lg:flex items-center px-4 w-24">
                <span>Size</span>
              </div>
              <div className="hidden xl:flex items-center px-4 w-32">
                <span>Modified</span>
              </div>
              <div className="w-32"></div>
            </div>
          )}

          {/* Folders */}
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                : "space-y-1"
            }
          >
            {filteredFolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onDelete={handleDeleteFolder}
                onEdit={handleEditFolder}
                viewMode={viewMode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreateModal && (
        <CreateFolderModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateFolder}
        />
      )}
    </div>
  );
};
