import { PgBoss } from "pg-boss";
import { env } from "../config/env.config";

export const QUEUES = {
  LISTING_EXPIRATION: "listing-expiration-queue",
  EXPIRATION_RENEWAL: "expiration-renewal-queue",
  WEBHOOK_RETRY: "webhook-retry-queue",
  NOTIFICATION: "notification-queue",
  DEAD_LETTER: "dead-letter-queue",
} as const;

export class QueueService {
  private boss: PgBoss;

  constructor() {
    this.boss = new PgBoss({
      connectionString: env.DATABASE_URL,
    });

    this.boss.on("error", (error: Error) => {
      console.error("[pg-boss Error]", error);
    });
  }

  async start(): Promise<PgBoss> {
    await this.boss.start();
    console.log("[QueueService] pg-boss worker engine initialized.");
    return this.boss;
  }

  getBoss(): PgBoss {
    return this.boss;
  }

  async send(queueName: string, data: object): Promise<string | null> {
    return this.boss.send(queueName, data);
  }
}

export const queueService = new QueueService();
