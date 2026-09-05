import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import healthRouter from "./routes/health.route";
import authRouter from "./routes/auth.route";
import providerRouter from "./routes/provider.route";
import listingRouter from "./routes/listing.route";
import paymentRouter from "./routes/payment.route";
import aiRouter from "./routes/ai.route";
import { env } from "./config/env.config";

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app: Express = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1", healthRouter);
app.use("/api/v1", authRouter);
app.use("/api/v1", providerRouter);
app.use("/api/v1", listingRouter);
app.use("/api/v1", paymentRouter);
app.use("/api/v1", aiRouter);

export default app;
