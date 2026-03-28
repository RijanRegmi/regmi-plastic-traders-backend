import mongoose, { Schema } from 'mongoose';
import slugify from 'slugify';
import { IProduct } from '../types';

const ProductSchema = new Schema<IProduct>(
  {
    name:          { type: String, required: true, trim: true },
    slug:          { type: String, unique: true },
    description:   { type: String, required: true },
    price:         { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: null },               // ← ADDED
    category:      { type: String, required: true, trim: true },
    images:        [{ type: String }],
    darazLink:     { type: String, required: true, trim: true },
    badge:         { type: String, trim: true, default: '' },
    rating:        { type: Number, default: 0, min: 0, max: 5 },
    reviewCount:   { type: Number, default: 0 },
    inStock:       { type: Boolean, default: true },
    featured:      { type: Boolean, default: false },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProductSchema.pre('save', async function () {
  if (this.isModified('name') || this.isNew) {
    this.slug = slugify(this.name, { lower: true, strict: true }) + '-' + Date.now();
  }
});

ProductSchema.index({ category: 1, isActive: 1 });
ProductSchema.index({ featured: 1, isActive: 1 });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);