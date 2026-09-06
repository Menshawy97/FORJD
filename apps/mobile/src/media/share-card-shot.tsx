import { forwardRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { CaptureOptions, ViewShotRef } from 'react-native-view-shot';

import { isExpoGo } from './share-capture';

/**
 * See `share-capture.ts`'s addendum for the full reasoning: `react-native-view-shot` throws the
 * instant it is imported when its native module is not registered, which is Expo Go's case. This
 * `require` is evaluated once, at module load, guarded by `isExpoGo()` -- never a plain top-level
 * `import` -- so loading this file under Expo Go never touches the library at all.
 */
const RealViewShot = isExpoGo() ? null : (require('react-native-view-shot').default as React.ComponentType<{
  ref?: React.Ref<ViewShotRef>;
  style?: StyleProp<ViewStyle>;
  options?: CaptureOptions;
  children?: ReactNode;
}>);

interface ShareCardShotProps {
  style?: StyleProp<ViewStyle>;
  options?: CaptureOptions;
  children?: ReactNode;
}

/**
 * The one place both share screens wrap their preview card. Under a dev-client or production
 * build this is a real `ViewShot`; under Expo Go it is a plain, visually identical `View` that
 * cannot capture anything -- `saveShareCardToPhotos`/`shareShareCard` are never called in that
 * case either, per each screen's own `isExpoGo()` branch.
 */
export const ShareCardShot = forwardRef<ViewShotRef, ShareCardShotProps>(function ShareCardShot(
  { style, options, children },
  ref,
) {
  if (!RealViewShot) {
    return <View style={style}>{children}</View>;
  }
  return (
    <RealViewShot ref={ref} style={style} options={options}>
      {children}
    </RealViewShot>
  );
});
