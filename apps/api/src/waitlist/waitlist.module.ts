import { Module } from '@nestjs/common';

import { TurnstileModule } from '../integrations/turnstile/turnstile.module';
import { WaitlistController } from './waitlist.controller';
import { WaitlistRepository } from './waitlist.repository';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [TurnstileModule],
  controllers: [WaitlistController],
  providers: [WaitlistRepository, WaitlistService],
})
export class WaitlistModule {}
