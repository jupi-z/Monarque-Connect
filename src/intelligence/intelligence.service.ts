import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthorizationService, type Permission } from '../tenancy/authorization.service.js';
import { METRIC_REGISTRY } from './metric-registry.js';
import { IntelligenceAlertStatus, IntelligenceGrain, type IntelligenceAlertsQuery, type IntelligenceDashboardQuery, type IntelligenceMetricsQuery } from './intelligence.dto.js';
import type { IntelligenceMetricCode } from './intelligence.constants.js';

type MetricRow = {
  metric_code: IntelligenceMetricCode;
  definition_version: number;
  kind: 'ACTIVITY' | 'CURRENT_STATE';
  bucket_start: Date | null;
  period_start: Date | null;
  period_end: Date | null;
  as_of: Date | null;
  calculated_at: Date;
  source_as_of: Date;
  value: Record<string, unknown>;
  dimensions: Record<string, string>;
  dimension_sort: string;
  sort_period: Date;
};

type PageCursor = { v: 1; context: string; metric: string; period: string; dimensions: string };
type AlertPageCursor = { v: 1; context: string; triggeredAt: string; id: string };
type AlertReadRow = {
  id: string; ruleCode: string; ruleVersion: number; severity: string; status: string;
  sourceType: string; sourceId: string; establishmentId: string | null;
  triggeredAt: Date; lastEvaluatedAt: Date; resolvedAt: Date | null;
};
const NULL_PERIOD = '9999-12-31T00:00:00.000Z';
const MAX_DASHBOARD_VALUES = 2000;

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService, private readonly authorization: AuthorizationService) {}

  async dashboard(principal: AuthPrincipal, organizationId: string, query: IntelligenceDashboardQuery) {
    const context = await this.authorization.requireModule(principal, organizationId, 'INTELLIGENCE_BASIC', 'intelligence:read');
    const scope = await this.resolveScope(context, query.establishmentId);
    const requested = Object.keys(METRIC_REGISTRY) as IntelligenceMetricCode[];
    const readable: IntelligenceMetricCode[] = [];
    for (const code of requested) if (await this.canReadMetric(principal, organizationId, context, code)) readable.push(code);
    const rows = readable.length ? await this.readSnapshots({
      organizationId, codes: readable, scope, from: new Date(query.from), to: new Date(query.to), grain: IntelligenceGrain.DAY,
      limit: MAX_DASHBOARD_VALUES + 1, dashboard: true,
    }) : [];
    if (rows.length > MAX_DASHBOARD_VALUES) throw new BadRequestException('Dashboard contains too many values; select an establishment or use the paginated metrics endpoint.');
    const alerts = await this.readOpenAlerts(principal, organizationId, context, scope);
    return {
      metrics: rows.map(stripCursorFields),
      openAlerts: alerts,
      calculatedAt: maxDate(rows.map((row) => row.calculatedAt)) ?? new Date().toISOString(),
      sourceAsOf: maxDate(rows.map((row) => row.sourceAsOf)) ?? new Date().toISOString(),
    };
  }

  async metrics(principal: AuthPrincipal, organizationId: string, query: IntelligenceMetricsQuery) {
    const context = await this.authorization.requireModule(principal, organizationId, 'INTELLIGENCE_BASIC', 'intelligence:read');
    const scope = await this.resolveScope(context, query.establishmentId);
    const codes = query.metricCodes?.length
      ? query.metricCodes as IntelligenceMetricCode[]
      : (Object.keys(METRIC_REGISTRY) as IntelligenceMetricCode[]).filter((code) => query.from && METRIC_REGISTRY[code].kind === 'ACTIVITY' || METRIC_REGISTRY[code].kind === 'CURRENT_STATE');
    if (codes.some((code) => METRIC_REGISTRY[code].kind === 'ACTIVITY') && (!query.from || !query.to)) {
      throw new BadRequestException('Activity metrics require both from and to.');
    }
    for (const code of codes) {
      if (!await this.canReadMetric(principal, organizationId, context, code)) throw new ForbiddenException('Metric source access denied');
    }
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const cursorContext = this.cursorContext(organizationId, scope, codes, from, to, query.grain);
    const after = query.cursor ? this.decodeCursor(query.cursor, cursorContext) : undefined;
    const rows = await this.readSnapshots({
      organizationId, codes, scope, from, to, grain: query.grain, limit: query.limit + 1, after,
    });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(stripCursorFields),
      hasMore,
      nextCursor: hasMore && last ? this.encodeCursor({
        v: 1, context: cursorContext, metric: last.metricCode,
        period: last._cursorPeriod,
        dimensions: last._cursorDimension,
      }) : null,
    };
  }

  async alerts(principal: AuthPrincipal, organizationId: string, query: IntelligenceAlertsQuery) {
    const context = await this.authorization.requireModule(principal, organizationId, 'INTELLIGENCE_BASIC', 'intelligence:read');
    const scope = await this.resolveScope(context, query.establishmentId);
    const sourceTypes = await this.readableAlertSourceTypes(principal, organizationId, context);
    if (sourceTypes.length === 0) return { items: [], hasMore: false, nextCursor: null };
    const cursorContext = this.alertCursorContext(organizationId, scope, query.status, query.severity);
    const after = query.cursor ? this.decodeAlertCursor(query.cursor, cursorContext) : undefined;
    const pageWhere: Prisma.InsightAlertWhereInput = {
      organizationId,
      status: query.status,
      sourceType: { in: sourceTypes },
      ...(query.severity ? { severity: query.severity } : {}),
      ...(scope === undefined ? {} : { establishmentId: { in: [...scope] } }),
      ...(after ? { OR: [
        { triggeredAt: { lt: new Date(after.triggeredAt) } },
        { triggeredAt: new Date(after.triggeredAt), id: { gt: after.id } },
      ] } : {}),
    };
    const rows = await this.prisma.insightAlert.findMany({
      where: pageWhere,
      orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: alertReadSelection,
    });
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toAlertResponse),
      hasMore,
      nextCursor: hasMore && last ? this.encodeCursor({
        v: 1,
        context: cursorContext,
        triggeredAt: last.triggeredAt.toISOString(),
        id: last.id,
      }) : null,
    };
  }

  async alert(principal: AuthPrincipal, organizationId: string, alertId: string) {
    const context = await this.authorization.requireModule(principal, organizationId, 'INTELLIGENCE_BASIC', 'intelligence:read');
    const alert = await this.prisma.insightAlert.findFirst({
      where: {
        id: alertId,
        organizationId,
        ...(context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? { establishmentId: { in: [...context.establishmentIds] } } : {}),
      },
      select: alertReadSelection,
    });
    if (!alert) throw new NotFoundException('Alert not found');
    const source = alertSource(alert.sourceType);
    if (!source) throw new NotFoundException('Alert not found');
    await this.authorization.requireModule(principal, organizationId, source.module, source.permission);
    return toAlertResponse(alert);
  }

  private async resolveScope(context: Awaited<ReturnType<AuthorizationService['requireMembership']>>, establishmentId?: string) {
    if (establishmentId) {
      await this.authorization.assertEstablishment(context, establishmentId);
      return [establishmentId];
    }
    return context.scopeMode === 'SELECTED_ESTABLISHMENTS' ? context.establishmentIds : undefined;
  }

  private async canReadMetric(principal: AuthPrincipal, organizationId: string, context: Awaited<ReturnType<AuthorizationService['requireMembership']>>, code: IntelligenceMetricCode): Promise<boolean> {
    const definition = METRIC_REGISTRY[code];
    if (!definition || definition.requiredPermissions.some((permission) => !this.authorization.can(context, permission as Permission))) return false;
    try {
      for (const moduleCode of definition.sourceModules) {
        await this.authorization.requireModule(principal, organizationId, moduleCode, definition.requiredPermissions[0] as Permission);
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async readSnapshots(input: {
    organizationId: string; codes: readonly IntelligenceMetricCode[]; scope: readonly string[] | undefined;
    from?: Date | undefined; to?: Date | undefined; grain: IntelligenceGrain; limit: number; dashboard?: boolean; after?: PageCursor | undefined;
  }) {
    const selectedScope = input.scope === undefined
      ? Prisma.sql`TRUE`
      : input.scope.length
        ? Prisma.sql`ms.establishment_id = ANY(${[...input.scope]}::uuid[])`
        : Prisma.sql`FALSE`;
    const fromFilter = input.from && input.to
      ? Prisma.sql`ms.period_start >= ${input.from} AND ms.period_start < ${input.to}`
      : Prisma.sql`FALSE`;
    const bucketExpression = input.dashboard
      ? Prisma.sql`${input.from}::timestamptz`
      : Prisma.sql`date_trunc(${String(input.grain) === 'DAY' ? 'day' : String(input.grain) === 'WEEK' ? 'week' : 'month'}, ms.period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    const bucketInterval = String(input.grain) === 'DAY' ? '1 day' : String(input.grain) === 'WEEK' ? '1 week' : '1 month';
    const activityPeriodStart = input.dashboard
      ? Prisma.sql`${input.from}::timestamptz`
      : input.from ? Prisma.sql`GREATEST(ms.bucket_start, ${input.from}::timestamptz)` : Prisma.sql`MIN(ms.period_start)`;
    const activityPeriodEnd = input.dashboard
      ? Prisma.sql`${input.to}::timestamptz`
      : input.to ? Prisma.sql`LEAST(ms.bucket_start + INTERVAL '${Prisma.raw(bucketInterval)}', ${input.to}::timestamptz)` : Prisma.sql`MAX(ms.period_end)`;
    const codes = [...input.codes];
    const versionFilter = Prisma.join(codes.map((code) => Prisma.sql`(ms.metric_code = ${code} AND ms.definition_version = ${METRIC_REGISTRY[code].definitionVersion})`), ' OR ');
    const after = input.after
      ? Prisma.sql`(metric_code, sort_period, dimension_sort) > (${input.after.metric}::text, ${new Date(input.after.period)}, ${input.after.dimensions}::text)`
      : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<MetricRow[]>(Prisma.sql`
      WITH activity_source AS (
        SELECT ms.*, ${bucketExpression} AS bucket_start
        FROM metric_snapshots ms
        WHERE ms.organization_id = ${input.organizationId}::uuid AND ms.metric_code = ANY(${codes}::text[])
          AND (${versionFilter}) AND ms.period_start IS NOT NULL AND (${fromFilter}) AND (${selectedScope})
      ), activity AS (
        SELECT ms.metric_code,
               MAX(ms.definition_version)::int AS definition_version,
               ms.bucket_start,
               ${activityPeriodStart} AS period_start,
               ${activityPeriodEnd} AS period_end,
               MAX(ms.calculated_at) AS calculated_at,
               MAX(ms.source_as_of) AS source_as_of,
               ms.dimension_key,
               ms.currency_key,
               CASE
                 WHEN ms.metric_code IN ('SALES_ISSUED','PAYMENTS_RECORDED','EXPENSES_RECORDED') THEN
                   jsonb_build_object('count', SUM(COALESCE((ms.value_json->>'count')::numeric,0))::bigint,
                     'amount', COALESCE(SUM((ms.value_json->>'amount')::numeric),0)::text, 'currency', ms.currency_key)
                 WHEN ms.metric_code = 'QUOTE_ORDER_CONVERSION' THEN
                   jsonb_build_object('count', SUM(COALESCE((ms.value_json->>'count')::numeric,0))::bigint,
                     'numerator', SUM(COALESCE((ms.value_json->>'numerator')::numeric,0))::bigint,
                     'denominator', SUM(COALESCE((ms.value_json->>'denominator')::numeric,0))::bigint,
                     'ratio', CASE WHEN SUM(COALESCE((ms.value_json->>'denominator')::numeric,0)) = 0 THEN '0.000000000000'
                       ELSE ROUND(SUM(COALESCE((ms.value_json->>'numerator')::numeric,0)) / SUM((ms.value_json->>'denominator')::numeric),12)::text END)
                 WHEN ms.metric_code = 'NETWORK_INQUIRIES_CONVERTED' THEN
                   jsonb_build_object('count', SUM(COALESCE((ms.value_json->>'count')::numeric,0))::bigint)
                 ELSE '{}'::jsonb
               END AS value_json
        FROM activity_source ms
        GROUP BY ms.metric_code, ms.bucket_start, ms.dimension_key, ms.currency_key
      ), current_ranked AS (
        SELECT ms.metric_code, ms.definition_version, ms.as_of, ms.calculated_at, ms.source_as_of,
               ms.dimension_key, ms.currency_key, ms.value_json,
               ROW_NUMBER() OVER (PARTITION BY ms.metric_code, ms.scope_key, ms.dimension_key, ms.currency_key
                                  ORDER BY ms.source_as_of DESC, ms.calculated_at DESC, ms.id DESC) AS rn
        FROM metric_snapshots ms
        WHERE ms.organization_id = ${input.organizationId}::uuid AND ms.metric_code = ANY(${codes}::text[])
          AND (${versionFilter}) AND ms.as_of IS NOT NULL AND (${selectedScope})
      ), unified AS (
        SELECT metric_code, definition_version, 'ACTIVITY'::text AS kind, bucket_start,
               period_start, period_end, NULL::timestamptz AS as_of, calculated_at, source_as_of,
               value_json AS value, dimension_key AS dimension_sort, currency_key,
               to_jsonb((SELECT jsonb_object_agg(key, val) FROM jsonb_each_text(dimension_key::jsonb) d(key,val)
                         WHERE key <> 'currencyKey') || CASE WHEN currency_key <> 'NONE' THEN jsonb_build_object('currency', currency_key) ELSE '{}'::jsonb END) AS dimensions,
               bucket_start AS sort_period
        FROM activity
        UNION ALL
        SELECT metric_code, definition_version, 'CURRENT_STATE'::text, NULL::timestamptz,
               NULL::timestamptz, NULL::timestamptz, as_of, calculated_at, source_as_of, value_json,
               dimension_key AS dimension_sort, currency_key,
               (dimension_key::jsonb - 'currencyKey' || CASE WHEN currency_key <> 'NONE' THEN jsonb_build_object('currency', currency_key) ELSE '{}'::jsonb END) AS dimensions,
               '9999-12-31T00:00:00Z'::timestamptz AS sort_period
        FROM current_ranked WHERE rn = 1
      )
      SELECT metric_code, definition_version, kind, bucket_start, period_start, period_end, as_of,
             calculated_at, source_as_of, value, dimensions, dimension_sort, sort_period
      FROM unified
      WHERE (${after})
      ORDER BY metric_code ASC, sort_period ASC, dimension_sort ASC, currency_key ASC
      LIMIT ${input.limit}
    `);
    return rows.map((row) => ({
      metricCode: row.metric_code,
      definitionVersion: row.definition_version,
      kind: row.kind,
      calculatedAt: row.calculated_at.toISOString(),
      sourceAsOf: row.source_as_of.toISOString(),
      value: normalizeJson(row.value),
      dimensions: mapDimensions(normalizeJson(row.dimensions)),
      _cursorDimension: row.dimension_sort,
      _cursorPeriod: row.bucket_start?.toISOString() ?? NULL_PERIOD,
      ...(row.kind === 'ACTIVITY' && row.period_start && row.period_end ? { period: {
        from: row.period_start.toISOString(), to: row.period_end.toISOString(),
      } } : {}),
    }));
  }

  private async readOpenAlerts(principal: AuthPrincipal, organizationId: string, context: Awaited<ReturnType<AuthorizationService['requireMembership']>>, scope?: readonly string[]) {
    const allowedTypes = await this.readableAlertSourceTypes(principal, organizationId, context);
    if (!allowedTypes.length) return [];
    const alerts = await this.prisma.insightAlert.findMany({
      where: { organizationId, status: 'OPEN', sourceType: { in: allowedTypes }, ...(scope === undefined ? {} : { establishmentId: { in: [...scope] } }) },
      orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }], take: 20,
      select: alertReadSelection,
    });
    return alerts.map(toAlertResponse);
  }

  private async readableAlertSourceTypes(principal: AuthPrincipal, organizationId: string, context: Awaited<ReturnType<AuthorizationService['requireMembership']>>) {
    const allowedTypes: string[] = [];
    for (const sourceType of ['INVOICE', 'PROJECT']) {
      const source = alertSource(sourceType);
      if (!source) continue;
      if (!this.authorization.can(context, source.permission)) continue;
      try {
        await this.authorization.requireModule(principal, organizationId, source.module, source.permission);
        allowedTypes.push(sourceType);
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return allowedTypes;
  }

  private cursorContext(organizationId: string, scope: readonly string[] | undefined, codes: readonly string[], from?: Date, to?: Date, grain?: string): string {
    return createHash('sha256').update(JSON.stringify({ v: 1, organizationId, scope: scope ? [...scope].sort() : '*', codes: [...codes].sort(), from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, grain })).digest('hex');
  }

  private alertCursorContext(organizationId: string, scope: readonly string[] | undefined, status: IntelligenceAlertStatus, severity?: string): string {
    return createHash('sha256').update(JSON.stringify({ v: 1, organizationId, scope: scope ? [...scope].sort() : '*', status, severity: severity ?? null, sort: 'TRIGGERED_AT_DESC_ID_ASC' })).digest('hex');
  }

  private encodeCursor(cursor: PageCursor | AlertPageCursor): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }

  private decodeCursor(value: string, context: string): PageCursor {
    try {
      const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PageCursor;
      if (cursor.v !== 1 || cursor.context !== context || !cursor.metric || !cursor.period || !cursor.dimensions || !Number.isFinite(Date.parse(cursor.period))) throw new Error();
      return cursor;
    } catch { throw new BadRequestException('Cursor is invalid or does not match this query.'); }
  }

  private decodeAlertCursor(value: string, context: string): AlertPageCursor {
    try {
      const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as AlertPageCursor;
      if (cursor.v !== 1 || cursor.context !== context || !cursor.id || !Number.isFinite(Date.parse(cursor.triggeredAt))) throw new Error();
      return cursor;
    } catch { throw new BadRequestException('Cursor is invalid or does not match this query.'); }
  }
}

const alertReadSelection = {
  id: true, ruleCode: true, ruleVersion: true, severity: true, status: true,
  sourceType: true, sourceId: true, establishmentId: true,
  triggeredAt: true, lastEvaluatedAt: true, resolvedAt: true,
} as const;

function alertSource(sourceType: string): { module: string; permission: Permission } | undefined {
  if (sourceType === 'INVOICE') return { module: 'SALES', permission: 'sales:invoices:read' };
  if (sourceType === 'PROJECT') return { module: 'PROJECTS', permission: 'projects:read' };
  return undefined;
}

function toAlertResponse(row: AlertReadRow) {
  return {
    id: row.id, ruleCode: row.ruleCode, ruleVersion: row.ruleVersion, severity: row.severity,
    status: row.status, sourceType: row.sourceType, sourceId: row.sourceId,
    establishmentId: row.establishmentId, triggeredAt: row.triggeredAt.toISOString(),
    lastEvaluatedAt: row.lastEvaluatedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

function normalizeJson<T>(value: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) as T;
  }
  return value;
}

function mapDimensions(value: Record<string, string>): Record<string, string> {
  const dimensions = { ...value };
  if (dimensions.cashAccountId) {
    dimensions.accountId = dimensions.cashAccountId;
    delete dimensions.cashAccountId;
  }
  return dimensions;
}

function maxDate(values: string[]): string | undefined {
  return values.reduce<string | undefined>((maximum, value) => !maximum || value > maximum ? value : maximum, undefined);
}

function stripCursorFields<T extends { _cursorDimension?: string; _cursorPeriod?: string }>(value: T): Omit<T, '_cursorDimension' | '_cursorPeriod'> {
  const result = { ...value } as T & Record<string, unknown>;
  delete result._cursorDimension;
  delete result._cursorPeriod;
  return result;
}
