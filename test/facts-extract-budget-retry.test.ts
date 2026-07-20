import { afterEach, describe, expect, test } from 'bun:test';

import {
  __setChatTransportForTests,
  configureGateway,
  resetGateway,
} from '../src/core/ai/gateway.ts';
import { BudgetExhausted } from '../src/core/budget/budget-tracker.ts';
import { extractFactsFromTurn } from '../src/core/facts/extract.ts';

afterEach(() => {
  __setChatTransportForTests(null);
  resetGateway();
});

describe('facts extraction budget retry semantics', () => {
  test('rethrows BudgetExhausted so callers cannot mark the page complete', async () => {
    configureGateway({
      chat_model: 'anthropic:claude-sonnet-4-6',
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    });
    __setChatTransportForTests(async () => {
      throw new BudgetExhausted('synthetic cap', {
        reason: 'cost',
        spent: 0.25,
        cap: 0.25,
      });
    });

    await expect(extractFactsFromTurn({
      turnText: 'A grounded fact that must be retried.',
      source: 'test:budget-retry',
    })).rejects.toBeInstanceOf(BudgetExhausted);
  });
});
