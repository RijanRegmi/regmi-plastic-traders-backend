import mongoose, { Schema } from 'mongoose';
import { ICmsSection } from '../types';

const CmsSectionSchema = new Schema<ICmsSection>(
  {
    page: {
      type: String,
      required: true,
      enum: ['home', 'products', 'about', 'contact', 'blog', 'global', 'seo'],
    },
    key: { type: String, required: true, trim: true },
    value: { type: Schema.Types.Mixed, required: true },
    type: {
      type: String,
      enum: ['text', 'richtext', 'image', 'json', 'boolean'],
      default: 'text',
    },
    label: { type: String, required: true },
  },
  { timestamps: true }
);

CmsSectionSchema.index({ page: 1, key: 1 }, { unique: true });

export const CmsSection = mongoose.model<ICmsSection>('CmsSection', CmsSectionSchema);
