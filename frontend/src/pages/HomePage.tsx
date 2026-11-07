import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Upload,
  Folder as FolderIcon,
  FileIcon,
  Plus,
  HardDrive,
  Users,
} from "lucide-react";
import type { Folder } from "../types/folder";
import type { EncryptedFile } from "../types";
import { FolderCard } from "../components/folders/FolderCard";
import { CreateFolderModal } from "../components/folders/CreateFolderModal";
import { FileTable } from "../components/files/FileTable";
import { FileShareDialog } from "../components/files/FileShareDialog";
import { apiService } from "../services/apiService";
import { afghFileService } from "../services/crypto/afghFileService";
import { useAuth } from "../contexts/AuthContext";
import type { AFGHFileEnvelope } from "../types/afgh";
import {
  getRootFolders,
  addFolder,
  formatSize,
} from "../mocks";
import { getUserByEmail } from "../mocks/teams";
import { calculateStorageByCategory } from "../utils/fileCategories";

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, keyPair } = useAuth();
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Use mock data for folders (could be migrated to API later)
  const [folders, setFolders] = useState<Folder[]>(getRootFolders());

  // Real files from API
  const [files, setFiles] = useState<EncryptedFile[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Share modal state
  const [shareModalFile, setShareModalFile] = useState<EncryptedFile | null>(null);
  const [shareEnvelope, setShareEnvelope] = useState<AFGHFileEnvelope | null>(null);
  const [loadingShareEnvelope, setLoadingShareEnvelope] = useState(false);

  // Load files from API
  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const userFiles = await apiService.getFiles();
      setFiles(userFiles);
    } catch (err) {
      console.error('[HomePage] Error loading files:', err);
    }
  };

  // Get recent files (last 5 files)
  const recentFiles = files
    .sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    )
    .slice(0, 5);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Handle file upload
    navigate("/upload");
  };

  const handleCreateFolder = (folder: Folder) => {
    addFolder(folder);
    setFolders(getRootFolders());
  };

  const handleDeleteFolder = (folderId: string) => {
    setFolders(folders.filter((f) => f.id !== folderId));
  };

  const handleEditFolder = (folder: Folder) => {
    console.log("Edit folder:", folder);
  };

  const handleDeleteFile = async (file: EncryptedFile) => {
    if (!confirm(`Delete ${file.name}?`)) return;
    try {
      await apiService.deleteFile(file.id);
      setFiles(files.filter(f => f.id !== file.id));
    } catch (err) {
      console.error('[HomePage] Delete error:', err);
      alert('Failed to delete file');
    }
  };

  const handleDownloadFile = async (file: EncryptedFile) => {
    if (!user || !keyPair) {
      alert('You must be logged in to download files');
      return;
    }

    try {
      setDownloadingId(file.id);
      setDownloadProgress(0);
      console.log('[HomePage] Starting download for:', file.name);

      const encryptedBlob = await apiService.downloadFile(file.id);
      setDownloadProgress(20);

      const envelopeText = await encryptedBlob.text();
      const envelope = afghFileService.deserializeEnvelope(envelopeText);

      const decryptedFile = await afghFileService.decryptFileOwner(
        envelope,
        keyPair,
        (progress, message) => {
          const mappedProgress = 30 + Math.round(progress * 0.6);
          setDownloadProgress(mappedProgress);
          console.log(`[HomePage] ${message} (${progress}%)`);
        }
      );

      setDownloadProgress(95);

      const blob = new Blob([decryptedFile.data], { type: decryptedFile.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decryptedFile.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setDownloadProgress(100);
    } catch (err) {
      console.error('[HomePage] Download error:', err);
      alert(`Failed to download file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  const handleShareFile = async (file: EncryptedFile) => {
    try {
      setLoadingShareEnvelope(true);
      setShareModalFile(file);

      const encryptedBlob = await apiService.downloadFile(file.id);
      const envelopeText = await encryptedBlob.text();
      const envelope = afghFileService.deserializeEnvelope(envelopeText);

      setShareEnvelope(envelope);
    } catch (err) {
      console.error('[HomePage] Error loading envelope for share:', err);
      alert('Failed to prepare file for sharing.');
      setShareModalFile(null);
    } finally {
      setLoadingShareEnvelope(false);
    }
  };

  const handleShareComplete = () => {
    setShareModalFile(null);
    setShareEnvelope(null);
  };

  const handleToggleStar = async (file: EncryptedFile) => {
    // TODO: Implement star toggle API
    console.log('Toggle star for:', file.id);
  };

  // Calculate storage by category using real files from API
  const storageByCategory = calculateStorageByCategory(files);
  const totalStorage = files.reduce((sum, f) => sum + f.size, 0);

  // Calculate percentages and create segments for the circle
  const segments = Object.entries(storageByCategory)
    .filter(([, data]) => data.size > 0)
    .map(([key, data]) => ({
      key,
      ...data,
      percentage: (data.size / totalStorage) * 100,
    }));

  // Get all unique participants from files
  const getParticipants = () => {
    const uniqueEmails = new Set(
      files.map((f) => f.uploadedBy).filter(Boolean)
    );
    return Array.from(uniqueEmails).slice(0, 8); // Show max 8 participants
  };

  const participants = getParticipants();

  return (
    <div className="space-y-8">
      {/* Hero Section with Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative overflow-hidden rounded-xl transition-all duration-300 ${
          isDragging
            ? "bg-primary-50 border-2 border-primary-400 border-dashed"
            : "bg-gradient-to-br from-primary-600 via-primary-500 to-secondary-400"
        }`}
      >
        <div className="relative z-10 px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white mb-1">
                {isDragging ? "Drop files to upload" : "Welcome to SecureBox !"}
              </h1>
              <p className="text-white/90 text-sm">
                {isDragging
                  ? "Release to start uploading your files securely"
                  : "Your secure, encrypted file storage solution"}
              </p>
            </div>

            {!isDragging && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate("/upload")}
                  className="px-5 py-2.5 bg-white text-primary-600 font-semibold rounded-lg hover:bg-white/90 transition-all shadow-lg hover:shadow-xl flex items-center gap-2 text-sm"
                >
                  <Upload className="h-4 w-4" />
                  Upload Files
                </button>
                <button
                  onClick={() => setShowCreateFolderModal(true)}
                  className="px-5 py-2.5 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-lg hover:bg-white/20 transition-all border border-white/20 flex items-center gap-2 text-sm"
                >
                  <Plus className="h-4 w-4" />
                  New Folder
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-400/20 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl"></div>
      </div>

      {/* Quick Stats */}
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
              <span className="text-xl font-bold text-gray-900">
                {folders.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary-50 rounded-lg flex items-center justify-center">
                  <FileIcon className="h-5 w-5 text-secondary-400" />
                </div>
                <span className="text-sm text-gray-600">Files</span>
              </div>
              <span className="text-xl font-bold text-gray-900">
                {files.length}
              </span>
            </div>
          </div>
        </div>

        {/* Participants Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">
              Participants
            </h3>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Users className="h-4 w-4" />
              <span>{participants.length}</span>
            </div>
          </div>
          <div className="space-y-3">
            {participants.slice(0, 3).map((email, index) => {
              const user = getUserByEmail(email);
              return (
                <div key={index} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-secondary-400 flex items-center justify-center overflow-hidden shadow-sm flex-shrink-0">
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-white text-sm font-semibold">
                        {(user?.name || email).charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {user?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{email}</p>
                  </div>
                </div>
              );
            })}
            {participants.length > 3 && (
              <div className="text-xs text-gray-500 text-center pt-2 border-t border-gray-100">
                +{participants.length - 3} more participants
              </div>
            )}
          </div>
        </div>

        {/* Storage by Category Card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Storage</p>
                  <p className="text-xl font-bold text-gray-900">
                    {formatSize(totalStorage)}
                  </p>
                </div>
              </div>

              {/* Storage Categories Legend */}
              <div className="space-y-1.5">
                {segments.map((segment) => (
                  <div
                    key={segment.key}
                    className="flex items-center justify-between text-xs"
                  >
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

      {/* Folders Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Folders</h2>
            <p className="text-sm text-gray-600 mt-1">Organize your files</p>
          </div>
          <button
            onClick={() => navigate("/folders")}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            View all →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {folders.slice(0, 4).map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onDelete={handleDeleteFolder}
              onEdit={handleEditFolder}
            />
          ))}
        </div>
      </div>

      {/* Recent Files Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Recent Files</h2>
            <p className="text-sm text-gray-600 mt-1">Your latest uploads</p>
          </div>
          <button
            onClick={() => navigate("/files")}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            View all →
          </button>
        </div>

        <FileTable
          files={recentFiles.map((file) => ({
            id: file.id,
            name: file.name,
            size: file.size,
            uploadedAt: file.uploadedAt,
            encrypted: true,
            starred: file.starred,
            uploadedBy: file.uploadedBy,
            uploadedByUser: file.uploadedBy
              ? getUserByEmail(file.uploadedBy)
              : undefined,
            mimeType: file.mimeType,
          }))}
          onDelete={handleDeleteFile}
          onDownload={handleDownloadFile}
          onShare={handleShareFile}
          onToggleStar={handleToggleStar}
          downloadingId={downloadingId}
          downloadProgress={downloadProgress}
        />
      </div>

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <CreateFolderModal
          onClose={() => setShowCreateFolderModal(false)}
          onCreate={handleCreateFolder}
        />
      )}

      {/* Share File Dialog */}
      {shareModalFile && shareEnvelope && (
        <FileShareDialog
          fileId={shareModalFile.id}
          fileName={shareModalFile.name}
          envelope={shareEnvelope}
          onClose={() => {
            setShareModalFile(null);
            setShareEnvelope(null);
          }}
          onShareComplete={handleShareComplete}
        />
      )}

      {/* Loading overlay when preparing to share */}
      {loadingShareEnvelope && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex items-center space-x-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
            <span className="text-gray-700">Preparing file for sharing...</span>
          </div>
        </div>
      )}
    </div>
  );
};
