import type { AuthService } from './service.js';
import type { TelegramRepository } from './telegram-repository.js';
import type { TelegramVerifier } from './telegram-verifier.js';

export class TelegramAuthService {
  constructor(private readonly verifier: TelegramVerifier, private readonly repository: TelegramRepository,
    private readonly auth: AuthService) {}

  async login(initData: string) {
    const identity = this.verifier.verify(initData);
    const user = await this.repository.resolveUser(identity);
    return this.auth.createSessionForVerifiedUser(user.id);
  }
}
