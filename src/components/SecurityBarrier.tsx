import React, { useEffect, useRef } from 'react';
import { pauseBgmForLockdown, resumeBgmAfterLockdown } from '../services/audio';

interface SecurityBarrierProps {
  screenRef: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}

export const SecurityBarrier: React.FC<SecurityBarrierProps> = ({ screenRef, disabled = false }) => {
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (disabled) return;

    const activateLockdown = () => {
      document.body.classList.add('security-blackout-active');
      const screen = screenRef.current;
      if (screen) {
        screen.classList.add('security-blackout-active');
        screen.style.pointerEvents = 'none';
      }
      pauseBgmForLockdown();
    };

    const releaseLockdown = () => {
      document.body.classList.remove('security-blackout-active');
      const screen = screenRef.current;
      if (screen) {
        if (document.hidden) return;
        screen.classList.remove('security-blackout-active');
        screen.style.pointerEvents = 'all';
      }
      resumeBgmAfterLockdown();
    };

    const scheduleRelease = (delay: number) => {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      releaseTimerRef.current = setTimeout(releaseLockdown, delay);
    };

    const onVisibilityChange = () => {
      if (document.hidden) activateLockdown();
      else scheduleRelease(300);
    };

    const onBlur = () => {
      setTimeout(() => {
        if (!document.hasFocus() || document.hidden) activateLockdown();
      }, 150);
    };

    const onFocus = () => {
      scheduleRelease(300);
    };

    const onPageHide = () => activateLockdown();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) scheduleRelease(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 5) {
        activateLockdown();
        scheduleRelease(2000);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const forbiddenMatch =
        e.key === 'PrintScreen' ||
        (e.ctrlKey && (e.key === 'p' || e.key === 's' || e.key === 'u')) ||
        (e.metaKey && e.shiftKey && (e.key === '4' || e.key === '3'));
      if (forbiddenMatch) {
        activateLockdown();
        scheduleRelease(2000);
      }
    };

    const preventDefault = (e: Event) => e.preventDefault();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('dragstart', preventDefault);

    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('dragstart', preventDefault);
      releaseLockdown();
    };
  }, [screenRef, disabled]);

  if (disabled) return null;

  return (
    <div id="extreme-security-barrier">
      <div className="security-lock-box">
        <span className="material-symbols-rounded">lock</span>
        <p className="lock-text">ENCRYPTION LOCK: SIGNAL LOST</p>
        <div className="lock-scanline"></div>
      </div>
    </div>
  );
};
