import mongoose, { Schema } from 'mongoose';
import { IReview } from '../types';

const ReviewSchema = new Schema<IReview>(
  {
    name: { type: String, required: true, trim: true },
    avatar: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true },
    platform: { type: String, default: 'Google' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Review = mongoose.model<IReview>('Review', ReviewSchema);
