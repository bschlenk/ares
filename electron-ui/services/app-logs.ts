import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AppLogEntry { cursor:number; timestamp:string; severity:string; source:string; message:string; instance:string; nativeGeneration?:number; truncated:number }
/** Bounded diagnostic sink. Writes are serialized, and never log their own failures. */
export class AppLogs {
  readonly instance=randomUUID();
  private entries:AppLogEntry[]=[];
  private sequence=0;
  private pending=0;
  private needsSeparator=false;
  private chain=Promise.resolve();
  private fragments=new Map<string,string>();
  private repeats=new Map<string,{at:number;count:number}>();
  lost=0;
  lastError?:AppLogEntry;
  constructor(readonly directory:string, private maxBytes=1024*1024) {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});
    // Recover only a bounded tail from our four regular log files. Restart
    // creates a new cursor generation; retained entries keep their source instance.
    for(const suffix of ['.3','.2','.1','']) {
      let fd:number|undefined;
      try {
        fd=fs.openSync(path.join(directory,'app.jsonl'+suffix),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        const stat=fs.fstatSync(fd);if(!stat.isFile())continue;
        const count=Math.min(stat.size,this.maxBytes+65536),start=stat.size-count;
        const buffer=Buffer.alloc(count);fs.readSync(fd,buffer,0,count,start);
        if(!suffix&&count&&buffer[count-1]!==10)this.needsSeparator=true;
        const lines=buffer.toString('utf8').split('\n');if(start)lines.shift();
        for(const line of lines)try {
          if(line.length>16384)continue;const entry=JSON.parse(line);
          if(!entry||typeof entry.timestamp!=='string'||entry.timestamp.length>64||
            !['info','warn','error','fatal','debug'].includes(entry.severity)||
            typeof entry.source!=='string'||entry.source.length>64||typeof entry.message!=='string'||
            entry.message.length>8192||typeof entry.instance!=='string'||entry.instance.length>64||
            !Number.isSafeInteger(entry.truncated)||entry.truncated<0)continue;
          const restored:AppLogEntry={cursor:++this.sequence,timestamp:entry.timestamp,severity:entry.severity,
            source:entry.source,message:entry.message.replace(/("?token"?\s*[:=]\s*"?)[a-f0-9]{64}/gi,'$1[redacted]'),
            instance:entry.instance,truncated:entry.truncated};
          if(Number.isSafeInteger(entry.nativeGeneration)&&entry.nativeGeneration>=0)restored.nativeGeneration=entry.nativeGeneration;
          this.entries.push(restored);if(this.entries.length>512)this.entries.shift();
          if(restored.severity==='error'||restored.severity==='fatal')this.lastError=restored;
        }catch{}
      }catch{}finally{if(fd!==undefined)fs.closeSync(fd);}
    }
  }
  write(source:string,severity:string,value:unknown,nativeGeneration?:number) {
    const raw=value instanceof Error?value.stack??value.message:String(value);
    const message=raw.slice(0,8192).replace(/("?token"?\s*[:=]\s*"?)[a-f0-9]{64}/gi,'$1[redacted]');
    const key=source+':'+message;
    const prior=this.repeats.get(key), now=Date.now();
    if(prior&&now-prior.at<1000&&++prior.count>8){++this.lost;return;}
    if(!prior||now-prior.at>=1000)this.repeats.set(key,{at:now,count:1});
    if(this.repeats.size>128)this.repeats.delete(this.repeats.keys().next().value!);
    const entry:AppLogEntry={cursor:++this.sequence,timestamp:new Date().toISOString(),severity,source,message,instance:this.instance,nativeGeneration,truncated:Math.max(0,raw.length-8192)};
    this.entries.push(entry);if(this.entries.length>512)this.entries.shift();
    if(severity==='error'||severity==='fatal')this.lastError=entry;
    if(this.pending>=128){++this.lost;return;}
    ++this.pending;
    this.chain=this.chain.then(async()=>{
      const file=path.join(this.directory,'app.jsonl');
      const st=await fs.promises.stat(file).catch(()=>undefined);
      if(st&&st.size>=this.maxBytes){
        await fs.promises.rm(file+'.3',{force:true});
        for(let n=2;n>=1;--n)await fs.promises.rename(file+'.'+n,file+'.'+(n+1)).catch(()=>{});
        await fs.promises.rename(file,file+'.1');this.needsSeparator=false;
      }
      await fs.promises.appendFile(file,(this.needsSeparator?'\n':'')+JSON.stringify(entry)+'\n',{mode:0o600});this.needsSeparator=false;
    }).catch(()=>{++this.lost;this.needsSeparator=true;}).finally(()=>{--this.pending;});
  }
  native(chunk:Buffer,generation:number) {
    const key=String(generation);let text=(this.fragments.get(key)??'')+chunk.toString('utf8');
    let end:number;
    while((end=text.indexOf('\n'))>=0){this.write('native','warn',text.slice(0,end),generation);text=text.slice(end+1);}
    if(text.length>8192){this.write('native','warn',text,generation);text='';}
    this.fragments.set(key,text);
    if(this.fragments.size>4)this.fragments.delete(this.fragments.keys().next().value!);
  }
  endNative(generation:number){const text=this.fragments.get(String(generation));if(text)this.write('native','warn',text,generation);this.fragments.delete(String(generation));}
  read(p:{cursor?:number;limit?:number;generation?:string;source?:string}) {
    if(p.generation!==undefined&&p.generation!==this.instance)throw new Error('stale_log_generation');
    const cursor=p.cursor??0,limit=p.limit??32;
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>64||p.source!==undefined&&typeof p.source!=='string')throw new Error('invalid_log_request');
    const first=this.entries[0]?.cursor??this.sequence+1;
    const entries=this.entries.filter(e=>e.cursor>cursor&&(!p.source||e.source===p.source)).slice(0,limit);
    return {generation:this.instance,entries,cursor:entries.at(-1)?.cursor??this.sequence,lost:this.lost,expired:cursor>0&&cursor<first-1,directory:this.directory,retention:{files:4,file_bytes:this.maxBytes,history:512}};
  }
  flush(){return this.chain;}
}
