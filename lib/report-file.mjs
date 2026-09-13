import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

export async function readReportFile(runsRoot, relative, {maxBytes=Infinity}={}) {
  const parts = relative.split(/[\\/]/);
  if(!parts.length || parts.some(p=>!p || p.startsWith('.'))) throw Error('文件未提供');
  const root = await fs.realpath(runsRoot);
  let cursor = root;
  // Reject even internal symlinks; reports only expose real generated files.
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if((await fs.lstat(cursor)).isSymbolicLink()) throw Error('文件未提供');
  }
  const real = await fs.realpath(cursor);
  if(!real.startsWith(root + path.sep)) throw Error('文件未提供');
  const handle = await fs.open(cursor, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat=await handle.stat();
    if(!stat.isFile()) throw Error('文件未提供');
    if(stat.size>maxBytes)throw Error('文件超过本轮读取容量');
    return await handle.readFile();
  } finally {await handle.close();}
}
