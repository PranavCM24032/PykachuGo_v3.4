import React, { useState } from 'react';
import { playSound } from '../services/audio';
import { CustomSelect } from './CustomSelect';
import type { GameConfig, LanguageCode } from '../types/game';

interface Step1LoginProps {
  active: boolean;
  teamName: string;
  onTeamNameChange: (val: string) => void;
  securityKey: string;
  onSecurityKeyChange: (val: string) => void;
  language: LanguageCode;
  onLanguageChange: (val: LanguageCode) => void;
  missionLevel: string;
  onMissionLevelChange: (val: string) => void;
  config: GameConfig | null;
  feedback: { message: string; type: 'error' | 'success' | 'info' } | null;
  shakeField: 'teamName' | 'teamSecurityKey' | null;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export const Step1Login: React.FC<Step1LoginProps> = ({
  active,
  teamName,
  onTeamNameChange,
  securityKey,
  onSecurityKeyChange,
  language,
  onLanguageChange,
  missionLevel,
  onMissionLevelChange,
  config,
  feedback,
  shakeField,
  isSubmitting,
  onSubmit,
}) => {
  const [showKey, setShowKey] = useState(false);

  const feedbackClass =
    feedback?.type === 'error'
      ? 'text-xs p-3 rounded border bg-red-900/30 border-red-700 text-red-200'
      : feedback?.type === 'success'
        ? 'text-xs p-3 rounded border bg-green-900/30 border-green-700 text-green-200'
        : 'text-xs p-3 rounded border bg-blue-900/30 border-blue-700 text-blue-200';

  return (
    <div id="step1" className={`flow-step${active ? ' active' : ''} h-full`}>
      <div className="min-h-full w-full flex flex-col justify-center items-center gap-3 p-3 sm:p-5">
        <div className="text-center w-full shrink-0">
          <h2 className="font-pixel text-blue-400 mb-1 tracking-widest uppercase text-[10px] sm:text-xs">
            Trainer Identification
          </h2>
          <p className="text-gray-400 mb-1 sm:mb-2 text-[10px] sm:text-xs">Sync Kanto Network</p>

          <div className="relative flex justify-center mx-auto mb-1 sm:mb-2">
            <div className="relative w-12 h-12 sm:w-16 sm:h-16 md:w-[70px] md:h-[70px] bg-gray-900 rounded-full flex items-center justify-center border border-blue-500/20">
              <div className="p-1 w-full h-full">
                <img
                  src="/assets/img/ash-3.png"
                  alt="Ash"
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full rounded-full object-cover filter brightness-90"
                />
              </div>
            </div>
          </div>
        </div>

        <form id="registrationForm" onSubmit={onSubmit} className="w-full max-w-[300px] sm:max-w-xs">
          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Team Name
            </label>
            <div className="relative">
              <input
                type="text"
                id="teamName"
                value={teamName}
                onChange={(e) => onTeamNameChange(e.target.value)}
                className={`w-full bg-black/40 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 sm:pl-3 sm:pr-9 sm:py-2 text-white focus:border-blue-500 focus:outline-none placeholder-gray-600 uppercase transition-all text-[11px] sm:text-xs${
                  shakeField === 'teamName' ? ' animate-shake' : ''
                }`}
                placeholder="TRAINER NAME"
                autoComplete="off"
                required
                maxLength={50}
                autoCapitalize="characters"
              />
              <span className="material-symbols-rounded absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-gray-500 text-base sm:text-lg pointer-events-none">
                badge
              </span>
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Security Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                id="teamSecurityKey"
                value={securityKey}
                onChange={(e) => onSecurityKeyChange(e.target.value)}
                className={`w-full bg-black/40 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 sm:pl-3 sm:pr-9 sm:py-2 text-white focus:border-blue-500 focus:outline-none placeholder-gray-600 transition-all font-mono text-[11px] sm:text-xs${
                  shakeField === 'teamSecurityKey' ? ' animate-shake' : ''
                }`}
                placeholder="••••"
                autoComplete="off"
                required
                maxLength={50}
              />
              <button
                type="button"
                onClick={() => {
                  playSound('click');
                  setShowKey((prev) => !prev);
                }}
                className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-blue-400 transition-colors focus:outline-none"
              >
                <span id="securityKeyToggleIcon" className="material-symbols-rounded text-base sm:text-lg">
                  {showKey ? 'visibility' : 'visibility_off'}
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Language
            </label>
            <div className="relative group">
              <CustomSelect
                id="codeLanguage"
                value={language}
                onChange={(v) => onLanguageChange(v as LanguageCode)}
                options={config?.languages || []}
                placeholder="Select Language"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1 ml-1 font-bold text-[9px] sm:text-[10px]">
              Mission Discovery
            </label>
            <div className="relative group">
              <CustomSelect
                id="missionLevel"
                value={missionLevel}
                onChange={onMissionLevelChange}
                groups={config?.missionGroups || []}
                placeholder="Select Mission"
              />
            </div>
          </div>

          {feedback && (
            <div id="registrationFeedback" className={feedbackClass}>
              <div>{feedback.message}</div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            onMouseDown={() => playSound('powerUp')}
            className="btn-pokedex w-full flex items-center justify-center gap-1.5 sm:gap-2 py-1.5 sm:py-2 text-[10px] sm:text-xs"
          >
            <span className="material-symbols-rounded text-base sm:text-lg">play_arrow</span>
            {isSubmitting ? 'SYNCING...' : 'START GO'}
          </button>
        </form>
      </div>
    </div>
  );
};
