import { adoptStyleSheet } from './dom-safe';

const QUICK_COMPOSER_CSS = `
/* Modern Web Guidance: form-factor-adaptation (44px touch targets, safe-area insets) & natural-interactions */
:root,
html[data-agy-unified-theme="light"] {
  --target-size: 24px;
  --agy-kb-offset: 0px;
}

@media (pointer: coarse) {
  :root {
    --target-size: 44px;
  }
}
`;

export function mountQuickComposerAndImeGuard(): void {
  adoptStyleSheet('agy-quick-composer', QUICK_COMPOSER_CSS);

  // 1. IME-Safe Enter-to-Submit guard per `ime-safe-enter-submit` guide
  let lastCompositionEndAt: number | null = null;

  document.addEventListener(
    'compositionend',
    (event) => {
      lastCompositionEndAt = event.timeStamp;
    },
    true
  );

  document.addEventListener(
    'keydown',
    (event) => {
      // Do not intercept if user is typing inside Quill or rich-text editors (e.g. Gemini Web)
      const target = event.target as HTMLElement | null;
      if (target && target.closest('.ql-editor, rich-textarea, [contenteditable="true"]')) {
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        const isComposingSafeguard =
          event.isComposing ||
          event.keyCode === 229 ||
          (lastCompositionEndAt !== null &&
            Math.abs(event.timeStamp - lastCompositionEndAt) < 50);

        if (isComposingSafeguard) {
          // Stop premature Enter submission during Chinese/Japanese IME candidate selection
          event.stopPropagation();
        }
      }
    },
    true
  );

  // 2. Viewport & Soft-Keyboard height adaptation (`fixHeights` + visualViewport)
  const syncViewportOffset = () => {
    const vv = window.visualViewport;
    if (vv) {
      const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--agy-kb-offset', `${Math.round(kbHeight)}px`);
    }
  };
  window.visualViewport?.addEventListener('resize', syncViewportOffset);
  window.visualViewport?.addEventListener('scroll', syncViewportOffset);
}
