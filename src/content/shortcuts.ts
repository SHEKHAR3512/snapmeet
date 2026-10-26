export type ShortcutAction = 'trigger-selected' | 'reappear' | 'reset-effects' | 'toggle-dock';

/** In-page fallback for the chrome.commands defaults (Alt+Shift+S/A/X/M). Uses `code` so macOS Option characters don't matter. */
const BINDINGS: Record<string, ShortcutAction> = {
  KeyS: 'trigger-selected',
  KeyA: 'reappear',
  KeyX: 'reset-effects',
  KeyM: 'toggle-dock',
};

export function matchShortcut(e: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code' | 'repeat'>): ShortcutAction | null {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.repeat) return null;
  return BINDINGS[e.code] ?? null;
}

/** Never intercept typing in chat, forms or other editable fields. */
export function isEditableTarget(e: Event): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (node as HTMLInputElement).type;
      if (!['checkbox', 'radio', 'button', 'range', 'submit', 'reset', 'color', 'file'].includes(type)) return true;
    }
  }
  return false;
}
