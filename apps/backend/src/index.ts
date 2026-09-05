import app from "./app";
import { env } from "./config/env.config";
import { initWorkers } from "./workers";

const PORT = env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`[AkGebeya Backend] Server running on port ${PORT}`);
  await initWorkers();
});
