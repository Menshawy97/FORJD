import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

/**
 * The prototype's `flash()` — a transient pill above the tab bar, gone on its own after
 * 1900ms. It is not a dialog: there is nothing to dismiss and nothing to confirm, which is
 * why the hook owns the timer and the caller only ever says what to say.
 *
 *   position:absolute; left:22; right:22; bottom:96
 *   padding:'13px 16px'; borderRadius:12
 *   background:rgba(28,29,32,.97); border:1px solid rgba(255,255,255,.1)
 *   boxShadow:'0 10px 30px rgba(0,0,0,.5)'; font:'600 13px/1'; color:#f6f5f3
 */
export const TOAST_DURATION_MS = 1900;

interface ToastController {
  message: string | null;
  show: (message: string) => void;
}

export function useToast(): ToastController {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    // Cleared and restarted rather than stacked: `flash()` does the same, so a second
    // message replaces the first and gets its own full 1900ms rather than inheriting what
    // was left of the previous one.
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  // A pending timer outliving the screen would call setState on an unmounted component and,
  // worse, keep the handle alive for two seconds after the user has navigated away.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return { message, show };
}

interface ToastProps {
  message: string | null;
}

export function Toast({ message }: ToastProps) {
  if (!message) {
    return null;
  }

  return (
    <View className="absolute bottom-[96px] left-[22px] right-[22px] rounded-button border border-borderToast bg-toastBg px-4 py-[13px] shadow-toast">
      <Text className="font-archivo text-toast font-semibold text-text">{message}</Text>
    </View>
  );
}
