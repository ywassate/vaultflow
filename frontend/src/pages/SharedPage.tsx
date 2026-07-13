import React, { useState, useEffect } from 'react';
import { Share2, Search, Grid3x3, List, Download, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { apiService, type SharedFileInfo } from '../services/apiService';
import { afghFileService } from '../services/crypto/afghFileService';
import { useAuth } from '../contexts/AuthContext';
import type { SharedAFGHFileEnvelope, Level2Ciphertext } from '../types/afgh';

// Helper functions
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const SharedPage: React.FC = () => {
  const { keyPair } = useAuth();
  const [sharedFiles, setSharedFiles] = useState<SharedFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);

  useEffect(() => {
    loadSharedFiles();
  }, []);

  const loadSharedFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const files = await apiService.getSharedFiles();
      setSharedFiles(files);
    } catch (err) {
      console.error('[SharedPage] Error loading shared files:', err);
      setError('Failed to load shared files');
    } finally {
      setLoading(false);
    }
  };

  // Filter files based on search query
  const filteredFiles = sharedFiles.filter(file =>
    file.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.sharedByName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.sharedBy?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownloadFile = async (file: SharedFileInfo) => {
    if (!keyPair) {
      alert('You must be logged in to download files');
      return;
    }

    if (!file.encryptedKey) {
      alert('No encryption data available for this file');
      return;
    }

    try {
      setDownloadingId(file.fileId);
      setDownloadProgress(0);
      console.log('[SharedPage] Starting download for shared file:', file.filename);

      // Step 1: Download encrypted file chunks from backend
      console.log('[SharedPage] Fetching encrypted file from server...');
      setDownloadProgress(10);
      const encryptedBlob = await apiService.downloadFile(file.fileId);

      // Step 2: Read blob as text (it's the original AFGH envelope)
      console.log('[SharedPage] Reading original envelope...');
      setDownloadProgress(20);
      const originalEnvelopeText = await encryptedBlob.text();
      const originalEnvelope = afghFileService.deserializeEnvelope(originalEnvelopeText);

      // Step 3: Parse the shared envelope from encryptedKey
      console.log('[SharedPage] Parsing shared envelope...');
      setDownloadProgress(30);
      const sharedEnvelopeData = JSON.parse(file.encryptedKey);

      // Reconstruct the Level2Ciphertext from the shared data
      const kemCiphertext: Level2Ciphertext = {
        U: base64ToUint8Array(sharedEnvelopeData.kemCiphertext.U),
        V: base64ToUint8Array(sharedEnvelopeData.kemCiphertext.V),
        level: 2,
      };

      // Construct the SharedAFGHFileEnvelope
      const sharedEnvelope: SharedAFGHFileEnvelope = {
        fileId: sharedEnvelopeData.fileId,
        fileName: sharedEnvelopeData.fileName,
        fileSize: sharedEnvelopeData.fileSize,
        mimeType: sharedEnvelopeData.mimeType,
        kemCiphertext: kemCiphertext,
        wrappedFileKey: sharedEnvelopeData.wrappedFileKey,
        wrapKeyIV: sharedEnvelopeData.wrapKeyIV,
        kdfSalt: sharedEnvelopeData.kdfSalt ? base64ToUint8Array(sharedEnvelopeData.kdfSalt) : undefined,
        chunks: originalEnvelope.chunks, // Use chunks from the original file
        metadata: sharedEnvelopeData.metadata,
        recipientId: sharedEnvelopeData.recipientId,
        shareId: sharedEnvelopeData.shareId,
        permissions: sharedEnvelopeData.permissions,
      };

      console.log('[SharedPage] Shared envelope reconstructed');
      setDownloadProgress(40);

      // Step 4: Decrypt the shared file with AFGH service
      console.log('[SharedPage] Decrypting shared file with AFGH...');
      const decryptedFile = await afghFileService.decryptSharedFile(
        sharedEnvelope,
        keyPair,
        (progress, message) => {
          const mappedProgress = 40 + Math.round(progress * 0.5);
          setDownloadProgress(mappedProgress);
          console.log(`[SharedPage] ${message} (${progress}%)`);
        }
      );

      console.log('[SharedPage] File decrypted successfully:', decryptedFile.fileName);
      setDownloadProgress(95);

      // Step 5: Create Blob and trigger download
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
      console.log('[SharedPage] Download complete!');

    } catch (err) {
      console.error('[SharedPage] Download error:', err);
      alert(`Failed to download file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  const handleRemoveShare = async (file: SharedFileInfo) => {
    if (!confirm(`Remove "${file.filename}" from your shared files?`)) return;

    try {
      await apiService.removeShare(file.shareId);
      setSharedFiles(sharedFiles.filter(f => f.shareId !== file.shareId));
    } catch (err) {
      console.error('[SharedPage] Error removing share:', err);
      alert('Failed to remove share');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shared with me</h1>
          <p className="text-gray-600 mt-1">
            {sharedFiles.length} {sharedFiles.length === 1 ? 'file' : 'files'} shared with you
          </p>
        </div>
      </div>

      {/* Search Bar and View Toggle */}
      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search shared files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'grid'
                ? 'bg-primary-50 text-primary-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title="Grid view"
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'list'
                ? 'bg-primary-50 text-primary-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-2">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-700">{error}</span>
          <button
            onClick={loadSharedFiles}
            className="ml-auto text-red-600 hover:text-red-800 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Loader2 className="h-8 w-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading shared files...</p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
            <Share2 className="h-10 w-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? 'No matching files' : 'No shared files yet'}
          </h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            {searchQuery
              ? 'Try adjusting your search query'
              : 'When others share files with you, they will appear here'}
          </p>
        </div>
      ) : viewMode === 'list' ? (
        /* List View */
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Shared by
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredFiles.map((file) => (
                <tr key={file.fileId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-primary-100 rounded-lg flex items-center justify-center">
                        <Share2 className="h-5 w-5 text-primary-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 truncate max-w-xs">
                          {file.filename}
                        </div>
                        <div className="text-xs text-gray-500">{file.mimeType}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{file.sharedByName}</div>
                    <div className="text-xs text-gray-500">{file.sharedBy}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatFileSize(file.size)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(file.sharedAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleDownloadFile(file)}
                        disabled={downloadingId === file.fileId}
                        className="inline-flex items-center px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                        title="Download"
                      >
                        {downloadingId === file.fileId ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                            <span>{downloadProgress}%</span>
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-1.5" />
                            <span>Download</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleRemoveShare(file)}
                        className="inline-flex items-center px-3 py-1.5 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition"
                        title="Remove from shared"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredFiles.map((file) => (
            <div
              key={file.fileId}
              className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="h-12 w-12 bg-primary-100 rounded-lg flex items-center justify-center">
                  <Share2 className="h-6 w-6 text-primary-600" />
                </div>
                <span className="text-xs text-gray-500">{formatFileSize(file.size)}</span>
              </div>
              <h3 className="text-sm font-medium text-gray-900 truncate mb-1">
                {file.filename}
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                From: {file.sharedByName || file.sharedBy}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownloadFile(file)}
                  disabled={downloadingId === file.fileId}
                  className="flex-1 inline-flex items-center justify-center px-3 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                >
                  {downloadingId === file.fileId ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      <span>{downloadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-1.5" />
                      <span>Download</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleRemoveShare(file)}
                  className="inline-flex items-center justify-center px-3 py-2 bg-red-100 text-red-600 text-sm rounded-lg hover:bg-red-200 transition"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
