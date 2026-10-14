import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CashAccountService } from './cash-account.service.js';
import { CashMovementService } from './cash-movement.service.js';
import { CashAccountListQuery, CashMovementListQuery, ChangeCashAccountStatusDto, CorrectCashMovementDto, CreateCashAccountDto, CreateCashMovementDto, CreateCashTransferDto, UpdateCashAccountDto } from './cash.dto.js';

@Controller('organizations/:organizationId/cash-accounts')
@UseGuards(AuthGuard)
export class CashAccountController {
  constructor(private readonly accounts: CashAccountService) {}
  @Get() list(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Query() q: CashAccountListQuery): Promise<unknown> { return this.accounts.list(p, o, q); }
  @Post() create(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Headers('idempotency-key') k: string | undefined, @Body() b: CreateCashAccountDto): Promise<unknown> { return this.accounts.create(p, o, b, k); }
  @Get(':cashAccountId') get(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Param('cashAccountId') id: string): Promise<unknown> { return this.accounts.get(p, o, id); }
  @Patch(':cashAccountId') update(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Param('cashAccountId') id: string, @Headers('idempotency-key') k: string | undefined, @Body() b: UpdateCashAccountDto): Promise<unknown> { return this.accounts.update(p, o, id, b, k); }
  @Post(':cashAccountId/deactivate') deactivate(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Param('cashAccountId') id: string, @Headers('idempotency-key') k: string | undefined, @Body() b: ChangeCashAccountStatusDto): Promise<unknown> { return this.accounts.deactivate(p, o, id, b, k); }
  @Post(':cashAccountId/reactivate') reactivate(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Param('cashAccountId') id: string, @Headers('idempotency-key') k: string | undefined, @Body() b: ChangeCashAccountStatusDto): Promise<unknown> { return this.accounts.reactivate(p, o, id, b, k); }
}

@Controller('organizations/:organizationId/cash-movements')
@UseGuards(AuthGuard)
export class CashMovementController {
  constructor(private readonly movements: CashMovementService) {}
  @Get() list(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Query() q: CashMovementListQuery): Promise<unknown> { return this.movements.list(p, o, q); }
  @Post() create(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Headers('idempotency-key') k: string | undefined, @Body() b: CreateCashMovementDto): Promise<unknown> { return this.movements.create(p, o, b, k); }
  @Post(':movementId/correct') correct(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Param('movementId') id: string, @Headers('idempotency-key') k: string | undefined, @Body() b: CorrectCashMovementDto): Promise<unknown> { return this.movements.correct(p, o, id, b, k); }
}

@Controller('organizations/:organizationId/cash-transfers')
@UseGuards(AuthGuard)
export class CashTransferController {
  constructor(private readonly movements: CashMovementService) {}
  @Post() create(@CurrentPrincipal() p: AuthPrincipal, @Param('organizationId') o: string, @Headers('idempotency-key') k: string | undefined, @Body() b: CreateCashTransferDto): Promise<unknown> { return this.movements.transfer(p, o, b, k); }
}
