import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { ExpenseService } from './expense.service.js';
import { CreateExpenseDto, ExpenseListQuery, RecordExpenseDto, UpdateExpenseDto, VoidExpenseDto } from './expense.dto.js';

@Controller('organizations/:organizationId/expenses')
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Get()
  list(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Query() query: ExpenseListQuery): Promise<unknown> { return this.expenses.list(principal, organizationId, query); }

  @Post()
  create(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: CreateExpenseDto): Promise<unknown> { return this.expenses.create(principal, organizationId, input, key); }

  @Get(':expenseId')
  get(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('expenseId') expenseId: string): Promise<unknown> { return this.expenses.get(principal, organizationId, expenseId); }

  @Patch(':expenseId')
  update(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('expenseId') expenseId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: UpdateExpenseDto): Promise<unknown> { return this.expenses.update(principal, organizationId, expenseId, input, key); }

  @Post(':expenseId/record')
  record(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('expenseId') expenseId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: RecordExpenseDto): Promise<unknown> { return this.expenses.record(principal, organizationId, expenseId, input, key); }

  @Post(':expenseId/void')
  void(@CurrentPrincipal() principal: AuthPrincipal, @Param('organizationId') organizationId: string, @Param('expenseId') expenseId: string, @Headers('idempotency-key') key: string | undefined, @Body() input: VoidExpenseDto): Promise<unknown> { return this.expenses.void(principal, organizationId, expenseId, input, key); }
}
