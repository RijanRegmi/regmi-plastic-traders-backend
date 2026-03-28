import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/database';
import { User } from '../models/User.model';
import { Product } from '../models/Product.model';
import { CmsSection } from '../models/CmsSection.model';
import { Review } from '../models/Review.model';
import { BlogPost } from '../models/BlogPost.model';

const seed = async () => {
  await connectDB();
  console.log('🌱 Seeding database...');

  // Clear collections
  await Promise.all([
    User.deleteMany({}),
    Product.deleteMany({}),
    CmsSection.deleteMany({}),
    Review.deleteMany({}),
    BlogPost.deleteMany({}),
  ]);

  // ✅ Drop the slug index to clear any null slug conflicts
  try {
    await mongoose.connection.collection('products').dropIndex('slug_1');
    console.log('🗑️ Dropped old slug index');
  } catch {
    // Index might not exist, that's fine
  }

  // Admin user
  await User.create({
    name: 'Admin',
    email: 'admin@regmiplastic',
    password: 'admin123',
    role: 'admin',
  });
  console.log('✅ Admin user: admin@regmiplastic / admin123');

  // ✅ Use .save() instead of insertMany so pre-save hook runs and generates slugs
  const products = [
    { name: 'Heavy Duty Storage Box 50L', description: 'Large 50L heavy-duty storage box. Perfect for homes and offices. UV resistant.', price: 450, category: 'Storage', images: [], darazLink: 'https://www.daraz.com.np/', badge: 'Best Seller', rating: 4.8, reviewCount: 120, featured: true, inStock: true, isActive: true },
    { name: 'Premium Water Bucket 10L', description: '10L premium water bucket with sturdy handle and lid. Food-grade plastic.', price: 180, category: 'Household', images: [], darazLink: 'https://www.daraz.com.np/', badge: 'Popular', rating: 4.6, reviewCount: 88, featured: true, inStock: true, isActive: true },
    { name: 'Stackable Drawer Set 3-Tier', description: '3-tier stackable plastic drawer set. Great for bedroom or office organization.', price: 1200, category: 'Storage', images: [], darazLink: 'https://www.daraz.com.np/', badge: 'New', rating: 4.9, reviewCount: 55, featured: true, inStock: true, isActive: true },
    { name: 'Garden Watering Can 5L', description: '5L plastic watering can with a long spout for easy and precise watering.', price: 320, category: 'Garden', images: [], darazLink: 'https://www.daraz.com.np/', badge: '', rating: 4.5, reviewCount: 42, featured: false, inStock: true, isActive: true },
    { name: 'Food Storage Container Set 6pcs', description: 'Set of 6 airtight BPA-free food storage containers. Microwave safe.', price: 650, category: 'Kitchen', images: [], darazLink: 'https://www.daraz.com.np/', badge: 'Top Rated', rating: 5.0, reviewCount: 200, featured: true, inStock: true, isActive: true },
    { name: 'Industrial Drum 200L', description: '200L heavy-duty industrial plastic drum for chemical and water storage.', price: 3500, category: 'Industrial', images: [], darazLink: 'https://www.daraz.com.np/', badge: '', rating: 4.7, reviewCount: 30, featured: false, inStock: true, isActive: true },
  ];

  for (const p of products) {
    await new Product(p).save();
  }
  console.log('✅ Products seeded');

  // CMS
  await CmsSection.insertMany([
    { page: 'global', key: 'storeName', value: 'Regmi Plastic Traders', label: 'Store Name', type: 'text' },
    { page: 'global', key: 'tagline', value: 'Quality Plastic Products for Every Home', label: 'Tagline', type: 'text' },
    { page: 'global', key: 'phone', value: '+977-9841234567', label: 'Phone', type: 'text' },
    { page: 'global', key: 'email', value: 'info@regmiplastic.com', label: 'Email', type: 'text' },
    { page: 'global', key: 'address', value: 'Kathmandu, Nepal', label: 'Address', type: 'text' },
    { page: 'home', key: 'heroTitle', value: "Nepal's Most Trusted Plastic Goods Store", label: 'Hero Title', type: 'text' },
    { page: 'home', key: 'heroSubtitle', value: 'Durable, affordable, and high-quality plastic products delivered to your doorstep.', label: 'Hero Subtitle', type: 'text' },
    { page: 'home', key: 'heroButtonText', value: 'Shop Now', label: 'Hero Button Text', type: 'text' },
    { page: 'home', key: 'aboutText', value: 'Regmi Plastic Traders has been serving Nepal since 2005. We specialize in high-quality plastic household items, industrial containers, storage solutions, and more.', label: 'About Text', type: 'richtext' },
    { page: 'home', key: 'stats', value: [{ label: 'Happy Customers', value: '15,000+' }, { label: 'Products Available', value: '500+' }, { label: 'Years of Experience', value: '19+' }, { label: 'Cities Served', value: '50+' }], label: 'Stats', type: 'json' },
    { page: 'products', key: 'pageTitle', value: 'Our Products', label: 'Page Title', type: 'text' },
    { page: 'products', key: 'pageSubtitle', value: 'Quality plastic products — click to buy on Daraz', label: 'Page Subtitle', type: 'text' },
    { page: 'about', key: 'title', value: 'About Regmi Plastic Traders', label: 'About Title', type: 'text' },
    { page: 'about', key: 'content', value: "Founded in 2005, Regmi Plastic Traders is one of Nepal's most trusted plastic product suppliers.", label: 'About Content', type: 'richtext' },
  ]);
  console.log('✅ CMS seeded');

  // Reviews
  await Review.insertMany([
    { name: 'Sita Sharma', rating: 5, text: 'Best plastic products in Kathmandu! Very durable and affordable.', platform: 'Google', isActive: true },
    { name: 'Ram Bahadur', rating: 5, text: 'Excellent service and fast delivery. Will order again!', platform: 'Google', isActive: true },
    { name: 'Priya Thapa', rating: 4, text: 'Good quality items. The storage boxes are perfect for my kitchen.', platform: 'Google', isActive: true },
    { name: 'Bikash Rai', rating: 5, text: 'Industrial drums are top quality. Great for our factory.', platform: 'Google', isActive: true },
  ]);
  console.log('✅ Reviews seeded');

  const blogPosts = [
    { title: 'Top 5 Storage Solutions for 2025', excerpt: 'Discover the best plastic storage solutions for your home this year.', content: '<p>Full blog content here...</p>', author: 'Admin', tags: ['storage', 'home'], isPublished: true },
    { title: 'How to Choose Quality Plastic Products', excerpt: 'A guide to identifying durable and safe plastic products.', content: '<p>Full blog content here...</p>', author: 'Admin', tags: ['guide', 'quality'], isPublished: true },
  ];

  for (const b of blogPosts) {
    await new BlogPost(b).save();
  }
  console.log('✅ Blog posts seeded');

  console.log('\n🎉 Database seeded successfully!');
  console.log('📧 Login: admin@regmiplastic.com');
  console.log('🔑 Password: admin123');
  await mongoose.disconnect();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});