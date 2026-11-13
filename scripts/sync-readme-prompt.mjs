#!/usr/bin/env node
// Copies media/ai-setup-prompt.md into the "Set up with AI" block of README.md.
// Run after editing the prompt; a unit test fails if the two differ.
import { readFileSync, writeFileSync } from 'node:fs';

const prompt = readFileSync('media/ai-setup-prompt.md', 'utf8').replace('{{CONTEXT}}\n', '').trim();
const readme = readFileSync('README.md', 'utf8');
const start = readme.indexOf('```text\n', readme.indexOf('## Set up with AI'));
const end = readme.indexOf('\n```', start + 8);
if (start < 0 || end < 0) throw new Error('Could not find the prompt block in README.md');
writeFileSync('README.md', readme.slice(0, start + 8) + prompt + readme.slice(end));
console.log('README prompt block updated.');
