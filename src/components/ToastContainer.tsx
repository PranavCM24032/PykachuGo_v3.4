import React from 'react';
import type { ToastMessage } from '../types/game';

interface ToastContainerProps {
  toasts: ToastMessage[];
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts }) => {
  return (
    <>
      {toasts.map((toast) => {
        const glassClass =
          toast.type === 'error'
            ? 'glass-black'
            : toast.type === 'success'
              ? 'glass-green'
              : 'glass-blue';
        const iconName =
          toast.type === 'error' ? 'warning' : toast.type === 'success' ? 'check_circle' : 'info';

        return (
          <div
            key={toast.id}
            className={`absolute top-6 left-1/2 -translate-x-1/2 glass-toast ${glassClass} px-3 py-2 rounded-lg border shadow-xl font-pixel text-[8px] sm:text-[9px] text-white z-[9999] transition-all duration-300 pointer-events-none w-[86%] max-w-[240px] sm:max-w-[280px] animate-toast-in`}
          >
            <div className="flex items-center gap-2 relative z-10 w-full">
              <span className="material-symbols-rounded text-sm sm:text-base shrink-0">{iconName}</span>
              <span className="text-[8px] sm:text-[9px] leading-tight break-words">{toast.message}</span>
            </div>
          </div>
        );
      })}
    </>
  );
};
