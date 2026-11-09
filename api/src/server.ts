import { createApp } from './app';
import { config } from './config';
import { tick } from './services/jobs';

const server = createApp().listen(config.port, () => {
  console.log(`MyMoney API listening on port ${config.port} (${config.providerMode} providers)`);
});
const timer = setInterval(tick, 2000);

function shutdown() {
  clearInterval(timer);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
