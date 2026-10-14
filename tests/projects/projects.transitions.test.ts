import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { assertProjectTransition, assertTaskTransition } from '../../src/projects/projects.transitions.js';

describe('Phase 8 state transitions', () => {
  it.each([
    ['PLANNED', 'ACTIVE'],
    ['ACTIVE', 'COMPLETED'],
    ['ACTIVE', 'CANCELLED'],
  ])('accepts project transition %s -> %s', (current, target) => {
    expect(() => assertProjectTransition(current, target)).not.toThrow();
  });

  it.each([
    ['PLANNED', 'COMPLETED'],
    ['PLANNED', 'CANCELLED'],
    ['COMPLETED', 'ACTIVE'],
    ['CANCELLED', 'ACTIVE'],
  ])('rejects project transition %s -> %s', (current, target) => {
    expect(() => assertProjectTransition(current, target)).toThrow(ConflictException);
  });

  it.each([
    ['TODO', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
    ['IN_PROGRESS', 'CANCELLED'],
  ])('accepts task transition %s -> %s', (current, target) => {
    expect(() => assertTaskTransition(current, target)).not.toThrow();
  });

  it.each([
    ['TODO', 'DONE'],
    ['TODO', 'CANCELLED'],
    ['DONE', 'IN_PROGRESS'],
    ['CANCELLED', 'TODO'],
  ])('rejects task transition %s -> %s', (current, target) => {
    expect(() => assertTaskTransition(current, target)).toThrow(ConflictException);
  });
});
