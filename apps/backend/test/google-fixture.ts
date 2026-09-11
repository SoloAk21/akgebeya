import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';
import { GoogleVerifier } from '../src/auth/google-verifier.js';
export async function googleFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  key.kid = randomUUID();
  const clientId = 'test-client.apps.googleusercontent.com';
  const keys = createLocalJWKSet({ keys: [key] });
  const verifier = new GoogleVerifier({ clientId }, keys);
  const sub = randomUUID();
  const email = 'google-' + randomUUID() + '@example.com';
  async function sign(overrides: JWTPayload = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub, email, email_verified: true, iss: 'https://accounts.google.com',
      aud: clientId, iat: now, exp: now + 300, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: key.kid }).sign(privateKey);
  }
  return { verifier, sign, sub, email, clientId, keys };
}
