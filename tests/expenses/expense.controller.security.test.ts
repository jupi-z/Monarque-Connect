import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { ExpenseController } from '../../src/expenses/expense.controller.js';

describe('Expense HTTP authorization boundary', () => {
  it('requires the central AuthGuard on the controller', () => {
    const guards = Reflect.getMetadata('__guards__', ExpenseController) as unknown[] | undefined;
    expect(guards ?? []).toEqual(expect.arrayContaining([AuthGuard]));
  });
});
