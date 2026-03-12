import { blogRepository, reviewRepository } from '../repositories/blog-review.repository';
import { NotFoundError } from '../errors/AppError';
import { IBlogPost, IReview } from '../types';

export class BlogService {
  async getPublished(page = 1, limit = 10) {
    return blogRepository.findAll({ isPublished: true }, { page, limit });
  }

  async getAll(page = 1, limit = 10) {
    return blogRepository.findAll({}, { page, limit });
  }

  async getBySlug(slug: string) {
    const post = await blogRepository.findBySlug(slug);
    if (!post) throw new NotFoundError('Blog post');
    return post;
  }

  async getById(id: string) {
    const post = await blogRepository.findById(id);
    if (!post) throw new NotFoundError('Blog post');
    return post;
  }

  async create(data: Partial<IBlogPost>) {
    return blogRepository.create(data);
  }

  async update(id: string, data: Partial<IBlogPost>) {
    const post = await blogRepository.update(id, data);
    if (!post) throw new NotFoundError('Blog post');
    return post;
  }

  async delete(id: string) {
    const post = await blogRepository.delete(id);
    if (!post) throw new NotFoundError('Blog post');
    return { message: 'Post deleted' };
  }
}

export class ReviewService {
  async getActive() {
    return reviewRepository.findActive();
  }

  async getAll() {
    return reviewRepository.findAll();
  }

  async getStats() {
    return reviewRepository.getAverageRating();
  }

  async create(data: Partial<IReview>) {
    return reviewRepository.create(data);
  }

  async update(id: string, data: Partial<IReview>) {
    const review = await reviewRepository.update(id, data);
    if (!review) throw new NotFoundError('Review');
    return review;
  }

  async delete(id: string) {
    const review = await reviewRepository.delete(id);
    if (!review) throw new NotFoundError('Review');
    return { message: 'Review deleted' };
  }
}

export const blogService = new BlogService();
export const reviewService = new ReviewService();
