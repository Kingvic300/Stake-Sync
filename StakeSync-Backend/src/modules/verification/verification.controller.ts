import { Body, Controller, Get, Param, ParseFilePipeBuilder, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/auth.js';
import { ProofsService } from './proofs.service.js';

class PhotoDto {
  @IsString()
  challengeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class CameraDto {
  @IsString()
  challengeId: string;

  @IsInt()
  @Min(1)
  @Max(2000)
  reps: number;

  @IsInt()
  @Min(1)
  @Max(7200)
  durationSec: number;

  /** Joint angles sampled during the set (about 10 per second). */
  @IsArray()
  @ArrayMaxSize(80_000)
  @IsNumber({}, { each: true })
  angles: number[];

  @IsDateString()
  startedAt: string;
}

class HealthSample {
  @IsDateString()
  start: string;

  @IsDateString()
  end: string;

  @IsInt()
  @Min(0)
  steps: number;
}

class HealthDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  steps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distanceM?: number;

  @IsIn(['healthkit', 'health_connect'])
  source: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => HealthSample)
  samples?: HealthSample[];
}

const image = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp|heic)$/ })
  .addMaxSizeValidator({ maxSize: 12 * 1024 * 1024 })
  .build();

@Controller('verification')
export class VerificationController {
  constructor(private readonly proofs: ProofsService) {}

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('proofs/photo')
  @UseInterceptors(FileInterceptor('file'))
  photo(@CurrentUser() user: AuthUser, @Body() dto: PhotoDto, @UploadedFile(image) file: Express.Multer.File) {
    return this.proofs.submitPhoto(user.id, dto.challengeId, file.buffer, dto.note ?? '');
  }

  @Throttle({ default: { limit: 60, ttl: 3600_000 } })
  @Post('proofs/camera')
  camera(@CurrentUser() user: AuthUser, @Body() dto: CameraDto) {
    return this.proofs.submitCamera(user.id, dto.challengeId, dto);
  }

  /** Called by the mobile app after reading Apple Health or Health Connect. */
  @Throttle({ default: { limit: 60, ttl: 3600_000 } })
  @Post('health/sync')
  health(@CurrentUser() user: AuthUser, @Body() dto: HealthDto) {
    return this.proofs.syncHealth(user.id, dto);
  }

  @Get('proofs/:challengeId')
  mine(@CurrentUser() user: AuthUser, @Param('challengeId') challengeId: string) {
    return this.proofs.mine(user.id, challengeId);
  }

  @Get('proofs/file/:id')
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.proofs.file(id, { id: user.id, admin: Boolean(user.adminRole) });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(data);
  }
}
