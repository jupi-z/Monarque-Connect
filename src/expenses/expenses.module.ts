import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventModule } from '../events/event.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ExpenseController } from './expense.controller.js';
import { ExpenseService } from './expense.service.js';

@Module({ imports: [AuthModule, EventModule, TenancyModule], controllers: [ExpenseController], providers: [ExpenseService], exports: [ExpenseService] })
export class ExpensesModule {}
