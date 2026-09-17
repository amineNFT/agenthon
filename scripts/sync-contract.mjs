import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/contracts', { recursive: true });
await copyFile('contracts/agenthon.py', 'public/contracts/agenthon.py');
