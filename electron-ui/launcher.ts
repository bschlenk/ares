import {spawnWindow} from './sessions/launching.js';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { profileRoot } from './profile.js';

export const usage='Usage: ares [GUI options] | tools | call TOOL [--json FILE | --name VALUE ...] | run SCRIPT [--args FILE] [--state FILE] [--artifact FILE] [--output FILE] [--video FILE] [--retain-result]\nGUI options: --services, --no-services, --instance-name NAME, --session-name NAME, --disable-plugins, --user-data-dir PATH\n';
export function dispatch(args:string[]):'help'|'cli'|'gui' {
  if(args.some(v=>v==='--help'||v==='-h')) {
    if(!args.length || ['--help','-h','call','tools','run'].includes(args[0]))return 'help';
    throw new Error('Unknown command');
  }
  if(['call','tools','run'].includes(args[0])) {
    if(args[0]==='tools'&&args.length!==1||args[0]!=='tools'&&(!args[1]||args[1].startsWith('-')))throw new Error('Missing or invalid command arguments');
    return 'cli';
  }
  const flags=new Set(['--services','--no-services','--disable-plugins']);
  const values=new Set(['--instance-name','--session-name','--user-data-dir']);
  for(let i=0;i<args.length;i++){
    if(flags.has(args[i]))continue;
    if(values.has(args[i])&&args[i+1]&&!args[i+1].startsWith('-')){++i;continue;}
    throw new Error(`Unknown command or option: ${args[i]}`);
  }
  return 'gui';
}
export async function launch(args=process.argv.slice(2)) {
  try {
    const action=dispatch(args);
    if(action==='help'){process.stdout.write(usage);return;}
    if(action==='cli'){process.argv=[process.argv[0],process.argv[1],...args];await import('./cli.js');return;}
    const index=args.indexOf('--user-data-dir');
    const directory=process.env.ARES_PROFILE_DIR||(index>=0?args[index+1]:profileRoot(path.join(os.homedir(),'Library/Application Support'),process.env.ARES_PROFILE));
    const env={...process.env};for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH'])delete env[key];
    spawnWindow({executable:process.execPath,args,env},directory);
  }catch(error){process.stderr.write(String(error)+'\n'+usage);process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void launch();
