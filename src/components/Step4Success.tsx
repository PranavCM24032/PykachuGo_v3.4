import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  getAudioContextTime,
  getCelebrationDuration,
  playFinalCelebration,
  playSound,
  speakCatch,
  stopCatchVoice,
} from '../services/audio';
import { getPokemonArtworkUrl } from '../services/gameBackend';
import type { Puzzle } from '../types/game';

interface Step4SuccessProps {
  active: boolean;
  puzzle: Puzzle | null;
  nextPuzzles: Puzzle[];
  missionLevel: string;
  revealKey: number;
  isLoggedIn: boolean;
  celebrationCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  screenRef: React.RefObject<HTMLDivElement | null>;
  onContinueToQRScan: () => void;
}

const CELEBRATION_BLASTS = [
  0, 3.45, 3.94, 4.44, 4.93, 5.43, 5.93, 6.42, 7.41, 7.91, 8.41, 9.4, 10.39,
  10.89, 11.38, 11.88, 12.62, 13.37, 14.01, 14.85, 15.75,
];
const CELEBRATION_SPARKS = [
  0.48, 0.97, 1.48, 1.97, 2.95, 4.68, 6.91, 8.9, 9.89, 11.63, 12.15, 13.86,
  14.38, 16.21, 17.42,
];
const CELEBRATION_BLAST_X = [0.5, 0.2, 0.8];

export const Step4Success: React.FC<Step4SuccessProps> = ({
  active,
  puzzle,
  nextPuzzles,
  missionLevel,
  revealKey,
  isLoggedIn,
  celebrationCanvasRef,
  screenRef,
  onContinueToQRScan,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const washRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const confettiFnRef = useRef<ReturnType<typeof confetti.create> | null>(null);
  const [imgSrc, setImgSrc] = useState<string>('/assets/img/pikachu.png');

  const isEnd =
    !puzzle ||
    !Array.isArray(puzzle.nextPuzzleId) ||
    puzzle.nextPuzzleId.length === 0;

  const levelNum =
    puzzle && typeof puzzle.level === 'number'
      ? puzzle.level
      : (missionLevel || 'L1').split('_')[0].replace('L', '') || '1';

  useEffect(() => {
    setImgSrc(getPokemonArtworkUrl(puzzle?.pokemonId));
  }, [puzzle?.pokemonId]);

  useEffect(() => {
    const clearAll = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      stopCatchVoice();
      try {
        confettiFnRef.current?.reset();
      } catch {
        // ignore confetti reset error
      }
      if (stageRef.current) {
        stageRef.current.classList.remove('is-playing', 'is-open');
      }
    };

    if (!active || !isLoggedIn || !puzzle) {
      clearAll();
      return;
    }

    clearAll();

    const stage = stageRef.current;
    if (!stage) return;

    // Reset + force reflow so the CSS keyframe always plays from t=0
    stage.classList.remove('is-playing', 'is-open');
    void stage.offsetWidth;
    stage.classList.add('is-playing');

    let alive = true;

    const triggerCelebration = () => {
      const audioStart = playFinalCelebration(1);
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      const canvas = celebrationCanvasRef.current;
      const screenEl = screenRef.current;
      if (!canvas || !screenEl) return;

      canvas.width = screenEl.clientWidth;
      canvas.height = screenEl.clientHeight;

      if (!confettiFnRef.current) {
        confettiFnRef.current = confetti.create(canvas, {
          resize: true,
          useWorker: false,
        });
      }
      const myConfetti = confettiFnRef.current;

      const wash = washRef.current;
      if (wash) {
        wash.style.transition = 'none';
        wash.style.opacity = '0.2';
        window.requestAnimationFrame(() => {
          if (!washRef.current) return;
          washRef.current.style.transition = 'opacity 1.4s ease';
          washRef.current.style.opacity = '0';
        });
      }

      const colors = [
        '#ff0000',
        '#3b82f6',
        '#ffd700',
        '#22c55e',
        '#a855f7',
        '#ffffff',
        '#f97316',
      ];

      const hasAudioClock = audioStart != null && getAudioContextTime() != null;
      const clock = hasAudioClock
        ? () => getAudioContextTime() as number
        : () => Date.now() / 1000;
      const base = audioStart != null ? audioStart : Date.now() / 1000;

      const schedule: Array<[number, 'blast' | 'star']> = [];
      CELEBRATION_BLASTS.forEach((t) => schedule.push([t, 'blast']));
      CELEBRATION_SPARKS.forEach((t) => schedule.push([t, 'star']));
      schedule.sort((a, b) => a[0] - b[0]);

      const lastHit = schedule.length ? schedule[schedule.length - 1][0] : 0;
      const trackDur = getCelebrationDuration();
      let displayEnd = lastHit + 1.0;
      if (trackDur) displayEnd = Math.min(displayEnd, trackDur);

      const blastAt = (x: number) =>
        myConfetti({
          particleCount: 140,
          startVelocity: 45,
          spread: 90,
          origin: { x, y: 0.7 },
          colors,
          gravity: 1.2,
        });

      const starAt = (x: number, y: number) =>
        myConfetti({
          particleCount: 40,
          spread: 100,
          origin: { x, y },
          shapes: ['star'],
          colors: ['#FFEAB0', '#FFF9E3', '#FACC15'],
        });

      let si = 0;
      let blastCount = 0;
      let nextFountainAt = 0;

      const frame = () => {
        if (!alive) return;
        const elapsed = clock() - base;

        while (si < schedule.length && elapsed >= schedule[si][0]) {
          if (elapsed - schedule[si][0] <= 0.12) {
            if (schedule[si][1] === 'blast') {
              blastAt(CELEBRATION_BLAST_X[blastCount++ % CELEBRATION_BLAST_X.length]);
            } else {
              starAt(Math.random(), Math.random() - 0.2);
            }
          }
          si++;
        }

        if (elapsed < displayEnd) {
          if (elapsed >= nextFountainAt) {
            myConfetti({
              particleCount: 5,
              angle: 60,
              spread: 55,
              origin: { x: 0, y: 1 },
              colors,
            });
            myConfetti({
              particleCount: 5,
              angle: 120,
              spread: 55,
              origin: { x: 1, y: 1 },
              colors,
            });
            nextFountainAt = elapsed + 0.1;
          }
          rafRef.current = window.requestAnimationFrame(frame);
        }
      };

      rafRef.current = window.requestAnimationFrame(frame);
    };

    timersRef.current.push(
      window.setTimeout(() => {
        if (!alive) return;
        playSound('pokeballDrop', 0.22);
      }, 715),
      window.setTimeout(() => {
        if (!alive) return;
        playSound('pokeballDrop', 0.12);
      }, 1066),
      window.setTimeout(() => {
        if (!alive || !stageRef.current) return;
        stageRef.current.classList.add('is-open');
        playSound('pokeballOpen');
        if (isEnd) {
          triggerCelebration();
        }
      }, 1400),
      window.setTimeout(() => {
        if (!alive) return;
        speakCatch(puzzle.pokemonName || '', !isEnd);
      }, 1440)
    );

    return () => {
      alive = false;
      clearAll();
    };
  }, [active, isLoggedIn, puzzle, revealKey, isEnd, celebrationCanvasRef, screenRef]);

  const handleImgError = () => {
    if (imgSrc !== '/assets/img/pikachu.png') {
      setImgSrc('/assets/img/pikachu.png');
    }
  };

  return (
    <>
      <div ref={washRef} className="celebration-wash" style={{ opacity: 0 }}></div>
      <div
        id="step4"
        className={`flow-step${active ? ' active' : ''} relative flex-1 min-h-0 h-full overflow-y-auto overflow-x-hidden`}
      >
        <div className="step4-success-layout relative flex min-h-full flex-col items-center justify-center gap-2.5 sm:gap-3 px-3 py-2 text-center sm:px-6 sm:py-3">
          {/* Background Sparkle & Halo Overlay */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div className="absolute left-[10%] top-[10%] size-2 rounded-full bg-yellow-300 animate-ping"></div>
            <div className="absolute right-[10%] top-[20%] size-3 rounded-full bg-white opacity-60 animate-pulse [animation-delay:500ms]"></div>
            <div className="absolute bottom-[25%] left-[15%] size-2 rounded-full bg-blue-300 animate-ping [animation-delay:1200ms]"></div>
            <div className="absolute bottom-[10%] right-[20%] size-2 rounded-full bg-purple-300 opacity-60 animate-pulse [animation-delay:800ms]"></div>
            <div className="absolute left-[5%] top-[40%] size-1.5 rounded-full bg-yellow-400 animate-ping [animation-delay:2000ms]"></div>
            <div className="absolute bottom-[40%] right-[5%] size-2 rounded-full bg-blue-400 animate-pulse [animation-delay:1500ms]"></div>

            <div className="perfect-sparkle sparkle-gold absolute left-[15%] top-[20%] size-3 sm:size-4 animate-twinkle [animation-duration:2s]"></div>
            <div className="perfect-sparkle sparkle-white absolute right-[10%] top-[40%] size-2 sm:size-3 animate-twinkle [animation-delay:300ms] [animation-duration:1.8s]"></div>
            <div className="perfect-sparkle sparkle-blue absolute bottom-[30%] left-[10%] size-1.5 sm:size-2 animate-twinkle [animation-delay:700ms] [animation-duration:2.5s]"></div>
            <div className="perfect-sparkle sparkle-gold absolute bottom-[40%] right-[15%] size-2 sm:size-3 animate-twinkle [animation-delay:1100ms] [animation-duration:2.2s]"></div>
            <div className="perfect-sparkle sparkle-purple absolute right-[25%] top-[15%] size-2 animate-twinkle [animation-delay:500ms] [animation-duration:3s]"></div>
            <div className="perfect-sparkle sparkle-blue absolute bottom-[15%] left-[30%] size-1.5 animate-twinkle [animation-delay:1800ms] [animation-duration:2.8s]"></div>
            <div
              className="perfect-sparkle sparkle-white absolute size-2 animate-twinkle"
              style={{ left: '7%', top: '28%', animationDelay: '900ms', animationDuration: '2.4s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-gold absolute size-1.5 animate-twinkle"
              style={{ left: '26%', top: '8%', animationDelay: '1400ms', animationDuration: '1.9s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-blue absolute size-2 animate-twinkle"
              style={{ left: '42%', top: '18%', animationDelay: '250ms', animationDuration: '2.7s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-purple absolute size-1.5 animate-twinkle"
              style={{ left: '64%', top: '9%', animationDelay: '1700ms', animationDuration: '2.1s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-gold absolute size-2 animate-twinkle"
              style={{ left: '83%', top: '29%', animationDelay: '650ms', animationDuration: '2.6s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-white absolute size-1.5 animate-twinkle"
              style={{ left: '92%', top: '58%', animationDelay: '1250ms', animationDuration: '2.3s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-purple absolute size-2 animate-twinkle"
              style={{ left: '73%', top: '72%', animationDelay: '350ms', animationDuration: '2.9s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-blue absolute size-1.5 animate-twinkle"
              style={{ left: '48%', top: '84%', animationDelay: '1550ms', animationDuration: '2.2s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-gold absolute size-2 animate-twinkle"
              style={{ left: '19%', top: '71%', animationDelay: '1050ms', animationDuration: '2.5s' }}
            ></div>
            <div
              className="perfect-sparkle sparkle-white absolute size-1.5 animate-twinkle"
              style={{ left: '4%', top: '57%', animationDelay: '1950ms', animationDuration: '2s' }}
            ></div>

            <div className="absolute left-1/2 top-1/2 size-48 sm:size-64 -translate-x-1/2 -translate-y-1/2 rounded-full border border-yellow-400/10 animate-spin-slow"></div>
            <div className="absolute left-1/2 top-1/2 size-56 sm:size-72 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full border border-blue-400/10 animate-spin-slow [animation-direction:reverse] [animation-duration:15s]"></div>
          </div>

          {/* Pokémon Stage Container */}
          <div className="step4-pokemon-stage relative z-10 flex w-full shrink-0 flex-col items-center justify-center">
            <div ref={stageRef} id="pokemonReveal" className="pokemon-reveal relative z-10 shrink-0">
              <div className="pk-platform">
                <div className="pk-ring pk-ring-outer"></div>
                <div className="pk-ring pk-ring-mid"></div>
                <div className="pk-ring pk-ring-core"></div>
              </div>

              <div className="pk-bloom"></div>
              <div className="pk-shockwave"></div>
              <div className="pk-shadow"></div>

              <div id="step4RevealBall" className="pk-ball">
                <div className="pk-half pk-top"></div>
                <div className="pk-half pk-bottom"></div>
                <div className="pk-band"></div>
                <div className="pk-btn"></div>
                <div className="pk-gloss"></div>
                <div className="pk-shade"></div>
              </div>

              <div className="pk-pop">
                <img
                  id="caughtPokemonSilhouette"
                  src={imgSrc}
                  onError={handleImgError}
                  className="pk-silhouette"
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                />
                <img
                  id="caughtPokemonImg"
                  src={imgSrc}
                  onError={handleImgError}
                  className="pk-sprite"
                  alt="Caught Pokémon"
                  decoding="async"
                />
              </div>
            </div>
          </div>

          {/* Main Content Section */}
          <div className="step4-success-content z-10 flex w-full shrink-0 flex-col items-center gap-3 px-2">
            <h2 className="font-pixel text-xs sm:text-sm tracking-wider text-green-400 uppercase drop-shadow">
              Decryption Successful
            </h2>

            {/* Single Destination Card */}
            <div
              id="locationCard"
              className={`${
                nextPuzzles.length === 1 ? '' : 'hidden '
              }location-card-glow relative w-full max-w-xs rounded-xl border border-yellow-500/40 bg-gray-900/80 p-3 shadow-2xl backdrop-blur-md`}
            >
              <div className="map-grid-bg absolute inset-0 opacity-20"></div>
              <div className="absolute left-0 top-0 size-2.5 rounded-tl-lg border-l-2 border-t-2 border-yellow-400/60"></div>
              <div className="absolute right-0 top-0 size-2.5 rounded-tr-lg border-r-2 border-t-2 border-yellow-400/60"></div>
              <div className="absolute bottom-0 left-0 size-2.5 rounded-bl-lg border-b-2 border-l-2 border-yellow-400/60"></div>
              <div className="absolute bottom-0 right-0 size-2.5 rounded-br-lg border-b-2 border-r-2 border-yellow-400/60"></div>

              <div className="relative z-10 flex items-center gap-3">
                <div className="flex w-7 h-7 sm:w-9 sm:h-9 shrink-0 items-center justify-center rounded-lg border border-yellow-500/30 bg-yellow-500/20">
                  <span className="material-symbols-rounded text-base sm:text-xl text-yellow-400">location_on</span>
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <span className="block text-[9px] font-black tracking-widest text-yellow-400/80 uppercase">
                    Signal Source
                  </span>
                  <p
                    id="locationClueText"
                    className={`${
                      nextPuzzles.length === 1 ? '' : 'hidden '
                    }font-pixel mt-0.5 text-xs sm:text-sm text-white leading-tight break-words`}
                  >
                    {nextPuzzles[0]?.locationClue || 'NO SIGNAL SOURCE'}
                  </p>
                </div>
              </div>
            </div>

            {/* Branching Multiple Destinations */}
            <div
              id="nextLocationList"
              className={`${
                nextPuzzles.length > 1 ? '' : 'hidden '
              }flex w-full flex-col items-center gap-2`}
            >
              {nextPuzzles.map((np) => (
                <div
                  key={np.id}
                  className="bg-gray-900/80 border border-yellow-500/40 rounded-xl p-2.5 sm:p-3 relative overflow-hidden backdrop-blur-sm location-card-glow shadow-2xl mx-auto w-full max-w-xs"
                >
                  <div className="absolute inset-0 map-grid-bg opacity-20"></div>
                  <div className="absolute top-0 left-0 w-2.5 h-2.5 border-t-2 border-l-2 border-yellow-400/50 rounded-tl-lg"></div>
                  <div className="absolute top-0 right-0 w-2.5 h-2.5 border-t-2 border-r-2 border-yellow-400/50 rounded-tr-lg"></div>
                  <div className="absolute bottom-0 left-0 w-2.5 h-2.5 border-b-2 border-l-2 border-yellow-400/50 rounded-bl-lg"></div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 border-b-2 border-r-2 border-yellow-400/50 rounded-br-lg"></div>

                  <div className="flex items-center gap-2.5 relative z-10">
                    <div className="flex-shrink-0">
                      <div className="w-7 h-7 sm:w-9 sm:h-9 bg-yellow-500/20 rounded-lg flex items-center justify-center border border-yellow-500/30">
                        <span className="material-symbols-rounded text-yellow-400 text-base sm:text-xl">
                          location_on
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <span className="text-yellow-400/80 text-[8px] sm:text-[9px] uppercase tracking-widest font-black block">
                        NEXT LOCATION
                      </span>
                      <p className="font-pixel text-white leading-tight break-words mt-0.5 text-xs sm:text-sm">
                        {(np.locationClue || 'NO SIGNAL SOURCE').toUpperCase()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completion Trophy Card */}
          <div
            id="completionMessage"
            className={`${isEnd ? '' : 'hidden '}z-20 w-full max-w-xs animate-fade-in`}
          >
            <div className="relative overflow-hidden rounded-xl border border-yellow-500/50 bg-black/70 p-4 shadow-[0_0_25px_rgba(234,179,8,0.35)] backdrop-blur-xl">
              <div className="flex flex-col items-center text-center">
                <div className="relative mb-2 flex size-14 sm:size-20 md:size-[88px] items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-yellow-400/20 blur-xl animate-pulse"></div>
                  <img
                    id="completionTrophyImg"
                    src="/assets/img/poketropy.png"
                    alt="Level Trophy"
                    width={80}
                    height={80}
                    decoding="async"
                    className="relative z-10 size-full object-contain drop-shadow-[0_0_15px_rgba(234,179,8,0.8)]"
                  />
                  <div className="gemini-shine shine-1"></div>
                  <div className="gemini-shine shine-2"></div>
                  <div className="gemini-shine shine-3"></div>
                  <div className="gemini-shine shine-4"></div>
                  <div className="gemini-shine shine-5"></div>
                  <div className="gemini-shine shine-6"></div>
                </div>

                <h3
                  id="completionLevelTitle"
                  className="font-pixel text-xs sm:text-sm tracking-tight text-yellow-300 uppercase"
                >
                  LEVEL {levelNum} CHAMPION
                </h3>
                <p
                  id="completionLevelSub"
                  className="mt-0.5 text-[9px] sm:text-[10px] font-black tracking-widest text-blue-200 uppercase"
                >
                  YOU HAVE COMPLETED LEVEL {levelNum}
                </p>

                <div className="mt-3 flex gap-1.5">
                  <div className="size-1.5 rounded-full bg-yellow-400 animate-ping"></div>
                  <div className="size-1.5 rounded-full bg-blue-400 animate-ping [animation-delay:500ms]"></div>
                  <div className="size-1.5 rounded-full bg-yellow-400 animate-ping [animation-delay:1000ms]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Call To Action */}
          <button
            type="button"
            id="nextSignalBtn"
            onClick={onContinueToQRScan}
            onMouseDown={() => playSound('click')}
            className={`${
              isEnd ? 'hidden ' : ''
            }btn-pokedex relative z-10 w-full max-w-xs shrink-0 py-3 font-pixel text-xs sm:text-sm tracking-wider uppercase transition-transform active:scale-95`}
          >
            Scan Next Signal
          </button>
        </div>
      </div>
    </>
  );
};
