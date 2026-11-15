import React, { useEffect, useState } from 'react';
import { playSound } from '../services/audio';

const IN_APP_BROWSERS = [
  { test: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i, name: 'Facebook' },
  { test: /Instagram/i, name: 'Instagram' },
  { test: /Messenger/i, name: 'Messenger' },
  { test: /Line\//i, name: 'LINE' },
  { test: /WhatsApp/i, name: 'WhatsApp' },
  { test: /Twitter|TwitterAndroid/i, name: 'X (Twitter)' },
  { test: /LinkedInApp/i, name: 'LinkedIn' },
  { test: /Snapchat/i, name: 'Snapchat' },
  { test: /Pinterest/i, name: 'Pinterest' },
  { test: /musical_ly|BytedanceWebview|TikTok/i, name: 'TikTok' },
  { test: /MicroMessenger/i, name: 'WeChat' },
  { test: /GSA\//i, name: 'Google App' },
  { test: /KAKAOTALK/i, name: 'KakaoTalk' },
  { test: /Telegram/i, name: 'Telegram' },
  { test: /NAVER/i, name: 'Naver' },
  { test: /WebView/i, name: 'an in-app browser' },
];

export function detectInAppBrowser(): string | null {
  const ua = navigator.userAgent || '';
  for (const browser of IN_APP_BROWSERS) {
    if (browser.test.test(ua)) return browser.name;
  }
  if (/wv\)/.test(ua) && /Android/i.test(ua)) return 'an in-app browser';
  return null;
}

function isIOSDevice(): boolean {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
}

interface CameraGuideOverlayProps {
  visible: boolean;
  reason: 'inapp' | 'permission';
  onClose: () => void;
  onShowToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export const CameraGuideOverlay: React.FC<CameraGuideOverlayProps> = ({
  visible,
  reason,
  onClose,
  onShowToast,
}) => {
  const [platformTab, setPlatformTab] = useState<'android' | 'ios'>(() =>
    isIOSDevice() ? 'ios' : 'android'
  );
  const [copiedLabel, setCopiedLabel] = useState(false);

  const inAppName = detectInAppBrowser();
  const useInApp = !!inAppName || reason === 'inapp';
  const resolvedInAppName = inAppName || 'an in-app browser';
  const ios = isIOSDevice();

  useEffect(() => {
    if (!visible) return;
    setPlatformTab(isIOSDevice() ? 'ios' : 'android');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const handleCopyUrl = async () => {
    const url = window.location.href.split('#')[0];
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        field.setSelectionRange(0, field.value.length);
        copied = document.execCommand('copy');
        field.remove();
      } catch {
        copied = false;
      }
    }

    if (copied) {
      setCopiedLabel(true);
      setTimeout(() => setCopiedLabel(false), 2000);
      onShowToast('Game link copied', 'success');
    } else {
      onShowToast('Copy failed — copy the address bar link manually', 'error');
    }
  };

  return (
    <div
      id="cameraGuideOverlay"
      className={visible ? '' : 'hidden'}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cameraGuideTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playSound('click');
          onClose();
        }
      }}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
        <symbol id="i-camera-off" viewBox="0 -960 960 960">
          <path d="M880-680v400q0 20-12.5 30T840-240q-15 0-27.5-10.5T800-281v-399H673q-17 0-32.5-6.5T614-706l-49-54H395l-10 11q-11 13-28.5 13T327-748q-11-11-11.5-27t10.5-28l10-11q11-12 26.5-19t32.5-7h170q17 0 32.5 7t26.5 19l50 54h126q33 0 56.5 23.5T880-680ZM160-120q-33 0-56.5-23.5T80-200v-480q0-33 23.5-56.5T160-760h41l80 80H160v480h601l80 80H160Zm466-215q-25 34-62.5 54.5T480-260q-75 0-127.5-52.5T300-440q0-46 20.5-83.5T375-586l58 58q-24 13-38.5 36T380-440q0 42 29 71t71 29q29 0 52-14.5t36-38.5l58 58Zm-18-233q25 24 38.5 57t13.5 71v12q0 6-1 12L456-619q6-1 12-1h12q38 0 71 13.5t57 38.5ZM791-57 55-792q-12-12-12-28.5T55-849q12-12 28.5-12t28.5 12l736 736q12 12 12 28t-12 28q-12 12-28.5 12T791-57ZM407-440Zm171-57Z" />
        </symbol>
        <symbol id="i-videocam-off" viewBox="0 -960 960 960">
          <path d="m720-540 126-126q10-10 22-5t12 19v344q0 14-12 19t-22-5L720-420q0 17-11.5 28.5T680-380q-17 0-28.5-11.5T640-420v-300H360q-20 0-30-12.5T320-760q0-15 10-27.5t30-12.5h280q33 0 56.5 23.5T720-720v180Zm74 486L54-794q-11-11-11-28t11-28q11-11 28-11t28 11l740 740q11 11 11 28t-11 28q-11 11-28 11t-28-11ZM498-575ZM382-464ZM160-800l80 80h-80v480h480v-80l80 80q0 33-23.5 56.5T640-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Z" />
        </symbol>
        <symbol id="i-more-horiz" viewBox="0 -960 960 960">
          <path d="M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z" />
        </symbol>
        <symbol id="i-open-in-new" viewBox="0 -960 960 960">
          <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h240q17 0 28.5 11.5T480-800q0 17-11.5 28.5T440-760H200v560h560v-240q0-17 11.5-28.5T800-480q17 0 28.5 11.5T840-440v240q0 33-23.5 56.5T760-120H200Zm560-584L416-360q-11 11-28 11t-28-11q-11-11-11-28t11-28l344-344H600q-17 0-28.5-11.5T560-800q0-17 11.5-28.5T600-840h200q17 0 28.5 11.5T840-800v200q0 17-11.5 28.5T800-560q-17 0-28.5-11.5T760-600v-104Z" />
        </symbol>
        <symbol id="i-paste" viewBox="0 -960 960 960">
          <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h167q11-35 43-57.5t70-22.5q40 0 71.5 22.5T594-840h166q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560h-80v80q0 17-11.5 28.5T640-640H320q-17 0-28.5-11.5T280-680v-80h-80v560Zm308.5-571.5Q520-783 520-800t-11.5-28.5Q497-840 480-840t-28.5 11.5Q440-817 440-800t11.5 28.5Q463-760 480-760t28.5-11.5Z" />
        </symbol>
        <symbol id="i-copy" viewBox="0 -960 960 960">
          <path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-520q0-17 11.5-28.5T160-720q17 0 28.5 11.5T200-680v520h400q17 0 28.5 11.5T640-120q0 17-11.5 28.5T600-80H200Zm160-240v-480 480Z" />
        </symbol>
        <symbol id="i-check" viewBox="0 -960 960 960">
          <path d="m424-408-86-86q-11-11-28-11t-28 11q-11 11-11 28t11 28l114 114q12 12 28 12t28-12l226-226q11-11 11-28t-11-28q-11-11-28-11t-28 11L424-408Zm56 328q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
        </symbol>
        <symbol id="i-close" viewBox="0 -960 960 960">
          <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z" />
        </symbol>
        <symbol id="i-android" viewBox="0 -960 960 960">
          <path d="M40-240q10-105 64-191t139-140l-77-129q-9-14-4.5-30t18.5-24q14-9 30-5t24 18l80 133q38-16 79.5-24t86.5-8q45 0 86.5 8t79.5 24l80-133q8-14 24-18t30 5q14 8 18 24t-4 30l-77 129q85 54 139 140t64 191H40Zm680.5-151.5Q722-409 711-426t-27-22q-16-5-29 4t-15 26q-2 17 9 34t27.5 22.5Q693-356 706-365t14.5-26.5ZM284-362q16-5 27-22t9.5-34.5Q319-436 306-445t-29.5-3.5Q260-443 249-426t-9 34q2 17 15 26t29 4Z" />
        </symbol>
        <symbol id="i-iphone" viewBox="0 -960 960 960">
          <path d="M280-40q-33 0-56.5-23.5T200-120v-720q0-33 23.5-56.5T280-920h400q33 0 56.5 23.5T760-840v124q18 7 29 22t11 34v80q0 19-11 34t-29 22v404q0 33-23.5 56.5T680-40H280Zm0-80h400v-720H280v720Zm0 0v-720 720Zm120-40h160q17 0 28.5-11.5T600-200q0-17-11.5-28.5T560-240H400q-17 0-28.5 11.5T360-200q0 17 11.5 28.5T400-160Z" />
        </symbol>
        <symbol id="i-lock" viewBox="0 -960 960 960">
          <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z" />
        </symbol>
        <symbol id="i-settings" viewBox="0 -960 960 960">
          <path d="M433-80q-27 0-46.5-18T363-142l-9-66q-13-5-24.5-12T307-235l-62 26q-25 11-50 2t-39-32l-47-82q-14-23-8-49t27-43l53-40q-1-7-1-13.5v-27q0-6.5 1-13.5l-53-40q-21-17-27-43t8-49l47-82q14-23 39-32t50 2l62 26q11-8 23-15t24-12l9-66q4-26 23.5-44t46.5-18h94q27 0 46.5 18t23.5 44l9 66q13 5 24.5 12t22.5 15l62-26q25-11 50-2t39 32l47 82q14 23 8 49t-27 43l-53 40q1 7 1 13.5v27q0 6.5-2 13.5l53 40q21 17 27 43t-8 49l-48 82q-14 23-39 32t-50-2l-60-26q-11 8-23 15t-24 12l-9 66q-4 26-23.5 44T527-80h-94Zm7-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z" />
        </symbol>
        <symbol id="i-videocam" viewBox="0 -960 960 960">
          <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h480q33 0 56.5 23.5T720-720v180l126-126q10-10 22-5t12 19v344q0 14-12 19t-22-5L720-420v180q0 33-23.5 56.5T640-160H160Zm0-80h480v-480H160v480Zm0 0v-480 480Z" />
        </symbol>
        <symbol id="i-refresh" viewBox="0 -960 960 960">
          <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-70q0-17 11.5-28.5T760-800q17 0 28.5 11.5T800-760v200q0 17-11.5 28.5T760-520H560q-17 0-28.5-11.5T520-560q0-17 11.5-28.5T560-600h128q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q68 0 124.5-34.5T692-367q8-14 22.5-19.5t29.5-.5q16 5 23 21t-1 30q-41 80-117 128t-169 48Z" />
        </symbol>
        <symbol id="i-text-fields" viewBox="0 -960 960 960">
          <path d="M297.5-177.5Q280-195 280-220v-460H140q-25 0-42.5-17.5T80-740q0-25 17.5-42.5T140-800h400q25 0 42.5 17.5T600-740q0 25-17.5 42.5T540-680H400v460q0 25-17.5 42.5T340-160q-25 0-42.5-17.5Zm360 0Q640-195 640-220v-260h-60q-25 0-42.5-17.5T520-540q0-25 17.5-42.5T580-600h240q25 0 42.5 17.5T880-540q0 25-17.5 42.5T820-480h-60v260q0 25-17.5 42.5T700-160q-25 0-42.5-17.5Z" />
        </symbol>
        <symbol id="i-shield" viewBox="0 -960 960 960">
          <path d="M467-85q-6-1-12-3-135-45-215-166.5T160-516v-189q0-25 14.5-45t37.5-29l240-90q14-5 28-5t28 5l240 90q23 9 37.5 29t14.5 45v189q0 140-80 261.5T505-88q-6 2-12 3t-13 1q-7 0-13-1Zm13-79q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z" />
        </symbol>
      </svg>

      <div id="cameraGuideCard" className={`cg-card${useInApp ? '' : ' is-permission'}`}>
        <button
          type="button"
          className="cg-close"
          onClick={() => {
            playSound('click');
            onClose();
          }}
          aria-label="Close"
        >
          <svg className="icon">
            <use href="#i-close"></use>
          </svg>
        </button>

        <div className="cg-brand-row">
          <div className="cg-brand">
            <img src="/assets/img/pokeball.svg" alt="" />
            Pykachu Go
          </div>
          <span className="cg-brand-tag">Camera Support</span>
        </div>

        <section id="cameraGuideInappPanel" className={`cg-panel${useInApp ? '' : ' hidden'}`}>
          <div className="cg-hero">
            <div className="cg-hero-badge">
              <svg className="icon">
                <use href="#i-camera-off"></use>
              </svg>
            </div>
            <h2 id="cameraGuideTitle" className="cg-hero-title">
              Camera blocked by <span id="cameraGuideInappName">{resolvedInAppName}</span>
            </h2>
            <p className="cg-hero-sub">
              <span id="cameraGuideInappNameText">{resolvedInAppName}</span>&apos;s built-in browser can&apos;t use the
              camera. Open the game in <b>Chrome</b> or <b>Safari</b> to scan QR signals.
            </p>
            <div className="cg-status-chip">
              <span className="dot"></span>
              <span id="cameraGuideInappStatus">{resolvedInAppName} detected</span>
            </div>
          </div>

          <div className="cg-steps">
            <div className="cg-step">
              <span className="cg-step-num">1</span>
              <div className="cg-step-body">
                <p>
                  Tap the <b id="cameraGuideMenuHint">{ios ? '••• (3 dots)' : '⋮ (3 dots)'}</b> menu in the corner.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-more-horiz"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">2</span>
              <div className="cg-step-body">
                <p>
                  Choose <b id="cameraGuideOpenHint">{ios ? 'Open in Safari' : 'Open in Chrome'}</b> to launch a real
                  browser.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-open-in-new"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">3</span>
              <div className="cg-step-body">
                <p>Paste the game link if it doesn&apos;t open automatically.</p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-paste"></use>
              </svg>
            </div>
          </div>

          <div className="cg-actions">
            <button type="button" id="cameraGuideCopyBtn" onClick={handleCopyUrl} className="cg-btn cg-btn-primary">
              <svg className="icon">
                <use href={copiedLabel ? '#i-check' : '#i-copy'}></use>
              </svg>
              {copiedLabel ? ' Link copied' : ' Copy game link'}
            </button>
            <button
              type="button"
              onClick={() => {
                playSound('click');
                onClose();
              }}
              className="cg-btn cg-btn-ghost"
            >
              <svg className="icon">
                <use href="#i-close"></use>
              </svg>
              Close
            </button>
          </div>
        </section>

        <section id="cameraGuidePermissionPanel" className={`cg-panel${useInApp ? ' hidden' : ''}`}>
          <div className="cg-hero">
            <div className="cg-hero-badge">
              <svg className="icon">
                <use href="#i-videocam-off"></use>
              </svg>
            </div>
            <h2 className="cg-hero-title">Camera access blocked</h2>
            <p className="cg-hero-sub">
              Permission was denied by your browser. Follow these quick steps to allow the camera, then reload.
            </p>
            <div className="cg-status-chip">
              <span className="dot"></span>
              <span>Permission required</span>
            </div>
          </div>

          <div className="cg-tabs" role="tablist" aria-label="Choose your device">
            <button
              type="button"
              id="cameraGuideTabAndroid"
              role="tab"
              onClick={() => setPlatformTab('android')}
              className={`cg-tab${platformTab === 'android' ? ' is-active' : ''}`}
            >
              <svg className="icon">
                <use href="#i-android"></use>
              </svg>
              Android
            </button>
            <button
              type="button"
              id="cameraGuideTabIOS"
              role="tab"
              onClick={() => setPlatformTab('ios')}
              className={`cg-tab${platformTab === 'ios' ? ' is-active' : ''}`}
            >
              <svg className="icon">
                <use href="#i-iphone"></use>
              </svg>
              iPhone
            </button>
          </div>

          <div id="cameraGuideContentAndroid" className={`cg-steps${platformTab === 'android' ? '' : ' hidden'}`}>
            <div className="cg-step">
              <span className="cg-step-num">1</span>
              <div className="cg-step-body">
                <p>
                  Tap the <b>Lock</b> or <b>tune</b> icon beside the address bar.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-lock"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">2</span>
              <div className="cg-step-body">
                <p>
                  Tap <b>Permissions</b> (or <b>Site settings</b>).
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-settings"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">3</span>
              <div className="cg-step-body">
                <p>
                  Set <b>Camera</b> to <b>Allow</b>.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-videocam"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">4</span>
              <div className="cg-step-body">
                <p>
                  Tap <b>Reload</b> below and scan again.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-refresh"></use>
              </svg>
            </div>
          </div>

          <div id="cameraGuideContentIOS" className={`cg-steps${platformTab === 'ios' ? '' : ' hidden'}`}>
            <div className="cg-step">
              <span className="cg-step-num">1</span>
              <div className="cg-step-body">
                <p>
                  Tap the <b>aA</b> button on the left of Safari&apos;s address bar.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-text-fields"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">2</span>
              <div className="cg-step-body">
                <p>
                  Open <b>Website Settings</b>.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-settings"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">3</span>
              <div className="cg-step-body">
                <p>
                  Set <b>Camera</b> to <b>Allow</b>.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-videocam"></use>
              </svg>
            </div>
            <div className="cg-step">
              <span className="cg-step-num">4</span>
              <div className="cg-step-body">
                <p>
                  Tap <b>Reload</b> below and scan again.
                </p>
              </div>
              <svg className="icon cg-step-icon">
                <use href="#i-refresh"></use>
              </svg>
            </div>
          </div>

          <div className="cg-actions">
            <button type="button" onClick={() => window.location.reload()} className="cg-btn cg-btn-primary">
              <svg className="icon">
                <use href="#i-refresh"></use>
              </svg>
              Reload page
            </button>
            <button
              type="button"
              onClick={() => {
                playSound('click');
                onClose();
              }}
              className="cg-btn cg-btn-ghost"
            >
              <svg className="icon">
                <use href="#i-close"></use>
              </svg>
              Close
            </button>
          </div>
        </section>

        <div className="cg-hint">
          <svg className="icon">
            <use href="#i-shield"></use>
          </svg>
          Camera is only used to scan QR signals — never recorded.
        </div>
      </div>
    </div>
  );
};
