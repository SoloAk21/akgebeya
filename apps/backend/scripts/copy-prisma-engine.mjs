import { copyFile, mkdir, readdir } from 'node:fs/promises';
const source = new URL('../src/generated/prisma/', import.meta.url);
const destination = new URL('../dist/generated/prisma/', import.meta.url);
const engines = (await readdir(source)).filter((file) => file.endsWith('.node'));
if (engines.length === 0) throw new Error('Generate Prisma before building; no native engine found.');
await mkdir(destination, { recursive: true });
await Promise.all(engines.map((file) => copyFile(new URL(file, source), new URL(file, destination))));
