import { Body, Controller, Delete, Get, HttpCode, Param, ParseFilePipeBuilder, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsString, Length, MaxLength } from 'class-validator';
import { CurrentUser, OptionalAuth, type AuthUser } from '../../common/auth.js';
import { ChallengesService } from './challenges.service.js';
import { CreateChallengeDto, FreezeDto, JoinDto, ListChallengesQuery, SignatureDto, UpdateChallengeDto } from './dto/challenge.dto.js';
import { ParticipationService } from './participation.service.js';

class InviteUsersDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  handles: string[];
}

class CancelDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

const image = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp|heic)$/ })
  .addMaxSizeValidator({ maxSize: 8 * 1024 * 1024 })
  .build();

@Controller()
export class ChallengesController {
  constructor(
    private readonly challenges: ChallengesService,
    private readonly participation: ParticipationService,
  ) {}

  @OptionalAuth()
  @Get('challenges')
  list(@Query() q: ListChallengesQuery, @CurrentUser() user?: AuthUser) {
    return this.challenges.list(q, user?.id);
  }

  @OptionalAuth()
  @Get('challenges/discover')
  discover(@CurrentUser() user?: AuthUser) {
    return this.challenges.discover(user?.id);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('challenges')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateChallengeDto) {
    return this.challenges.create(user.id, dto);
  }

  @OptionalAuth()
  @Get('challenges/:id')
  get(@Param('id') id: string, @Query('code') code: string | undefined, @CurrentUser() user?: AuthUser) {
    return this.challenges.detail(id, user?.id, code);
  }

  /** The exact rules document to accept before staking, and its hash. */
  @OptionalAuth()
  @Get('challenges/:id/rules')
  rules(@Param('id') id: string, @Query('code') code: string | undefined, @CurrentUser() user?: AuthUser) {
    return this.challenges.rulesFor(id, user?.id, code);
  }

  @Get('challenges/:id/requirements')
  async requirements(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('code') code?: string) {
    const c = await this.challenges.visible(id, user.id, code);
    return { missing: await this.participation.requirements(c, user.id) };
  }

  @OptionalAuth()
  @Get('challenges/:id/today')
  today(@Param('id') id: string, @Query('code') code: string | undefined, @CurrentUser() user?: AuthUser) {
    return this.challenges.todayProblems(id, user?.id, code);
  }

  @OptionalAuth()
  @Get('challenges/:id/leaderboard')
  leaderboard(@Param('id') id: string, @Query('code') code: string | undefined, @CurrentUser() user?: AuthUser) {
    return this.challenges.leaderboard(id, user?.id, code);
  }

  @Get('challenges/:id/participants')
  participants(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.challenges.participantsFor(id, user.id);
  }

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('challenges/:id/invitations')
  inviteUsers(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: InviteUsersDto) {
    return this.challenges.inviteUsers(user.id, id, dto.handles);
  }

  /** Full edit of every setting, only while nobody has joined. */
  @Patch('challenges/:id/settings')
  edit(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateChallengeDto) {
    return this.challenges.edit(user.id, id, dto);
  }

  @Patch('challenges/:id')
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateChallengeDto) {
    return this.challenges.update(user.id, id, dto);
  }

  @Post('challenges/:id/banner')
  @UseInterceptors(FileInterceptor('file'))
  banner(@Param('id') id: string, @CurrentUser() user: AuthUser, @UploadedFile(image) file: Express.Multer.File) {
    return this.challenges.setBanner(user.id, id, file.buffer);
  }

  @Post('challenges/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: CancelDto) {
    return this.challenges.cancel(user.id, id, dto.reason);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('challenges/:id/join')
  join(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: JoinDto) {
    return this.participation.join(user.id, id, dto);
  }

  @Post('challenges/:id/join/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SignatureDto) {
    return this.participation.confirmJoin(user.id, id, dto.signature);
  }

  /** The person backed out before signing. */
  @Delete('challenges/:id/join')
  @HttpCode(204)
  abandon(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.participation.abandonJoin(user.id, id);
  }

  @Get('challenges/:id/progress')
  progress(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.participation.progress(user.id, id);
  }

  @Post('challenges/:id/freeze')
  freeze(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: FreezeDto) {
    return this.participation.freeze(user.id, id, dto.day);
  }

  @Post('challenges/:id/freeze/confirm')
  confirmFreeze(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SignatureDto) {
    return this.participation.confirmFreeze(user.id, id, dto.signature);
  }

  @Get('me/challenges')
  mine(@CurrentUser() user: AuthUser) {
    return this.participation.mine(user.id);
  }

  @OptionalAuth()
  @Get('invites/:code')
  invite(@Param('code') code: string) {
    return this.challenges.resolveInvite(code);
  }
}
