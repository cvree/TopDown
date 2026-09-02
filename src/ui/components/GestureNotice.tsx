import { audio } from '../../engine/audio';

/**
 * Opera — including GX — enables mouse gestures by default, and they are built
 * from the two inputs a MOBA uses most:
 *
 *   right-drag down        → open a new tab
 *   right-drag left/right  → back / forward
 *   right held + left click → back  ("rocker" gesture)
 *
 * Right-click is move and left-click is attack-move here, so playing normally
 * fires them constantly. The gestures are handled by browser chrome above the
 * page, which means no amount of `preventDefault` reaches them — the game can
 * only survive them (see the back guard in App and the unload guard in
 * GameView) and tell the player where the switch is.
 */
export const hasBrowserMouseGestures = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const data = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  if (data.userAgentData?.brands?.some((b) => /opera/i.test(b.brand))) return true;
  return /\bOPR\//.test(navigator.userAgent);
};

export function GestureNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="gesture-notice panel">
      <div className="gn-mark" aria-hidden>
        !
      </div>
      <div className="gn-body">
        <div className="gn-title">Turn off Opera’s mouse gestures before you play</div>
        <p>
          Right-drag opens a new tab and right-click&nbsp;+&nbsp;left-click goes back — the same two
          inputs this trainer uses to move and attack-move. Opera runs those above the page, so the
          game cannot block them; a run will survive one, but your hands will keep firing them.
        </p>
        <p className="gn-path">
          Opera menu → <b>Settings</b> → <b>Browser</b> → <b>Shortcuts</b> → uncheck{' '}
          <b>Enable mouse gestures</b>
          <span className="faint"> · or paste </span>
          <code>opera://settings/?search=gestures</code>
          <span className="faint"> into the address bar</span>
        </p>
      </div>
      <button
        className="btn ghost sm gn-dismiss"
        onClick={() => {
          audio.play('uiClick');
          onDismiss();
        }}
      >
        Got it
      </button>
    </div>
  );
}
