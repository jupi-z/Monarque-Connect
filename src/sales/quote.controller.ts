import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateQuoteDto, OrganizationQuoteParams, QuoteListQuery, QuoteParams, UpdateQuoteDto } from './quote.dto.js';
import { QuoteService } from './quote.service.js';

@Controller('organizations/:organizationId/quotes')
@UseGuards(AuthGuard)
export class QuoteController {
  constructor(private readonly quotes: QuoteService) {}

  @Get()
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationQuoteParams, @Query() query: QuoteListQuery): Promise<unknown> { return this.quotes.list(principal, params.organizationId, query); }

  @Post()
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationQuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: CreateQuoteDto): Promise<unknown> { return this.quotes.create(principal, params.organizationId, input, idempotencyKey); }

  @Get(':quoteId')
  async get(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams): Promise<unknown> { return this.quotes.get(principal, params.organizationId, params.quoteId); }

  @Patch(':quoteId')
  async update(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() input: UpdateQuoteDto): Promise<unknown> { return this.quotes.update(principal, params.organizationId, params.quoteId, input, idempotencyKey); }

  @Post(':quoteId/send')
  @HttpCode(200)
  async send(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.quotes.transition(principal, params.organizationId, params.quoteId, 'SENT', idempotencyKey); }

  @Post(':quoteId/accept')
  @HttpCode(200)
  async accept(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.quotes.transition(principal, params.organizationId, params.quoteId, 'ACCEPTED', idempotencyKey); }

  @Post(':quoteId/reject')
  @HttpCode(200)
  async reject(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.quotes.transition(principal, params.organizationId, params.quoteId, 'REJECTED', idempotencyKey); }

  @Post(':quoteId/cancel')
  @HttpCode(200)
  async cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: QuoteParams, @Headers('idempotency-key') idempotencyKey: string | undefined): Promise<unknown> { return this.quotes.transition(principal, params.organizationId, params.quoteId, 'CANCELLED', idempotencyKey); }
}
