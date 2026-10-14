import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Schema = { $ref?: string; required?: string[]; properties?: Record<string, Schema> };
type Operation = { operationId?: string; parameters?: Array<{ $ref?: string }>; requestBody?: { content?: Record<string, { schema?: Schema }> }; responses?: Record<string, { $ref?: string; content?: Record<string, { schema?: Schema }> }> };
type Document = { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };

const expected: Record<string, string> = {
  'GET /organizations/{organizationId}/conversations': 'listConversations',
  'POST /organizations/{organizationId}/conversations': 'createConversation',
  'GET /organizations/{organizationId}/conversations/{conversationId}': 'getConversation',
  'GET /organizations/{organizationId}/conversations/{conversationId}/messages': 'listMessages',
  'POST /organizations/{organizationId}/conversations/{conversationId}/messages': 'sendMessage',
  'GET /organizations/{organizationId}/conversation-invitations': 'listConversationInvitations',
  'POST /organizations/{organizationId}/conversation-invitations/{invitationId}/token': 'issueConversationInvitationToken',
  'POST /organizations/{organizationId}/conversation-invitations/{invitationId}/accept': 'acceptConversationInvitation',
  'POST /organizations/{organizationId}/conversation-invitations/{invitationId}/decline': 'declineConversationInvitation',
  'POST /organizations/{organizationId}/conversations/{conversationId}/participant-invitations': 'createParticipantInvitation',
  'DELETE /organizations/{organizationId}/conversations/{conversationId}/participants/{userId}': 'leaveOrRevokeParticipant',
  'POST /organizations/{organizationId}/conversations/{conversationId}/block': 'blockConversationRelation',
  'DELETE /organizations/{organizationId}/conversations/{conversationId}/block': 'unblockConversationRelation',
  'PUT /platform/organizations/{organizationId}/network-trust': 'setOrganizationNetworkTrust',
};

async function load(): Promise<Document> {
  return parse(await readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8')) as Document;
}

function operation(spec: Document, key: string): Operation {
  const [method, ...pathParts] = key.split(' ');
  const result = spec.paths[pathParts.join(' ')]?.[method.toLowerCase()];
  if (!result) throw new Error(`Missing operation ${key}`);
  return result;
}

describe('Phase 9 Messaging OpenAPI contract', () => {
  it('freezes every messaging and platform trust operation', async () => {
    const spec = await load();
    for (const [key, operationId] of Object.entries(expected)) expect(operation(spec, key).operationId, key).toBe(operationId);
  });

  it('requires idempotency on every Phase 9 mutation and documents errors', async () => {
    const spec = await load();
    for (const [key, operationId] of Object.entries(expected)) {
      const op = operation(spec, key);
      if (key.startsWith('GET ')) continue;
      expect(op.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'), operationId).toBe(true);
      expect(op.responses?.['401']?.$ref ?? op.responses?.['401']?.content?.['application/problem+json']?.schema?.$ref, operationId).toContain('Unauthorized');
    }
    expect(operation(spec, 'POST /organizations/{organizationId}/conversations/{conversationId}/messages').responses?.['429']?.$ref).toContain('TooManyRequests');
  });

  it('keeps invitation tokens out of list DTOs and exposes only the one-time token DTO', async () => {
    const spec = await load();
    const schemas = spec.components.schemas;
    expect(schemas.ConversationInvitation?.properties?.token).toBeUndefined();
    expect(schemas.ConversationInvitationToken?.required).toEqual(expect.arrayContaining(['invitationId', 'token', 'expiresAt']));
    expect(operation(spec, 'POST /organizations/{organizationId}/conversation-invitations/{invitationId}/token').responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ConversationInvitationToken');
  });

  it('freezes immutable message fields and the platform trust command', async () => {
    const spec = await load();
    expect(spec.components.schemas.Message?.required).toEqual(expect.arrayContaining(['authorUserId', 'sourceOrganizationId', 'sequence', 'clientMessageId']));
    expect(spec.components.schemas.SetNetworkTrustRequest?.required).toEqual(expect.arrayContaining(['status', 'reason']));
    expect(operation(spec, 'PUT /platform/organizations/{organizationId}/network-trust').responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/NetworkTrust');
  });
});

