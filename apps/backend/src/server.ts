import {HttpChapaClient} from './payments/chapa-client.js';
import {loadChapaConfig} from './config.js';
import { GeminiListingAiClient } from './listings/gemini-client.js';
import { loadGeminiConfig } from './config.js';
import { ListingService } from './listings/service.js';
import { PrismaListingRepository } from './listings/repository.js';
import { ProviderService } from './providers/service.js';
import { PrismaProviderRepository } from './providers/repository.js';
import { loadProviderConfig } from './config.js';
import { GoogleVerifier } from './auth/google-verifier.js';
import { GoogleAuthService } from './auth/google-service.js';
import { PrismaGoogleRepository } from './auth/google-repository.js';
import { TelegramVerifier } from './auth/telegram-verifier.js';
import { TelegramAuthService } from './auth/telegram-service.js';
import { PrismaTelegramRepository } from './auth/telegram-repository.js';
import { PhoneOtpService } from './auth/phone-service.js';
import { PrismaPhoneOtpRepository } from './auth/phone-repository.js';
import { createOtpTransport } from './auth/phone-transport.js';
import { createDatabaseClient } from './database.js';
import { AuthService } from './auth/service.js';
import { PrismaAuthRepository } from './auth/repository.js';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig, loadAuthConfig, loadTelegramConfig, loadPhoneOtpConfig, loadGoogleConfig } from './config.js';

try {
  const config = loadConfig();
  const authConfig = loadAuthConfig();
  const telegramConfig = loadTelegramConfig();
  const phoneConfig = loadPhoneOtpConfig();
  const phoneTransport = createOtpTransport(phoneConfig);
  const database = createDatabaseClient('pooled');
  const auth = new AuthService(new PrismaAuthRepository(database), authConfig);
  const telegram = new TelegramAuthService(new TelegramVerifier(telegramConfig), new PrismaTelegramRepository(database), auth);
  const phone = new PhoneOtpService(new PrismaPhoneOtpRepository(database), phoneTransport, phoneConfig, authConfig);
  const google = new GoogleAuthService(new GoogleVerifier(loadGoogleConfig()), new PrismaGoogleRepository(database), authConfig);
  const provider = new ProviderService(new PrismaProviderRepository(database), loadProviderConfig());
  const chapaConfig=loadChapaConfig();
  const chapa=chapaConfig.secretKey&&chapaConfig.baseUrl&&chapaConfig.callbackUrl&&chapaConfig.returnUrl?new HttpChapaClient(chapaConfig):undefined;
  const listings = new ListingService(new PrismaListingRepository(database), new GeminiListingAiClient(loadGeminiConfig()), chapa);
  const server = createServer(createApp(config, auth, telegram, phone, google, provider, listings));
  server.listen(config.port, config.host, () => {
    console.log(`Backend listening at http://${config.host}:${config.port}${config.apiPrefix}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`Server failed: ${error.code ?? 'UNKNOWN'}`);
    process.exitCode = 1;
    void database.$disconnect().catch(() => { console.error('Database shutdown failed'); });
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      console.error('Server shutdown timed out');
      process.exit(1);
    }, 10_000);
    timeout.unref();
    server.close(async (error) => {
      try { await database.$disconnect(); } catch { process.exitCode = 1; console.error('Database shutdown failed'); }
      clearTimeout(timeout);
      if (error) {
        console.error('Server shutdown failed');
        process.exitCode = 1;
      }
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Backend startup failed');
  process.exitCode = 1;
}
