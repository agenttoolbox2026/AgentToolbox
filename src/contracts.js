import { z } from 'zod';

const integer = (max) => z.number().int().min(0).max(max);
const atomic = integer(1_000_000_000); // USDC atomic units, never floating dollars
const label = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.:-]+$/);
export const id = z.uuid();
export const key = z.string().min(32).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const recoverSchema = z.strictObject({
  operation: label.describe('Redacted tool label; never include a URL or credential.'),
  failure: z.strictObject({
    kind: z.enum(['http', 'network', 'mcp', 'business', 'auth', 'missing_resource', 'browser', 'unknown']),
    status: z.number().int().min(100).max(599).optional(),
    code: label.optional(),
    headers: z.strictObject({
      'retry-after': z.string().max(80).optional(),
      date: z.string().max(80).optional(),
    }).optional(),
    redacted_message: z.string().max(256).optional().describe('Not stored or interpreted.'),
  }),
  safety: z.strictObject({
    read_only: z.boolean(),
    idempotency_key: z.string().min(1).max(128).optional(),
    idempotency_supported: z.boolean().optional().describe('True only if the upstream guarantees deduplication using this key and the same payload.'),
  }),
  attempts_so_far: z.number().int().min(1).max(100),
  limits: z.strictObject({
    max_attempts: integer(5).describe('Total attempts including the original failed call.'),
    max_wait_ms: integer(30_000),
    max_price_usdc_atomic: atomic,
  }),
  estimates: z.strictObject({ retry_cost_usdc_atomic: atomic, failure_avoided_usdc_atomic: atomic }).optional(),
  agent_id: id.optional().describe('Optional random pseudonym, never a real identity.'),
  discovery_source: z.enum(['mcp', 'llms_txt', 'openapi', 'referral', 'manual', 'unknown']).optional(),
});
export const acceptSchema = z.strictObject({ accept: z.boolean(), max_price_usdc_atomic: atomic });
export const resultSchema = z.strictObject({
  outcome: z.enum(['success', 'failure', 'unverifiable']),
  retry_attempts: z.literal(1),
  completed: z.boolean(),
  evidence: z.strictObject({
    type: z.enum(['http', 'mcp', 'none']),
    final_status: z.number().int().min(100).max(599).optional(),
    mcp_is_error: z.boolean().optional(),
    digest_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }),
  savings: z.strictObject({ time_ms: integer(86_400_000), tokens: integer(1_000_000), usdc_atomic: atomic }).optional(),
});
export const feedbackSchema = z.strictObject({
  recovery_id: id,
  helpful: z.boolean(),
  reason: z.enum(['saved_time', 'prevented_unsafe_retry', 'unnecessary', 'wrong_rule', 'other']),
  operator_effort_ms: integer(86_400_000).optional(),
});

export const example = {
  operation: 'catalog.read', failure: { kind: 'http', status: 429, headers: { 'retry-after': '1' } },
  safety: { read_only: true }, attempts_so_far: 1,
  limits: { max_attempts: 2, max_wait_ms: 3000, max_price_usdc_atomic: 0 },
};
export const jsonSchema = (schema) => z.toJSONSchema(schema, { target: 'draft-7' });
