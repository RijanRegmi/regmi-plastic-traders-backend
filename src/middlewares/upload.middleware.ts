// ──────────────────────────────────────────────────────────────────────────────
// UPDATED upload.middleware.ts
// Products now save to /uploads/products/ (separate from blog/logo/background)
// All other logic unchanged.
// ──────────────────────────────────────────────────────────────────────────────

import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

const UPLOADS_DIR   = path.join(process.cwd(), 'uploads');
const PRODUCTS_DIR  = path.join(process.cwd(), 'uploads', 'products');   // ← NEW
const BLOG_DIR      = path.join(process.cwd(), 'uploads', 'blog');
const LOGO_DIR      = path.join(process.cwd(), 'uploads', 'logo');
const BG_DIR        = path.join(process.cwd(), 'uploads', 'background');

// Ensure all directories exist
[UPLOADS_DIR, PRODUCTS_DIR, BLOG_DIR, LOGO_DIR, BG_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files are allowed (jpg, png, webp, gif)'));
};

// ─── Product image upload (saves to /uploads/products/) ───────────────────────
const productStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PRODUCTS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
export const upload = multer({
  storage: productStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

// ─── Blog image upload ─────────────────────────────────────────────────────────
const blogStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BLOG_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `blog-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
export const blogImageUpload = multer({
  storage: blogStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// ─── Logo upload ───────────────────────────────────────────────────────────────
const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LOGO_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `logo${ext}`);
  },
});
export const logoUpload = multer({
  storage: logoStorage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// ─── Hero Background upload ────────────────────────────────────────────────────
const bgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BG_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `bg-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
export const bgUpload = multer({
  storage: bgStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ─── URL helpers ───────────────────────────────────────────────────────────────
export const getImageUrl     = (req: Request, filename: string) =>
  `${req.protocol}://${req.get('host')}/uploads/products/${filename}`;   // ← Updated path

export const getBlogImageUrl = (req: Request, filename: string) =>
  `${req.protocol}://${req.get('host')}/uploads/blog/${filename}`;

export const getLogoUrl      = (req: Request, filename: string) =>
  `${req.protocol}://${req.get('host')}/uploads/logo/${filename}`;

export const getBgImageUrl   = (req: Request, filename: string) =>
  `${req.protocol}://${req.get('host')}/uploads/background/${filename}`;

export const deleteImageFile = (filename: string): void => {
  // Try /uploads/products/ first, fall back to /uploads/ for legacy files
  const paths = [
    path.join(PRODUCTS_DIR, filename),
    path.join(UPLOADS_DIR, filename),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) { fs.unlinkSync(p); return; }
  }
};