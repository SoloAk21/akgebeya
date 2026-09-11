import { z } from 'zod';
import type { AuthConfig } from '../config.js';
import { HttpError } from '../errors.js';
import { AuthService } from './service.js';
import type { GoogleRepository } from './google-repository.js';
import type { GoogleIdentityVerifier } from './google-verifier.js';

export class GoogleAuthService {
  constructor(private readonly verifier: GoogleIdentityVerifier, private readonly repository: GoogleRepository,
    private readonly config: AuthConfig) {}
  async login(input: string) {
    const token = z.string().min(1).max(12_000).safeParse(input);
    if (!token.success) throw new HttpError('BAD_REQUEST');
    const identity = await this.verifier.verify(token.data);
    return this.repository.withIdentity(identity, (id, auth) =>
      new AuthService(auth, this.config).createSessionForVerifiedUser(id));
  }
}
