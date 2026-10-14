import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../tenancy/authorization.service.js';
import type { CreateDocumentLinkDto, DocumentListQuery, RevokeDocumentDto, StartDocumentUploadDto, CompleteDocumentUploadDto, DocumentTargetType } from './documents.dto.js';
import { MemoryStorageAdapter } from './memory-storage.adapter.js';
import type { StorageAdapter } from './storage-adapter.js';

type Cursor = { createdAt: string; id: string };
type Context = { requestId: string; correlationId: string };
const documentSelect = { id: true, organizationId: true, establishmentId: true, originalFilename: true, mediaType: true, byteSize: true, checksumSha256: true, storageKey: true, status: true, classification: true, uploadedByUserId: true, createdAt: true, updatedAt: true, revokedAt: true, revocationReason: true, links: { select: { id: true, organizationId: true, documentId: true, targetType: true, targetId: true, createdByUserId: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } as const;
type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
const documentLinkSelect = { id: true, organizationId: true, documentId: true, targetType: true, targetId: true, createdByUserId: true, createdAt: true } as const;
type DocumentLinkRow = Prisma.DocumentLinkGetPayload<{ select: typeof documentLinkSelect }>;

@Injectable()
export class DocumentService {
  private readonly storage: StorageAdapter;

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter, storage: MemoryStorageAdapter) {
    this.storage = storage;
  }

  async list(principal: AuthPrincipal, organizationId: string, query: DocumentListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    if (query.targetId && !query.targetType) throw new BadRequestException('targetType is required with targetId');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const targetEstablishmentId = query.targetId && query.targetType ? await this.assertTarget(this.prisma, organizationId, query.targetType, query.targetId) : undefined;
    if (targetEstablishmentId) await this.authorization.assertEstablishment(context, targetEstablishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const limit = query.limit ?? 20;
    const rows = await this.prisma.document.findMany({ where: { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(query.status ? { status: query.status } : {}), ...(query.targetId && query.targetType ? { links: { some: { organizationId, targetType: query.targetType, targetId: query.targetId } } } : {}), ...(cursor ? { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit + 1, select: documentSelect });
    const items = rows.slice(0, limit).map((row) => this.serialize(row));
    const next = rows.length > limit ? rows[limit - 1] : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, documentId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    const document = await this.findScoped(context, organizationId, documentId);
    return this.serialize(document);
  }

  async startUpload(principal: AuthPrincipal, organizationId: string, input: StartDocumentUploadDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_UPLOAD_START', input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UPLOAD_START', key, payloadHash);
        if (replay) return this.uploadSession(tx, organizationId, replay.resourceId);
        const id = randomUUID();
        const session = await this.storage.beginUpload({ documentId: id, mediaType: input.mediaType.trim(), byteSize: input.byteSize });
        const document = await tx.document.create({ data: { id, organizationId, establishmentId: input.establishmentId, originalFilename: input.originalFilename.trim(), mediaType: input.mediaType.trim(), byteSize: input.byteSize, status: 'PENDING_UPLOAD', classification: input.classification, storageKey: session.storageKey, uploadedByUserId: principal.userId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UPLOAD_START', key, payloadHash, resourceType: 'Document', resourceId: id, establishmentId: input.establishmentId });
        for (const link of input.links ?? []) await this.createLink(tx, principal, organizationId, document, link, event);
        await this.recordMutation(tx, 'DOCUMENT_UPLOAD_STARTED', 'document.upload_started.v1', principal, organizationId, input.establishmentId, id, event, { originalFilename: document.originalFilename, mediaType: document.mediaType, byteSize: document.byteSize.toString(), classification: document.classification });
        return { document: this.serialize(document), uploadToken: session.uploadToken, expiresAt: session.expiresAt.toISOString() };
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replayUpload(principal, organizationId, key, payloadHash);
      throw error;
    }
  }

  async complete(principal: AuthPrincipal, organizationId: string, documentId: string, input: CompleteDocumentUploadDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const current = await this.findScoped(context, organizationId, documentId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_UPLOAD_COMPLETE', documentId, input });
    if (!current.storageKey) throw new ConflictException('Document has no upload session');
    await this.storage.completeUpload(current.storageKey, input.checksumSha256.toLowerCase(), input.byteSize);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        if (current.status === 'REVOKED') throw new ConflictException('Revoked document cannot be completed');
        if (current.status !== 'PENDING_UPLOAD') throw new ConflictException('Document upload is not pending');
        if (current.byteSize !== input.byteSize) throw new ConflictException('Uploaded byte size does not match the declaration');
        const changed = await tx.document.updateMany({ where: { id: documentId, organizationId, status: 'PENDING_UPLOAD' }, data: { status: 'AVAILABLE', checksumSha256: input.checksumSha256.toLowerCase() } });
        if (changed.count === 0) throw new ConflictException('Document was changed concurrently');
        const document = await tx.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash, resourceType: 'Document', resourceId: documentId, establishmentId: document.establishmentId });
        await this.recordMutation(tx, 'DOCUMENT_AVAILABLE', 'document.available.v1', principal, organizationId, document.establishmentId, documentId, event, { checksumSha256: document.checksumSha256, byteSize: document.byteSize.toString() });
        return this.serialize(document);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash, documentId);
      throw error;
    }
  }

  async content(principal: AuthPrincipal, organizationId: string, documentId: string): Promise<Readable> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    const document = await this.findScoped(context, organizationId, documentId);
    if (document.status !== 'AVAILABLE' || !document.storageKey) throw new NotFoundException('Document content unavailable');
    return this.storage.readStream(document.storageKey);
  }

  async link(principal: AuthPrincipal, organizationId: string, documentId: string, input: CreateDocumentLinkDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const document = await this.findScoped(context, organizationId, documentId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_LINK', documentId, input });
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_LINK', key, payloadHash);
        if (replay) return this.getLink(tx, organizationId, replay.resourceId);
        const link = await this.createLink(tx, principal, organizationId, document, input, event);
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_LINK', key, payloadHash, resourceType: 'DocumentLink', resourceId: link.id, establishmentId: document.establishmentId });
        return this.serializeLink(link);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'DOCUMENT_LINK', key, payloadHash);
      throw error;
    }
  }

  async unlink(principal: AuthPrincipal, organizationId: string, documentId: string, linkId: string, rawKey?: string): Promise<void> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const document = await this.findScoped(context, organizationId, documentId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_UNLINK', documentId, linkId });
    const event = this.eventContext();
    try {
      await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UNLINK', key, payloadHash);
        if (replay) return;
        const link = await tx.documentLink.findFirst({ where: { id: linkId, organizationId, documentId }, select: { id: true, targetType: true, targetId: true } });
        if (!link) throw new NotFoundException();
        await tx.documentLink.delete({ where: { id: linkId } });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UNLINK', key, payloadHash, resourceType: 'DocumentLink', resourceId: linkId, establishmentId: document.establishmentId });
        await this.recordMutation(tx, 'DOCUMENT_UNLINKED', 'document.unlinked.v1', principal, organizationId, document.establishmentId, documentId, event, { linkId, targetType: link.targetType, targetId: link.targetId });
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'DOCUMENT_UNLINK', key, payloadHash, linkId).then(() => undefined);
      throw error;
    }
  }

  async revoke(principal: AuthPrincipal, organizationId: string, documentId: string, input: RevokeDocumentDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const current = await this.findScoped(context, organizationId, documentId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_REVOKE', documentId, input });
    if (current.storageKey) await this.storage.revoke(current.storageKey);
    const event = this.eventContext();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_REVOKE', key, payloadHash);
        if (replay) return this.getForResponse(tx, organizationId, replay.resourceId);
        if (current.status === 'REVOKED') throw new ConflictException('Document is already revoked');
        const changed = await tx.document.updateMany({ where: { id: documentId, organizationId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date(), revocationReason: input.reason.trim() } });
        if (changed.count === 0) throw new ConflictException('Document was changed concurrently');
        const document = await tx.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_REVOKE', key, payloadHash, resourceType: 'Document', resourceId: documentId, establishmentId: document.establishmentId });
        await this.recordMutation(tx, 'DOCUMENT_REVOKED', 'document.revoked.v1', principal, organizationId, document.establishmentId, documentId, event, { reason: input.reason.trim() });
        return this.serialize(document);
      });
    } catch (error) {
      if (this.isUnique(error)) return this.replay(principal, organizationId, 'DOCUMENT_REVOKE', key, payloadHash, documentId);
      throw error;
    }
  }

  private async findScoped(context: AuthorizationContext, organizationId: string, documentId: string): Promise<DocumentRow> { const document = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: documentSelect }); if (!document) throw new NotFoundException(); if (document.establishmentId) await this.authorization.assertEstablishment(context, document.establishmentId); return document; }
  private async assertTarget(client: PrismaService | Prisma.TransactionClient, organizationId: string, targetType: DocumentTargetType, targetId: string): Promise<string | null> {
    switch (targetType) {
      case 'PROJECT': return (await client.project.findFirst({ where: { id: targetId, organizationId }, select: { establishmentId: true } }))?.establishmentId ?? (() => { throw new NotFoundException('Document target not found'); })();
      case 'TASK': return (await client.task.findFirst({ where: { id: targetId, organizationId }, select: { project: { select: { establishmentId: true } } } }))?.project.establishmentId ?? (() => { throw new NotFoundException('Document target not found'); })();
      case 'OPPORTUNITY': return (await client.opportunity.findFirst({ where: { id: targetId, organizationId }, select: { establishmentId: true } }))?.establishmentId ?? (() => { throw new NotFoundException('Document target not found'); })();
      case 'PARTY': if (!(await client.businessParty.findFirst({ where: { id: targetId, organizationId }, select: { id: true } }))) throw new NotFoundException('Document target not found'); return null;
      case 'QUOTE': return this.findEstablishment(client.quote, organizationId, targetId);
      case 'SALES_ORDER': return this.findEstablishment(client.salesOrder, organizationId, targetId);
      case 'INVOICE': return this.findEstablishment(client.invoice, organizationId, targetId);
      case 'PAYMENT_RECORD': return this.findEstablishment(client.paymentRecord, organizationId, targetId);
      case 'SUPPLIER_RFQ': return this.findEstablishment(client.supplierRFQ, organizationId, targetId);
      case 'PURCHASE_ORDER': return this.findEstablishment(client.purchaseOrder, organizationId, targetId);
      case 'GOODS_RECEIPT': return this.findEstablishment(client.goodsReceipt, organizationId, targetId);
      case 'EXPENSE': return this.findEstablishment(client.expense, organizationId, targetId);
    }
  }

  private async findEstablishment(delegate: { findFirst(args: { where: { id: string; organizationId: string }; select: { establishmentId: true } }): Promise<{ establishmentId: string } | null> }, organizationId: string, targetId: string): Promise<string> { const row = await delegate.findFirst({ where: { id: targetId, organizationId }, select: { establishmentId: true } }); if (!row) throw new NotFoundException('Document target not found'); return row.establishmentId; }
  private async createLink(tx: Prisma.TransactionClient, principal: AuthPrincipal, organizationId: string, document: DocumentRow, input: CreateDocumentLinkDto, event: Context): Promise<DocumentLinkRow> { const targetEstablishmentId = await this.assertTarget(tx, organizationId, input.targetType, input.targetId); if (document.establishmentId && targetEstablishmentId && document.establishmentId !== targetEstablishmentId) throw new ConflictException('Document target is outside the establishment scope'); const link = await tx.documentLink.create({ data: { id: randomUUID(), organizationId, documentId: document.id, establishmentId: targetEstablishmentId ?? document.establishmentId, targetType: input.targetType, targetId: input.targetId, createdByUserId: principal.userId }, select: documentLinkSelect }); await this.recordMutation(tx, 'DOCUMENT_LINKED', 'document.linked.v1', principal, organizationId, document.establishmentId, document.id, event, { linkId: link.id, targetType: link.targetType, targetId: link.targetId }); return link; }
  private async findCommand(tx: Prisma.TransactionClient, organizationId: string, actorUserId: string, operation: string, key: string, payloadHash: string): Promise<{ resourceId: string } | null> { const row = await tx.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId, operation, key } }, select: { resourceId: true, payloadHash: true } }); if (!row) return null; if (row.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key was already used with a different command'); return row; }
  private async createCommand(tx: Prisma.TransactionClient, input: { organizationId: string; actorUserId: string; operation: string; key: string; payloadHash: string; resourceType: string; resourceId: string; establishmentId: string | null }): Promise<void> { await tx.phase8IdempotencyKey.create({ data: { id: randomUUID(), ...input } }); }
  private async replay(principal: AuthPrincipal, organizationId: string, operation: string, key: string, payloadHash: string, expectedResourceId?: string): Promise<unknown> { const row = await this.prisma.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation, key } }, select: { resourceId: true, payloadHash: true } }); if (!row || row.payloadHash !== payloadHash || (expectedResourceId !== undefined && row.resourceId !== expectedResourceId)) throw new ConflictException('Idempotency-Key could not be replayed'); return this.getForResponse(this.prisma, organizationId, row.resourceId); }
  private async replayUpload(principal: AuthPrincipal, organizationId: string, key: string, payloadHash: string): Promise<unknown> { const row = await this.prisma.phase8IdempotencyKey.findUnique({ where: { organizationId_actorUserId_operation_key: { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UPLOAD_START', key } }, select: { resourceId: true, payloadHash: true } }); if (!row || row.payloadHash !== payloadHash) throw new ConflictException('Idempotency-Key could not be replayed'); return this.uploadSession(this.prisma, organizationId, row.resourceId); }
  private async uploadSession(client: PrismaService | Prisma.TransactionClient, organizationId: string, documentId: string): Promise<unknown> { const document = await client.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect }); return { document: this.serialize(document), uploadToken: document.storageKey ?? document.id, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() }; }
  private async getForResponse(client: PrismaService | Prisma.TransactionClient, organizationId: string, documentId: string): Promise<unknown> { return this.serialize(await client.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect })); }
  private async getLink(client: PrismaService | Prisma.TransactionClient, organizationId: string, linkId: string): Promise<unknown> { return this.serializeLink(await client.documentLink.findFirstOrThrow({ where: { id: linkId, organizationId }, select: documentLinkSelect })); }
  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string | null, documentId: string, context: Context, payload: Record<string, unknown>): Promise<void> { await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Document', targetId: documentId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } }); await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Document', id: documentId }, organizationId, ...(establishmentId ? { establishmentId } : {}), correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'documents', payload })); }
  private serialize(document: DocumentRow): unknown { return { ...document, byteSize: document.byteSize.toString(), storageKey: undefined, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString(), revokedAt: document.revokedAt?.toISOString() ?? null, links: document.links.map((link) => this.serializeLink(link)) }; }
  private serializeLink(link: DocumentLinkRow): unknown { return { ...link, createdAt: link.createdAt.toISOString() }; }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
