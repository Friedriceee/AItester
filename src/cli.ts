#!/usr/bin/env node
import { Command } from 'commander';
import { startRecording } from './core/record.js';
import { replayIR } from './core/replay.js';
import { generateFromIR } from './core/generate.js';

const program = new Command();
program
  .name('ai-tester')
  .description('Playwright-based AI test recorder: record interactions to JSON IR, generate templates, and replay.')
  .version('0.1.0');

program
  .command('record')
  .description('Record user interactions on a target URL to JSON IR.')
  .option('-u, --url <url>', 'Target URL to open and record')
  .option('-o, --out <path>', 'Output IR file path')
  .action(async (opts) => {
    const url: string | undefined = opts.url;
    const out: string | undefined = opts.out;
    if (!url) {
      console.error('Error: --url is required');
      process.exit(1);
    }
    try {
      const session = await startRecording({ url, outPath: out });
      
      const onSigInt = async () => {
        console.log('\n[AI Tester] Stopping recording...');
        await session.stop();
        process.exit(0);
      };
      process.once('SIGINT', onSigInt);

      // Keep the process alive until explicitly stopped
      // The browser closing will also trigger finalization in the core module
    } catch (err) {
      console.error(`Recording failed: ${String(err)}`);
      process.exit(1);
    }
  });

program
  .command('replay')
  .description('Replay a JSON IR by performing actions in the browser.')
  .option('-i, --input <path>', 'Input IR JSON file')
  .action(async (opts) => {
    const input: string | undefined = opts.input;
    if (!input) {
      console.error('Error: --input is required');
      process.exit(1);
    }
    try {
      await replayIR(input);
    } catch (err) {
      console.error(`Replay failed: ${String(err)}`);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate target templates from IR (placeholder: normalize IR).')
  .option('-i, --input <path>', 'Input IR JSON file')
  .option('-f, --format <fmt>', 'Target format (playwright|gherkin|markdown|excel|csv|smart)', 'playwright')
  .option('-o, --out <path>', 'Output file path')
  .action(async (opts) => {
    const input: string | undefined = opts.input;
    const fmt: string = opts.format ?? 'playwright';
    const out: string | undefined = opts.out;
    if (!input) {
      console.error('Error: --input is required');
      process.exit(1);
    }
    try {
      await generateFromIR(input, fmt, out);
    } catch (err) {
      console.error(`Generate failed: ${String(err)}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`CLI error: ${String(err)}`);
  process.exit(1);
});