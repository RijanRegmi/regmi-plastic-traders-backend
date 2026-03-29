// ─── MUST be first — loads .env before any other module reads process.env ──────
import 'dotenv/config';

// ─── Configure Cloudinary immediately after dotenv ────────────────────────────
import { configureCloudinary } from './config/cloudinary';
configureCloudinary();

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/database';
import routes from './routes';
import { errorHandler, notFound } from './middlewares/error.middleware';

const app = express();

// ─── CORS & Logging ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowedOrigin = req.headers.origin || process.env.CLIENT_URL || 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method !== 'OPTIONS') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ─── Security & Parsing ────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: 'Too many requests' }));

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Welcome & Health Check ───────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ 
  message: 'Welcome to Regmi Plastic Traders API', 
  status: 'active',
  environment: process.env.NODE_ENV || 'development'
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error Handling — MUST be last ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5050;

if (process.env.NODE_ENV !== 'production') {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  });
} else {
  connectDB().catch(console.error);
}

export default app;