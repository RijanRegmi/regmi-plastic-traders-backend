import multer, { FileFilterCallback } from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary';
import { Request } from 'express';

// ─── File filter (images only) ─────────────────────────────────────────────────
const fileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only image files are allowed (jpg, png, webp, gif)'));
};

// ─── Cloudinary storage factory ────────────────────────────────────────────────
const cloudinaryStorage = (folderInfo: string | ((req: Request, file: Express.Multer.File) => string)) =>
  new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
      // Determine the folder dynamically or use static string
      let folderName = 'regmi-plastic/misc';
      if (typeof folderInfo === 'function') {
        folderName = folderInfo(req, file);
      } else if (folderInfo) {
        folderName = `regmi-plastic/${folderInfo}`; 
      }
      return {
        folder: folderName,
        allowed_formats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
        // Optionally configure specific public_id naming if desired, otherwise cloudinary auto-generates
      };
    },
  });

// ─── Product images  (up to 5, 5 MB each) ─────────────────────────────────────
export const upload = multer({
  storage: cloudinaryStorage('products'),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

// ─── Blog cover image (1 file, 5 MB) ──────────────────────────────────────────
export const blogImageUpload = multer({
  storage: cloudinaryStorage('blog'),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// ─── Logo (1 file, 2 MB) ──────────────────────────────────────────────────────
export const logoUpload = multer({
  storage: cloudinaryStorage('logo'),
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// ─── Dynamic background (1 file, 10 MB) ───────────────────────────────────────
export const dynamicBgUpload = multer({
  storage: cloudinaryStorage((req) => {
    const page = req.params.page || 'home';
    const folder = page === 'about' ? 'about' : page === 'blog' ? 'blog' : 'background';
    return `regmi-plastic/${folder}`;
  }),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

// ─── URL helpers ─────────────────────────────────────────────────────────────
// multer-storage-cloudinary stores the full url on file.path 
// (You might just use file.path directly in controllers over these helpers now, but keeping signature for safety)
export const getImageUrl     = (_req: Request, url: string) => url;
export const getBlogImageUrl = (_req: Request, url: string) => url;
export const getLogoUrl      = (_req: Request, url: string) => url;
export const getDynamicBgImageUrl = (_req: Request, _page: string, url: string) => url;

// ─── Delete helper ─────────────────────────────────────────────────────────────
/**
 * Deletes an image from Cloudinary using its public_id.
 * Typically, Cloudinary URLs look like this: 
 * https://res.cloudinary.com/<cloud_name>/image/upload/v1234567/regmi-plastic/products/filename.jpg
 * 
 * The `public_id` would be "regmi-plastic/products/filename"
 */
export const deleteImageFile = async (public_id: string): Promise<void> => {
   if (!public_id) return;
   
   try {
      await cloudinary.uploader.destroy(public_id);
   } catch (err) {
      console.error('Failed to delete image from Cloudinary:', err);
   }
};