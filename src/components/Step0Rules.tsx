import React from 'react';
import { playSound } from '../services/audio';

interface Step0RulesProps {
  active: boolean;
  onAccept: () => void;
}

export const Step0Rules: React.FC<Step0RulesProps> = ({ active, onAccept }) => {
  return (
    <div id="step0" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-4 p-3 sm:p-5 text-center">
        <h2 className="font-pixel text-blue-400 tracking-widest uppercase text-xs sm:text-sm shrink-0">
          Mission Protocol
        </h2>

        <div className="briefing-container shrink-0">
          <div className="rules-board blackboard w-full mx-auto">
            <p className="rules-content text-[11px] sm:text-xs leading-relaxed text-left space-y-2 text-slate-100">
              <span className="rules-title block mb-1.5 uppercase font-bold text-center pb-1">
                Oak&apos;s Master Rules
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">1.</span>
                <span>No tab switching. (Jenny&apos;s watching!)</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">2.</span>
                <span>Hints cost processing time.</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">3.</span>
                <span>Keys are confidential.</span>
              </span>
              <span className="flex items-start gap-1.5">
                <span className="chalk-bullet">4.</span>
                <span>Stay in mission sector.</span>
              </span>
            </p>
          </div>

          <div className="oak-overlap">
            <img src="/assets/img/oak.png" alt="Professor Oak" loading="lazy" decoding="async" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            playSound('powerUp');
            onAccept();
          }}
          className="btn-pokedex w-full max-w-xs flex items-center justify-center gap-2 py-3 text-xs sm:text-sm shrink-0"
        >
          <span className="material-symbols-rounded text-base sm:text-lg">check_circle</span>
          I&apos;M READY, PROFESSOR!
        </button>
      </div>
    </div>
  );
};
