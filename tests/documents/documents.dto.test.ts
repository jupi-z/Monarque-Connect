import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CompleteDocumentUploadDto, StartDocumentUploadDto } from '../../src/documents/documents.dto.js';

describe('Phase 8 document DTO numeric validation', () => {
  it('accepts a JSON integer transformed to positive bigint', async () => {
    const dto = plainToInstance(StartDocumentUploadDto, { establishmentId: '11111111-1111-4111-8111-111111111111', originalFilename: 'brief.txt', mediaType: 'text/plain', byteSize: 5, classification: 'CONFIDENTIAL' });
    expect(dto.byteSize).toBe(5n);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects zero and fractional upload sizes', async () => {
    const zero = plainToInstance(CompleteDocumentUploadDto, { checksumSha256: 'a'.repeat(64), byteSize: 0 });
    const fraction = plainToInstance(CompleteDocumentUploadDto, { checksumSha256: 'a'.repeat(64), byteSize: 1.5 });
    expect((await validate(zero)).some((error) => error.property === 'byteSize')).toBe(true);
    expect((await validate(fraction)).some((error) => error.property === 'byteSize')).toBe(true);
  });
});
