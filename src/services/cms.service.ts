import { cmsRepository } from '../repositories/cms.repository';
import { ICmsSection } from '../types';

export class CmsService {
  async getPageContent(page: ICmsSection['page']) {
    const sections = await cmsRepository.findByPage(page);
    return sections.reduce<Record<string, unknown>>((acc, section) => {
      acc[section.key] = section.value;
      return acc;
    }, {});
  }

  async getAllContent() {
    const sections = await cmsRepository.findAll();
    return sections.reduce<Record<string, Record<string, unknown>>>((acc, section) => {
      if (!acc[section.page]) acc[section.page] = {};
      acc[section.page][section.key] = section.value;
      return acc;
    }, {});
  }

  async upsertSection(
    page: ICmsSection['page'],
    key: string,
    value: ICmsSection['value'],
    label: string,
    type: ICmsSection['type'] = 'text'
  ) {
    return cmsRepository.upsert(page, key, { value, label, type });
  }

  async bulkUpdate(items: Partial<ICmsSection>[]) {
    return cmsRepository.upsertMany(items);
  }

  async updatePageSection(
    page: ICmsSection['page'],
    updates: Record<string, { value: unknown; label?: string; type?: ICmsSection['type'] }>
  ) {
    const items = Object.entries(updates).map(([key, meta]) => ({
      page,
      key,
      value: meta.value as ICmsSection['value'],
      label: meta.label || key,
      type: meta.type || ('text' as ICmsSection['type']),
    }));
    return cmsRepository.upsertMany(items);
  }
}

export const cmsService = new CmsService();
