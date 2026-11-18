interface KeyboardLock {
  lock(codes: string[]): Promise<void>;
  unlock(): void;
}

export function createTabProtection() {
  const keyboard = (navigator as Navigator & { keyboard?: Partial<KeyboardLock> }).keyboard;
  let guarding = false;
  let capturing = false;
  let locked = false;
  let disposed = false;
  let request = 0;

  function confirmLeave(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = true;
  }

  function updateConfirmation(active: boolean) {
    if (guarding === active) return;
    guarding = active;
    if (active) window.addEventListener('beforeunload', confirmLeave);
    else window.removeEventListener('beforeunload', confirmLeave);
  }

  function captureShortcut(event: KeyboardEvent) {
    if (capturing && document.fullscreenElement && event.code === 'KeyW' && event.ctrlKey)
      event.preventDefault();
  }
  window.addEventListener('keydown', captureShortcut, true);

  function sync(inMatch: boolean, playing: boolean) {
    if (disposed) return;
    const wanted = playing && document.fullscreenElement === document.documentElement;
    if (wanted !== capturing) {
      capturing = wanted;
      const current = ++request;
      if (wanted && keyboard?.lock) {
        void keyboard.lock(['KeyW']).then(
          () => {
            if (current !== request) return;
            locked = true;
            updateConfirmation(false);
          },
          () => {
            // Keep the native leave confirmation when capture is declined or unavailable.
          },
        );
      } else if (!wanted) {
        keyboard?.unlock?.();
        locked = false;
      }
    }
    updateConfirmation(inMatch && !locked);
  }

  function toggleFullscreen() {
    const pending = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.();
    void pending?.catch(() => {
      // The browser controls availability and permissions for fullscreen.
    });
  }

  function dispose() {
    sync(false, false);
    disposed = true;
    window.removeEventListener('keydown', captureShortcut, true);
  }

  return { dispose, sync, toggleFullscreen };
}
