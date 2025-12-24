# Playwright AI 测试用例生成器

基于 Playwright 的"所见即所得"AI 测试用例生成工具。你只需在真实页面上点击和输入，系统会自动记录所有交互并生成标准化的测试用例。

## 功能特性

- 自动捕获 click、input、navigation 事件
- 生成标准化的测试步骤描述
- 可重现录制的所有操作步骤
- 支持 Playwright、Gherkin、Markdown 等格式

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 录制测试用例
```bash
# 录制指定网站的用户交互
npm run record -- --url "https://example.com"

# 或使用完整命令
npm run dev record --url "https://example.com" --out "my-test.json"
```

### 3. 回放测试用例
```bash
# 回放录制的测试步骤
npm run replay -- --input "recordings/session-xxx.json"
```

### 4. 生成测试模板
```bash
# 从录制文件生成标准化测试模板
npm run generate -- --input "recordings/session-xxx.json" --format playwright
```

## CLI 命令详解

### 录制命令 (record)
```bash
npm run dev record [选项]

选项:
  -u, --url <url>     目标网站 URL (必需)
  -o, --out <path>    输出文件路径 (可选)
```

**示例:**
```bash
# 录制 GitHub 首页交互
npm run dev record --url "https://github.com"

# 指定输出文件
npm run dev record --url "https://example.com" --out "tests/login-flow.json"
```

### 回放命令 (replay)
```bash
npm run dev replay [选项]

选项:
  -i, --input <path>  输入的 JSON IR 文件 (必需)
```

**示例:**
```bash
npm run dev replay --input "recordings/session-2024-12-17T08-30-45-123Z.json"
```

### 生成命令 (generate)
```bash
npm run dev generate [选项]

选项:
  -i, --input <path>   输入的 JSON IR 文件 (必需)
  -f, --format <fmt>   输出格式 (playwright|gherkin|markdown)
  -o, --out <path>     输出文件路径 (可选)
```

**示例:**
```bash
# 生成 Playwright 测试文件
npm run dev generate --input "recordings/my-test.json" --format playwright

# 生成 Markdown 文档
npm run dev generate --input "recordings/my-test.json" --format markdown --out "docs/test-case.md"
```

## JSON IR 格式说明

生成的中间表示 (IR) 采用以下格式:

```json
{
  "version": "1.0",
  "meta": {
    "url": "https://example.com",
    "startedAt": 1703123456789,
    "finishedAt": 1703123567890
  },
  "steps": [
    {
      "type": "navigation",
      "url": "https://example.com",
      "ts": 1703123456789
    },
    {
      "type": "click",
      "selector": "#login-button",
      "x": 100,
      "y": 200,
      "ts": 1703123460000
    },
    {
      "type": "input",
      "selector": "#username",
      "value": "testuser",
      "ts": 1703123465000
    }
  ]
}
```

## 使用流程

1. **启动录制**: 运行 `npm run dev record --url <目标网站>`
2. **执行操作**: 在打开的浏览器中进行你想要测试的操作
3. **停止录制**: 按 `Ctrl+C` 或关闭浏览器窗口
4. **查看结果**: 录制文件会保存在 `recordings/` 目录下
5. **回放验证**: 使用 `replay` 命令验证录制的准确性
6. **生成模板**: 使用 `generate` 命令导出为所需格式

## 注意事项

- 录制时请确保网络连接稳定
- 建议在录制前清除浏览器缓存和 cookies
- 复杂的 SPA 应用可能需要等待页面完全加载
- 录制文件包含敏感信息时请注意安全

## 故障排除

### 常见问题

**Q: 录制时浏览器没有打开**
A: 确保已安装 Playwright 浏览器: `npx playwright install`

**Q: 某些元素无法被选择器定位**
A: 工具会优先使用 ID，然后是 class，最后是标签名。建议为关键元素添加稳定的 ID

**Q: 回放时步骤失败**
A: 检查目标网站是否发生变化，或网络是否正常
