// A bottom sheet with a text input must stay above the keyboard on both platforms. The sheets used
// `Platform.OS === 'ios' ? 'padding' : undefined`, relying on Android resizing the window, which it
// no longer does for these overlays with edge-to-edge (target level 36): on the emulator the keyboard
// covered the goals sheet's fields (2026-10-16, remaining-checklist.md).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { SHEET_KEYBOARD_BEHAVIOR } from '../sheet-keyboard';

const SRC = join(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('bottom-sheet keyboard avoidance', () => {
  it('pads on Android as well as iPhone', () => {
    expect(SHEET_KEYBOARD_BEHAVIOR).toBe('padding');
  });

  it('every KeyboardAvoidingView uses the shared behaviour, none is iPhone-only', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('<KeyboardAvoidingView')) return false;
      const behaviors = text.match(/behavior=\{[^}]*\}/g) ?? [];
      return behaviors.some((b) => b !== 'behavior={SHEET_KEYBOARD_BEHAVIOR}');
    });
    expect(offenders).toEqual([]);
  });
});
