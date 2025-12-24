import fs from 'node:fs';
import path from 'node:path';

interface AIEvent {
  type: 'click' | 'input' | 'navigation';
  selector?: string;
  value?: string;
  url?: string;
  x?: number;
  y?: number;
  ts?: number;
}

interface AIR {
  version: string;
  meta: {
    url: string;
    startedAt: number;
    finishedAt?: number;
  };
  steps: AIEvent[];
}

export function convertToExcel(irPath: string, outputPath?: string): string {
  const ir: AIR = JSON.parse(fs.readFileSync(irPath, 'utf-8'));
  
  // CSV header
  const csvLines = [
    'Step,Type,Action,Element,Value,Coordinates,Timestamp,Readable Time'
  ];
  
  ir.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    const timestamp = step.ts || 0;
    const readableTime = new Date(timestamp).toLocaleString('zh-CN');
    
    let action = '';
    let element = step.selector || '';
    let value = '';
    let coordinates = '';
    
    switch (step.type) {
      case 'navigation':
        action = `导航到页面`;
        element = 'URL';
        value = (step as any).url || '';
        break;
        
      case 'click':
        action = `点击元素`;
        coordinates = step.x && step.y ? `(${step.x}, ${step.y})` : '';
        break;
        
      case 'input':
        action = `输入文本`;
        value = step.value || '';
        break;
    }
    
    // Escape CSV values
    const escapeCSV = (str: string) => {
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    csvLines.push([
      stepNumber.toString(),
      step.type,
      escapeCSV(action),
      escapeCSV(element),
      escapeCSV(value),
      escapeCSV(coordinates),
      timestamp.toString(),
      escapeCSV(readableTime)
    ].join(','));
  });
  
  const csvContent = csvLines.join('\n');
  
  // Generate output path
  const finalOutputPath = outputPath || (() => {
    const baseName = path.basename(irPath, path.extname(irPath));
    return path.join('generated', `${baseName}.csv`);
  })();
  
  // Ensure directory exists
  const dir = path.dirname(finalOutputPath);
  fs.mkdirSync(dir, { recursive: true });
  
  // Write CSV file
  fs.writeFileSync(finalOutputPath, csvContent, 'utf-8');
  
  return finalOutputPath;
}