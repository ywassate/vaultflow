import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';
import type { ToastType } from '../../contexts/toast';

interface ToastProps {
  type: ToastType;
  title: string;
  message?: string;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ type, title, message, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation
    setTimeout(() => setIsVisible(true), 10);
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for animation to complete
  };

  const config = {
    success: {
      icon: CheckCircle,
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
      iconColor: 'text-green-600',
      titleColor: 'text-green-900',
      messageColor: 'text-green-700',
    },
    error: {
      icon: XCircle,
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200',
      iconColor: 'text-red-600',
      titleColor: 'text-red-900',
      messageColor: 'text-red-700',
    },
    warning: {
      icon: AlertCircle,
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      iconColor: 'text-yellow-600',
      titleColor: 'text-yellow-900',
      messageColor: 'text-yellow-700',
    },
    info: {
      icon: Info,
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      iconColor: 'text-blue-600',
      titleColor: 'text-blue-900',
      messageColor: 'text-blue-700',
    },
  };

  const { icon: Icon, bgColor, borderColor, iconColor, titleColor, messageColor } = config[type];

  return (
    <div
      className={`
        ${bgColor} ${borderColor}
        border rounded-lg shadow-lg p-4 min-w-[320px] max-w-md
        transition-all duration-300 transform
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`${iconColor} flex-shrink-0 mt-0.5`}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-semibold ${titleColor} mb-1`}>{title}</h4>
          {message && <p className={`text-sm ${messageColor}`}>{message}</p>}
        </div>

        <button
          onClick={handleClose}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded hover:bg-white/50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
