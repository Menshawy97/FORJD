import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { ForjdOngoingNoticeModuleEvents, NativeShowOptions, NoticeActionPayload } from './ForjdOngoingNotice.types';

declare class ForjdOngoingNoticeModule extends NativeModule<ForjdOngoingNoticeModuleEvents> {
  /** Whether it was posted: false when the person has notifications off. */
  show(options: NativeShowOptions): Promise<boolean>;
  dismiss(id: string): void;
  /** Taps made while nothing listened, oldest first; each is returned once. */
  takePendingActions(): NoticeActionPayload[];
}

/** Null where the native module is not built in: iOS, Expo Go, web and Jest (ADR-063). */
export default requireOptionalNativeModule<ForjdOngoingNoticeModule>('ForjdOngoingNotice');
