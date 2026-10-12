import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, Length, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/auth.js';
import { AppError } from '../../common/errors.js';
import { SignatureDto } from '../challenges/dto/challenge.dto.js';
import { DisputesService } from './disputes.service.js';

/** Multipart sends everything as strings; links may arrive as one value or many. */
const toArray = ({ value }: { value: unknown }) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

class OpenDisputeDto {
  @IsString()
  challengeId: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  day: number;

  @IsString()
  @Length(10, 1000, { message: 'Tell us what happened in at least a sentence.' })
  reason: string;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  links?: string[];
}

class EvidenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  links?: string[];
}

const images = FilesInterceptor('images', 4, {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(jpeg|png|webp|heic)$/.test(file.mimetype) ? cb(null, true) : cb(new AppError('invalid_file', 'Upload JPEG, PNG, WebP or HEIC images.'), false),
});

@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.disputes.mine(user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post()
  @UseInterceptors(images)
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenDisputeDto, @UploadedFiles() files: Express.Multer.File[] = []) {
    return this.disputes.open(user.id, dto.challengeId, dto.day, dto.reason, dto.links ?? [], files.map((f) => f.buffer));
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignatureDto) {
    return this.disputes.confirmOpen(user.id, id, dto.signature);
  }

  @Post(':id/evidence')
  @UseInterceptors(images)
  evidence(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EvidenceDto, @UploadedFiles() files: Express.Multer.File[] = []) {
    return this.disputes.addEvidence(user.id, id, dto.note ?? '', dto.links ?? [], files.map((f) => f.buffer));
  }

  @Get(':id/evidence/:index')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number, @Res() res: Response) {
    const data = await this.disputes.evidenceFile(id, index, { id: user.id, admin: Boolean(user.adminRole) });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(data);
  }
}
