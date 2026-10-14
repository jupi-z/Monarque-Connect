import { Controller, Delete, Get, Headers, Param, Post, Query, Res, UseGuards, Body } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CompleteDocumentUploadDto, CreateDocumentLinkDto, DocumentLinkParams, DocumentListQuery, DocumentParams, OrganizationDocumentParams, RevokeDocumentDto, StartDocumentUploadDto } from './documents.dto.js';
import { DocumentService } from './document.service.js';

@Controller('organizations/:organizationId/documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationDocumentParams, @Query() query: DocumentListQuery): Promise<unknown> { return this.documents.list(principal, params.organizationId, query); }

  @Post('uploads')
  startUpload(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationDocumentParams, @Headers('idempotency-key') key: string | undefined, @Body() input: StartDocumentUploadDto): Promise<unknown> { return this.documents.startUpload(principal, params.organizationId, input, key); }

  @Get(':documentId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentParams): Promise<unknown> { return this.documents.get(principal, params.organizationId, params.documentId); }

  @Post(':documentId/complete')
  complete(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CompleteDocumentUploadDto): Promise<unknown> { return this.documents.complete(principal, params.organizationId, params.documentId, input, key); }

  @Get(':documentId/content')
  async content(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentParams, @Res() response: Response): Promise<void> { const stream = await this.documents.content(principal, params.organizationId, params.documentId); response.type('application/octet-stream'); stream.pipe(response); }

  @Post(':documentId/links')
  link(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentParams, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateDocumentLinkDto): Promise<unknown> { return this.documents.link(principal, params.organizationId, params.documentId, input, key); }

  @Delete(':documentId/links/:linkId')
  async unlink(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentLinkParams, @Headers('idempotency-key') key: string | undefined): Promise<void> { await this.documents.unlink(principal, params.organizationId, params.documentId, params.linkId, key); }

  @Post(':documentId/revoke')
  revoke(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: DocumentParams, @Headers('idempotency-key') key: string | undefined, @Body() input: RevokeDocumentDto): Promise<unknown> { return this.documents.revoke(principal, params.organizationId, params.documentId, input, key); }
}
