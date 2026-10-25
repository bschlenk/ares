/** Imported before main initializes Electron/native state; never log back into a failed stream. */
let sink:((source:string,error:unknown,fatal:boolean)=>void)|undefined;
const early:{source:string;error:unknown;fatal:boolean}[]=[];
function capture(source:string,error:unknown,fatal=false){
  if(sink){sink(source,error,fatal);return;}
  if(early.length<8)early.push({source,error,fatal});
  if(fatal){process.exitCode=1;setTimeout(()=>process.exit(1),1500).unref();}
}
for(const stream of [process.stdout,process.stderr])stream.on('error',error=>{
  if((error as NodeJS.ErrnoException).code!=='EPIPE')capture('stdio',error);
});
process.on('uncaughtException',error=>capture('main',error,true));
process.on('unhandledRejection',error=>capture('main',error,true));
export function attachDiagnostics(next:NonNullable<typeof sink>){sink=next;for(const entry of early.splice(0))sink(entry.source,entry.error,entry.fatal);}
