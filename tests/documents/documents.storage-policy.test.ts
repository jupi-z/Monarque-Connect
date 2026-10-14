import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentStorageAdapter } from '../../src/documents/documents.module.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalAdapter = process.env.DOCUMENT_STORAGE_ADAPTER;
const originalAllowMemory = process.env.DOCUMENT_STORAGE_ALLOW_MEMORY;

describe('document storage runtime policy', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalAdapter === undefined) delete process.env.DOCUMENT_STORAGE_ADAPTER; else process.env.DOCUMENT_STORAGE_ADAPTER = originalAdapter;
    if (originalAllowMemory === undefined) delete process.env.DOCUMENT_STORAGE_ALLOW_MEMORY; else process.env.DOCUMENT_STORAGE_ALLOW_MEMORY = originalAllowMemory;
  });

  it('allows the memory adapter in tests', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DOCUMENT_STORAGE_ADAPTER;
    expect(createDocumentStorageAdapter()).toBeDefined();
  });

  it('refuses the demonstration adapter in production-like environments', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOCUMENT_STORAGE_ADAPTER = 'memory';
    delete process.env.DOCUMENT_STORAGE_ALLOW_MEMORY;
    expect(() => createDocumentStorageAdapter()).toThrow(/test-only|real document storage/i);
    process.env.NODE_ENV = 'staging';
    expect(() => createDocumentStorageAdapter()).toThrow(/test-only|real document storage/i);
  });
});
