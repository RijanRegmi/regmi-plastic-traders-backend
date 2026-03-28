import { Request, Response, NextFunction } from 'express';
import { authRepository } from '../repositories/auth.repository';
import { ConflictError, NotFoundError } from '../errors/AppError';

export class UserController {
  /** GET /admin/users — list all admin users */
  async getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await authRepository.findAll();
      res.json({ success: true, data: users });
    } catch (err) { next(err); }
  }

  /** POST /admin/users — create a new admin/user account */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, password, role } = req.body;
      const exists = await authRepository.existsByEmail(email);
      if (exists) throw new ConflictError('Email already registered');
      const user = await authRepository.create({
        name,
        email,
        password,
        role: role || 'admin',
      });
      res.status(201).json({
        success: true,
        data: { id: user._id, name: user.name, email: user.email, role: user.role },
        message: 'User created',
      });
    } catch (err) { next(err); }
  }

  /** PATCH /admin/users/:id — update user details */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, password, role } = req.body;
      const updated = await authRepository.update(req.params.id, {
        ...(name && { name }),
        ...(email && { email }),
        ...(password && { password }),
        ...(role && { role }),
      });
      if (!updated) throw new NotFoundError('User');
      res.json({ success: true, data: updated, message: 'User updated' });
    } catch (err) { next(err); }
  }

  /** DELETE /admin/users/:id — delete a user (cannot delete yourself) */
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = (req as Request & { user?: { id: string } }).user?.id;
      if (req.params.id === currentUserId) {
        res.status(400).json({ success: false, message: 'You cannot delete your own account' });
        return;
      }
      const deleted = await authRepository.delete(req.params.id);
      if (!deleted) throw new NotFoundError('User');
      res.json({ success: true, message: 'User deleted' });
    } catch (err) { next(err); }
  }
}

export const userController = new UserController();
