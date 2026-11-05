/**
 * InputController: Unified Keyboard & Touch Gesture System
 *
 * Desktop Shortcuts:
 * - Right Arrow / D / J: Next photo
 * - Left Arrow / A / K: Previous photo
 * - 1, 2, 3, 4, 5 (and Numpad 1-5): Set star rating (with optional auto-advance)
 * - 0 (and Numpad 0): Clear rating (0)
 * - X / Backspace / Delete: Reject (-1)
 * - Space / Z: Toggle 100% 1:1 focus check zoom
 * - F: Toggle Fullscreen
 *
 * Mobile Touch Ergonomics:
 * - Swipe Left: Next photo
 * - Swipe Right: Previous photo
 * - Double Tap: Toggle 100% zoom at tap coordinates
 */

export class InputController {
  constructor(handlers = {}) {
    this.onNext = handlers.onNext || (() => {});
    this.onPrev = handlers.onPrev || (() => {});
    this.onRate = handlers.onRate || (() => {}); // (rating) => {}
    this.onToggleZoom = handlers.onToggleZoom || (() => {}); // (x, y) => {}
    this.onToggleFullscreen = handlers.onToggleFullscreen || (() => {});

    this.touchContainer = handlers.touchContainer || null;

    // Gesture tracking state
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.lastTapTime = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;

    this._setupKeyboardListener();
    this._setupTouchGestures();
  }

  _setupKeyboardListener() {
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input, textarea, or contentEditable
      const target = e.target;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = e.key;
      const code = e.code;

      // 1. Navigation: Next (Right Arrow, D, J)
      if (key === 'ArrowRight' || key === 'd' || key === 'D' || key === 'j' || key === 'J') {
        e.preventDefault();
        this.onNext();
        return;
      }

      // 2. Navigation: Prev (Left Arrow, A, K)
      if (key === 'ArrowLeft' || key === 'a' || key === 'A' || key === 'k' || key === 'K') {
        e.preventDefault();
        this.onPrev();
        return;
      }

      // 3. Ratings 1-5
      if (
        ['1', '2', '3', '4', '5'].includes(key) ||
        ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5'].includes(code)
      ) {
        e.preventDefault();
        const rating = parseInt(key, 10) || parseInt(code.replace('Numpad', ''), 10);
        this.onRate(rating);
        return;
      }

      // 4. Rating 0 (Clear)
      if (key === '0' || code === 'Numpad0') {
        e.preventDefault();
        this.onRate(0);
        return;
      }

      // 5. Reject (-1): X, Backspace, Delete
      if (
        key === 'x' ||
        key === 'X' ||
        key === 'Backspace' ||
        key === 'Delete'
      ) {
        e.preventDefault();
        this.onRate(-1);
        return;
      }

      // 6. Zoom: Space or Z
      if (key === ' ' || key === 'z' || key === 'Z') {
        e.preventDefault();
        this.onToggleZoom(null, null);
        return;
      }

      // 7. Fullscreen: F
      if (key === 'f' || key === 'F') {
        e.preventDefault();
        this.onToggleFullscreen();
        return;
      }
    });
  }

  _setupTouchGestures() {
    if (!this.touchContainer) return;

    this.touchContainer.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          this.touchStartTime = Date.now();
        }
      },
      { passive: true }
    );

    this.touchContainer.addEventListener(
      'touchend',
      (e) => {
        if (e.changedTouches.length === 1) {
          const touch = e.changedTouches[0];
          const deltaX = touch.clientX - this.touchStartX;
          const deltaY = touch.clientY - this.touchStartY;
          const deltaTime = Date.now() - this.touchStartTime;

          // Double tap detection (< 300ms between taps within 25px radius)
          const now = Date.now();
          const distFromLastTap = Math.hypot(touch.clientX - this.lastTapX, touch.clientY - this.lastTapY);

          if (now - this.lastTapTime < 300 && distFromLastTap < 30) {
            this.lastTapTime = 0;
            this.onToggleZoom(touch.clientX, touch.clientY);
            return;
          }

          this.lastTapTime = now;
          this.lastTapX = touch.clientX;
          this.lastTapY = touch.clientY;

          // Swipe detection: Min distance 50px, horizontal dominant, fast gesture (< 400ms)
          if (deltaTime < 400 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            if (deltaX < 0) {
              // Swipe Left -> Next
              this.onNext();
            } else {
              // Swipe Right -> Prev
              this.onPrev();
            }
          }
        }
      },
      { passive: true }
    );
  }
}
