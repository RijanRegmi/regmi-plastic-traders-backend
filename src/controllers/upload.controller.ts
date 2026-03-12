import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import {
  getImageUrl,
  getBlogImageUrl,
  getLogoUrl,
  getBgImageUrl,
  deleteImageFile,
} from '../middlewares/upload.middleware';
import { cmsService } from '../services/cms.service';
import { blogService } from '../services/blog-review.service';
import { AppError } from '../errors/AppError';

export class UploadController {
  async uploadImages(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) throw new AppError('No files uploaded', 400);

      const uploaded = files.map((file) => ({
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
        url: getImageUrl(req, file.filename),
        path: `/uploads/${file.filename}`,
      }));

      res.status(201).json({
        success: true,
        message: `${files.length} file(s) uploaded successfully`,
        data: uploaded,
      });
    } catch (err) { next(err); }
  }

  async uploadSingle(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: getImageUrl(req, file.filename),
          path: `/uploads/${file.filename}`,
        },
      });
    } catch (err) { next(err); }
  }

  async uploadBlogImage(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const { id } = req.params;
      const coverImagePath = `/uploads/blog/${file.filename}`;

      const updatedPost = await blogService.update(id, { coverImage: coverImagePath } as any);

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded and saved',
        data: {
          filename: file.filename,
          url: getBlogImageUrl(req, file.filename),
          path: coverImagePath,
          post: updatedPost,
        },
      });
    } catch (err) { next(err); }
  }

  async uploadBlogImageTemp(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const coverImagePath = `/uploads/blog/${file.filename}`;

      res.status(201).json({
        success: true,
        message: 'Blog cover image uploaded',
        data: {
          filename: file.filename,
          url: getBlogImageUrl(req, file.filename),
          path: coverImagePath,
        },
      });
    } catch (err) { next(err); }
  }

  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const logoPath = `/uploads/logo/${file.filename}`;
      await cmsService.upsertSection('global', 'logoUrl', logoPath, 'Logo Image URL', 'image');

      res.status(201).json({
        success: true,
        message: 'Logo uploaded and saved',
        data: {
          filename: file.filename,
          url: getLogoUrl(req, file.filename),
          path: logoPath,
        },
      });
    } catch (err) { next(err); }
  }

  async uploadBackground(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file as Express.Multer.File;
      if (!file) throw new AppError('No file uploaded', 400);

      const bgPath = `/uploads/background/${file.filename}`;

      // Immediately persist to DB so the home page SSR picks it up on next load
      await cmsService.upsertSection('home', 'heroBgImage', bgPath, 'Hero Background Image', 'image');

      res.status(201).json({
        success: true,
        message: 'Background image uploaded and saved',
        data: {
          filename: file.filename,
          url: getBgImageUrl(req, file.filename),
          path: bgPath,
        },
      });
    } catch (err) { next(err); }
  }

  async deleteImage(req: Request, res: Response, next: NextFunction) {
    try {
      const { filename } = req.params;
      const safeName = path.basename(filename);
      if (safeName !== filename) throw new AppError('Invalid filename', 400);

      const filePath = path.join(process.cwd(), 'uploads', safeName);
      if (!fs.existsSync(filePath)) throw new AppError('File not found', 404);

      deleteImageFile(safeName);
      res.json({ success: true, message: 'Image deleted successfully' });
    } catch (err) { next(err); }
  }

  async listImages(req: Request, res: Response, next: NextFunction) {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        res.json({ success: true, data: [] });
        return;
      }

      const files = fs
        .readdirSync(uploadsDir)
        .filter((f) => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
        .map((filename) => {
          const stat = fs.statSync(path.join(uploadsDir, filename));
          return {
            filename,
            url: getImageUrl(req, filename),
            path: `/uploads/${filename}`,
            size: stat.size,
            uploadedAt: stat.mtime,
          };
        })
        .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

      res.json({ success: true, data: files, total: files.length });
    } catch (err) { next(err); }
  }
}

export const uploadController = new UploadController();