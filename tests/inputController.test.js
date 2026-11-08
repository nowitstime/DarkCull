import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, MockElement } from './testHelper.js';
import { InputController } from '../js/inputController.js';

describe('InputController', () => {
  let touchContainer;
  let imgElement;
  let swipeBadge;
  let controller;
  let callbacks;
  let gestureMap;

  beforeEach(() => {
    setupTestEnvironment();

    touchContainer = new MockElement('div', 'viewport');
    imgElement = new MockElement('img', 'mainImg');
    swipeBadge = new MockElement('div', 'swipeBadge');

    callbacks = {
      prev: 0,
      next: 0,
      skip: 0,
      undo: 0,
      rate: null,
      zoom: null,
      fullscreen: 0,
    };

    gestureMap = {
      up: 'rate_5',
      down: 'reject',
      left: 'rate_3',
      right: 'rate_4',
      longPress: 'undo',
    };

    controller = new InputController({
      touchContainer,
      imgElement,
      swipeBadge,
      onPrev: () => callbacks.prev++,
      onNext: () => callbacks.next++,
      onSkip: () => callbacks.skip++,
      onUndo: () => callbacks.undo++,
      onRate: (r) => (callbacks.rate = r),
      onToggleZoom: (x, y) => (callbacks.zoom = { x, y }),
      onToggleFullscreen: () => callbacks.fullscreen++,
      isZoomedFn: () => false,
      getGestureMapFn: () => gestureMap,
    });
  });

  describe('Gesture mapping resolution (_resolveGestureAction)', () => {
    it('resolves skip, back, and undo actions', () => {
      const skip = controller._resolveGestureAction('skip', 'up');
      assert.deepEqual(skip, { action: 'skip', label: '➔ SKIP', cls: 'swipe-skip', dir: 'up' });

      const back = controller._resolveGestureAction('back', 'down');
      assert.deepEqual(back, { action: 'back', label: '⬅ BACK', cls: 'swipe-back', dir: 'down' });

      const undo = controller._resolveGestureAction('undo', 'hold');
      assert.deepEqual(undo, { action: 'undo', label: '↺ UNDO', cls: 'swipe-undo', dir: 'hold' });
    });

    it('resolves reject (-1) and star ratings (0..5)', () => {
      const reject = controller._resolveGestureAction('reject', 'down');
      assert.equal(reject.action, 'rate');
      assert.equal(reject.rating, -1);
      assert.equal(reject.cls, 'swipe-reject');

      const star5 = controller._resolveGestureAction('rate_5', 'up');
      assert.equal(star5.action, 'rate');
      assert.equal(star5.rating, 5);
      assert.equal(star5.cls, 'swipe-rate-5');

      const clear0 = controller._resolveGestureAction('rate_0', 'left');
      assert.equal(clear0.action, 'rate');
      assert.equal(clear0.rating, 0);
      assert.equal(clear0.cls, 'swipe-rate-0');
    });

    it('returns null on unknown or disabled gestures', () => {
      assert.equal(controller._resolveGestureAction('none'), null);
      assert.equal(controller._resolveGestureAction(undefined), null);
    });
  });

  describe('Swipe intent direction discrimination (_getSwipeIntent)', () => {
    it('detects horizontal right swipe intent', () => {
      const intent = controller._getSwipeIntent(80, 10, 24);
      assert.ok(intent);
      assert.equal(intent.dir, 'right');
      assert.equal(intent.rating, 4); // mapped to rate_4 in gestureMap
    });

    it('detects horizontal left swipe intent', () => {
      const intent = controller._getSwipeIntent(-90, 12, 24);
      assert.ok(intent);
      assert.equal(intent.dir, 'left');
      assert.equal(intent.rating, 3); // mapped to rate_3 in gestureMap
    });

    it('detects vertical up swipe intent', () => {
      const intent = controller._getSwipeIntent(5, -100, 24);
      assert.ok(intent);
      assert.equal(intent.dir, 'up');
      assert.equal(intent.rating, 5); // mapped to rate_5 in gestureMap
    });

    it('detects vertical down swipe intent', () => {
      const intent = controller._getSwipeIntent(8, 85, 24);
      assert.ok(intent);
      assert.equal(intent.dir, 'down');
      assert.equal(intent.rating, -1); // mapped to reject in gestureMap
    });

    it('returns null if swipe distance is below minimum threshold', () => {
      const intent = controller._getSwipeIntent(12, 10, 24);
      assert.equal(intent, null);
    });
  });

  describe('Keyboard shortcuts', () => {
    const triggerKey = (code, key = null, shiftKey = false, ctrlKey = false) => {
      const listeners = window.listeners ? window.listeners.get('keydown') || [] : [];
      for (const listener of listeners) {
        listener({
          code,
          key: key !== null ? key : code,
          shiftKey,
          ctrlKey,
          metaKey: ctrlKey,
          target: { tagName: 'DIV' },
          preventDefault: () => {},
        });
      }
    };

    it('handles numeric rating keys (1-5, 0, and X)', () => {
      triggerKey('Digit5', '5');
      assert.equal(callbacks.rate, 5);

      triggerKey('Digit3', '3');
      assert.equal(callbacks.rate, 3);

      triggerKey('Digit0', '0');
      assert.equal(callbacks.rate, 0);

      triggerKey('KeyX', 'x');
      assert.equal(callbacks.rate, -1);
    });

    it('handles navigation keys (ArrowRight/D, ArrowLeft/A)', () => {
      triggerKey('ArrowRight', 'ArrowRight');
      assert.equal(callbacks.next, 1);

      triggerKey('KeyD', 'd');
      assert.equal(callbacks.next, 2);

      triggerKey('ArrowLeft', 'ArrowLeft');
      assert.equal(callbacks.prev, 1);

      triggerKey('KeyA', 'a');
      assert.equal(callbacks.prev, 2);
    });

    it('handles zoom toggle (Space, KeyZ)', () => {
      triggerKey('Space', ' ');
      assert.ok(callbacks.zoom);

      callbacks.zoom = null;
      triggerKey('KeyZ', 'z');
      assert.ok(callbacks.zoom);
    });

    it('handles undo key (KeyU, and Ctrl+Z)', () => {
      triggerKey('KeyU', 'u');
      assert.equal(callbacks.undo, 1);

      triggerKey('KeyZ', 'z', false, true); // Ctrl+Z
      assert.equal(callbacks.undo, 2);
    });

    it('handles fullscreen key (KeyF)', () => {
      triggerKey('KeyF', 'f');
      assert.equal(callbacks.fullscreen, 1);
    });
  });
});
