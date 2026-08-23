import { createApp } from './app.js';

// server/.env (if present) is applied inside createApp before the port is
// read, so PORT from .env works without a dotenv dependency.
const app = createApp();

const port = Number(process.env.PORT ?? 8920);

app.listen(port, () => {
  console.log(`[diegesis-web] server listening on http://localhost:${port}`);
});
