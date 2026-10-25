'use strict'
// Complete local lane: private media is explicit, and a skip is a failure.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2)
if(args.length&&!(args.length===2&&args[0]==='--rom'))throw new Error('Usage: npm run test:all -- --rom /path/to/Kirby.z64 (or set ARES_PLUGIN_TEST_ROM)')
const source=args[1]||process.env.ARES_PLUGIN_TEST_ROM
if(!source)throw new Error('Full test lane requires the verified Kirby ROM: pass --rom or set ARES_PLUGIN_TEST_ROM; no test will be silently skipped')
const rom=path.resolve(source)
if(!fs.statSync(rom).isFile())throw new Error('Kirby ROM must be a regular file')
const build=path.resolve(process.env.ARES_NATIVE_BUILD||path.join(root,'../build-electron-make'))
const env={...process.env,ARES_PLUGIN_TEST_ROM:rom,ARES_HOST:path.join(build,'bin/ares-electron-host'),ARES_CPU_FIXTURE:path.join(build,'bin/ares-electron-cpu-fixture'),ARES_TASK_FIXTURE:path.join(build,'bin/ares-electron-task-fixture'),ARES_MATRIX_FIXTURE:path.join(build,'bin/ares-electron-matrix-fixture')}
async function run(command,args,summary=false){
 let tail=''
 const child=spawn(command,args,{cwd:root,env,stdio:['inherit','pipe','inherit']})
 child.stdout.on('data',data=>{process.stdout.write(data);tail=(tail+data).slice(-65536)})
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve(code??(signal?1:0)))})
 if(code!==0)throw new Error(`Test command failed (${code})`)
 if(summary&&(!/^# skipped 0$/m.test(tail)||!/^# fail 0$/m.test(tail)))throw new Error('Full test lane requires zero failures and zero skipped tests')
}
;(async()=>{
 await run('cmake',['--build',build,'--target','ares-electron-host','ares-electron-cpu-fixture','ares-electron-task-fixture','ares-electron-matrix-fixture','-j','4'])
 await run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
 const files=fs.readdirSync(path.join(root,'tests')).filter(file=>file.endsWith('.test.cjs')).sort().map(file=>'tests/'+file)
 await run(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','protocol.test.cjs',...files],true)
 console.log('ALL_TESTS_PASS: all tests selected, zero skipped')
})().catch(error=>{console.error(error.message);process.exitCode=1})
