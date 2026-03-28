import { Request, Response, NextFunction } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { uploadToCloudinary, deleteImageFile } from '../middlewares/upload.middleware';
import { cmsService } from '../services/cms.service';
import { blogService } from '../services/blog-review.service';
import { AppError } from '../errors/AppError';
import { ICmsSection, IBlogPost } from '../types';

export class UploadController {
  // ─── Product images (up to 5) ───────────────────────────────────────────────
  async uploadImages(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) throw new AppError('No files uploaded', 400);

      const uploaded = await Promise.all(
        files.map(async (file) => {
          const result = await uploadToCloudinary(file.buffer, 'products');
          return {
            filename:     result.public_id,
            originalName: file.originalname,
            size:         file.size,
            mimetype:     file.mimetype,
            url:          result.secure_url,
            path:         result.public_id,
          };
        }),
      );

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
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const result = await uploadToCloudinary(file.buffer, 'products');

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          filename:     result.public_id,
          originalName: file.originalname,
          size:         file.size,
          mimetype:     file.mimetype,
          url:          result.secure_url,
          path:         result.public_id,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Blog cover image (attached to an existing post) ────────────────────────
  async uploadBlogImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const result = await uploadToCloudinary(file.buffer, 'blog');
      const { id } = req.params;
      const updatedPost = await blogService.update(id, { coverImage: result.secure_url } as Partial<IBlogPost>);

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded and saved',
        data: {
          filename: result.public_id,
          url:      result.secure_url,
          path:     result.public_id,
          post:     updatedPost,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Blog cover image (temp — no post ID yet) ────────────────────────────────
  async uploadBlogImageTemp(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const result = await uploadToCloudinary(file.buffer, 'blog');

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded',
        data: {
          filename: result.public_id,
          url:      result.secure_url,
          path:     result.public_id,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Logo ────────────────────────────────────────────────────────────────────
  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const result = await uploadToCloudinary(file.buffer, 'logo');

      // Persist the Cloudinary public URL so it's globally available
      await cmsService.upsertSection('global', 'logoUrl', result.secure_url, 'Logo Image URL', 'image');

      res.status(201).json({
        success: true,
        message: 'Logo uploaded and saved',
        data: {
          filename: result.public_id,
          url:      result.secure_url,
          path:     result.public_id,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Dynamic background ──────────────────────────────────────────────────────
  async uploadBackground(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const page   = req.params.page || 'home';
      const folder = page === 'about' ? 'about' : page === 'blog' ? 'blog' : 'background';
      const key    = page === 'about' ? 'aboutBgImage' : page === 'blog' ? 'blogBgImage' : 'heroBgImage';

      const result = await uploadToCloudinary(file.buffer, folder);

      await cmsService.upsertSection(
        page as ICmsSection['page'],
        key,
        result.secure_url,
        `${page} Background Image`,
        'image',
      );

      res.status(201).json({
        success: true,
        message: 'Background image uploaded and saved',
        data: {
          filename: result.public_id,
          url:      result.secure_url,
          path:     result.public_id,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Delete image ────────────────────────────────────────────────────────────
  async deleteImage(req: Request, res: Response, next: NextFunction) {
    try {
      let public_id = req.params.filename;
      if (req.query.id) public_id = req.query.id as string;
      if (!public_id) throw new AppError('Invalid public_id', 400);

      await deleteImageFile(public_id);
      res.json({ success: true, message: 'Image deleted successfully' });
    } catch (err) { next(err); }
  }

  // ─── List images ─────────────────────────────────────────────────────────────
  async listImages(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        prefix: 'regmi-plastic/products/',
        max_results: 100,
      });

      const files = result.resources
        .map((obj: { public_id: string; secure_url: string; bytes: number; created_at: string }) => ({
          filename:   obj.public_id,
          url:        obj.secure_url,
          path:       obj.public_id,
          size:       obj.bytes,
          uploadedAt: obj.created_at,
        }))
        .sort((a: { uploadedAt: string }, b: { uploadedAt: string }) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        );

      res.json({ success: true, data: files, total: files.length });
    } catch (err) {
      console.error('Cloudinary List Error', err);
      next(err);
    }
  }
}

export const uploadController = new UploadController();