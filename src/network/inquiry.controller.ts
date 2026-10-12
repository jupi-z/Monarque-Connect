import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentPrincipal } from '../auth/auth.decorators.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { CreateNetworkInquiryDto, ConvertNetworkInquiryDto, NetworkInquiryListQuery, NetworkInquiryParams, NetworkInquiryTargetParams, OrganizationInquiryParams, TransitionNetworkInquiryDto } from './inquiry.dto.js';
import { NetworkInquiryService } from './inquiry.service.js';

@Controller()
@UseGuards(AuthGuard)
export class NetworkInquiryController {
  constructor(private readonly inquiries: NetworkInquiryService) {}

  @Post('organizations/:organizationId/network/organizations/:targetOrganizationId/inquiries')
  async create(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: NetworkInquiryTargetParams, @Body() input: CreateNetworkInquiryDto): Promise<unknown> {
    return this.inquiries.create(principal, params.organizationId, params.targetOrganizationId, input);
  }

  @Get('organizations/:organizationId/network-inquiries')
  async list(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: OrganizationInquiryParams, @Query() query: NetworkInquiryListQuery): Promise<unknown> {
    return this.inquiries.list(principal, params.organizationId, query);
  }

  @Patch('organizations/:organizationId/network-inquiries/:inquiryId')
  async transition(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: NetworkInquiryParams, @Body() input: TransitionNetworkInquiryDto): Promise<unknown> {
    return this.inquiries.transition(principal, params.organizationId, params.inquiryId, input.status);
  }

  @Post('organizations/:organizationId/network-inquiries/:inquiryId/convert')
  async convert(@CurrentPrincipal() principal: AuthPrincipal, @Param() params: NetworkInquiryParams, @Body() input: ConvertNetworkInquiryDto): Promise<unknown> {
    return this.inquiries.convert(principal, params.organizationId, params.inquiryId, input);
  }
}
