import React, { useEffect, useState } from 'react';

interface LoaderSplashProps {
  booted: boolean;
}

export const LoaderSplash: React.FC<LoaderSplashProps> = ({ booted }) => {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!booted) return;
    const minWait = setTimeout(() => {
      setExiting(true);
    }, 1500);
    return () => clearTimeout(minWait);
  }, [booted]);

  useEffect(() => {
    if (!exiting) return;
    const removeTimer = setTimeout(() => {
      setVisible(false);
    }, 450);
    return () => clearTimeout(removeTimer);
  }, [exiting]);

  if (!visible) return null;

  return (
    <div
      id="appLoader"
      className={`loader-surface${exiting ? ' is-done' : ''}`}
      role="status"
      aria-label="Loading Pykachu Go"
    >
      <div className="loader-stage is-ready">
        <div className="partner-row">
          <span className="mark mark--csi">
            <img id="markCsi" src="/assets/img/csi.jpg" alt="CSI" width={225} height={225} />
          </span>

          <span className="cross" aria-hidden="true">
            &times;
          </span>

          <span className="mark mark--auron">
            <img id="markAuron" src="/assets/img/auron.png" alt="Auron" width={699} height={727} />
          </span>
        </div>

        <p className="presents">presents</p>

        <img
          className="main-logo"
          id="mainLogo"
          src="/assets/img/logo1.png"
          alt="Pykachu Go"
          width={558}
          height={285}
        />

        <div
          className="progress"
          role="progressbar"
          aria-label="Loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={exiting ? 100 : 50}
        >
          <span className="progress-fill"></span>
        </div>
      </div>
    </div>
  );
};
