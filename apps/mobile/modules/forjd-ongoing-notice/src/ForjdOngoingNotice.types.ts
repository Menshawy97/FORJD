/** One notice's content, as the Kotlin `NoticeContent` record reads it. Times are epoch milliseconds. */
export type NativeNoticeContent = {
  title: string;
  text: string;
  subText: string | null;
  /** The chronometer counts down to this time; the notice times out then. */
  countDownToMs: number | null;
  /** The chronometer counts up from this time. */
  countUpFromMs: number | null;
  actions: NativeNoticeAction[];
};

export type NativeNoticeAction = {
  id: string;
  title: string;
  /** Opens the app with the action, instead of acting in the background. */
  opensApp: boolean;
};

export type NativeShowOptions = NativeNoticeContent & {
  id: string;
  channelId: string;
  channelName: string;
  /** `#RRGGBB`. */
  color: string;
  visibility: 'public' | 'private';
  /** Posted in place of this notice when its countdown ends, even if the app is asleep. */
  then: NativeNoticeContent | null;
};

export type NoticeActionPayload = {
  noticeId: string;
  actionId: string;
};

export type ForjdOngoingNoticeModuleEvents = {
  onAction: (params: NoticeActionPayload) => void;
};
