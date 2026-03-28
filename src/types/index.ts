import { Request } from 'express';
import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export interface JwtPayload {
  id: string;
  role: string;
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  price: number;
  originalPrice?: number;          // ← ADDED
  category: string;
  images: string[];
  darazLink: string;
  badge?: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  featured: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICmsSection extends Document {
  _id: Types.ObjectId;
  page: 'home' | 'products' | 'about' | 'contact' | 'blog' | 'global';
  key: string;
  value: string | object | string[];
  type: 'text' | 'richtext' | 'image' | 'json' | 'boolean';
  label: string;
  updatedAt: Date;
}

export interface IBlogPost extends Document {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  author: string;
  tags: string[];
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReview extends Document {
  _id: Types.ObjectId;
  name: string;
  avatar?: string;
  rating: number;
  text: string;
  platform: string;
  isActive: boolean;
  createdAt: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}