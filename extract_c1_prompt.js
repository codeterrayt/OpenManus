// extract_c1_prompt.js
// Run this in the frontend context to extract the C1 system prompt
import { c1appLibrary, c1appPromptOptions, openUIC1Library, openUIC1PromptOptions } from '@thesysai/genui-sdk';
import fs from 'fs';

console.log('=== c1appLibrary type:', typeof c1appLibrary);
console.log('=== c1appLibrary keys:', Object.keys(c1appLibrary || {}));
console.log('');
console.log('=== c1appPromptOptions type:', typeof c1appPromptOptions);
console.log('=== c1appPromptOptions:', JSON.stringify(c1appPromptOptions, null, 2));
console.log('');
console.log('=== openUIC1Library type:', typeof openUIC1Library);
console.log('=== openUIC1Library keys:', Object.keys(openUIC1Library || {}));
console.log('');
console.log('=== openUIC1PromptOptions type:', typeof openUIC1PromptOptions);
console.log('=== openUIC1PromptOptions:', JSON.stringify(openUIC1PromptOptions, null, 2));

// Try to generate the prompt
if (c1appLibrary && typeof c1appLibrary.prompt === 'function') {
  console.log('\n=== c1appLibrary.prompt() ===');
  const prompt = c1appLibrary.prompt(c1appPromptOptions);
  console.log(prompt);
  fs.writeFileSync('c1_system_prompt.txt', prompt, 'utf-8');
  console.log('\nSaved to c1_system_prompt.txt');
}

if (openUIC1Library && typeof openUIC1Library.prompt === 'function') {
  console.log('\n=== openUIC1Library.prompt() ===');
  const prompt = openUIC1Library.prompt(openUIC1PromptOptions);
  console.log(prompt);
  fs.writeFileSync('openui_c1_system_prompt.txt', prompt, 'utf-8');
  console.log('\nSaved to openui_c1_system_prompt.txt');
}
