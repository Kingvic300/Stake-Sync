import { Body, Controller, Delete, Get, HttpCode, Param, ParseFilePipeBuilder, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, OptionalAuth, type AuthUser } from '../../common/auth.js';
import type { OrgKind, OrgPlan, OrgRole } from './entities/organization.entities.js';
import { OrganizationsService } from './organizations.service.js';

class CreateOrgDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsIn(['Community', 'University', 'Company', 'Brand'])
  kind: OrgKind;

  @IsString()
  @Length(10, 500)
  about: string;

  @IsOptional()
  @IsUrl()
  website?: string;

  @IsOptional()
  @IsIn(['Community', 'Organization', 'Sponsored campaign'])
  plan?: OrgPlan;
}

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  about?: string;

  @IsOptional()
  @IsUrl()
  website?: string;
}

class CodeDto {
  @IsString()
  @Length(4, 24)
  code: string;
}

class RoleDto {
  @IsIn(['Owner', 'Admin', 'Moderator', 'Member'])
  role: OrgRole;
}

class InviteDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  handles?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails?: string[];
}

class AnnounceDto {
  @IsString()
  @Length(2, 2000)
  body: string;

  @IsOptional()
  @IsString()
  challengeId?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

const image = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
  .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 })
  .build();

@Controller()
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @OptionalAuth()
  @Get('orgs')
  directory() {
    return this.orgs.directory();
  }

  @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  @Post('orgs')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrgDto) {
    return this.orgs.create(user.id, dto);
  }

  @Get('me/orgs')
  mine(@CurrentUser() user: AuthUser) {
    return this.orgs.mine(user.id);
  }

  @Post('orgs/join')
  join(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    return this.orgs.join(user.id, dto.code);
  }

  @OptionalAuth()
  @Get('orgs/:slug')
  get(@Param('slug') slug: string, @CurrentUser() user?: AuthUser) {
    return this.orgs.get(slug, user?.id);
  }

  @Patch('orgs/:slug')
  update(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(user.id, slug, dto);
  }

  @Post('orgs/:slug/avatar')
  @UseInterceptors(FileInterceptor('file'))
  avatar(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @UploadedFile(image) file: Express.Multer.File) {
    return this.orgs.setAvatar(user.id, slug, file.buffer);
  }

  @Post('orgs/:slug/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.leave(user.id, slug);
  }

  @Get('orgs/:slug/members')
  members(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.listMembers(user.id, slug);
  }

  @Patch('orgs/:slug/members/:handle')
  @HttpCode(204)
  role(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('handle') handle: string, @Body() dto: RoleDto) {
    return this.orgs.setRole(user.id, slug, handle, dto.role);
  }

  @Delete('orgs/:slug/members/:handle')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('handle') handle: string) {
    return this.orgs.removeMember(user.id, slug, handle);
  }

  @Post('orgs/:slug/invite-code')
  rotate(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.rotateInvite(user.id, slug);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('orgs/:slug/invitations')
  invite(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: InviteDto) {
    return this.orgs.invite(user.id, slug, dto.handles ?? [], dto.emails ?? []);
  }

  @Get('orgs/:slug/dashboard')
  dashboard(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.dashboard(user.id, slug);
  }

  @Get('orgs/:slug/announcements')
  announcements(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    return this.orgs.listAnnouncements(user.id, slug);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('orgs/:slug/announcements')
  announce(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: AnnounceDto) {
    return this.orgs.announce(user.id, slug, dto.body, dto.challengeId, dto.pinned ?? false);
  }

  @Get('orgs/:slug/challenges/:challengeId/export')
  async export(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Param('challengeId') challengeId: string, @Res() res: Response) {
    const file = await this.orgs.exportResults(user.id, slug, challengeId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }
}
