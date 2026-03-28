import { QueryFilter, UpdateQuery, SortOrder } from 'mongoose';
import { Message, IMessage } from '../models/Message.model';

export class MessageRepository {
  async findWithPagination(
    filter: QueryFilter<IMessage> = {},
    page: number = 1,
    limit: number = 20,
    sort: Record<string, SortOrder> = { createdAt: -1 }
  ) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Message.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Message.countDocuments(filter),
    ]);

    return { data, total };
  }

  async create(data: Partial<IMessage>) {
    return Message.create(data);
  }

  async update(id: string, data: UpdateQuery<IMessage>) {
    return Message.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  }

  async delete(id: string) {
    return Message.findByIdAndDelete(id);
  }
}

export const messageRepository = new MessageRepository();
