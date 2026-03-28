import { v2 as cloudinary } from 'cloudinary';

// Called once at startup — dotenv must be loaded before this runs
export function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });

  const { cloud_name, api_key } = cloudinary.config();
  if (!cloud_name || !api_key) {
    console.warn('⚠️  Cloudinary config missing — check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env');
  } else {
    console.log('✅ Cloudinary configured:', { cloud_name, api_key_set: true });
  }
}

export default cloudinary;