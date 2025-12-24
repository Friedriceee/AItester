import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { AIR, ClickEvent, DeepSeekResponse, InputEvent, NavEvent, SmartTestCase } from './types.js';
import { ensureDirForFile, loadIR } from './utils.js';

async function callDeepSeekAPI(prompt: string): Promise<string> {
  const endpoint = process.env.DEEPSEEK_ENDPOINT || 'http://gpt-proxy.jd.com/v1';
  const apiKey = process.env.DEEPSEEK_API_KEY || '41859ebf-78c8-41ad-b27b-61846cbc4701';

  try {
    const response = await axios.post(`${endpoint}/chat/completions`, {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    const data = response.data as DeepSeekResponse;
    
    // 更好的错误处理
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.error('API 响应格式异常:', JSON.stringify(data, null, 2));
      throw new Error('API 响应格式不正确');
    }
    
    const content = data.choices[0]?.message?.content;
    if (!content) {
      console.error('API 响应中没有内容:', JSON.stringify(data.choices[0], null, 2));
      throw new Error('API 响应中没有有效内容');
    }
    
    return content;
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error);
    throw new Error('无法生成智能测试用例，请检查网络连接和API配置');
  }
}

async function generateSmartTestCases(ir: AIR): Promise<SmartTestCase[]> {
  // 敏感词过滤：手机号/长数字/邮箱等统一脱敏，避免接口报敏感词错误
  const sanitize = (text: string) => {
    if (!text) return '';
    // 中国手机号（11位，以1开头）
    let result = text.replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]');
    // 连续6位以上数字（可能是身份证/订单号）
    result = result.replace(/\b\d{6,}\b/g, '[REDACTED_NUM]');
    // 邮箱
    result = result.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
    // URL 查询参数中的可能敏感值（保留键名，隐藏值）
    result = result.replace(/([?&][^=]+)=([^&]+)/g, (_m, k) => `${k}=[REDACTED]`);
    return result;
  };

  // 构建 prompt，包含所有事件的简化描述（已脱敏）
  const eventsDescription = ir.steps.map((step, index) => {
    switch (step.type) {
      case 'navigation':
        return `${index + 1}. 导航到: ${sanitize((step as NavEvent).url)}`;
      case 'click':
        return `${index + 1}. 点击元素: ${sanitize((step as ClickEvent).selector)}`;
      case 'input':
        const inputStep = step as InputEvent;
        return `${index + 1}. 在 ${sanitize(inputStep.selector)} 输入: "${sanitize(inputStep.value)}"`;
      default:
        return `${index + 1}. 未知操作`;
    }
  }).join('\n');

  const prompt = `你是资深测试工程师。请把下面"用户操作记录"整理为专业测试用例，输出【纯 JSON 数组】且不要任何多余文字。

【重要约束】
1) 合并连续输入：同一字段多次输入仅保留最终值（如 1→19 只写"输入19"一次）。
2) 用例中不得出现 URL、selector、DOM、控件 id/class 等技术信息；页面与字段都用业务语言表达（如"团购编辑页""库存""限购""价格""保存"）。
3) 每条用例包含：stepNumber, description, preconditions, expectedResult（stepNumber 从1递增）。
4) 对涉及数值/必填的字段，除主流程外补 1–2 条代表性的校验用例：
   - 必填为空 → 保存失败并提示"不能为空/请填写"
   - 数值 0/负数/非数字（按字段类型取其一）→ 保存失败并提示"需大于0/请输入大于0的整数"
5) 预期结果写可验证点：保存成功/失败提示、再次进入页面的配置回显、前端展示或下单流程变化。

【用户操作记录】
${eventsDescription}

仅输出 JSON 数组。`;

  try {
    // 首次调用（已做基础脱敏）
    let response: string;
    try {
      response = await callDeepSeekAPI(prompt);
    } catch (e) {
      // 若仍失败，做更激进的脱敏（移除所有数字）
      const aggressivePrompt = prompt.replace(/\d/g, 'X');
      console.log('[AI Tester] 检测到敏感信息，已进行更强脱敏后重试...');
      response = await callDeepSeekAPI(aggressivePrompt);
    }
    
    // 尝试解析 JSON 响应
    const cleanResponse = response.trim();
    let jsonStart = cleanResponse.indexOf('[');
    let jsonEnd = cleanResponse.lastIndexOf(']') + 1;
    
    if (jsonStart === -1 || jsonEnd === 0) {
      throw new Error('API 响应格式不正确');
    }
    
    const jsonStr = cleanResponse.substring(jsonStart, jsonEnd);
    const testCases = JSON.parse(jsonStr) as SmartTestCase[];
    
    return testCases;
  } catch (error) {
    console.error('解析智能测试用例失败:', error);
    // 返回基础的测试用例作为后备方案
    return [{
      stepNumber: 1,
      description: '执行录制的用户操作流程',
      preconditions: '系统正常运行，用户具备相应权限',
      expectedResult: '所有操作成功执行，系统状态符合预期'
    }];
  }
}

export async function generateFromIR(inputPath: string, fmt: string, outPath?: string) {
  // 兼容打包后相对路径：尝试 userData/recordings，再回退到 cwd/recordings，最后解析为绝对路径
  const resolveInputPath = () => {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }

    const candidates: string[] = [];

    // electron userData
    if (process.versions?.electron) {
      try {
        const { app } = require('electron') as typeof import('electron');
        const userDataBase = app.getPath('userData');
        candidates.push(path.join(userDataBase, inputPath));
        candidates.push(path.join(userDataBase, 'recordings', path.basename(inputPath)));
      } catch {
        // ignore
      }
    }

    // cwd fallbacks
    candidates.push(path.join(process.cwd(), inputPath));
    candidates.push(path.join(process.cwd(), 'recordings', path.basename(inputPath)));
    candidates.push(path.resolve(inputPath));

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // 如果都不存在，仍返回最后一个，loadIR 会抛出明确错误
    return candidates[candidates.length - 1];
  };

  const resolvedInput = resolveInputPath();

  // 输出目录基准：优先 userData/generated，其次 cwd/generated
  const defaultOutBase = (() => {
    if (process.versions?.electron) {
      try {
        const { app } = require('electron') as typeof import('electron');
        return path.join(app.getPath('userData'), 'generated');
      } catch {
        return path.join(process.cwd(), 'generated');
      }
    }
    return path.join(process.cwd(), 'generated');
  })();

  // 清洗 outPath：去除首尾引号和首尾空格
  const sanitizeOutPath = (p?: string) => {
    if (!p) return '';
    return p.trim().replace(/^['"]|['"]$/g, '');
  };

  // 根据格式决定默认文件名和扩展名；如传入的是目录则追加文件名
  const resolveOutPath = (rawOut: string | undefined, baseName: string, ext: string) => {
    const cleaned = sanitizeOutPath(rawOut);
    const fileName = `${baseName}${ext}`;
    if (!cleaned) return path.join(defaultOutBase, fileName);
    const abs = path.resolve(cleaned);
    if (path.extname(abs)) return abs; // 已包含扩展名，直接使用
    return path.join(abs, fileName);    // 传入目录时自动附加文件名
  };

  const ir = loadIR(resolvedInput);

  if (fmt === 'smart') {
    // Generate smart test cases using AI
    console.log('[AI Tester] 正在使用 AI 生成智能测试用例...');
    
    try {
      const smartTestCases = await generateSmartTestCases(ir);
      
      // Generate CSV format for smart test cases
      const csvLines = [
        '步骤,测试步骤描述,前置条件,预期结果'
      ];
      
      smartTestCases.forEach(testCase => {
        // Escape CSV values
        const escapeCSV = (str: string) => {
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        
        csvLines.push([
          testCase.stepNumber.toString(),
          escapeCSV(testCase.description),
          escapeCSV(testCase.preconditions),
          escapeCSV(testCase.expectedResult)
        ].join(','));
      });
      
      const csvContent = csvLines.join('\n');
      
      // Generate output path
      const target = resolveOutPath(
        outPath,
        `${path.basename(inputPath, path.extname(inputPath))}_smart_testcases`,
        '.csv'
      );
      
      // Ensure directory exists
      ensureDirForFile(target);
      
      // Write CSV file
      fs.writeFileSync(target, csvContent, 'utf-8');
      console.log(`[AI Tester] 智能测试用例已生成到: ${target}`);
      return;
      
    } catch (error) {
      console.error('生成智能测试用例失败:', error);
      console.log('回退到标准 CSV 格式...');
      // Fall back to regular CSV format
    }
  }

  if (fmt === 'excel' || fmt === 'csv') {
    // Generate Excel/CSV format inline
    const csvLines = [
      'Step,Type,Action,Element,Value,Coordinates,Timestamp,Readable Time'
    ];
    
    ir.steps.forEach((step, index) => {
      const stepNumber = index + 1;
      const timestamp = step.ts || 0;
      const readableTime = new Date(timestamp).toLocaleString('zh-CN');
      
      let action = '';
      let element = '';
      let value = '';
      let coordinates = '';
      
      if (step.type === 'click' || step.type === 'input') {
        element = (step as ClickEvent | InputEvent).selector || '';
      }
      if (step.type === 'input') {
        value = (step as InputEvent).value || '';
      }
      if (step.type === 'click') {
        const clickStep = step as ClickEvent;
        coordinates = clickStep.x && clickStep.y ? `(${clickStep.x}, ${clickStep.y})` : '';
      }
      
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
    const target = resolveOutPath(
      outPath,
      path.basename(inputPath, path.extname(inputPath)),
      '.csv'
    );
    
    // Ensure directory exists
    ensureDirForFile(target);
    
    // Write CSV file
    fs.writeFileSync(target, csvContent, 'utf-8');
    console.log(`[AI Tester] Generated Excel/CSV to: ${target}`);
    return;
  }

  // For other formats, normalize and re-save IR
  const normalized: AIR = {
    version: '1.0',
    meta: ir.meta,
    steps: ir.steps.map(s => {
      // minimal normalization
      if (s.type === 'click') {
        return { type: 'click', selector: (s as ClickEvent).selector } as ClickEvent;
      }
      if (s.type === 'input') {
        const val = (s as InputEvent).value ?? '';
        return { type: 'input', selector: (s as InputEvent).selector, value: val } as InputEvent;
      }
      if (s.type === 'navigation') {
        return { type: 'navigation', url: (s as NavEvent).url } as NavEvent;
      }
      return s;
    }),
  };

  const target = resolveOutPath(
    outPath,
    path.basename(inputPath, path.extname(inputPath)),
    '.normalized.json'
  );

  ensureDirForFile(target);
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2), 'utf-8');
  console.log(`[AI Tester] Generated (${fmt}) to: ${target}`);
}