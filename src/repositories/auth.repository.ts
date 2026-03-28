import { User } from '../models/User.model';
import { IUser } from '../types';
import bcrypt from 'bcryptjs';

export class AuthRepository {
  async findByEmail(email: string) {
    return User.findOne({ email }).select('+password');
  }

  async findById(id: string) {
    return User.findById(id);
  }

  async findAll() {
    return User.find().select('-password').sort({ createdAt: -1 }).lean();
  }

  async create(data: Partial<IUser>) {
    return User.create(data);
  }

  async update(id: string, data: Partial<IUser> & { password?: string }) {
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    return User.findByIdAndUpdate(id, data, { new: true, runValidators: true }).select('-password').lean();
  }

  async delete(id: string) {
    return User.findByIdAndDelete(id);
  }

  async existsByEmail(email: string) {
    return User.exists({ email });
  }
}

export const authRepository = new AuthRepository();
