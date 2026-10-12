import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CATEGORIES, PROVIDERS, type VerificationConfig } from '../entities/challenge.entities.js';

export class CreateChallengeDto {
  /** The host's "I agree to the challenge rules and the Terms of Service" checkbox. Must be true. */
  @IsBoolean()
  agreeToRules: boolean;

  /** 'me', or the slug of a verified organization you manage. */
  @IsString()
  host: string;

  @IsString()
  @Length(4, 90)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  summary?: string;

  @IsString()
  @Length(20, 5000)
  description: string;

  @IsIn(CATEGORIES)
  category: (typeof CATEGORIES)[number];

  @IsIn(['public', 'private', 'org'])
  privacy: 'public' | 'private' | 'org';

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(100_000)
  limit?: number;

  /** One or two providers. With two, every day needs both. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(PROVIDERS, { each: true })
  providers: (typeof PROVIDERS)[number][];

  @IsOptional()
  @IsObject()
  verificationConfig?: VerificationConfig;

  @IsIn(['days', 'count'])
  mode: 'days' | 'count';

  @IsInt()
  @Min(1)
  @Max(128)
  duration: number;

  /** Days mode: days that must be completed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  required?: number;

  /** Count mode: total to reach. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  target?: number;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  countUnit?: string;

  /** Custom requirement wording; generated from the provider and numbers when left out. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  requirement?: string;

  /** First day, YYYY-MM-DD, in `timezone`. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsIn(['none', 'fixed', 'range'])
  stakeMode: 'none' | 'fixed' | 'range';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  stake?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  range?: [number, number];

  @IsString()
  preset: string;

  @IsOptional()
  @IsBoolean()
  freeze?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  freezeDays?: number;

  /** Sponsor pool the host pledges to fund. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  pool?: number;

  @IsOptional()
  @IsIn(['equal'])
  split?: 'equal';

  @IsOptional()
  @IsBoolean()
  forfeits?: boolean;

  @IsOptional()
  @IsIn(['Starter', 'Steady', 'Hard'])
  difficulty?: 'Starter' | 'Steady' | 'Hard';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  disputeWindowHours?: number;
}

export class ListChallengesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stakeMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stakeMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  rewardMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMax?: number;

  @IsOptional()
  @IsIn(['Starter', 'Steady', 'Hard'])
  difficulty?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  participantsMin?: number;

  @IsOptional()
  @IsIn(['public', 'org'])
  privacy?: string;

  @IsOptional()
  @IsString()
  org?: string;

  @IsOptional()
  @IsIn(['open', 'live', 'settling', 'ended'])
  status?: string;

  @IsOptional()
  @IsIn(['trending', 'starting', 'reward', 'new', 'participants'])
  sort?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class JoinDto {
  /** Hex sha256 of the rules document the person accepted. */
  @Matches(/^[0-9a-f]{64}$/)
  acceptedRulesHash: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  stake?: number;

  @IsOptional()
  @IsString()
  wallet?: string;

  /** Invite code for private challenges. */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code?: string;
}

export class SignatureDto {
  @IsString()
  @Length(64, 100)
  signature: string;
}

export class FreezeDto {
  /** First day to freeze, 1-based like the app shows. */
  @IsInt()
  @Min(1)
  day: number;
}

export class UpdateChallengeDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  summary?: string;
}
