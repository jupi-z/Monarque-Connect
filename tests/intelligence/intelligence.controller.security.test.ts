import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { IntelligenceController } from '../../src/intelligence/intelligence.controller.js';
import { IntelligenceModule } from '../../src/intelligence/intelligence.module.js';
import { describe, expect, it } from 'vitest';

describe('Phase 10A Intelligence route registration and authentication', () => {
  it('registers the controller in the Intelligence module', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, IntelligenceModule) as unknown[];
    expect(controllers).toContain(IntelligenceController);
  });

  it('registers all four read routes behind the central authentication guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, IntelligenceController)).toBe('organizations/:organizationId/intelligence');
    expect(Reflect.getMetadata('__guards__', IntelligenceController)).toEqual(expect.arrayContaining([AuthGuard]));

    const routes = (['dashboard', 'metrics', 'alerts', 'alert'] as const).map((name) => {
        const handler = Object.getOwnPropertyDescriptor(IntelligenceController.prototype, name)?.value as (...args: never[]) => unknown;
        return {
          method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
          path: Reflect.getMetadata(PATH_METADATA, handler) as string,
        };
      });

    expect(routes).toEqual(expect.arrayContaining([
      { method: RequestMethod.GET, path: 'dashboard' },
      { method: RequestMethod.GET, path: 'metrics' },
      { method: RequestMethod.GET, path: 'alerts' },
      { method: RequestMethod.GET, path: 'alerts/:alertId' },
    ]));
  });
});
