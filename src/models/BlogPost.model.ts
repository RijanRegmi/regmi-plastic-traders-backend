import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import { IBlogPost } from '../types';

const BlogPostSchema = new Schema<IBlogPost>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true },
    excerpt: { type: String, required: true },
    content: { type: String, required: true },
    coverImage: { type: String, default: '' },
    author: { type: String, default: 'Admin' },
    tags: [{ type: String }],
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ✅ async with no next parameter — works across all Mongoose versions
BlogPostSchema.pre('save', async function () {
  if (this.isModified('title') || this.isNew) {
    this.slug = slugify(this.title, { lower: true, strict: true }) + '-' + Date.now();
  }
});

export const BlogPost = mongoose.model<IBlogPost>('BlogPost', BlogPostSchema);