import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { Admin, ADMIN_ROLES, CurrentUser, Public, type AdminRole, type AuthUser } from '../../common/auth.js';
import { USDC } from '../../common/money.js';
import { PROVIDERS, type ProviderKey } from '../challenges/entities/challenge.entities.js';
import { ChallengesService } from '../challenges/challenges.service.js';
import { CommunityService } from '../community/community.service.js';
import { DisputesService } from '../disputes/disputes.service.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { ProofsService } from '../verification/proofs.service.js';
import { ProviderHealthService } from '../verification/provider-health.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { AdminLogsService } from './admin-logs.service.js';
import { AdminService } from './admin.service.js';
import { ApprovalsService } from './approvals.service.js';

/** Confirming a failure that locks more than this needs a second admin. */
const FOUR_EYES_OVER = 50n * USDC;

class ReasonDto {
  @IsString()
  @Length(3, 1000, { message: 'Add a short reason. It goes in the audit log.' })
  reason: string;
}

class DecideDto extends ReasonDto {
  @IsBoolean()
  approve: boolean;
}

class ApproveDto {
  @IsBoolean()
  approve: boolean;
}

class DisputeDecisionDto extends ReasonDto {
  @IsBoolean()
  upheld: boolean;
}

class EvidenceRequestDto {
  @IsString()
  @Length(3, 1000)
  message: string;
}

class RiskDto extends ReasonDto {
  @IsIn(['watching', 'cleared', 'restricted'])
  status: 'watching' | 'cleared' | 'restricted';
}

class ReportActionDto extends ReasonDto {
  @IsIn(['dismiss', 'remove', 'mute'])
  action: 'dismiss' | 'remove' | 'mute';
}

class OutageDto extends ReasonDto {
  @IsIn(PROVIDERS)
  provider: ProviderKey;

  @IsDateString()
  from: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

class TeamDto extends ReasonDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn([...ADMIN_ROLES, null])
  role: AdminRole | null;
}

class BannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  text: string | null;
}

class StructureDto {
  @IsString()
  @Length(2, 20)
  key: string;

  @IsString()
  @Length(2, 30)
  name: string;

  @IsInt()
  @Min(0)
  @Max(10)
  freeStrikes: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(50, { each: true })
  penalties: [number, number, number];

  @IsString()
  @MaxLength(120)
  note: string;
}

class StructuresDto extends ReasonDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => StructureDto)
  structures: StructureDto[];
}

class LogQueryDto {
  @IsOptional()
  @IsIn(['request', 'app', 'security', 'error'])
  kind?: string;

  /** One level or a comma list: info,warn,error */
  @IsOptional()
  @Matches(/^(info|warn|error)(,(info|warn|error))*$/)
  level?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Matches(/^[1-5]xx$/)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  user?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{8,36}$/)
  requestId?: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

class LimitsDto extends ReasonDto {
  @IsObject()
  limits: Record<string, number>;
}

/** Everything the admin app needs. Every write takes a reason and lands in the audit log. */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly approvals: ApprovalsService,
    private readonly disputes: DisputesService,
    private readonly proofs: ProofsService,
    private readonly community: CommunityService,
    private readonly orgs: OrganizationsService,
    private readonly challenges: ChallengesService,
    private readonly health: ProviderHealthService,
    private readonly verification: VerificationService,
    private readonly settings: SettingsService,
    private readonly logs: AdminLogsService,
  ) {}

  @Admin()
  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  // ---------- disputes ----------

  @Admin()
  @Get('disputes')
  disputeQueue(@Query('status') status?: string) {
    return this.disputes.queue(status);
  }

  @Admin()
  @Get('disputes/:id')
  dispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.detail(id);
  }

  @Admin('decide_disputes')
  @Post('disputes/:id/review')
  @HttpCode(204)
  review(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.startReview(user.id, id);
  }

  @Admin('decide_disputes')
  @Post('disputes/:id/request-evidence')
  @HttpCode(204)
  requestEvidence(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EvidenceRequestDto) {
    return this.disputes.requestEvidence(user.id, id, dto.message);
  }

  @Admin('decide_disputes')
  @Post('disputes/:id/decide')
  async decideDispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeDecisionDto) {
    const d = await this.disputes.get(id);
    if (!dto.upheld && d && d.lockedAmount > FOUR_EYES_OVER) {
      return this.approvals.request(user.id, 'confirm_dispute_failure', `Dispute D-${id.slice(0, 4).toUpperCase()}`, { disputeId: id }, dto.reason);
    }
    return this.disputes.decide(user.id, id, dto.upheld, dto.reason);
  }

  // ---------- proof reviews ----------

  @Admin('review_proof')
  @Get('reviews')
  reviews() {
    return this.proofs.queue();
  }

  @Admin('review_proof')
  @Get('reviews/:id/file')
  async reviewFile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const data = await this.proofs.file(id, { id: user.id, admin: true });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }

  @Admin('review_proof')
  @Post('reviews/:id')
  decideReview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) {
    return this.proofs.review(user.id, id, dto.approve, dto.reason);
  }

  // ---------- risk and accounts ----------

  @Admin()
  @Get('risk')
  risk(@Query('status') status?: string) {
    return this.admin.riskFlags(status);
  }

  @Admin('restrict_accounts')
  @Post('risk/:id')
  async setRisk(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RiskDto) {
    if (dto.status === 'restricted') {
      const flag = (await this.admin.riskFlags()).find((f) => f.id === id);
      return this.approvals.request(user.id, 'restrict_account', `@${flag?.user.handle ?? id}`, { userId: flag?.userId }, dto.reason);
    }
    return this.admin.setRisk(user.id, id, dto.status, dto.reason);
  }

  @Admin()
  @Get('users')
  users(@Query('q') q?: string, @Query('status') status?: string) {
    return this.admin.listUsers(q, status);
  }

  @Admin()
  @Get('users/:handle')
  user(@Param('handle') handle: string) {
    return this.admin.userDetail(handle);
  }

  @Admin('restrict_accounts')
  @Post('users/:handle/restrict')
  async restrict(@CurrentUser() user: AuthUser, @Param('handle') handle: string, @Body() dto: ReasonDto) {
    const u = await this.admin.userIdForHandle(handle);
    return this.approvals.request(user.id, 'restrict_account', `@${u.handle}`, { userId: u.id }, dto.reason);
  }

  @Admin('restrict_accounts')
  @Post('users/:handle/suspend')
  async suspend(@CurrentUser() user: AuthUser, @Param('handle') handle: string, @Body() dto: ReasonDto) {
    const u = await this.admin.userIdForHandle(handle);
    return this.approvals.request(user.id, 'suspend_account', `@${u.handle}`, { userId: u.id }, dto.reason);
  }

  @Admin('restrict_accounts')
  @Post('users/:handle/reinstate')
  @HttpCode(204)
  reinstate(@CurrentUser() user: AuthUser, @Param('handle') handle: string, @Body() dto: ReasonDto) {
    return this.admin.reinstate(user.id, handle, dto.reason);
  }

  // ---------- approvals (four-eyes) ----------

  @Admin()
  @Get('approvals')
  pending() {
    return this.approvals.pending();
  }

  @Admin()
  @Post('approvals/:id')
  decideApproval(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    return this.approvals.decide(user.id, id, dto.approve);
  }

  // ---------- reports ----------

  @Admin('moderate_reports')
  @Get('reports')
  reports() {
    return this.community.openReports();
  }

  @Admin('moderate_reports')
  @Post('reports/:id')
  @HttpCode(204)
  resolveReport(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportActionDto) {
    return this.community.resolveReport(user.id, id, dto.action, dto.reason);
  }

  // ---------- challenges and organizations ----------

  @Admin()
  @Get('challenges')
  challengesList(@Query('status') status?: string) {
    return this.admin.listChallenges(status);
  }

  @Admin('manage_challenges')
  @Post('challenges/:id/pause')
  @HttpCode(204)
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.admin.hold(user.id, id, dto.reason);
  }

  @Admin('manage_challenges')
  @Delete('challenges/:id/pause')
  @HttpCode(204)
  unpause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.hold(user.id, id, null);
  }

  @Admin('manage_challenges')
  @Post('challenges/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.challenges.cancel(user.id, id, dto.reason, true);
  }

  @Admin()
  @Get('orgs')
  orgsList() {
    return this.orgs.adminList();
  }

  @Admin('approve_orgs')
  @Post('orgs/:slug/decision')
  @HttpCode(204)
  decideOrg(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() dto: DecideDto) {
    return this.orgs.decide(user.id, slug, dto.approve, dto.reason);
  }

  // ---------- provider health and outages ----------

  @Admin()
  @Get('health')
  async providerHealth() {
    return { providers: await this.health.stats(), incidents: await this.health.list() };
  }

  @Admin('declare_outage')
  @Post('outages')
  outage(@CurrentUser() user: AuthUser, @Body() dto: OutageDto) {
    return this.verification.declareOutage(user.id, dto.provider, new Date(dto.from), dto.to ? new Date(dto.to) : null, dto.reason);
  }

  @Admin('declare_outage')
  @Post('outages/:id/end')
  @HttpCode(204)
  endOutage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.health.resolve(user.id, id, dto.reason);
  }

  // ---------- escrow (read only) ----------

  @Admin('view_finance')
  @Get('escrow')
  escrow() {
    return this.admin.escrow();
  }

  @Admin('view_finance')
  @Get('treasury')
  treasury() {
    return this.admin.treasury();
  }

  // ---------- server and error logs ----------

  @Admin('view_logs')
  @Get('logs')
  logList(@Query() q: LogQueryDto) {
    return this.logs.list(q);
  }

  @Admin('view_logs')
  @Get('logs/stats')
  logStats(@Query('hours') hours?: string) {
    const h = Number(hours);
    return this.logs.stats(Number.isInteger(h) && h > 0 && h <= 168 ? h : 24);
  }

  @Admin('view_logs')
  @Get('logs/:id')
  logEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.logs.one(id);
  }

  @Admin('view_logs')
  @Get('errors')
  errors(@Query('status') status?: string, @Query('q') q?: string) {
    return this.logs.errorGroups(status, q?.slice(0, 120));
  }

  @Admin('view_logs')
  @Get('errors/:id')
  error(@Param('id', ParseUUIDPipe) id: string) {
    return this.logs.errorGroup(id);
  }

  @Admin('view_logs')
  @Post('errors/:id/resolve')
  @HttpCode(204)
  resolveError(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.logs.resolve(user.id, id, dto.reason);
  }

  @Admin('view_logs')
  @Post('errors/:id/reopen')
  @HttpCode(204)
  reopenError(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.logs.reopen(user.id, id);
  }

  // ---------- audit, team, settings ----------

  @Admin()
  @Get('audit')
  audit(@Query('q') q?: string, @Query('before') before?: string) {
    return this.admin.auditLog(q, before);
  }

  @Admin()
  @Get('team')
  team() {
    return this.admin.team();
  }

  @Admin('manage_team')
  @Put('team')
  @HttpCode(204)
  setRole(@CurrentUser() user: AuthUser, @Body() dto: TeamDto) {
    return this.admin.setRole(user.id, dto.email, dto.role ?? null, dto.reason);
  }

  @Admin()
  @Get('settings')
  getSettings() {
    return this.admin.platformSettings();
  }

  @Admin('manage_settings')
  @Put('settings/banner')
  @HttpCode(204)
  banner(@CurrentUser() user: AuthUser, @Body() dto: BannerDto) {
    return this.admin.setBanner(user.id, dto.text?.trim() || null);
  }

  /** Penalty structures affect people's money: a second admin approves. Running challenges keep theirs. */
  @Admin('manage_settings')
  @Post('settings/structures')
  structures(@CurrentUser() user: AuthUser, @Body() dto: StructuresDto) {
    return this.approvals.request(user.id, 'change_penalty_structures', dto.structures.map((s) => s.name).join(', '), { structures: dto.structures }, dto.reason);
  }

  @Admin('manage_settings')
  @Put('settings/limits')
  @HttpCode(204)
  limits(@CurrentUser() user: AuthUser, @Body() dto: LimitsDto) {
    return this.admin.setLimits(user.id, dto.limits, dto.reason);
  }
}

/** Public endpoints the apps read without signing in. */
@Controller()
export class PlatformController {
  constructor(
    private readonly settings: SettingsService,
    private readonly health: ProviderHealthService,
  ) {}

  @Public()
  @Get('platform')
  async platform() {
    const f = await this.settings.fees();
    return {
      banner: await this.settings.get<string | null>('banner'),
      structures: await this.settings.structures(),
      fees: { joinPercent: f.joinBps / 100, platformSharePercent: f.forfeitBps / 100 },
    };
  }

  /** Status page: provider health and incidents. */
  @Public()
  @Get('status')
  async status() {
    const providers = await this.health.stats();
    const incidents = await this.health.list();
    return {
      providers: providers.map((p) => ({ provider: p.provider, status: p.status })),
      incidents: incidents.slice(0, 20).map((i) => ({ provider: i.provider, status: i.status, from: i.startsAt.toISOString(), to: i.endsAt?.toISOString() ?? null, reason: i.reason })),
    };
  }
}
