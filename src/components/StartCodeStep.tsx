import React, { useEffect, useRef } from 'react';
import { playSound } from '../services/audio';
import { getBadgeUrl } from '../services/gameBackend';
import type { Puzzle } from '../types/game';

interface StartCodeStepProps {
  active: boolean;
  lockedPuzzle: Puzzle | null;
  unlockCode: string;
  onUnlockCodeChange: (val: string) => void;
  feedback: { message: string; type: 'error' | 'success' | 'info' } | null;
  shakeInput: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}

export const StartCodeStep: React.FC<StartCodeStepProps> = ({
  active,
  lockedPuzzle,
  unlockCode,
  onUnlockCodeChange,
  feedback,
  shakeInput,
  onSubmit,
  onBack,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 600);
    return () => clearTimeout(t);
  }, [active]);

  const badgeId = lockedPuzzle?.badgeId;
  const badgeUrl = badgeId ? getBadgeUrl(badgeId) : '';

  const feedbackClass =
    feedback?.type === 'error'
      ? 'text-xs p-3 rounded border bg-red-900/30 border-red-700 text-red-200 mb-2'
      : 'text-xs p-3 rounded border bg-blue-900/30 border-blue-700 text-blue-200 mb-2';

  return (
    <div id="startcode" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-4 p-3 sm:p-5">
        <div className="w-full text-center shrink-0">
          <div
            id="step3BadgeContainer"
            className={`gym-badge-container${badgeUrl ? '' : ' hidden'} animate-fade-in`}
          >
            <div className="badge-sparkle"></div>
            {badgeUrl && (
              <img
                id="gymBadgeImg"
                src={badgeUrl}
                alt="Gym Badge"
                loading="lazy"
                decoding="async"
                className="gym-badge-image"
              />
            )}
          </div>

          <h2 className="font-pixel text-yellow-500 mb-1 tracking-widest uppercase text-xs sm:text-sm">
            Encryption Detected
          </h2>
          <p className="hidden text-gray-400 text-[10px] sm:text-xs">Input decryption key to proceed</p>
        </div>

        <form id="unlockForm" onSubmit={onSubmit} className="w-full max-w-xs sm:max-w-sm">
          <div className="mb-3 sm:mb-4">
            <label className="block text-gray-500 uppercase tracking-widest mb-1 font-bold text-[10px] sm:text-xs">
              Start Key
            </label>
            <div className="relative group">
              <input
                ref={inputRef}
                type="text"
                id="unlockCode"
                value={unlockCode}
                onChange={(e) => onUnlockCodeChange(e.target.value)}
                className={`w-full bg-black/40 border-2 border-gray-800 rounded-xl pl-3 pr-9 sm:pr-10 py-2.5 sm:py-3 text-white focus:border-yellow-500 focus:outline-none placeholder-gray-600 uppercase transition-all text-xs sm:text-sm${
                  shakeInput ? ' animate-shake' : ''
                }`}
                placeholder="ENCRYPTION KEY"
                autoComplete="off"
                required
                maxLength={50}
                autoCapitalize="characters"
              />
              <span className="material-symbols-rounded absolute right-3 top-1/2 -translate-y-1/2 text-yellow-500/50 group-focus-within:text-yellow-500 transition-colors text-base sm:text-lg md:text-xl pointer-events-none">
                key
              </span>
            </div>
          </div>

          {feedback && (
            <div id="unlockFeedback" className={feedbackClass}>
              {feedback.message}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              onMouseDown={() => playSound('click')}
              className="btn-pokedex flex-[2] flex items-center justify-center gap-1.5 py-2.5 sm:py-3 text-xs sm:text-sm"
              style={{
                background: 'linear-gradient(145deg, #F59E0B, #D97706)',
                borderBottom: '3px solid #92400E',
              }}
            >
              <span className="material-symbols-rounded text-base sm:text-lg md:text-xl">lock_open</span>
              VERIFY
            </button>

            <button
              type="button"
              onClick={() => {
                playSound('click');
                onBack();
              }}
              className="flex-1 bg-gray-800/50 border-2 border-gray-700 rounded-xl flex items-center justify-center text-gray-400 hover:text-white transition-all py-2.5 sm:py-3"
            >
              <span className="material-symbols-rounded text-base sm:text-lg md:text-xl">arrow_back</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
