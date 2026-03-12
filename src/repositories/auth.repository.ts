import { User } from '../models/User.model';
import { IUser } from '../types';

export class AuthRepository {
  async findByEmail(email: string) {
    return User.findOne({ email }).select('+password');
  }

  async findById(id: string) {
    return User.findById(id);
  }

  async create(data: Partial<IUser>) {
    return User.create(data);
  }

  async existsByEmail(email: string) {
    return User.exists({ email });
  }
}

export const authRepository = new AuthRepository();
