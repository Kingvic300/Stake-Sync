import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEntry } from '../modules/admin/entities/admin.entities.js';
import { User } from '../modules/users/entities/user.entities.js';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEntry) private readonly repo: Repository<AuditEntry>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** actorId null records the system as the actor. */
  async log(actorId: string | null, action: string, target: string, reason: string, meta: Record<string, unknown> = {}) {
    const actor = actorId ? await this.users.findOneBy({ id: actorId }) : null;
    return this.repo.save(this.repo.create({ actorId, actorName: actor?.name ?? 'System', action, target, reason, meta }));
  }
}
