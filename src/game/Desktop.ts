// The desktop build (Electron, electron/main.cjs) can close itself; a browser tab can't, so QUIT GAME only shows there.

/** Running as the desktop app. */
export function isDesktop(): boolean {
  return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
}

/** Close the game (the desktop app quits when its window closes). */
export function quitGame() {
  window.close();
}
