import { FilterQuery, UpdateQuery } from 'mongoose';
import { Product } from '../models/Product.model';
import { IProduct } from '../types';

export class ProductRepository {
  async findAll(
    filter: FilterQuery<IProduct> = {},
    options: { page?: number; limit?: number; sort?: object } = {}
  ) {
    const { page = 1, limit = 20, sort = { createdAt: -1 } } = options;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Product.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);

    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    return Product.findById(id).lean();
  }

  async findBySlug(slug: string) {
    return Product.findOne({ slug }).lean();
  }

  async findFeatured(limit = 6) {
    return Product.find({ featured: true, isActive: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async findByCategory(category: string) {
    return Product.find({ category, isActive: true }).lean();
  }

  async create(data: Partial<IProduct>) {
    return Product.create(data);
  }

  async update(id: string, data: UpdateQuery<IProduct>) {
    return Product.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  }

  async delete(id: string) {
    return Product.findByIdAndDelete(id);
  }

  async getCategories() {
    return Product.distinct('category', { isActive: true });
  }
}

export const productRepository = new ProductRepository();
