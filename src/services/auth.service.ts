import jwt from 'jsonwebtoken';
import { authRepository } from '../repositories/auth.repository';
import { UnauthorizedError, ConflictError } from '../errors/AppError';
import { JwtPayload } from '../types';

export class AuthService {
  private generateToken(payload: JwtPayload): string {
    return jwt.sign(payload, process.env.JWT_SECRET as string, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    } as jwt.SignOptions);
  }

  async login(email: string, password: string) {
    const user = await authRepository.findByEmail(email);
    if (!user) throw new UnauthorizedError('Invalid email or password');

    const isMatch = await user.comparePassword(password);
    if (!isMatch) throw new UnauthorizedError('Invalid email or password');

    const token = this.generateToken({ id: user._id.toString(), role: user.role });
    return {
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    };
  }

  async register(name: string, email: string, password: string) {
    const exists = await authRepository.existsByEmail(email);
    if (exists) throw new ConflictError('Email already registered');

    const user = await authRepository.create({ name, email, password, role: 'user' });
    const token = this.generateToken({ id: user._id.toString(), role: user.role });
    return {
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  }
}

export const authService = new AuthService();
