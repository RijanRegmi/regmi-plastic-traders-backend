import { productRepository } from '../repositories/product.repository';
import { NotFoundError } from '../errors/AppError';
import { IProduct } from '../types';

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
    const product = await productRepository.update(id, data);
    if (!product) throw new NotFoundError('Product');
    return product;
  }

  async delete(id: string) {
    const product = await productRepository.delete(id);
    if (!product) throw new NotFoundError('Product');
    return { message: 'Product deleted successfully' };
  }
}

export const productService = new ProductService();
