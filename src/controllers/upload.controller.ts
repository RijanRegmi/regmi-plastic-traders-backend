import { Request, Response, NextFunction } from 'express';
import cloudinary from '../config/cloudinary';
import { deleteImageFile } from '../middlewares/upload.middleware';
import { cmsService } from '../services/cms.service';
import { blogService } from '../services/blog-review.service';
import { AppError } from '../errors/AppError';
import { ICmsSection, IBlogPost } from '../types';

// multer-storage-cloudinary drops the URL on file.path, 
// and the Cloudinary identifier (e.g. "regmi-plastic/products/abc1234") on file.filename
type CloudinaryFile = Express.Multer.File & { path: string, filename: string };

export class UploadController {
  // ─── Product images (up to 5) ───────────────────────────────────────────────
  async uploadImages(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as CloudinaryFile[];
      if (!files || files.length === 0) throw new AppError('No files uploaded', 400);

      const uploaded = files.map((file) => ({
        filename:     file.filename,  // Stores Cloudinary public_id
        originalName: file.originalname,
        size:         file.size,
        mimetype:     file.mimetype,
        url:          file.path,      // Cloudinary secure URL
        path:         file.filename,  // Keep path as public_id for DB references and deletions
      }));

      res.status(201).json({
        success: true,
        message: `${files.length} file(s) uploaded successfully`,
        data: uploaded,
      });
    } catch (err) { next(err); }
  }

  // ─── Single product image ────────────────────────────────────────────────────
  async uploadSingle(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as CloudinaryFile;
      if (!file) throw new AppError('No file uploaded', 400);

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          filename:     file.filename,
          originalName: file.originalname,
          size:         file.size,
          mimetype:     file.mimetype,
          url:          file.path,
          path:         file.filename,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Blog cover image (attached to an existing post) ────────────────────────
  async uploadBlogImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as CloudinaryFile;
      if (!file) throw new AppError('No file uploaded', 400);

      const { id } = req.params;
      const updatedPost = await blogService.update(id, { coverImage: file.path } as Partial<IBlogPost>);

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded and saved',
        data: {
          filename: file.filename,
          url:      file.path,
          path:     file.filename,
          post:     updatedPost,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Blog cover image (temp — no post ID yet) ────────────────────────────────
  async uploadBlogImageTemp(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as CloudinaryFile;
      if (!file) throw new AppError('No file uploaded', 400);

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded',
        data: {
          filename: file.filename,
          url:      file.path,
          path:     file.filename,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Logo ────────────────────────────────────────────────────────────────────
  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as CloudinaryFile;
      if (!file) throw new AppError('No file uploaded', 400);

      // Persist the Cloudinary public URL so it's globally available
      await cmsService.upsertSection('global', 'logoUrl', file.path, 'Logo Image URL', 'image');

      res.status(201).json({
        success: true,
        message: 'Logo uploaded and saved',
        data: {
          filename: file.filename,
          url:      file.path,
          path:     file.filename,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Dynamic background ──────────────────────────────────────────────────────
  async uploadBackground(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as CloudinaryFile;
      if (!file) throw new AppError('No file uploaded', 400);

      const page = req.params.page || 'home';
      const key  = page === 'about' ? 'aboutBgImage' : page === 'blog' ? 'blogBgImage' : 'heroBgImage';

      await cmsService.upsertSection(
        page as ICmsSection['page'],
        key,
        file.path,
        `${page} Background Image`,
        'image',
      );

      res.status(201).json({
        success: true,
        message: 'Background image uploaded and saved',
        data: {
          filename: file.filename,
          url:      file.path,
          path:     file.filename,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Delete image ────────────────────────────────────────────────────────────
  async deleteImage(req: Request, res: Response, next: NextFunction) {
    try {
      // For Cloudinary, :filename passed from frontend should ideally be the `public_id` 
      // (e.g. "regmi-plastic/products/filename"). Note slashes might be an issue in URL params.
      // Make sure the frontend encodes the public_id.
      let public_id = req.params.filename;

      // Handle query param `?id=public_id` as a fallback if slashes block standard req.params
      if (req.query.id) {
         public_id = req.query.id as string;
      }
      
      if (!public_id) throw new AppError('Invalid public_id', 400);

      await deleteImageFile(public_id);
      res.json({ success: true, message: 'Image deleted successfully' });
    } catch (err) { next(err); }
  }

  // ─── List images ─────────────────────────────────────────────────────────────
  async listImages(_req: Request, res: Response, next: NextFunction) {
    try {
        // Query Cloudinary Media Library for assets inside our specific folder prefix
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: 'regmi-plastic/products/', 
            max_results: 100 
        });

        const files = result.resources.map((obj: { public_id: string; secure_url: string; bytes: number; created_at: string }) => ({
          filename:   obj.public_id,
          url:        obj.secure_url,
          path:       obj.public_id, // Serves as the deletion key
          size:       obj.bytes,
          uploadedAt: obj.created_at,
        }))
        // Ensure reverse chronological
        .sort((a: { uploadedAt: string }, b: { uploadedAt: string }) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

      res.json({ success: true, data: files, total: files.length });
    } catch (err) { 
        console.error("Cloudinary List Error", err);
        next(err); 
    }
  }
}

export const uploadController = new UploadController();