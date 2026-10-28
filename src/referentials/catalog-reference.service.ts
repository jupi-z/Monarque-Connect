import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class CatalogReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async listMeasureUnits(): Promise<unknown> {
    const items = await this.prisma.measureUnit.findMany({ where: { active: true }, orderBy: [{ dimension: 'asc' }, { code: 'asc' }], select: { code: true, displayName: true, dimension: true, baseUnitCode: true, numerator: true, denominator: true, registryVersion: true, sourceRevision: true } });
    const versions = [...new Set(items.map((item) => item.registryVersion))];
    return { version: versions.length === 0 ? 'empty' : versions.length === 1 ? `measure-units-v${versions[0]}` : 'mixed', items: items.map((item) => ({ ...item, numerator: item.numerator.toString(), denominator: item.denominator.toString(), registryVersion: `measure-units-v${item.registryVersion}` })) };
  }

  async listCurrencies(): Promise<unknown> {
    const items = await this.prisma.currencyDefinition.findMany({ where: { active: true }, orderBy: { code: 'asc' }, select: { code: true, minorUnitDigits: true, registryVersion: true, sourceRevision: true } });
    const versions = [...new Set(items.map((item) => item.registryVersion))];
    return { version: versions.length === 0 ? 'empty' : versions.length === 1 ? `currencies-v${versions[0]}` : 'mixed', items };
  }
}
