import { Request, Response, NextFunction } from 'express';
import { blogService, reviewService } from '../services/blog-review.service';

export class BlogController {
  async getPublished(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = req.query;
      const result = await blogService.getPublished(Number(page) || 1, Number(limit) || 10);
      res.json({ success: true, data: result.data, pagination: result });
    } catch (err) { next(err); }
  }

  async adminGetAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await blogService.getAll(Number(req.query.page) || 1, Number(req.query.limit) || 10);
      res.json({ success: true, data: result.data, pagination: result });
    } catch (err) { next(err); }
  }

  async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const post = await blogService.getBySlug(req.params.slug);
      res.json({ success: true, data: post });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const post = await blogService.create(req.body);
      res.status(201).json({ success: true, data: post, message: 'Post created' });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const post = await blogService.update(req.params.id, req.body);
      res.json({ success: true, data: post, message: 'Post updated' });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await blogService.delete(req.params.id);
      res.json({ success: true, message: result.message });
    } catch (err) { next(err); }
  }
}

export class ReviewController {
  async getActive(_req: Request, res: Response, next: NextFunction) {
    try {
      const reviews = await reviewService.getActive();
      const stats = await reviewService.getStats();
      res.json({ success: true, data: reviews, stats });
    } catch (err) { next(err); }
  }

  async adminGetAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const reviews = await reviewService.getAll();
      res.json({ success: true, data: reviews });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const review = await reviewService.create(req.body);
      res.status(201).json({ success: true, data: review, message: 'Review created' });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const review = await reviewService.update(req.params.id, req.body);
      res.json({ success: true, data: review });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await reviewService.delete(req.params.id);
      res.json({ success: true, message: result.message });
    } catch (err) { next(err); }
  }
}

export const blogController = new BlogController();
export const reviewController = new ReviewController();
