/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Alert } from '../ui';
import { X, Share2, Mail, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/apiService';
import { afghFileService } from '../../services/crypto/afghFileService';
import { useAuth } from '../../contexts/AuthContext';
import type { AFGHPublicKey } from '../../types/afgh';

interface FileShareDialogProps {
  fileId: string;
  fileName: string;
  envelope: any; // AFGHFileEnvelope
  onClose: () => void;
  onShareComplete?: () => void;
}

type ShareStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * FileShareDialog Component
 * Implements secure file sharing using AFGH Proxy Re-Encryption
 */
export const FileShareDialog: React.FC<FileShareDialogProps> = ({
  fileId,
  fileName,
  envelope,
  onClose,
  onShareComplete
}) => {
  const { keyPair } = useAuth();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [status, setStatus] = useState<ShareStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleShare = async () => {
    if (!recipientEmail.trim()) {
      setError('Please enter a recipient email address');
      return;
    }

    if (!keyPair) {
      setError('You must be logged in to share files');
      return;
    }

    if (!envelope) {
      setError('File envelope not available for sharing');
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      // Step 1: Get recipient's public key from backend
      console.log('[Share] Fetching recipient public key for:', recipientEmail);
      const recipientKeyData = await apiService.getUserPublicKey(recipientEmail);

      if (!recipientKeyData) {
        throw new Error('User not found or has no public key registered');
      }

      // Parse recipient public key
      let recipientPublicKey: AFGHPublicKey;
      if (typeof recipientKeyData === 'string') {
        // If it's a JSON string, parse it
        const parsed = JSON.parse(recipientKeyData);
        recipientPublicKey = {
          publicKey1: base64ToUint8Array(parsed.publicKey1),
          publicKey2: base64ToUint8Array(parsed.publicKey2),
          userId: recipientEmail,
        };
      } else {
        // It's already an object
        recipientPublicKey = {
          publicKey1: base64ToUint8Array(recipientKeyData.publicKey1),
          publicKey2: base64ToUint8Array(recipientKeyData.publicKey2),
          userId: recipientEmail,
        };
      }

      console.log('[Share] Recipient public key retrieved');

      // Step 2: Create shared envelope (decrypt-then-re-encrypt for recipient)
      console.log('[Share] Creating shared envelope for recipient...');
      const sharedEnvelope = await afghFileService.shareFile(
        envelope,
        keyPair,
        recipientPublicKey,
        recipientEmail,
        'read'
      );

      console.log('[Share] Shared envelope created');

      // Step 3: Serialize and send to backend
      const serializedEnvelope = JSON.stringify({
        ...sharedEnvelope,
        kemCiphertext: {
          U: uint8ArrayToBase64(sharedEnvelope.kemCiphertext.U),
          V: uint8ArrayToBase64(sharedEnvelope.kemCiphertext.V),
          level: sharedEnvelope.kemCiphertext.level,
        },
        kdfSalt: sharedEnvelope.kdfSalt ? uint8ArrayToBase64(sharedEnvelope.kdfSalt) : undefined,
      });

      await apiService.shareFile(fileId, recipientEmail, serializedEnvelope);

      console.log('[Share] File shared successfully!');
      setStatus('success');
      setSuccessMessage(`File shared with ${recipientEmail}`);

      // Call completion callback after short delay
      setTimeout(() => {
        onShareComplete?.();
      }, 1500);

    } catch (err: any) {
      console.error('[Share] Error:', err);
      setStatus('error');
      if (err.response?.status === 404) {
        setError('User not found. Make sure they have registered an account.');
      } else if (err.response?.status === 409) {
        setError('File is already shared with this user.');
      } else {
        setError(err.message || 'Failed to share file. Please try again.');
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Share2 className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Share File</h2>
              <p className="text-sm text-gray-500 truncate max-w-xs">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={status === 'loading'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {status === 'success' ? (
            <div className="flex flex-col items-center py-4">
              <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
              <p className="text-green-700 font-medium">{successMessage}</p>
            </div>
          ) : (
            <>
              {/* Email Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Recipient Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="Enter recipient's email"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    disabled={status === 'loading'}
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <Alert type="error" message={error} />
              )}

              {/* Security Info */}
              <div className="bg-primary-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-primary-900 text-sm">End-to-End Encrypted</h4>
                    <p className="text-xs text-primary-700 mt-1">
                      This file will be securely shared using proxy re-encryption.
                      Only the recipient can decrypt the file with their private key.
                    </p>
                  </div>
                </div>
              </div>

              {/* Share Button */}
              <button
                onClick={handleShare}
                disabled={status === 'loading' || !recipientEmail.trim()}
                className="w-full py-2.5 px-4 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center space-x-2"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Sharing...</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-5 w-5" />
                    <span>Share File</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper functions
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
