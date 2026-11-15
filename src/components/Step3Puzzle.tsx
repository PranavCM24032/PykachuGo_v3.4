import React from 'react';
import { playSound } from '../services/audio';
import { HINT_SETTINGS, type LanguageCode, type Puzzle } from '../types/game';

interface Step3PuzzleProps {
  active: boolean;
  puzzle: Puzzle | null;
  language: LanguageCode;
  questionText: string;
  elapsedSeconds: number;
  tabSwitchCount: number;
  answerValue: string;
  onAnswerChange: (val: string) => void;
  onSubmitAnswer: (e: React.FormEvent) => void;
  shakeAnswer: boolean;
  answerInputRef: React.RefObject<HTMLInputElement | null>;
  hasHint: boolean;
  hintRequestOpen: boolean;
  hintPenaltyOpen: boolean;
  hintPenaltySeconds: number;
  hintPenaltyRingIteration: number;
  hintFocusLost: boolean;
  hintDisplayOpen: boolean;
  hintText: string;
  terminalLocked: boolean;
  ensureChecked: boolean;
  onEnsureCheckedChange: (checked: boolean) => void;
  onUnlockTerminal: () => void;
  onRequestHint: () => void;
  onConfirmHintRequest: () => void;
  onCancelHintRequest: () => void;
  onCloseHintPopup: () => void;
}

function formatMMSS(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const secs = (safe % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

export const Step3Puzzle: React.FC<Step3PuzzleProps> = ({
  active,
  puzzle,
  language,
  questionText,
  elapsedSeconds,
  tabSwitchCount,
  answerValue,
  onAnswerChange,
  onSubmitAnswer,
  shakeAnswer,
  answerInputRef,
  hasHint,
  hintRequestOpen,
  hintPenaltyOpen,
  hintPenaltySeconds,
  hintPenaltyRingIteration,
  hintFocusLost,
  hintDisplayOpen,
  hintText,
  terminalLocked,
  ensureChecked,
  onEnsureCheckedChange,
  onUnlockTerminal,
  onRequestHint,
  onConfirmHintRequest,
  onCancelHintRequest,
  onCloseHintPopup,
}) => {
  const penaltyTotal =
    puzzle?.hintPenalty && puzzle.hintPenalty > 0
      ? puzzle.hintPenalty
      : HINT_SETTINGS.defaultPenalty;

  const anyHintOverlayVisible = hintRequestOpen || hintPenaltyOpen || hintDisplayOpen;

  return (
    <>
      <div id="step3" className={`flow-step${active ? ' active' : ''} h-full relative overflow-hidden`}>
        <div className="flex flex-col h-full relative z-10 p-2 sm:p-3 overflow-hidden">
          <div className="flex justify-between items-center mb-2 px-2 shrink-0 border-b border-green-500/30 pb-1.5 font-mono">
            <span className="text-green-500 text-xs sm:text-sm truncate pr-2"> &gt;_ TERMINAL</span>
            <span
              id="langBadge"
              className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-bold"
            >
              {language === 'CPP' ? 'C++' : 'PYTHON'}
            </span>
            <div className="flex items-center gap-2">
              <div id="tabWarning" className={`${tabSwitchCount > 0 ? '' : 'hidden '}animate-pulse`}>
                <span className="material-symbols-rounded text-red-500 text-sm sm:text-base">warning</span>
              </div>
              <span id="puzzleTimer" className="text-green-500 text-xs sm:text-sm font-mono tabular-nums">
                {formatMMSS(elapsedSeconds)}
              </span>
            </div>
          </div>

          <div
            className={`code-terminal${active ? ' glow-active' : ''} flex-1 p-2 sm:p-3 mb-3 transition-all duration-200${
              terminalLocked ? ' blur-md opacity-25 pointer-events-none select-none' : ''
            }`}
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 opacity-40">
              <div className="cyber-pokeball">
                <div className="cyber-orbit"></div>
                <div id="step4Pokeball" className={`pixel-pokeball${puzzle ? '' : ' hidden'}`}>
                  <div className="pokeball-btn"></div>
                </div>
              </div>
            </div>

            <pre
              id="puzzleQuestion"
              className="flex-1 overflow-y-auto scrollable text-green-300 text-xs sm:text-sm leading-relaxed font-mono whitespace-pre-wrap break-words unselectable relative z-10 p-1"
            >
              {questionText || 'Loading puzzle data...'}
            </pre>
          </div>

          <form
            id="answerForm"
            onSubmit={onSubmitAnswer}
            className={`shrink-0 w-full mt-auto transition-all duration-200${
              terminalLocked ? ' opacity-25 pointer-events-none select-none' : ''
            }`}
          >
            <div className="flex flex-row sm:flex-row gap-2 sm:gap-3 items-stretch">
              <button
                type="button"
                id="hintRequestBtn"
                disabled={terminalLocked}
                onClick={onRequestHint}
                className={`${
                  hasHint ? '' : 'hidden '
                }bg-yellow-500/10 border-2 border-yellow-500/50 rounded-xl flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 hover:text-yellow-400 active:bg-yellow-500/30 transition-colors relative z-20 cursor-pointer py-3 sm:py-0 min-h-[44px] min-w-[44px] order-1`}
              >
                <span className="material-symbols-rounded text-lg sm:text-xl md:text-2xl">lightbulb</span>
              </button>

              <div className="flex-1 min-w-0 order-2">
                <input
                  ref={answerInputRef}
                  type="text"
                  id="puzzleAnswer"
                  disabled={terminalLocked}
                  value={answerValue}
                  onChange={(e) => onAnswerChange(e.target.value)}
                  className={`w-full h-full bg-gray-900/50 border-2 border-gray-700 rounded-lg px-3 sm:px-4 py-3 text-white text-sm sm:text-base focus:border-green-500 outline-none uppercase min-h-[44px]${
                    shakeAnswer ? ' animate-shake' : ''
                  }`}
                  placeholder="ENTER SOLUTION"
                  autoComplete="off"
                  required
                  maxLength={50}
                  autoCapitalize="characters"
                />
              </div>

              <button
                type="submit"
                disabled={terminalLocked}
                onMouseDown={() => playSound('click')}
                className="btn-pokedex flex items-center justify-center min-h-[44px] min-w-[44px] order-3 py-3 sm:py-0"
              >
                <span className="material-symbols-rounded text-lg sm:text-xl md:text-2xl">send</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Hint System Overlays */}
      <div id="hintContainer" className={anyHintOverlayVisible ? '' : 'hidden'}>
        {/* Hint Request Overlay */}
        <div
          id="hintRequestOverlay"
          className={`${
            hintRequestOpen ? '' : 'hidden '
          }absolute inset-0 z-[90] glass-panel flex flex-col items-center justify-center p-4`}
        >
          <div className="bg-gray-900/90 border-2 border-yellow-600/50 rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm text-center animate-fade-in">
            <span className="material-symbols-rounded text-yellow-500 text-3xl sm:text-4xl md:text-5xl">
              lightbulb
            </span>
            <h3 className="font-pixel text-yellow-500 text-sm sm:text-base my-3">Hint Request</h3>
            <p className="text-gray-400 text-xs sm:text-sm mb-4">
              Requires <span id="hintPenaltyTime" className="font-bold">{penaltyTotal}</span>s
              processing time. Stay on screen.
            </p>
            <div className="flex gap-2 sm:gap-3">
              <button
                type="button"
                onClick={onConfirmHintRequest}
                onMouseDown={() => playSound('click')}
                className="bg-yellow-600 text-black font-bold flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-yellow-700 transition-colors min-h-[44px]"
              >
                PROCEED
              </button>
              <button
                type="button"
                onClick={onCancelHintRequest}
                onMouseDown={() => playSound('click')}
                className="bg-gray-800 text-white flex-1 py-3 sm:py-4 rounded-lg text-sm sm:text-base hover:bg-gray-700 transition-colors min-h-[44px]"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>

        {/* Hint Penalty Overlay */}
        <div
          id="hintPenaltyOverlay"
          className={`${
            hintPenaltyOpen ? '' : 'hidden '
          }absolute inset-0 z-[95] flex flex-col items-center justify-center p-4 backdrop-blur-3xl`}
        >
          <div className="text-center relative w-full max-w-xs sm:max-w-sm glass-black border border-amber-500/30 rounded-xl p-6 sm:p-8 backdrop-blur-sm animate-fade-in">
            <div className="absolute inset-0 bg-gradient-to-br from-stone-900/80 via-amber-900/20 to-stone-900/80">
              <div className="absolute inset-0 flex items-center justify-center opacity-10">
                <img
                  src="/assets/img/brock.png"
                  alt="Brock"
                  loading="lazy"
                  decoding="async"
                  className="h-[70%] max-h-64 object-contain opacity-90"
                />
              </div>
            </div>

            <div className="mb-8 relative z-10">
              <h2 className="font-pixel text-amber-400 text-lg sm:text-xl uppercase tracking-widest mb-2">
                GYM TRAINING
              </h2>
              <p className="text-xs sm:text-sm text-gray-400 uppercase">Brock's Discipline</p>
            </div>

            <div className="relative w-[clamp(118px,26vmin,192px)] h-[clamp(118px,26vmin,192px)] mx-auto mb-5 sm:mb-8 z-10">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="rgba(245, 158, 11, 0.2)"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  key={hintPenaltyRingIteration}
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="rgb(245, 158, 11)"
                  strokeWidth="4"
                  fill="none"
                  className="hint-penalty-timer-ring"
                  strokeDasharray="283"
                  strokeDashoffset="283"
                  strokeLinecap="round"
                  style={
                    hintPenaltyOpen
                      ? { animation: `hint-countdown ${penaltyTotal}s linear forwards` }
                      : undefined
                  }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div
                  className="font-pixel text-amber-300 text-[clamp(32px,8vmin,52px)] mb-1 sm:mb-2"
                  id="hintTimerDisplay"
                >
                  {Math.max(0, hintPenaltySeconds)}
                </div>
                <span className="text-xs sm:text-sm text-amber-500/70 uppercase">Seconds</span>
              </div>
            </div>

            <div className="mb-6 relative z-10">
              <p className="text-amber-400 text-sm sm:text-base uppercase mb-2">
                Decrypting Hint...
              </p>
              <p className="text-xs text-gray-500">Stay focused on your training!</p>
            </div>

            <div
              id="hintWarningMessage"
              className={`${
                hintFocusLost ? '' : 'hidden '
              }bg-red-900/40 border border-red-500/50 p-4 rounded-lg animate-shake mb-6 relative z-10`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="material-symbols-rounded text-red-400 text-sm sm:text-base">warning</span>
                <p className="text-red-400 text-xs sm:text-sm font-pixel uppercase">FOCUS LOST!</p>
              </div>
              <p className="text-red-300 text-xs mt-1" id="tabSwitchWarning">
                Tab switch detected! Timer reset.
              </p>
            </div>

            <div className="border-t border-amber-500/20 pt-4 relative z-10">
              <p className="text-xs text-amber-500/60">&quot;Rock-solid focus wins battles.&quot;</p>
            </div>
          </div>
        </div>

        {/* Hint Display */}
        <div
          id="hintDisplay"
          className={`${
            hintDisplayOpen ? '' : 'hidden '
          }absolute inset-0 z-[110] glass-panel flex items-center justify-center p-4`}
        >
          <div className="glass-blue border-2 border-blue-500/50 rounded-xl p-4 sm:p-5 w-full max-w-xs sm:max-w-sm relative animate-fade-in">
            <button
              type="button"
              onClick={onCloseHintPopup}
              onMouseDown={() => playSound('click')}
              className="absolute top-2 right-2 text-gray-400 hover:text-white p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg"
            >
              <span className="material-symbols-rounded text-lg sm:text-xl">close</span>
            </button>
            <h3 className="font-pixel text-blue-400 text-sm sm:text-base mb-3">Hint Unlocked</h3>
            <div className="max-h-40 sm:max-h-48 overflow-y-auto">
              <p id="hintText" className="text-white text-sm sm:text-base font-mono leading-relaxed">
                {hintText}
              </p>
            </div>
            <button
              type="button"
              onClick={onCloseHintPopup}
              onMouseDown={() => playSound('click')}
              className="btn-pokedex w-full mt-4 py-3 text-sm sm:text-base"
            >
              CLOSE
            </button>
          </div>
        </div>
      </div>

      {/* Terminal-Only Tab-Switch Lock Overlay */}
      {active && terminalLocked && (
        <div
          id="terminalLockOverlay"
          className="absolute inset-0 z-[125] glass-panel glass-red flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terminalLockTitle"
        >
          <div className="relative z-10 w-full max-w-xs sm:max-w-sm rounded-xl border-2 border-red-500/50 bg-gray-950/95 p-4 sm:p-5 text-center shadow-[0_0_35px_rgba(239,68,68,0.35)] animate-fade-in">
            <div className="mx-auto mb-3 flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-full border border-red-500/50 bg-red-500/15 shadow-[0_0_20px_rgba(239,68,68,0.25)]">
              <span className="material-symbols-rounded text-2xl sm:text-3xl text-red-400">lock</span>
            </div>

            <h3
              id="terminalLockTitle"
              className="font-pixel text-xs sm:text-sm text-red-400 uppercase tracking-widest mb-2"
            >
              TERMINAL LOCKED
            </h3>

            <p className="text-[11px] sm:text-xs text-slate-300 font-mono leading-relaxed mb-3">
              Tab switch detected. Only the coding terminal has been locked for security verification.
            </p>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-mono text-red-300 uppercase mb-4">
              <span className="material-symbols-rounded text-xs sm:text-sm text-red-400">warning</span>
              <span>Tab Switches Recorded: {tabSwitchCount}</span>
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-slate-700/80 bg-black/50 p-3 text-left cursor-pointer hover:border-blue-500/50 transition-colors mb-4 select-none">
              <input
                type="checkbox"
                checked={ensureChecked}
                onChange={(e) => {
                  playSound('click');
                  onEnsureCheckedChange(e.target.checked);
                }}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                  ensureChecked
                    ? 'border-green-400 bg-green-500 text-black shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                    : 'border-slate-500 bg-slate-900/90 text-transparent'
                }`}
              >
                <span className="material-symbols-rounded text-[13px] sm:text-sm font-bold">check</span>
              </span>
              <span className="text-[11px] sm:text-xs font-mono text-slate-200 leading-snug">
                I ensure that I will stay inside the terminal and will not switch tabs or windows.
              </span>
            </label>

            <button
              type="button"
              disabled={!ensureChecked}
              onClick={() => {
                if (!ensureChecked) return;
                playSound('powerUp');
                onUnlockTerminal();
              }}
              className={`btn-pokedex w-full flex items-center justify-center gap-2 py-3 text-xs sm:text-sm transition-all ${
                ensureChecked
                  ? 'opacity-100 cursor-pointer'
                  : 'opacity-45 cursor-not-allowed grayscale'
              }`}
            >
              <span className="material-symbols-rounded text-base sm:text-lg md:text-xl">
                {ensureChecked ? 'lock_open' : 'verified_user'}
              </span>
              UNLOCK TERMINAL
            </button>
          </div>
        </div>
      )}
    </>
  );
};
