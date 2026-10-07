import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { assertPasswordPolicy } from './identity.js';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    assertPasswordPolicy(password);
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}
