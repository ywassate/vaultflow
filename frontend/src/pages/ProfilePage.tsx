import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Camera, Upload, X } from 'lucide-react';
import { useToast } from '../contexts/toast';

// Predefined avatar options
const AVATAR_OPTIONS = [
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Jasmine',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Oscar',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Max',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Bella',
];

export const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || '');
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const handleAvatarClick = () => {
    setShowAvatarPicker(true);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showError('Invalid file type', 'Please select an image file');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showError('File too large', 'Please select an image smaller than 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
        setShowAvatarPicker(false);
        showSuccess('Avatar updated', 'Your profile picture has been updated');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSelectAvatar = (avatarUrl: string) => {
    setAvatarPreview(avatarUrl);
    setShowAvatarPicker(false);
    showSuccess('Avatar updated', 'Your profile picture has been updated');
  };

  const handleSave = () => {
    // TODO: Implement save to backend
    showSuccess('Changes saved', 'Your profile has been updated');
  };

  return (
    <div className="space-y-8">
      {/* Header with Avatar */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Account</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your personal information</p>
        </div>

        {/* Avatar at extreme right */}
        <div className="flex flex-col items-end gap-3">
          <div className="relative group">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 cursor-pointer ring-4 ring-gray-100" onClick={handleAvatarClick}>
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={user.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary-500 to-secondary-400 flex items-center justify-center">
                  <span className="text-white text-2xl font-bold">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={handleAvatarClick}
              className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Camera className="h-5 w-5 text-white" />
            </button>
          </div>
          <button
            onClick={handleAvatarClick}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            Change photo
          </button>
        </div>
      </div>

      {/* Avatar Picker */}
      {showAvatarPicker && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-semibold text-gray-900">Choose an avatar</h3>
            <button
              onClick={() => setShowAvatarPicker(false)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUploadClick}
            className="w-full mb-6 px-4 py-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-primary-500 hover:bg-primary-50 transition-all text-sm font-medium text-gray-700 flex items-center justify-center gap-2"
          >
            <Upload className="h-5 w-5" />
            Upload your own photo
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Predefined Avatars Grid */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Or choose from presets</p>
            <div className="flex flex-wrap gap-3">
              {AVATAR_OPTIONS.map((avatarUrl, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectAvatar(avatarUrl)}
                  className="w-14 h-14 rounded-full overflow-hidden bg-gray-100 hover:ring-4 hover:ring-primary-100 transition-all shadow-sm hover:shadow-md"
                >
                  <img
                    src={avatarUrl}
                    alt={`Avatar option ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Profile Information */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 shadow-sm">
        {/* Name Section */}
        <div className="p-6">
          <label className="block">
            <span className="text-sm font-semibold text-gray-900 mb-3 block">Full name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-shadow"
              placeholder="Enter your name"
            />
          </label>
        </div>

        {/* Email Section */}
        <div className="p-6">
          <div>
            <span className="text-sm font-semibold text-gray-900 mb-3 block">Email address</span>
            <p className="text-sm text-gray-600">{user.email}</p>
            <p className="text-xs text-gray-500 mt-1">Your email cannot be changed</p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3 pt-4">
        <button
          onClick={handleSave}
          className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 transition-colors shadow-sm hover:shadow"
        >
          Save changes
        </button>
      </div>
    </div>
  );
};
