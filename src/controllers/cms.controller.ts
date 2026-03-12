import { Request, Response, NextFunction } from 'express';
import { cmsService } from '../services/cms.service';
import { ICmsSection } from '../types';

export class CmsController {
  async getPage(req: Request, res: Response, next: NextFunction) {
    try {
      const page = req.params.page as ICmsSection['page'];
      const content = await cmsService.getPageContent(page);
      res.json({ success: true, data: content });
    } catch (err) { next(err); }
  }

  async getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const content = await cmsService.getAllContent();
      res.json({ success: true, data: content });
    } catch (err) { next(err); }
  }

  async updatePage(req: Request, res: Response, next: NextFunction) {
    try {
      const page = req.params.page as ICmsSection['page'];
      const updates = req.body;
      await cmsService.updatePageSection(page, updates);
      res.json({ success: true, message: 'Page content updated successfully' });
    } catch (err) { next(err); }
  }

  async upsertSection(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, key } = req.params;
      const { value, label, type } = req.body;
      const section = await cmsService.upsertSection(
        page as ICmsSection['page'], key, value, label, type
      );
      res.json({ success: true, data: section, message: 'Section updated' });
    } catch (err) { next(err); }
  }
}

export const cmsController = new CmsController();
