import { Router } from 'express';
import { authController }           from '../controllers/auth.controller';
import { productController }        from '../controllers/product.controller';
import { cmsController }            from '../controllers/cms.controller';
import { blogController, reviewController } from '../controllers/blog-review.controller';
import { uploadController }         from '../controllers/upload.controller';
import { protect, adminOnly }       from '../middlewares/auth.middleware';
import { upload, blogImageUpload, logoUpload, bgUpload } from '../middlewares/upload.middleware';

const router = Router();

// ─── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/login',    (req, res, next) => authController.login(req, res, next));
router.post('/auth/register', (req, res, next) => authController.register(req, res, next));
router.get('/auth/me', protect, (req, res, next) => authController.me(req, res, next));

// ─── Public Products ───────────────────────────────────────────────────────────
router.get('/products',            (req, res, next) => productController.getAll(req, res, next));
router.get('/products/featured',   (req, res, next) => productController.getFeatured(req, res, next));
router.get('/products/categories', (req, res, next) => productController.getCategories(req, res, next));
router.get('/products/:slug',      (req, res, next) => productController.getBySlug(req, res, next));

// ─── Public CMS ────────────────────────────────────────────────────────────────
router.get('/cms',       (req, res, next) => cmsController.getAll(req, res, next));
router.get('/cms/:page', (req, res, next) => cmsController.getPage(req, res, next));

// ─── Public Blog ───────────────────────────────────────────────────────────────
router.get('/blog',       (req, res, next) => blogController.getPublished(req, res, next));
router.get('/blog/:slug', (req, res, next) => blogController.getBySlug(req, res, next));

// ─── Public Reviews ────────────────────────────────────────────────────────────
router.get('/reviews', (req, res, next) => reviewController.getActive(req, res, next));

// ─── Admin (protected) ────────────────────────────────────────────────────────
router.use('/admin', protect, adminOnly);

// Admin Products
router.get   ('/admin/products',       (req, res, next) => productController.adminGetAll(req, res, next));
router.post  ('/admin/products',       (req, res, next) => productController.create(req, res, next));
router.put   ('/admin/products/:id',   (req, res, next) => productController.update(req, res, next));
router.delete('/admin/products/:id',   (req, res, next) => productController.delete(req, res, next));

// Admin CMS
router.put('/admin/cms/:page',      (req, res, next) => cmsController.updatePage(req, res, next));
router.put('/admin/cms/:page/:key', (req, res, next) => cmsController.upsertSection(req, res, next));

// Admin Blog
router.get   ('/admin/blog',       (req, res, next) => blogController.adminGetAll(req, res, next));
router.post  ('/admin/blog',       (req, res, next) => blogController.create(req, res, next));
router.put   ('/admin/blog/:id',   (req, res, next) => blogController.update(req, res, next));
router.delete('/admin/blog/:id',   (req, res, next) => blogController.delete(req, res, next));

// Admin Reviews
router.get   ('/admin/reviews',       (req, res, next) => reviewController.adminGetAll(req, res, next));
router.post  ('/admin/reviews',       (req, res, next) => reviewController.create(req, res, next));
router.put   ('/admin/reviews/:id',   (req, res, next) => reviewController.update(req, res, next));
router.delete('/admin/reviews/:id',   (req, res, next) => reviewController.delete(req, res, next));

// Admin Image Uploads
router.get   ('/admin/upload',         (req, res, next) => uploadController.listImages(req, res, next));
router.post  ('/admin/upload',          upload.array('images', 5), (req, res, next) => uploadController.uploadImages(req, res, next));
router.post  ('/admin/upload/single',   upload.single('image'),    (req, res, next) => uploadController.uploadSingle(req, res, next));
router.delete('/admin/upload/:filename',(req, res, next) => uploadController.deleteImage(req, res, next));

// Admin Logo Upload
router.post('/admin/upload/logo', logoUpload.single('logo'), (req, res, next) => uploadController.uploadLogo(req, res, next));

// Admin Hero Background Upload  ← NEW
// Must be declared BEFORE /blog-temp and /blog/:id so Express doesn't conflict
router.post('/admin/upload/background', bgUpload.single('background'), (req, res, next) => uploadController.uploadBackground(req, res, next));

// Admin Blog Image Upload
// NOTE: /blog-temp must come BEFORE /blog/:id
router.post('/admin/upload/blog-temp', blogImageUpload.single('coverImage'), (req, res, next) => uploadController.uploadBlogImageTemp(req, res, next));
router.post('/admin/upload/blog/:id',  blogImageUpload.single('coverImage'), (req, res, next) => uploadController.uploadBlogImage(req, res, next));

export default router;