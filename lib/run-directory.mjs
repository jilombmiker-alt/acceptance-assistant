import fs from 'node:fs/promises';
import path from 'node:path';

// The final mkdir is exclusive: concurrent callers cannot both own a run.
export async function createRunDirectory(out) {
  const absolute = path.resolve(out);
  await fs.mkdir(path.dirname(absolute), {recursive: true});
  try {await fs.mkdir(absolute, {mode: 0o700});}
  catch (error) {
    if(error.code === 'EEXIST') throw Error('结果目录已存在，拒绝覆盖已有证据；请指定新的运行目录');
    throw error;
  }
  return absolute;
}
