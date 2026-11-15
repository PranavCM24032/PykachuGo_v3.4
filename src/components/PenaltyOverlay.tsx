import React from 'react';

interface PenaltyOverlayProps {
  visible: boolean;
  seconds: number;
  ringIteration: number;
}

export const PenaltyOverlay: React.FC<PenaltyOverlayProps> = ({
  visible,
  seconds,
  ringIteration,
}) => {
  return (
    <div
      id="penaltyOverlay"
      className={`${visible ? '' : 'hidden '}absolute inset-0 z-[150] flex flex-col items-center justify-center p-4 backdrop-blur-3xl`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900/90 via-gray-800/95 to-gray-900/90">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 10px, #100303 10px, #373737 20px)',
          }}
        ></div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/30"></div>
      </div>

      <div className="relative w-full max-w-64 sm:max-w-80 border-2 border-red-500/30 rounded-xl p-4 sm:p-6 bg-black/80 shadow-[0_0_30px_rgba(220,38,38,0.4)] text-center z-10 backdrop-blur-sm animate-fade-in">
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/assets/img/jenny.png"
            alt="Officer Jenny"
            loading="lazy"
            decoding="async"
            className="h-[85%] max-h-80 object-contain opacity-25"
          />
        </div>

        <div className="mt-3 sm:mt-6 relative w-[clamp(112px,24vmin,168px)] h-[clamp(112px,24vmin,168px)] mx-auto">
          <svg className="w-full h-full -rotate-90 absolute top-0 left-0" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" stroke="rgba(120, 120, 120, 0.3)" strokeWidth="4" fill="none" />
            <circle
              key={ringIteration}
              cx="50"
              cy="50"
              r="45"
              stroke="rgb(239, 68, 68)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="283"
              strokeDashoffset="283"
              className="penalty-timer-ring"
              style={visible ? { animation: 'countdown 15s linear forwards' } : undefined}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="font-mono text-[clamp(34px,8vmin,56px)] text-white font-bold tabular-nums" id="penaltyTimer">
              {Math.max(0, seconds)}
            </div>
            <span className="text-xs sm:text-sm text-red-300 font-pixel uppercase mt-1">Seconds</span>
          </div>
        </div>

        <h1 className="font-pixel text-red-300 text-sm sm:text-base uppercase mt-3 sm:mt-4 tracking-widest">
          MALPRACTICE DETECTED
        </h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="material-symbols-rounded text-sm sm:text-base text-red-400">security</span>
          <p className="text-xs sm:text-sm text-gray-300 uppercase">Authority Alert</p>
          <span className="material-symbols-rounded text-sm sm:text-base text-red-400">policy</span>
        </div>
      </div>
    </div>
  );
};
