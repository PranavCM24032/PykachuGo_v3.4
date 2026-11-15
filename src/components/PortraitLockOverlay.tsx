import React from 'react';
import { RotateCw, Smartphone } from 'lucide-react';

export const PortraitLockOverlay: React.FC = () => {
  return (
    <div
      id="portraitLockOverlay"
      className="portrait-lock-overlay fixed inset-0 z-[99999] bg-black flex-col items-center justify-center p-6 text-center select-none"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-full max-w-sm rounded-2xl border-2 border-red-500/40 bg-[#070b14] p-6 shadow-[0_0_50px_rgba(220,38,38,0.25)]">
        <div className="relative mx-auto mb-4 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full border-2 border-blue-400/50 bg-blue-500/10 shadow-[0_0_25px_rgba(59,130,246,0.3)]">
          <Smartphone className="h-7 w-7 sm:h-8 sm:w-8 text-blue-400 portrait-rotate-icon" strokeWidth={2} />
          <RotateCw
            className="absolute -bottom-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 rounded-full bg-[#070b14] p-0.5 text-yellow-400"
            strokeWidth={2.5}
          />
        </div>

        <h2 className="font-pixel text-xs text-red-400 uppercase tracking-widest mb-3">
          Rotate Phone
        </h2>

        <p className="font-mono text-xs text-slate-300 leading-relaxed mb-4">
          Landscape mode is locked. Rotate your device back to vertical portrait mode to continue.
        </p>

        <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-red-300">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
          Portrait Lock Active
        </div>
      </div>
    </div>
  );
};
