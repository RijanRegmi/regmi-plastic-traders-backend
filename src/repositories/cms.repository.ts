import { CmsSection } from '../models/CmsSection.model';
import { ICmsSection } from '../types';

export class CmsRepository {
  async findByPage(page: ICmsSection['page']) {
    return CmsSection.find({ page }).lean();
  }

  async findAll() {
    return CmsSection.find().lean();
  }

  async findByKey(page: ICmsSection['page'], key: string) {
    return CmsSection.findOne({ page, key }).lean();
  }

  async upsert(page: ICmsSection['page'], key: string, data: Partial<ICmsSection>) {
    return CmsSection.findOneAndUpdate(
      { page, key },
      { ...data, page, key },
      { new: true, upsert: true, runValidators: true }
    ).lean();
  }

  async upsertMany(items: Partial<ICmsSection>[]) {
    const ops = items.map((item) => ({
      updateOne: {
        filter: { page: item.page, key: item.key },
        update: { $set: item },
        upsert: true,
      },
    }));
    return CmsSection.bulkWrite(ops);
  }

  async delete(id: string) {
    return CmsSection.findByIdAndDelete(id);
  }
}

export const cmsRepository = new CmsRepository();
