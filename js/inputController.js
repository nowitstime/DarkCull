/**
 * InputController: Unified Keyboard & Touch Gesture System
 *
 * Desktop Shortcuts:
 * - Right Arrow / D / J: Next photo
 * - Left Arrow / A / K: Previous photo
 * - 3, 4, 5 (and Numpad 3-5): Set star rating (with optional auto-advance)
 * - 0 (and Numpad 0): Clear rating / Unrated (0)
 * - X / Backspace / Delete: Reject (-1)
 * - U / Ctrl+Z / Cmd+Z: Undo previous action
 * - Space / Z: Toggle 100% 1:1 focus check zoom
 * - F: Toggle Fullscreen
 *
 * Mobile Touch Ergonomics:
 * - 4-Way Rating Mode:
 *   - Swipe Up: Rate ★5
 *   - Swipe Right: Rate ★4
 *   - Swipe Left: Rate ★3
 *   - Swipe Down: Reject (✕ / -1)
 * - Reject / Skip Mode:
 *   - Swipe Right / Up: Skip / Keep (➔)
 *   - Swipe Left / Down: Reject (✕ / -1)
 * - Hold Picture (Long-Press ~450ms): Undo previous rating/skip
 * - Double Tap: Toggle 100% 1:1 zoom at tap coordinates
 */

export class InputController {
  constructor(handlers = {}) {
    this.onNext = handlers.onNext || (() => {});
    this.onPrev = handlers.onPrev || (() => {});
    this.onRate = handlers.onRate || (() => {}); // (rating) => {}
    this.onSkip = handlers.onSkip || (() => {}); // () => {}
    this.onUndo = handlers.onUndo || (() => {}); // () => {}
    this.onToggleZoom = handlers.onToggleZoom || (() => {}); // (x, y) => {}
    this.onToggleFullscreen = handlers.onToggleFullscreen || (() => {});
    this.isZoomedFn = handlers.isZoomedFn || (() => false);
    this.getGestureMapFn =
      handlers.getGestureMapFn ||
      (() => ({
        up: 'rate_5',
        down: 'reject',
        left: 'rate_3',
        right: 'rate_4',
        longPress: 'undo',
      }));

    this.touchContainer = handlers.touchContainer || null;
    this.imgElement = handlers.imgElement || null;
    this.swipeBadge = handlers.swipeBadge || null;

    // Gesture tracking state
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchStartTime = 0;
    this.isSwiping = false;
    this.multiTouchActive = false;
    this.longPressTriggered = false;
    this._longPressTimer = null;
    this._badgeHideTimer = null;
    this._commitTimer = null;
    this._pendingCommit = null;
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

      // 0. Undo: Ctrl+Z / Cmd+Z or U
      if (
        ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'Z')) ||
        key === 'u' ||
        key === 'U'
      ) {
        e.preventDefault();
        this.onUndo();
        return;
      }

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

      // 3. Ratings 1-5 (and Numpad 1-5)
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

  _resolveGestureAction(actionKey, dir = null) {
    switch (actionKey) {
      case 'skip':
        return { action: 'skip', label: '➔ SKIP', cls: 'swipe-skip', dir };
      case 'back':
        return { action: 'back', label: '⬅ BACK', cls: 'swipe-back', dir };
      case 'undo':
        return { action: 'undo', label: '↺ UNDO', cls: 'swipe-undo', dir };
      case 'reject':
        return { action: 'rate', rating: -1, label: '✕ REJECT', cls: 'swipe-reject', dir };
      case 'rate_0':
        return { action: 'rate', rating: 0, label: '★ 0 CLEAR', cls: 'swipe-rate-0', dir };
      case 'rate_1':
        return { action: 'rate', rating: 1, label: '★ 1 STAR', cls: 'swipe-rate-1', dir };
      case 'rate_2':
        return { action: 'rate', rating: 2, label: '★ 2 STARS', cls: 'swipe-rate-2', dir };
      case 'rate_3':
        return { action: 'rate', rating: 3, label: '★ 3 STARS', cls: 'swipe-rate-3', dir };
      case 'rate_4':
        return { action: 'rate', rating: 4, label: '★ 4 STARS', cls: 'swipe-rate-4', dir };
      case 'rate_5':
        return { action: 'rate', rating: 5, label: '★ 5 STARS', cls: 'swipe-rate-5', dir };
      default:
        return null;
    }
  }

  _executeGestureIntent(intent) {
    if (!intent) return;
    if (intent.action === 'skip') {
      this.onSkip();
    } else if (intent.action === 'back') {
      this.onPrev();
    } else if (intent.action === 'undo') {
      this.onUndo();
    } else if (intent.action === 'rate') {
      this.onRate(intent.rating);
    }
  }

  _getSwipeIntent(deltaX, deltaY, minDist = 24) {
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const dist = Math.hypot(deltaX, deltaY);

    if (dist < minDist) return null;

    let dir;
    if (absX > absY) {
      dir = deltaX > 0 ? 'right' : 'left';
    } else {
      dir = deltaY < 0 ? 'up' : 'down';
    }

    const map = this.getGestureMapFn() || {};
    return this._resolveGestureAction(map[dir], dir);
  }

  _clearLongPressTimer() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  _flushPendingCommit() {
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
    if (this._pendingCommit) {
      const fn = this._pendingCommit;
      this._pendingCommit = null;
      fn();
    }
  }

  _showCommittedBadge(intent, durationMs = 520) {
    if (!this.swipeBadge || !intent) return;
    clearTimeout(this._badgeHideTimer);
    this.swipeBadge.textContent = intent.label;
    this.swipeBadge.className = `swipe-badge visible ${intent.cls}`;
    this.swipeBadge.style.opacity = '1';
    this.swipeBadge.style.transform = 'translate(-50%, -50%) scale(1.04)';

    this._badgeHideTimer = setTimeout(() => {
      if (this.swipeBadge && !this.isSwiping) {
        this.swipeBadge.style.opacity = '0';
        this.swipeBadge.style.transform = 'translate(-50%, -50%) scale(0.88)';
      }
    }, durationMs);
  }

  _resetCardTransform(hideBadge = true) {
    if (this.imgElement && !this.isZoomedFn() && !this.multiTouchActive) {
      this.imgElement.style.transition = 'transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.16s ease';
      this.imgElement.style.transform = 'none';
      this.imgElement.style.opacity = '1';
    }
    if (hideBadge && this.swipeBadge) {
      clearTimeout(this._badgeHideTimer);
      this.swipeBadge.className = 'swipe-badge';
      this.swipeBadge.style.opacity = '0';
    }
  }

  _setupTouchGestures() {
    if (!this.touchContainer) return;

    // Prevent mobile browser native long-press image menu ("Download image / Share image")
    this.touchContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    this.touchContainer.addEventListener(
      'touchstart',
      (e) => {
        this._clearLongPressTimer();
        this._flushPendingCommit();

        // Multi-touch (2-finger pinch-to-zoom): cancel swipe/hold and let ViewportEngine handle pinch
        if (e.touches.length > 1) {
          this.multiTouchActive = true;
          this.isSwiping = false;
          this.longPressTriggered = false;
          if (this.swipeBadge) {
            this.swipeBadge.style.opacity = '0';
          }
          return;
        }

        this.multiTouchActive = false;
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;
        this.longPressTriggered = false;

        if (this.imgElement && !this.isZoomedFn()) {
          this.imgElement.style.transition = 'none';
        }

        // Start Long-Press timer (~430ms hold while not zoomed)
        if (!this.isZoomedFn()) {
          this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            if (this.isSwiping || this.multiTouchActive || this.isZoomedFn()) return;

            const map = this.getGestureMapFn() || {};
            const intent = this._resolveGestureAction(map.longPress ?? 'undo', 'hold');
            if (!intent) return;

            this.longPressTriggered = true;
            if (navigator.vibrate) {
              try {
                navigator.vibrate(35);
              } catch (_) {}
            }

            this._showCommittedBadge(intent, 580);
            this._executeGestureIntent(intent);
          }, 430);
        }
      },
      { passive: true }
    );

    this.touchContainer.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 1) {
          this.multiTouchActive = true;
          this.isSwiping = false;
          this._clearLongPressTimer();
          return;
        }

        if (this.longPressTriggered || this.multiTouchActive) {
          if (e.cancelable) e.preventDefault();
          return;
        }

        // When zoomed in, ViewportEngine handles 1-finger panning; do not swipe-rate
        if (this.isZoomedFn()) {
          this._clearLongPressTimer();
          return;
        }

        const touch = e.touches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        const dist = Math.hypot(deltaX, deltaY);

        if (dist > 10) {
          this._clearLongPressTimer();
          if (!this.imgElement || this.imgElement.style.display === 'none') return;

          this.isSwiping = true;
          if (e.cancelable) e.preventDefault();

          // Smooth damped card drag & subtle tilt
          const dampedX = deltaX * 0.65;
          const dampedY = deltaY * 0.65;
          const rotateDeg = Math.max(-10, Math.min(10, deltaX * 0.035));
          this.imgElement.style.transform = `translate3d(${dampedX}px, ${dampedY}px, 0) rotate(${rotateDeg}deg)`;

          const intent = this._getSwipeIntent(deltaX, deltaY, 22);
          if (this.swipeBadge) {
            if (intent) {
              clearTimeout(this._badgeHideTimer);
              const progress = Math.min(1, Math.max(0.35, (dist - 20) / 50));
              this.swipeBadge.textContent = intent.label;
              this.swipeBadge.className = `swipe-badge visible ${intent.cls}`;
              this.swipeBadge.style.opacity = `${progress}`;
              this.swipeBadge.style.transform = `translate(-50%, -50%) scale(${0.88 + 0.16 * progress})`;
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
        this._clearLongPressTimer();

        if (this.multiTouchActive) {
          if (e.touches.length === 0) {
            this.multiTouchActive = false;
          }
          return;
        }

        if (this.longPressTriggered) {
          this.longPressTriggered = false;
          this.isSwiping = false;
          this._resetCardTransform(false);
          return;
        }

        if (e.changedTouches.length !== 1) return;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        const dist = Math.hypot(deltaX, deltaY);
        const now = Date.now();
        const elapsed = Math.max(1, now - this.touchStartTime);
        const velocity = dist / elapsed; // px per ms

        // 1. Check if it was a tap (minimal finger movement) -> check for Double-Tap Zoom
        if (!this.isSwiping && dist < 18) {
          const timeSinceLastTap = now - this.lastTapTime;
          const distFromLastTap = Math.hypot(
            touch.clientX - this.lastTapX,
            touch.clientY - this.lastTapY
          );

          if (timeSinceLastTap > 0 && timeSinceLastTap < 340 && distFromLastTap < 48) {
            if (e.cancelable) e.preventDefault();
            this.lastTapTime = 0;
            this.onToggleZoom(touch.clientX, touch.clientY);
            return;
          }

          this.lastTapTime = now;
          this.lastTapX = touch.clientX;
          this.lastTapY = touch.clientY;
          if (!this.isZoomedFn()) {
            this._resetCardTransform(true);
          }
          return;
        }

        // 2. If zoomed in, don't trigger swipe ratings
        if (this.isZoomedFn()) {
          this.isSwiping = false;
          return;
        }

        // 3. Evaluate swipe commit: either distance >= 58px OR fast flick (dist >= 28px & velocity >= 0.42px/ms)
        const isCommittedSwipe = dist >= 58 || (dist >= 28 && velocity >= 0.42 && elapsed < 260);
        const intent = this._getSwipeIntent(deltaX, deltaY, 24);

        if (intent && isCommittedSwipe && this.imgElement) {
          if (navigator.vibrate) {
            try {
              navigator.vibrate(12);
            } catch (_) {}
          }

          // Keep the swipe badge prominently visible for 520ms so even fast flicks are unmistakable
          this._showCommittedBadge(intent, 520);

          // Quick, crisp exit in the swipe direction
          const flyX = intent.dir === 'right' ? 220 : intent.dir === 'left' ? -220 : deltaX * 0.8;
          const flyY = intent.dir === 'down' ? 220 : intent.dir === 'up' ? -220 : deltaY * 0.8;

          this.imgElement.style.transition = 'transform 0.09s ease-out, opacity 0.09s ease-out';
          this.imgElement.style.transform = `translate3d(${flyX}px, ${flyY}px, 0) scale(0.94)`;
          this.imgElement.style.opacity = '0.15';

          this._pendingCommit = () => {
            // Instant reset at center (no backward slide!) before swapping image src
            if (this.imgElement && !this.isZoomedFn()) {
              this.imgElement.style.transition = 'none';
              this.imgElement.style.transform = 'scale(0.97)';
              this.imgElement.style.opacity = '0.4';
            }
            this._executeGestureIntent(intent);
            requestAnimationFrame(() => {
              if (this.imgElement && !this.isZoomedFn()) {
                this.imgElement.style.transition = 'transform 0.11s ease-out, opacity 0.11s ease-out';
                this.imgElement.style.transform = 'none';
                this.imgElement.style.opacity = '1';
              }
            });
          };
          this._commitTimer = setTimeout(() => {
            this._flushPendingCommit();
          }, 85);
        } else {
          // Snap back to center
          this._resetCardTransform(true);
        }

        this.isSwiping = false;
      },
      { passive: false }
    );

    this.touchContainer.addEventListener('touchcancel', () => {
      this._clearLongPressTimer();
      this.longPressTriggered = false;
      this.multiTouchActive = false;
      this.isSwiping = false;
      if (!this.isZoomedFn()) {
        this._resetCardTransform(true);
      }
    });
  }
}
