import type { UserRole, UserStatus } from '../generated/prisma/enums.js';

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  preferredLocale: string;
};
export type AuthUserRecord = AuthUser & { status: UserStatus; deletedAt: Date | null };
export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthUserRecord;
};
export type AuthContext = { sessionId: string; user: AuthUser };
export interface AuthRepository {
  findUser(id: string): Promise<AuthUserRecord | null>;
  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<{ id: string }>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(id: string, userId: string, at: Date): Promise<void>;
}

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}
