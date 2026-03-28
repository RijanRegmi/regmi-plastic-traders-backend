import { Request, Response, NextFunction } from 'express';
import { productService } from '../services/product.service';

export class ProductController {
  async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, category, search } = req.query;
      const result = await productService.getPublicProducts({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        category: category as string,
        search: search as string,
      });
      res.json({
        success: true,
        data: result.data,
        pagination: { total: result.total, page: result.page, limit: result.limit, pages: result.pages },
      });
    } catch (err) { next(err); }
  }

  async getFeatured(_req: Request, res: Response, next: NextFunction) {
    try {
      const products = await productService.getFeatured();
      res.json({ success: true, data: products });
    } catch (err) { next(err); }
  }

  async getCategories(_req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await productService.getCategories();
      res.json({ success: true, data: categories });
    } catch (err) { next(err); }
  }

  async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await productService.getBySlug(req.params.slug);
      res.json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await productService.getById(req.params.id);
      res.json({ success: true, data: product });
    } catch (err) { next(err); }
  }

  async adminGetAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, category, search } = req.query;
      const result = await productService.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        category: category as string,
        search: search as string,
      });
      res.json({
        success: true,
        data: result.data,
        pagination: { total: result.total, page: result.page, limit: result.limit, pages: result.pages },
      });
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await productService.create(req.body);
      res.status(201).json({ success: true, data: product, message: 'Product created successfully' });
    } catch (err) { next(err); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await productService.update(req.params.id, req.body);
      res.json({ success: true, data: product, message: 'Product updated successfully' });
    } catch (err) { next(err); }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await productService.delete(req.params.id);
      res.json({ success: true, message: result.message });
    } catch (err) { next(err); }
  }
}

export const productController = new ProductController();
