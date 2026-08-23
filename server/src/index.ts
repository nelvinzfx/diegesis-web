import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8920);

const app = createApp();
app.listen(port, () => {
  console.log(`[diegesis-web] server listening on http://localhost:${port}`);
});
