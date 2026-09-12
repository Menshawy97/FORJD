import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportAccount } from '@/auth/apiClient';

/**
 * R4 (H2) -- GDPR Art. 15 & 20's "Export my data" action. `GET /users/me/export` returns the
 * whole account as one JSON body; this is the one place that body ever touches disk on the
 * device, so the caller (the Settings screen) never has to know `expo-file-system` or
 * `expo-sharing` exist -- it calls one function and gets a resolved or rejected promise, the
 * same shape `deleteAccount()` already gives `delete-account.tsx`.
 *
 * Written to the cache directory, not the document directory: this file is a transient
 * hand-off to the OS share sheet, not something FORJD itself needs to read back later, which
 * is exactly the distinction `Paths.cache`'s own docs draw ("can be deleted by the system when
 * the device runs low on storage").
 */
export class ExportSharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device.');
    this.name = 'ExportSharingUnavailableError';
  }
}

function exportFileName(): string {
  // Colons are not valid in a filename on every platform this app ships to -- ISO timestamps
  // carry them, so this strips punctuation down to something every OS accepts.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `forjd-data-export-${stamp}.json`;
}

export async function shareAccountExport(): Promise<void> {
  const data = await exportAccount();

  const file = new File(new Directory(Paths.cache), exportFileName());
  file.create();
  file.write(JSON.stringify(data, null, 2));

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new ExportSharingUnavailableError();
  }

  await Sharing.shareAsync(file.uri, { dialogTitle: 'Export my data', mimeType: 'application/json' });
}
