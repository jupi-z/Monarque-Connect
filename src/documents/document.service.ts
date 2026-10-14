import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type AuditAction } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { createDomainEvent } from '../events/domain-event.factory.js';
import { createRequestContext, currentEventContext } from '../events/event-context.js';
import { PrismaOutboxWriter } from '../events/prisma-outbox.writer.js';
import type { AuthPrincipal, AuthorizationContext } from '../auth/auth.types.js';
import { AuthorizationService, type Permission } from '../tenancy/authorization.service.js';
import type { CreateDocumentLinkDto, DocumentListQuery, RevokeDocumentDto, StartDocumentUploadDto, CompleteDocumentUploadDto, DocumentTargetType } from './documents.dto.js';
import type { StorageAdapter } from './storage-adapter.js';
import { STORAGE_ADAPTER } from './storage-adapter.js';

type Cursor = { createdAt: string; id: string };
type Context = { requestId: string; correlationId: string };
const targetReadRequirements: Record<DocumentTargetType, { moduleCode: string; permission: Permission }> = {
  PROJECT: { moduleCode: 'PROJECTS', permission: 'projects:read' },
  TASK: { moduleCode: 'PROJECTS', permission: 'projects:read' },
  OPPORTUNITY: { moduleCode: 'CRM', permission: 'crm:read' },
  PARTY: { moduleCode: 'CRM', permission: 'parties:read' },
  QUOTE: { moduleCode: 'SALES', permission: 'sales:quotes:read' },
  SALES_ORDER: { moduleCode: 'SALES', permission: 'sales:orders:read' },
  INVOICE: { moduleCode: 'SALES', permission: 'sales:invoices:read' },
  PAYMENT_RECORD: { moduleCode: 'SALES', permission: 'sales:payments:read' },
  SUPPLIER_RFQ: { moduleCode: 'PURCHASES', permission: 'purchases:rfqs:read' },
  PURCHASE_ORDER: { moduleCode: 'PURCHASES', permission: 'purchases:orders:read' },
  GOODS_RECEIPT: { moduleCode: 'PURCHASES', permission: 'purchases:receipts:read' },
  EXPENSE: { moduleCode: 'EXPENSES', permission: 'expenses:read' },
};
const documentSelect = { id: true, organizationId: true, establishmentId: true, originalFilename: true, mediaType: true, byteSize: true, checksumSha256: true, storageKey: true, uploadToken: true, uploadExpiresAt: true, status: true, classification: true, uploadedByUserId: true, createdAt: true, updatedAt: true, revokedAt: true, revocationReason: true, links: { select: { id: true, organizationId: true, documentId: true, establishmentId: true, targetType: true, targetId: true, createdByUserId: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } as const;
type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;
const documentLinkSelect = { id: true, organizationId: true, documentId: true, establishmentId: true, targetType: true, targetId: true, createdByUserId: true, createdAt: true } as const;
type DocumentLinkRow = Prisma.DocumentLinkGetPayload<{ select: typeof documentLinkSelect }>;

@Injectable()
export class DocumentService {
  private readonly storage: StorageAdapter;

  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService, private readonly outbox: PrismaOutboxWriter, @Inject(STORAGE_ADAPTER) storage: StorageAdapter) {
    this.storage = storage;
  }

  async list(principal: AuthPrincipal, organizationId: string, query: DocumentListQuery): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    if (query.targetId && !query.targetType) throw new BadRequestException('targetType is required with targetId');
    if (query.establishmentId) await this.authorization.assertEstablishment(context, query.establishmentId);
    const targetEstablishmentId = query.targetId && query.targetType ? await this.assertTargetReadable(principal, organizationId, query.targetType, query.targetId) : undefined;
    if (targetEstablishmentId) await this.authorization.assertEstablishment(context, targetEstablishmentId);
    const establishmentIds = query.establishmentId ? [query.establishmentId] : context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? Array.from(context.establishmentIds) : undefined;
    let scanCursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const limit = query.limit ?? 20;
    const baseWhere = { organizationId, ...(establishmentIds ? { establishmentId: { in: establishmentIds } } : {}), ...(query.status ? { status: query.status } : {}), ...(query.targetId && query.targetType ? { links: { some: { organizationId, targetType: query.targetType, targetId: query.targetId } } } : {}) };
    const readableRows: DocumentRow[] = [];
    let lastScanned: DocumentRow | undefined;
    let hasMore = false;
    const batchSize = 100;
    while (readableRows.length <= limit) {
      const rows = await this.prisma.document.findMany({ where: { ...baseWhere, ...(scanCursor ? { OR: [{ createdAt: { gt: new Date(scanCursor.createdAt) } }, { createdAt: new Date(scanCursor.createdAt), id: { gt: scanCursor.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: batchSize, select: documentSelect });
      if (rows.length === 0) { hasMore = false; break; }
      for (const row of rows) {
        lastScanned = row;
        if (await this.canReadDocumentTargets(principal, organizationId, row)) readableRows.push(row);
        if (readableRows.length > limit) break;
      }
      if (readableRows.length > limit) { hasMore = true; break; }
      if (rows.length < batchSize) { hasMore = false; break; }
      const last = rows[rows.length - 1];
      if (!last) break;
      scanCursor = { createdAt: last.createdAt.toISOString(), id: last.id };
      hasMore = true;
    }
    const items = readableRows.slice(0, limit).map((row) => this.serialize(row));
    const next = readableRows.length > limit ? readableRows[limit - 1] : hasMore && lastScanned ? lastScanned : undefined;
    return { items, nextCursor: next ? this.encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) : null };
  }

  async get(principal: AuthPrincipal, organizationId: string, documentId: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    const document = await this.findScoped(context, organizationId, documentId);
    await this.assertReadableDocumentTargets(principal, organizationId, document);
    return this.serialize(document);
  }

  async startUpload(principal: AuthPrincipal, organizationId: string, input: StartDocumentUploadDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    await this.authorization.assertEstablishment(context, input.establishmentId);
    for (const link of input.links ?? []) await this.assertTargetReadable(principal, organizationId, link.targetType, link.targetId);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_UPLOAD_START', input });
    const event = this.eventContext();
    const id = randomUUID();
    const session = await this.storage.beginUpload({ documentId: id, mediaType: input.mediaType.trim(), byteSize: input.byteSize });
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UPLOAD_START', key, payloadHash);
        if (replay) return { replayed: true, response: await this.uploadSession(tx, organizationId, replay.resourceId) };
        const document = await tx.document.create({ data: { id, organizationId, establishmentId: input.establishmentId, originalFilename: input.originalFilename.trim(), mediaType: input.mediaType.trim(), byteSize: input.byteSize, status: 'PENDING_UPLOAD', classification: input.classification, storageKey: session.storageKey, uploadToken: session.uploadToken, uploadExpiresAt: session.expiresAt, uploadedByUserId: principal.userId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UPLOAD_START', key, payloadHash, resourceType: 'Document', resourceId: id, establishmentId: input.establishmentId });
        for (const link of input.links ?? []) await this.createLink(tx, principal, organizationId, document, link, event);
        await this.recordMutation(tx, 'DOCUMENT_UPLOAD_STARTED', 'document.upload_started.v1', principal, organizationId, input.establishmentId, id, event, { originalFilename: document.originalFilename, mediaType: document.mediaType, byteSize: document.byteSize.toString(), classification: document.classification });
        const persisted = await tx.document.findFirstOrThrow({ where: { id, organizationId }, select: documentSelect });
        return { replayed: false, response: { document: this.serialize(persisted), uploadToken: session.uploadToken, expiresAt: session.expiresAt.toISOString() } };
      });
      if (outcome.replayed) { try { await this.storage.revoke(session.storageKey); } catch { /* cleanup is retried by storage lifecycle tooling */ } }
      return outcome.response;
    } catch (error) {
      try { await this.storage.revoke(session.storageKey); } catch { /* preserve the transaction error */ }
      if (this.isUnique(error)) return this.replayUpload(principal, organizationId, key, payloadHash);
      throw error;
    }
  }

  async upload(principal: AuthPrincipal, organizationId: string, documentId: string, uploadToken: string | undefined, content: Readable): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const document = await this.findScoped(context, organizationId, documentId);
    if (document.status !== 'PENDING_UPLOAD' || !document.storageKey) throw new ConflictException('Document upload is not pending');
    if (!uploadToken?.trim()) throw new BadRequestException('X-Upload-Token is required');
    const receipt = await this.storage.writeUpload(document.storageKey, uploadToken, content);
    return { byteSize: receipt.byteSize.toString(), checksumSha256: receipt.checksumSha256 };
  }

  async complete(principal: AuthPrincipal, organizationId: string, documentId: string, input: CompleteDocumentUploadDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const initial = await this.findScoped(context, organizationId, documentId);
    await this.assertReadableDocumentTargets(principal, organizationId, initial);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_UPLOAD_COMPLETE', documentId, input });
    const event = this.eventContext();
    const validation = await this.prisma.$transaction(async (tx) => {
      const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash);
      if (replay) return { replayId: replay.resourceId };
      const current = await tx.document.findFirst({ where: { id: documentId, organizationId }, select: documentSelect });
      if (!current) throw new NotFoundException();
      if (current.status === 'REVOKED') throw new ConflictException('Revoked document cannot be completed');
      if (current.status !== 'PENDING_UPLOAD') throw new ConflictException('Document upload is not pending');
      if (!current.storageKey) throw new ConflictException('Document has no upload session');
      if (current.byteSize !== input.byteSize) throw new ConflictException('Uploaded byte size does not match the declaration');
      return { storageKey: current.storageKey };
    });
    if ('replayId' in validation) {
      const replayed = await this.findScoped(context, organizationId, validation.replayId);
      await this.assertReadableDocumentTargets(principal, organizationId, replayed);
      return this.serialize(replayed);
    }
    await this.storage.completeUpload(validation.storageKey, input.checksumSha256.toLowerCase(), input.byteSize);
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash);
        if (replay) return { resourceId: replay.resourceId };
        const changed = await tx.document.updateMany({ where: { id: documentId, organizationId, status: 'PENDING_UPLOAD' }, data: { status: 'AVAILABLE', checksumSha256: input.checksumSha256.toLowerCase() } });
        if (changed.count === 0) throw new ConflictException('Document was changed concurrently');
        const document = await tx.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_UPLOAD_COMPLETE', key, payloadHash, resourceType: 'Document', resourceId: documentId, establishmentId: document.establishmentId });
        await this.recordMutation(tx, 'DOCUMENT_AVAILABLE', 'document.available.v1', principal, organizationId, document.establishmentId, documentId, event, { checksumSha256: document.checksumSha256, byteSize: document.byteSize.toString() });
        return { resourceId: document.id };
      });
      const completed = await this.findScoped(context, organizationId, outcome.resourceId);
      await this.assertReadableDocumentTargets(principal, organizationId, completed);
      return this.serialize(completed);
    } catch (error) {
      if (this.isUnique(error)) {
        const replayed = await this.findScoped(context, organizationId, documentId);
        await this.assertReadableDocumentTargets(principal, organizationId, replayed);
        return this.serialize(replayed);
      }
      throw error;
    }
  }

  async content(principal: AuthPrincipal, organizationId: string, documentId: string): Promise<Readable> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:read');
    const document = await this.findScoped(context, organizationId, documentId);
    await this.assertReadableDocumentTargets(principal, organizationId, document);
    if (document.status !== 'AVAILABLE' || !document.storageKey) throw new NotFoundException('Document content unavailable');
    return this.storage.readStream(document.storageKey);
  }

  async link(principal: AuthPrincipal, organizationId: string, documentId: string, input: CreateDocumentLinkDto, rawKey?: string): Promise<unknown> {
    const context = await this.authorization.requireModule(principal, organizationId, 'DOCUMENTS', 'documents:write');
    const document = await this.findScoped(context, organizationId, documentId);
    await this.assertTargetReadable(principal, organizationId, input.targetType, input.targetId);
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
    const initial = await this.findScoped(context, organizationId, documentId);
    await this.assertReadableDocumentTargets(principal, organizationId, initial);
    const key = this.requireKey(rawKey);
    const payloadHash = this.hash({ operation: 'DOCUMENT_REVOKE', documentId, input });
    const event = this.eventContext();
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const replay = await this.findCommand(tx, organizationId, principal.userId, 'DOCUMENT_REVOKE', key, payloadHash);
        if (replay) { const document = await tx.document.findFirstOrThrow({ where: { id: replay.resourceId, organizationId }, select: documentSelect }); return { resourceId: document.id, storageKey: document.storageKey }; }
        const current = await tx.document.findFirst({ where: { id: documentId, organizationId }, select: documentSelect });
        if (!current) throw new NotFoundException();
        if (current.status === 'REVOKED') throw new ConflictException('Document is already revoked');
        const changed = await tx.document.updateMany({ where: { id: documentId, organizationId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date(), revocationReason: input.reason.trim() } });
        if (changed.count === 0) throw new ConflictException('Document was changed concurrently');
        const document = await tx.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect });
        await this.createCommand(tx, { organizationId, actorUserId: principal.userId, operation: 'DOCUMENT_REVOKE', key, payloadHash, resourceType: 'Document', resourceId: documentId, establishmentId: document.establishmentId });
        await this.recordMutation(tx, 'DOCUMENT_REVOKED', 'document.revoked.v1', principal, organizationId, document.establishmentId, documentId, event, { reason: input.reason.trim() });
        return { resourceId: document.id, storageKey: document.storageKey };
      });
      if (outcome.storageKey) {
        try { await this.storage.revoke(outcome.storageKey); } catch { throw new ServiceUnavailableException('Document storage revocation is pending retry'); }
      }
      const revoked = await this.findScoped(context, organizationId, outcome.resourceId);
      await this.assertReadableDocumentTargets(principal, organizationId, revoked);
      return this.serialize(revoked);
    } catch (error) {
      if (this.isUnique(error)) {
        const replayed = await this.findScoped(context, organizationId, documentId);
        await this.assertReadableDocumentTargets(principal, organizationId, replayed);
        return this.serialize(replayed);
      }
      throw error;
    }
  }

  private async findScoped(context: AuthorizationContext, organizationId: string, documentId: string): Promise<DocumentRow> { const document = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: documentSelect }); if (!document) throw new NotFoundException(); if (document.establishmentId) await this.authorization.assertEstablishment(context, document.establishmentId); return document; }
  private async assertTargetReadable(principal: AuthPrincipal, organizationId: string, targetType: DocumentTargetType, targetId: string): Promise<string | null> {
    const requirement = targetReadRequirements[targetType];
    const targetContext = await this.authorization.requireModule(principal, organizationId, requirement.moduleCode, requirement.permission);
    const establishmentId = await this.assertTarget(this.prisma, organizationId, targetType, targetId);
    if (establishmentId) await this.authorization.assertEstablishment(targetContext, establishmentId);
    return establishmentId;
  }

  private async assertReadableDocumentTargets(principal: AuthPrincipal, organizationId: string, document: DocumentRow): Promise<void> {
    for (const link of document.links) {
      try {
        await this.assertTargetReadable(principal, organizationId, link.targetType, link.targetId);
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) throw new NotFoundException('Document not found');
        throw error;
      }
    }
  }

  private async canReadDocumentTargets(principal: AuthPrincipal, organizationId: string, document: DocumentRow): Promise<boolean> {
    try { await this.assertReadableDocumentTargets(principal, organizationId, document); return true; } catch (error) { if (error instanceof NotFoundException) return false; throw error; }
  }
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
  private async uploadSession(client: PrismaService | Prisma.TransactionClient, organizationId: string, documentId: string): Promise<unknown> { const document = await client.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect }); return { document: this.serialize(document), uploadToken: document.uploadToken ?? document.storageKey ?? document.id, expiresAt: (document.uploadExpiresAt ?? new Date(Date.now() + 15 * 60 * 1000)).toISOString() }; }
  private async getForResponse(client: PrismaService | Prisma.TransactionClient, organizationId: string, documentId: string): Promise<unknown> { return this.serialize(await client.document.findFirstOrThrow({ where: { id: documentId, organizationId }, select: documentSelect })); }
  private async getLink(client: PrismaService | Prisma.TransactionClient, organizationId: string, linkId: string): Promise<unknown> { return this.serializeLink(await client.documentLink.findFirstOrThrow({ where: { id: linkId, organizationId }, select: documentLinkSelect })); }
  private async recordMutation(tx: Prisma.TransactionClient, action: AuditAction, eventType: string, principal: AuthPrincipal, organizationId: string, establishmentId: string | null, documentId: string, context: Context, payload: Record<string, unknown>): Promise<void> { await tx.auditEvent.create({ data: { id: randomUUID(), action, actorUserId: principal.userId, organizationId, establishmentId, targetType: 'Document', targetId: documentId, requestId: context.requestId, correlationId: context.correlationId, metadataJson: payload as Prisma.InputJsonValue } }); await this.outbox.enqueue(tx, createDomainEvent({ eventType, eventVersion: 1, occurredAt: new Date().toISOString(), actor: { type: 'USER', id: principal.userId }, aggregate: { type: 'Document', id: documentId }, organizationId, ...(establishmentId ? { establishmentId } : {}), correlationId: context.correlationId, requestId: context.requestId, dataClassification: 'CONFIDENTIAL', purpose: 'documents', payload })); }
  private serialize(document: DocumentRow): unknown { return { ...document, byteSize: document.byteSize.toString(), storageKey: undefined, uploadToken: undefined, uploadExpiresAt: undefined, createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString(), revokedAt: document.revokedAt?.toISOString() ?? null, links: document.links.map((link) => this.serializeLink(link)) }; }
  private serializeLink(link: DocumentLinkRow): unknown { return { id: link.id, organizationId: link.organizationId, documentId: link.documentId, targetType: link.targetType, targetId: link.targetId, createdByUserId: link.createdByUserId, createdAt: link.createdAt.toISOString() }; }
  private eventContext(): Context { const context = currentEventContext(); return context?.requestId ? { requestId: context.requestId, correlationId: context.correlationId } : createRequestContext(); }
  private requireKey(value?: string): string { if (!value?.trim() || value.length > 200 || /[\r\n]/.test(value)) throw new BadRequestException('Idempotency-Key is required and invalid'); return value.trim(); }
  private hash(value: unknown): string {
    const replacer = (_key: string, child: unknown): unknown => typeof child === 'bigint' ? child.toString() : child;
    const serialized = JSON.stringify(value, replacer);
    if (serialized === undefined) throw new BadRequestException('Command payload is not serializable');
    return createHash('sha256').update(serialized).digest('hex');
  }
  private isUnique(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'; }
  private encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url'); }
  private decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>; if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') throw new Error(); return { createdAt: parsed.createdAt, id: parsed.id }; } catch { throw new BadRequestException('Cursor is invalid'); } }
}
