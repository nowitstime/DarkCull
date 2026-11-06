/**
 * InputController: Unified Keyboard & Touch Gesture System
 *
 * Desktop Shortcuts:
 * - Right Arrow / D / J: Next photo
 * - Left Arrow / A / K: Previous photo
 * - 3, 4, 5 (and Numpad 3-5): Set star rating (with optional auto-advance)
 * - 0 (and Numpad 0): Clear rating / Unrated (0)
 * - X / Backspace / Delete: Reject (-1)
 * - Space / Z: Toggle 100% 1:1 focus check zoom
 * - F: Toggle Fullscreen
 *
 * Mobile Touch Ergonomics (Tinder-style 4-way Rating Swipes + Double Tap Zoom):
 * - Drag / Swipe Up: Rate ★5
 * - Drag / Swipe Right: Rate ★4
 * - Drag / Swipe Left: Rate ★3
 * - Drag / Swipe Down: Reject (✕ / -1)
 * - Double Tap: Toggle 100% 1:1 zoom at tap coordinates
 */

export class InputController {
  constructor(handlers = {}) {
    this.onNext = handlers.onNext || (() => {});
    this.onPrev = handlers.onPrev || (() => {});
    this.onRate = handlers.onRate || (() => {}); // (rating) => {}
    this.onToggleZoom = handlers.onToggleZoom || (() => {}); // (x, y) => {}
    this.onToggleFullscreen = handlers.onToggleFullscreen || (() => {});
    this.isZoomedFn = handlers.isZoomedFn || (() => false);

    this.touchContainer = handlers.touchContainer || null;
    this.imgElement = handlers.imgElement || null;
    this.swipeBadge = handlers.swipeBadge || null;

    // Gesture tracking state
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.isSwiping = false;
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

      // 3. Ratings 3-5 (or 1-5 on keyboard)
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

  _getSwipeIntent(deltaX, deltaY) {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const dist = Math.hypot(deltaX, deltaY);

    if (dist < 30) return null;

    if (absX > absY) {
      // Horizontal dominant
      if (deltaX > 0) {
        return { rating: 4, label: '★ 4', cls: 'swipe-rate-4', dir: 'right' };
      } else {
        return { rating: 3, label: '★ 3', cls: 'swipe-rate-3', dir: 'left' };
      }
    } else {
      // Vertical dominant
      if (deltaY < 0) {
        return { rating: 5, label: '★ 5', cls: 'swipe-rate-5', dir: 'up' };
      } else {
        return { rating: -1, label: '✕ REJECT', cls: 'swipe-reject', dir: 'down' };
      }
    }
  }

  _resetCardTransform() {
    if (this.imgElement && !this.isZoomedFn()) {
      this.imgElement.style.transition = 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.18s ease';
      this.imgElement.style.transform = 'none';
      this.imgElement.style.opacity = '1';
    }
    if (this.swipeBadge) {
      this.swipeBadge.className = 'swipe-badge';
      this.swipeBadge.style.opacity = '0';
    }
  }

  _setupTouchGestures() {
    if (!this.touchContainer) return;

    this.touchContainer.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) {
          this.isSwiping = false;
          this._resetCardTransform();
          return;
        }

        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;

        if (this.imgElement && !this.isZoomedFn()) {
          this.imgElement.style.transition = 'none';
        }
      },
      { passive: true }
    );

    this.touchContainer.addEventListener(
      'touchmove',
      (e) => {
        // When zoomed in, ViewportEngine handles 1:1 panning; do not swipe-rate
        if (this.isZoomedFn() || e.touches.length !== 1) return;
        if (!this.imgElement || this.imgElement.style.display === 'none') return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        const dist = Math.hypot(deltaX, deltaY);

        if (dist > 12) {
          this.isSwiping = true;
          if (e.cancelable) e.preventDefault();

          // Apply Tinder-style card drag & slight tilt
          const rotateDeg = Math.max(-14, Math.min(14, deltaX * 0.05));
          this.imgElement.style.transform = `translate3d(${deltaX * 0.75}px, ${deltaY * 0.75}px, 0) rotate(${rotateDeg}deg)`;

          const intent = this._getSwipeIntent(deltaX, deltaY);
          if (this.swipeBadge) {
            if (intent) {
              const progress = Math.min(1, (dist - 30) / 65);
              this.swipeBadge.textContent = intent.label;
              this.swipeBadge.className = `swipe-badge visible ${intent.cls}`;
              this.swipeBadge.style.opacity = `${Math.max(0.25, progress)}`;
              this.swipeBadge.style.transform = `translate(-50%, -50%) scale(${0.85 + 0.25 * progress})`;
            } else {
              this.swipeBadge.className = 'swipe-badge';
              this.swipeBadge.style.opacity = '0';
            }
          }
        }
      },
      { passive: false }
    );

    this.touchContainer.addEventListener(
      'touchend',
      (e) => {
        if (e.changedTouches.length !== 1) return;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        const dist = Math.hypot(deltaX, deltaY);
        const now = Date.now();

        // 1. Check if it was a tap (minimal finger movement) -> check for Double-Tap Zoom
        if (!this.isSwiping && dist < 20) {
          const timeSinceLastTap = now - this.lastTapTime;
          const distFromLastTap = Math.hypot(
            touch.clientX - this.lastTapX,
            touch.clientY - this.lastTapY
          );

          if (timeSinceLastTap > 0 && timeSinceLastTap < 350 && distFromLastTap < 45) {
            if (e.cancelable) e.preventDefault();
            this.lastTapTime = 0;
            this.onToggleZoom(touch.clientX, touch.clientY);
            return;
          }

          this.lastTapTime = now;
          this.lastTapX = touch.clientX;
          this.lastTapY = touch.clientY;
          this._resetCardTransform();
          return;
        }

        // 2. If zoomed in, don't trigger swipe ratings
        if (this.isZoomedFn()) {
          this.isSwiping = false;
          return;
        }

        // 3. Evaluate Tinder-style 4-way swipe threshold (75px)
        const COMMIT_THRESHOLD = 75;
        const intent = this._getSwipeIntent(deltaX, deltaY);

        if (intent && dist >= COMMIT_THRESHOLD && this.imgElement) {
          // Fly out animation in the swipe direction before committing rating
          const flyX = intent.dir === 'right' ? 320 : intent.dir === 'left' ? -320 : deltaX;
          const flyY = intent.dir === 'down' ? 320 : intent.dir === 'up' ? -320 : deltaY;

          this.imgElement.style.transition = 'transform 0.14s ease-in, opacity 0.14s ease-in';
          this.imgElement.style.transform = `translate3d(${flyX}px, ${flyY}px, 0) scale(0.92)`;
          this.imgElement.style.opacity = '0.2';

          setTimeout(() => {
            this._resetCardTransform();
            this.onRate(intent.rating);
          }, 120);
        } else {
          // Snap back to center
          this._resetCardTransform();
        }

        this.isSwiping = false;
      },
      { passive: false }
    );

    this.touchContainer.addEventListener('touchcancel', () => {
      this.isSwiping = false;
      this._resetCardTransform();
    });
  }
}
