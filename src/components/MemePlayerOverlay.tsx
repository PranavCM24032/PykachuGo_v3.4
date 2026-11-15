import React, { useCallback, useEffect, useRef } from 'react';
import { playSound } from '../services/audio';
import type { MemeEntry } from '../types/game';

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  unMute: () => void;
  setVolume: (vol: number) => void;
  seekTo: (seconds: number) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: string | HTMLElement,
        opts: Record<string, unknown>
      ) => YTPlayerInstance;
      PlayerState: {
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function ensureYTApiLoaded(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('YouTube player timeout'))), 10000);
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === 'function') prevReady();
      if (window.YT && window.YT.Player) finish(resolve);
    };
    const existing = document.getElementById('yt-iframe-api-script') as HTMLScriptElement | null;
    if (!existing) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onload = () => {
        if (window.YT && window.YT.Player) finish(resolve);
      };
      tag.onerror = () => finish(() => reject(new Error('Unable to load YouTube player')));
      document.head.appendChild(tag);
    }
  }).catch((err) => {
    ytApiPromise = null;
    throw err;
  });
  return ytApiPromise;
}

function extractVideoId(url: string): string {
  const text = String(url || '').trim();
  if (!text) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      return parsed.pathname.slice(1).split(/[/?#]/)[0] || '';
    }
    if (host.includes('youtube.com') || host.includes('m.youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const m = parsed.pathname.match(/(?:\/embed\/|\/shorts\/|\/watch\/|\/v\/|\/u\/\w\/)([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {
    // fallback regex
  }
  const m = text.match(/^.*(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/);
  return m && m[1] && m[1].length >= 11 ? m[1].split('/')[0] : '';
}

const MEME_TOP_CROP = 40;
const MEME_BOTTOM_CROP = 56;

interface MemePlayerOverlayProps {
  meme: MemeEntry | null;
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const MemePlayerOverlay: React.FC<MemePlayerOverlayProps> = ({
  meme,
  onClose,
  onShowToast,
}) => {
  const clipRef = useRef<HTMLDivElement | null>(null);
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);

  const fitMemePlayer = useCallback(() => {
    const clip = clipRef.current;
    const playerEl = document.getElementById('memePlayerDiv');
    if (!clip || !playerEl || clip.clientWidth === 0) return;
    const cw = clip.clientWidth;
    const ch = clip.clientHeight;
    const w = Math.max(cw, ((ch + MEME_TOP_CROP + MEME_BOTTOM_CROP) * 9) / 16);
    const h = (w * 16) / 9;
    playerEl.style.width = `${Math.round(w)}px`;
    playerEl.style.height = `${Math.round(h)}px`;
    playerEl.style.left = `${Math.round((cw - w) / 2)}px`;
    playerEl.style.top = `${-MEME_TOP_CROP}px`;
  }, []);

  const destroyPlayer = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch {
        // ignore
      }
      playerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const clip = clipRef.current;
    let observer: ResizeObserver | null = null;
    if (clip && 'ResizeObserver' in window) {
      observer = new ResizeObserver(() => fitMemePlayer());
      observer.observe(clip);
    }
    window.addEventListener('resize', fitMemePlayer);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fitMemePlayer);
    };
  }, [fitMemePlayer]);

  useEffect(() => {
    if (!meme) {
      destroyPlayer();
      return;
    }

    const videoId = extractVideoId(meme.ytlink || meme.memeid || '');
    if (!videoId) {
      onShowToast('Invalid meme link', 'error');
      onClose();
      return;
    }

    const start = Number(meme.starttime) || 0;
    const rawEnd = Number(meme.endtime) || 0;
    const end = rawEnd > start ? rawEnd : undefined;
    let cancelled = false;

    requestAnimationFrame(() => {
      fitMemePlayer();
      ensureYTApiLoaded()
        .then(() => {
          if (cancelled || !window.YT || !window.YT.Player || !playerMountRef.current) {
            throw new Error('YouTube player unavailable');
          }
          destroyPlayer();
          // Ensure fresh child div for YT.Player replacement
          playerMountRef.current.innerHTML = '<div id="memePlayerDiv"></div>';
          fitMemePlayer();

          playerRef.current = new window.YT.Player('memePlayerDiv', {
            height: '100%',
            width: '100%',
            videoId,
            playerVars: {
              autoplay: 1,
              controls: 0,
              modestbranding: 1,
              rel: 0,
              showinfo: 0,
              iv_load_policy: 3,
              disablekb: 1,
              playsinline: 1,
              enablejsapi: 1,
              mute: 1,
              loop: 1,
              playlist: videoId,
              start,
              end,
              origin: window.location.origin,
            },
            events: {
              onReady: (e: { target: YTPlayerInstance }) => {
                e.target.playVideo();
                setTimeout(() => {
                  try {
                    e.target.unMute();
                    e.target.setVolume(100);
                  } catch {
                    // ignore
                  }
                }, 150);
              },
              onStateChange: (e: { data: number }) => {
                if (window.YT && e.data === window.YT.PlayerState.ENDED && playerRef.current) {
                  try {
                    playerRef.current.seekTo(start);
                    playerRef.current.playVideo();
                  } catch {
                    // ignore
                  }
                }
              },
              onError: () => {
                onShowToast('Unable to play meme clip. Please try again later.', 'error');
                onClose();
              },
            },
          });
          requestAnimationFrame(fitMemePlayer);
        })
        .catch(() => {
          if (!cancelled) {
            onShowToast('Unable to load the meme player. Please try again later.', 'error');
            onClose();
          }
        });
    });

    return () => {
      cancelled = true;
      destroyPlayer();
    };
  }, [meme, destroyPlayer, fitMemePlayer, onClose, onShowToast]);

  const handleAreaTap = () => {
    if (playerRef.current) {
      try {
        playerRef.current.unMute();
        playerRef.current.setVolume(100);
      } catch {
        // ignore
      }
    }
  };

  return (
    <div id="memePlayerContainer" className={`${meme ? '' : 'hidden '}absolute inset-0 z-[130] bg-black`}>
      <div className="absolute inset-0 bg-black">
        <div id="memeVideoClip" ref={clipRef}>
          <div ref={playerMountRef} className="w-full h-full">
            <div id="memePlayerDiv"></div>
          </div>
        </div>

        <div
          onClick={handleAreaTap}
          style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'transparent', cursor: 'pointer' }}
        />

        <div className="absolute bottom-0 left-0 right-0 z-30 flex justify-center p-3 sm:p-4 pointer-events-none">
          <button
            type="button"
            onClick={() => {
              playSound('click');
              onClose();
            }}
            className="btn-pokedex pointer-events-auto flex items-center justify-center gap-2 py-3 px-6 text-sm sm:text-base"
          >
            <span className="material-symbols-rounded text-base sm:text-lg">arrow_back</span>
            BACK TO SCANNER
          </button>
        </div>
      </div>
    </div>
  );
};
