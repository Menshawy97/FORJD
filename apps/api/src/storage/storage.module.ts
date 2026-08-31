import { Module } from '@nestjs/common';

import { STORAGE_PROVIDER } from './providers/storage-provider.interface';
import { supabaseStorageClientProvider } from './providers/supabase-storage-client';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';

/**
 * The exercise-media mirror (Phase F) is the first real consumer — InBody upload (Phase 5)
 * was the one originally anticipated when this module was written under Phase 1.
 */
@Module({
  providers: [
    supabaseStorageClientProvider,
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageProvider },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
