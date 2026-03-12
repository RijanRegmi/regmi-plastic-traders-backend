import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, email, password } = req.body;
      const result = await authService.register(name, email, password);
      res.status(201).json({ success: true, data: result });
    } catch (err) { next(err); }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: (req as any).user });
    } catch (err) { next(err); }
  }
}

export const authController = new AuthController();
