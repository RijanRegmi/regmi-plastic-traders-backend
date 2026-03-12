import { Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { AuthRequest } from '../types';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError';

export const protect = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.split(' ')[1];
    const payload = authService.verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
};

export const adminOnly = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  try {
    if (req.user?.role !== 'admin') {
      throw new ForbiddenError('Admin access required');
    }
    next();
  } catch (err) {
    next(err);
  }
};
