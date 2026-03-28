import multer, { FileFilterCallback } from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { Request } from 'express';
import streamifier from 'streamifier';

// ─── File filter (images only) ─────────────────────────────────────────────────
const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files are allowed (jpg, png, webp, gif)'));
};

// ─── Memory storage (buffer) — we upload to Cloudinary manually ───────────────
const memoryStorage = multer.memoryStorage();

// ─── Product images (up to 5, 5 MB each) ──────────────────────────────────────
export const upload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

// ─── Blog cover image (1 file, 5 MB) ──────────────────────────────────────────
export const blogImageUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// ─── Logo (1 file, 2 MB) ──────────────────────────────────────────────────────
export const logoUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// ─── Dynamic background (1 file, 10 MB) ───────────────────────────────────────
export const dynamicBgUpload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ─── Core upload helper ────────────────────────────────────────────────────────
export const uploadToCloudinary = (
  buffer: Buffer,
  folder: string,
): Promise<{ public_id: string; secure_url: string }> => {
  return new Promise((resolve, reject) => {

    // ── Debug: confirm config is loaded ──────────────────────────────────────
    const cfg = cloudinary.config();
    console.log('📤 Uploading to Cloudinary...');
    console.log('   folder     :', `regmi-plastic/${folder}`);
    console.log('   buffer size:', buffer?.length ?? 'UNDEFINED — file.buffer is missing!');
    console.log('   cloud_name :', cfg.cloud_name  || '✗ MISSING');
    console.log('   api_key    :', cfg.api_key     ? '✓ set' : '✗ MISSING');
    console.log('   api_secret :', cfg.api_secret  ? '✓ set' : '✗ MISSING');

    if (!buffer || buffer.length === 0) {
      const err = new Error('file.buffer is empty — multer memoryStorage may not be active');
      console.error('❌', err.message);
      return reject(err);
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `regmi-plastic/${folder}`,
        allowed_formats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
      },
      (error, result) => {
        if (error || !result) {
          console.error('❌ Cloudinary upload_stream error:', error);
          return reject(error || new Error('Upload failed — no result returned'));
        }
        console.log('✅ Cloudinary upload success:', result.public_id);
        resolve({ public_id: result.public_id, secure_url: result.secure_url });
      },
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// ─── Delete helper ─────────────────────────────────────────────────────────────
export const deleteImageFile = async (public_id: string): Promise<void> => {
  if (!public_id) return;
  try {
    await cloudinary.uploader.destroy(public_id);
  } catch (err) {
    console.error('Failed to delete image from Cloudinary:', err);
  }
};

// ─── Legacy URL helpers (kept for compatibility) ───────────────────────────────
export const getImageUrl          = (_req: Request, url: string) => url;
export const getBlogImageUrl      = (_req: Request, url: string) => url;
export const getLogoUrl           = (_req: Request, url: string) => url;
export const getDynamicBgImageUrl = (_req: Request, _page: string, url: string) => url;