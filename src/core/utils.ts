import fs from 'node:fs';
import path from 'node:path';
import { AIR } from './types.js';

export function ensureDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function saveIR(outPath: string, ir: AIR) {
  ensureDirForFile(outPath);
  fs.writeFileSync(outPath, JSON.stringify(ir, null, 2), 'utf-8');
  console.log(`[AI Tester] IR saved to: ${outPath}`);
}

export function loadIR(irPath: string): AIR {
  const raw = fs.readFileSync(irPath, 'utf-8');
  const json = JSON.parse(raw);
  // minimal validation
  if (!json.version || !json.meta || !Array.isArray(json.steps)) {
    throw new Error('Invalid IR format');
  }
  return json as AIR;
}