import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler, h } from './lib/http';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { engageRouter } from './routes/engage';
import { moneyRouter } from './routes/money';
import { webhookRouter } from './routes/webhooks';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(compression());
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));
  if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  app.get('/health', h(() => ({ ok: true, service: 'mymoney-api' })));
  const v1 = express.Router();
  v1.use(webhookRouter, authRouter, moneyRouter, engageRouter, adminRouter);
  app.use('/v1', v1);
  app.use((_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }); });
  app.use(errorHandler);
  return app;
}
