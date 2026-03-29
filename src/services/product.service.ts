import { productRepository } from '../repositories/product.repository';
import { NotFoundError } from '../errors/AppError';
import { IProduct } from '../types';
import { deleteByUrl } from '../middlewares/upload.middleware';

export class ProductService {
  async getAll(query: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    featured?: boolean;
    isActive?: boolean;
  }) {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.category) filter.category = query.category;
    if (query.featured !== undefined) filter.featured = query.featured;
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { description: { $regex: query.search, $options: 'i' } },
      ];
    }
    return productRepository.findAll(filter, { page: query.page || 1, limit: query.limit || 20 });
  }

  async getPublicProducts(query: { page?: number; limit?: number; category?: string; search?: string }) {
    return this.getAll({ ...query, isActive: true });
  }

  async getById(id: string) {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product');
    return product;
  }

  async getBySlug(slug: string) {
    const product = await productRepository.findBySlug(slug);
    if (!product) throw new NotFoundError('Product');
    return product;
  }

  async getFeatured() {
    return productRepository.findFeatured(6);
  }

  async getCategories() {
    return productRepository.getCategories();
  }

  async create(data: Partial<IProduct>) {
    return productRepository.create(data);
  }

  async update(id: string, data: Partial<IProduct>) {
    // ── Get old product for cleanup ──────────────────────────────────────────
    const oldProduct = await productRepository.findById(id);
    
    const product = await productRepository.update(id, data);
    if (!product) throw new NotFoundError('Product');

    // ── Clean up removed images ──────────────────────────────────────────────
    if (oldProduct && data.images) {
      const removed = oldProduct.images.filter((img) => !data.images?.includes(img));
      for (const imgUrl of removed) {
        await deleteByUrl(imgUrl);
      }
    }

    return product;
  }

  async delete(id: string) {
    const product = await productRepository.findById(id);
    if (!product) throw new NotFoundError('Product');

    // ── Clean up all images ─────────────────────────────────────────────────
    if (product.images?.length > 0) {
      for (const imgUrl of product.images) {
        await deleteByUrl(imgUrl);
      }
    }

    await productRepository.delete(id);
    return { message: 'Product deleted successfully' };
  }
}

export const productService = new ProductService();
