import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import { StorageService } from './storage.service.js';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

/** Serves public uploads (banners, avatars) when using local storage. Proof files go through their own endpoints. */
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('public/*path')
  async get(@Param('path') path: string | string[], @Res() res: Response) {
    const key = `public/${Array.isArray(path) ? path.join('/') : path}`;
    try {
      const data = await this.storage.get(key);
      res.setHeader('Content-Type', TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(data);
    } catch {
      throw notFound('file');
    }
  }
}
