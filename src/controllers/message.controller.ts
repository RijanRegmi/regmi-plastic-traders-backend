import { Request, Response, NextFunction } from 'express';
import { messageRepository } from '../repositories/message.repository';
import nodemailer from 'nodemailer';

// Configure a basic transporter that works if env vars are present
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export class MessageController {
  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      
      const { data, total } = await messageRepository.findWithPagination(
        {},
        page,
        limit,
        { createdAt: 'desc' }
      );
      
      res.json({ 
        success: true, 
        data,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const message = await messageRepository.create(req.body);

      // Attempt to send email passively if SMTP is configured
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        transporter.sendMail({
          from: `"Regmi Plastic CMS" <${process.env.SMTP_USER}>`,
          to: process.env.SMTP_USER, 
          subject: `New Contact Form Message from ${message.name}`,
          text: `You have received a new message through the website contact form.\n\nName: ${message.name}\nContact: ${message.contact}\n\nMessage:\n${message.message}`,
        }).catch(err => console.error("Email dispatch failed:", err));
      }

      res.status(201).json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  }

  async updateMessageStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const message = await messageRepository.update(req.params.id, { isRead: req.body.isRead });
      if (!message) {
        return res.status(404).json({ success: false, message: 'Message not found' });
      }
      res.json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  }

  async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      await messageRepository.delete(req.params.id);
      res.json({ success: true, message: 'Message deleted' });
    } catch (err) {
      next(err);
    }
  }
}

export const messageController = new MessageController();
