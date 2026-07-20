import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { computeConversationFactsBacklogCheck } from '../src/commands/doctor.ts';
import {
  NON_EXTRACTABLE_AUDIT_SOURCE,
  TERMINAL_AUDIT_SOURCE,
} from '../src/commands/extract-conversation-facts.ts';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await resetPgliteState(engine);
  await engine.setConfig('cycle.conversation_facts_backfill.enabled', 'true');
});

async function seedPage(slug: string, type: string): Promise<void> {
  await engine.putPage(slug, {
    type,
    title: slug,
    compiled_truth: 'A page body long enough for the doctor backlog fixture.',
    timeline: '',
    frontmatter: {},
  });
}

async function seedOutcome(slug: string, source: string): Promise<void> {
  await engine.executeRaw(
    `INSERT INTO facts (
       fact, kind, source, source_session, confidence, notability,
       row_num, source_markdown_slug, source_id
     ) VALUES ($1, 'fact', $2, $3, 1.0, 'low', 0, $4, 'default')`,
    [
      source === TERMINAL_AUDIT_SOURCE
        ? 'EXTRACTION_COMPLETE'
        : 'EXTRACTION_NOT_APPLICABLE',
      source,
      `${source}:${slug}`,
      slug,
    ],
  );
}

describe('conversation_facts_backlog durable outcomes', () => {
  test('defaults to meeting and slack, excluding individual email pages', async () => {
    await seedPage('meetings/pending', 'meeting');
    for (let i = 0; i < 12; i++) await seedPage(`emails/${i}`, 'email');

    const result = await computeConversationFactsBacklogCheck(engine);
    expect(result.details?.backlog).toBe(1);
    expect(result.details?.types).toEqual(['meeting', 'slack']);
    expect(result.status).toBe('ok');
  });

  test('reports complete and scanned-not-extractable separately', async () => {
    await seedPage('meetings/complete', 'meeting');
    await seedPage('slack/not-applicable', 'slack');
    await seedPage('meetings/pending', 'meeting');
    await seedOutcome('meetings/complete', TERMINAL_AUDIT_SOURCE);
    await seedOutcome('slack/not-applicable', NON_EXTRACTABLE_AUDIT_SOURCE);

    const result = await computeConversationFactsBacklogCheck(engine);
    expect(result.details?.backlog).toBe(1);
    expect(result.details?.completed).toBe(1);
    expect(result.details?.scanned_not_extractable).toBe(1);
  });

  test('an outcome older than the page is stale and returns to backlog', async () => {
    await seedPage('meetings/growing', 'meeting');
    await seedOutcome('meetings/growing', TERMINAL_AUDIT_SOURCE);
    await engine.executeRaw(
      `UPDATE pages
          SET updated_at = updated_at + INTERVAL '1 second'
        WHERE source_id = 'default' AND slug = 'meetings/growing'`,
    );

    const result = await computeConversationFactsBacklogCheck(engine);
    expect(result.details?.backlog).toBe(1);
    expect(result.details?.completed).toBe(0);
  });
});
