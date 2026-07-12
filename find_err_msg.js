// find_err_msg.js
import fs from 'fs';

const content = fs.readFileSync('frontend/src/store/useChatStore.ts', 'utf-8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('error') && !line.includes('console.error')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
