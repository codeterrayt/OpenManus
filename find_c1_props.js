// find_c1_props.js
import fs from 'fs';

const content = fs.readFileSync('frontend/node_modules/@thesysai/genui-sdk/dist/index.d.ts', 'utf-8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.includes('C1Component') || line.includes('C1ComponentProps')) {
    console.log(`Line ${idx + 1}: ${line}`);
    // Print 5 lines before and after
    for (let i = Math.max(0, idx - 5); i < Math.min(lines.length, idx + 15); i++) {
      console.log(`  [${i + 1}] ${lines[i]}`);
    }
    console.log('---');
  }
});
