import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
    return;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    res.status(422).json({ success: false, message: err.message });
    return;
  }

  // Mongoose duplicate key
  if ((err as NodeJS.ErrnoException & { code?: number }).code === 11000) {
    res.status(409).json({ success: false, message: 'Duplicate value. Resource already exists.' });
    return;
  }

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    res.status(400).json({ success: false, message: 'Invalid ID format' });
    return;
  }

  console.error('--- Backend Error Handler ---');
  console.error('Name:', err.name);
  console.error('Message:', err.message);
  const cloudinaryErr = err as Error & { http_code?: number };
  if (cloudinaryErr.http_code) console.error('Cloudinary Code:', cloudinaryErr.http_code);
  console.error('Stack:', err.stack);
  
  res.status(500).json({ 
    success: false, 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV !== 'production' ? err : undefined 
  });
};

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: 'Route not found' });
};
