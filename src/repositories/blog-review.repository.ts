import { BlogPost } from '../models/BlogPost.model';
import { Review } from '../models/Review.model';
import { IBlogPost, IReview } from '../types';
import { QueryFilter, UpdateQuery } from 'mongoose';

export class BlogRepository {
  async findAll(filter: QueryFilter<IBlogPost> = {}, options: { page?: number; limit?: number } = {}) {
    const { page = 1, limit = 10 } = options;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      BlogPost.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BlogPost.countDocuments(filter),
    ]);
    return { data, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findBySlug(slug: string) {
    return BlogPost.findOne({ slug }).lean();
  }

  async findById(id: string) {
    return BlogPost.findById(id).lean();
  }

  async create(data: Partial<IBlogPost>) {
    return BlogPost.create(data);
  }

  async update(id: string, data: UpdateQuery<IBlogPost>) {
    return BlogPost.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  }

  async delete(id: string) {
    return BlogPost.findByIdAndDelete(id);
  }
}

export class ReviewRepository {
  async findActive() {
    return Review.find({ isActive: true }).sort({ createdAt: -1 }).lean();
  }

  async findAll() {
    return Review.find().sort({ createdAt: -1 }).lean();
  }

  async create(data: Partial<IReview>) {
    return Review.create(data);
  }

  async update(id: string, data: UpdateQuery<IReview>) {
    return Review.findByIdAndUpdate(id, data, { new: true }).lean();
  }

  async delete(id: string) {
    return Review.findByIdAndDelete(id);
  }

  async getAverageRating() {
    const result = await Review.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    return result[0] || { avgRating: 0, count: 0 };
  }
}

export const blogRepository = new BlogRepository();
export const reviewRepository = new ReviewRepository();
