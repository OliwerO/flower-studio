// Category: SAFE — read-only; uses the configured DB. Real LLM key required.
//
// Live smoke test for the Ask Blossom assistant.
// Runs ~12 NL questions, forces each to use an expected tool, and prints
// [OK|FAIL] along with the tool used vs expected and the first 120 chars of the answer.
//
// Usage:
//   node backend/scripts/assistant-live-smoke.js
//
// Requires:
//   - ANTHROPIC_API_KEY set (real Claude call — not mocked)
//   - DATABASE_URL or pglite config set (reads production data)
//
// Exit code: always 0 — this is a smoke print, not a CI gate.

import { ask } from '../src/services/assistantService.js';

const today = new Date().toISOString().slice(0, 10);
// Build a YYYY-MM string for the month three months ago (safe for marketing spend)
const threeMonthsAgo = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 7); // YYYY-MM
})();
const lastMonth = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
const lastMonthFrom = `${lastMonth}-01`;
const lastMonthTo = (() => {
  const [y, m] = lastMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${lastMonth}-${String(lastDay).padStart(2, '0')}`;
})();

const QUESTIONS = [
  {
    message: `How many orders were there last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'query_orders',
  },
  {
    message: `What was the total revenue last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'financial_summary',
  },
  {
    message: `Which channel is most profitable last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'channel_efficiency',
  },
  {
    message: `Compare last month (${lastMonthFrom} to ${lastMonthTo}) vs two months before that.`,
    expectTool: 'compare_periods',
  },
  {
    message: `What was the busiest day of the week last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'sales_trends',
  },
  {
    message: `What are the top 5 best-selling products last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'top_products',
  },
  {
    message: `How much did we spend on ads in ${threeMonthsAgo}?`,
    expectTool: 'marketing_spend',
  },
  {
    message: `What flowers are moving fastest in the last 30 days?`,
    expectTool: 'stock_velocity',
  },
  {
    message: `Which supplier had the most waste last month (${lastMonthFrom} to ${lastMonthTo})?`,
    expectTool: 'supplier_scorecard',
  },
  {
    message: `Who hasn't ordered in the last 60 days?`,
    expectTool: 'lapsed_customers',
  },
  {
    message: `Whose birthday or anniversary is coming up in the next 14 days?`,
    expectTool: 'upcoming_occasions',
  },
  {
    message: `What items are in shortfall right now?`,
    expectTool: 'stock_status',
  },
];

async function main() {
  console.log(`\nAsk Blossom live smoke — ${today}\n${'─'.repeat(60)}`);
  let okCount = 0;
  let failCount = 0;

  for (const q of QUESTIONS) {
    try {
      const r = await ask({ message: q.message });
      const usedTool = r.toolResults?.[0]?.name ?? '(no tool)';
      const answerSnippet = r.answer.slice(0, 120).replace(/\n/g, ' ');
      const pass = usedTool === q.expectTool;
      const tag = pass ? '[OK  ]' : '[FAIL]';
      if (pass) okCount++; else failCount++;
      console.log(`${tag} "${q.message.slice(0, 55)}…"`);
      console.log(`       tool: ${usedTool} (expected: ${q.expectTool})`);
      console.log(`       answer: ${answerSnippet}`);
      console.log();
    } catch (err) {
      failCount++;
      console.log(`[FAIL] "${q.message.slice(0, 55)}…"`);
      console.log(`       ERROR: ${err.message}`);
      console.log();
    }
  }

  console.log(`${'─'.repeat(60)}`);
  console.log(`Results: ${okCount} OK, ${failCount} FAIL (out of ${QUESTIONS.length})\n`);
  process.exit(0); // always 0 — smoke print, not CI gate
}

main();
