import { v2 as cloudinary } from 'cloudinary';

// Cloudinary configuration is automatically picked up from the CLOUDINARY_URL environment variable.
// If it's not present, we can explicitly throw an error or handle it.
if (!process.env.CLOUDINARY_URL) {
  console.warn('⚠️ Missing CLOUDINARY_URL environment variable. Image uploads will fail.');
}

export default cloudinary;
