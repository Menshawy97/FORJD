import { Module } from '@nestjs/common';

import { STORAGE_PROVIDER } from './providers/storage-provider.interface';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';

/**
 * Exported but unconsumed until Phase 5 (InBody upload). Registering the binding now keeps
 * the adapter honest — it has to compile and resolve, not sit as dead code.
 */
@Module({
  providers: [{ provide: STORAGE_PROVIDER, useClass: SupabaseStorageProvider }],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
