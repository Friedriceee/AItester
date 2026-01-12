#!/usr/bin/env node

/**
 * 测试浏览器打包解决方案
 * 这个脚本验证浏览器文件是否被正确打包和访问
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🧪 测试浏览器打包解决方案...\n');

// 1. 检查浏览器安装路径
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || 'C:\\playwright-browsers';
console.log(`📁 浏览器路径: ${browsersPath}`);

if (fs.existsSync(browsersPath)) {
  console.log('✅ 浏览器目录存在');
  
  // 列出目录结构
  console.log('\n📋 浏览器目录内容:');
  try {
    const files = execSync(`dir /s /b "${browsersPath}"`, { encoding: 'utf8' });
    const lines = files.split('\n').filter(line => line.trim());
    
    // 只显示前几行，避免输出过长
    lines.slice(0, 10).forEach(file => {
      console.log(`  ${file}`);
    });
    
    if (lines.length > 10) {
      console.log(`  ... 还有 ${lines.length - 10} 个文件`);
    }
    
    // 检查是否有Windows浏览器文件
    const hasWinBrowser = lines.some(line => line.includes('chrome-win'));
    if (hasWinBrowser) {
      console.log('✅ 找到Windows浏览器文件');
    } else {
      console.log('❌ 未找到Windows浏览器文件');
    }
    
    // 检查是否有macOS浏览器文件（应该被清理）
    const hasMacBrowser = lines.some(line => line.includes('chrome-mac') || line.includes('mac-'));
    if (hasMacBrowser) {
      console.log('⚠️  发现macOS浏览器文件，可能导致长路径问题');
    } else {
      console.log('✅ 未发现macOS浏览器文件');
    }
    
  } catch (error) {
    console.log('❌ 无法列出目录内容:', error.message);
  }
} else {
  console.log('❌ 浏览器目录不存在');
}

// 2. 测试Electron主进程路径设置
console.log('\n🔧 测试Electron路径设置逻辑...');

// 模拟Electron主进程的路径查找逻辑
function testElectronPathLogic() {
  const isPackaged = false; // 测试开发环境
  
  const candidatePaths = isPackaged
    ? [
        path.join('resources', 'playwright-browsers'),
        path.join('resources', 'app.asar.unpacked', 'playwright-browsers'),
        path.join('app', 'playwright-browsers'),
      ]
    : [
        path.join(process.cwd(), 'playwright-browsers'),
        path.join(process.cwd(), 'C:\\playwright-browsers'),
      ];

  console.log('可能的路径:');
  candidatePaths.forEach((p, i) => {
    const exists = fs.existsSync(p);
    console.log(`  ${i + 1}. ${p} ${exists ? '✅' : '❌'}`);
  });
}

testElectronPathLogic();

// 3. 模拟测试 assertBundledBrowser 逻辑
console.log('\n🔍 模拟 assertBundledBrowser 逻辑...');

function mockAssertBundledBrowser() {
  let browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  
  if (!browserRoot) {
    // 模拟 Electron 环境查找
    // 假设当前目录是项目根目录，模拟 app.getAppPath()
    const basePath = process.cwd();
    const candidate = path.join(basePath, 'playwright-browsers');
    
    console.log(`  检查路径: ${candidate}`);
    if (fs.existsSync(candidate)) {
      browserRoot = candidate;
      console.log(`  ✅ 找到浏览器目录: ${browserRoot}`);
      
      try {
        const files = fs.readdirSync(browserRoot);
        const hasChromium = files.some(n => n.startsWith('chromium-') || n.startsWith('chrome-'));
        if (hasChromium) {
          console.log('  ✅ 找到 Chromium 浏览器文件夹');
        } else {
          console.log('  ❌ 目录存在但未找到 Chromium (这在开发环境可能是因为还没下载)');
        }
      } catch (e) {
        console.log(`  ❌ 读取目录失败: ${e.message}`);
      }
      
    } else {
      console.log('  ❌ 未找到浏览器目录 (如果在开发环境且未运行 npm run pw:install，这是正常的)');
    }
  }
}

mockAssertBundledBrowser();


// 4. 测试package.json配置
console.log('\n📦 测试package.json构建配置...');

try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  if (packageJson.build && packageJson.build.files) {
    console.log('✅ 找到构建配置');
    
    const browserConfig = packageJson.build.files.find(f => 
      typeof f === 'object' && f.from && f.from.includes('playwright-browsers')
    );
    
    if (browserConfig) {
      console.log('✅ 找到浏览器打包配置:');
      console.log(`  来源: ${browserConfig.from}`);
      console.log(`  目标: ${browserConfig.to}`);
      console.log(`  过滤器: ${JSON.stringify(browserConfig.filter)}`);
    } else {
      console.log('❌ 未找到浏览器打包配置');
    }
    
    if (packageJson.build.asar === false) {
      console.log('✅ ASAR打包已禁用（避免长路径问题）');
    } else {
      console.log('⚠️  ASAR打包已启用，可能导致长路径问题');
    }
  } else {
    console.log('❌ 未找到构建配置');
  }
} catch (error) {
  console.log('❌ 无法读取package.json:', error.message);
}

console.log('\n🎉 测试完成！');
console.log('如果以上测试都通过，说明浏览器打包解决方案应该可以正常工作。');