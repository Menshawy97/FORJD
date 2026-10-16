/**
 * The `KeyboardAvoidingView` behaviour for every bottom sheet with a text input, on both platforms.
 * The sheets used to pad only on iPhone and rely on Android resizing the window, which it no longer
 * does for these overlays with edge-to-edge (target level 36): the keyboard covered the nutrition
 * goals sheet's fields on the emulator (2026-10-16). `sheet-keyboard.test.ts` fails if a sheet goes
 * back to an iPhone-only behaviour.
 */
export const SHEET_KEYBOARD_BEHAVIOR = 'padding' as const;
