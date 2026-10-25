'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { inflateSync } = require('node:zlib');
const { NativeSessionClient } = require('../dist/services/native-client.js');
const { SessionRouter } = require('../dist/services/session-router.js');
const { LocalServiceHost, LocalServiceClient } = require('../dist/services/local-endpoint.js');
const { StdioPeer } = require('./stdio-peer.cjs');
const host = process.env.ARES_HOST || path.resolve(__dirname, '../../build-electron-make/bin/ares-electron-host');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unwrap = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
async function waitRun(native) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const reply = await native.request('session.status'); if (!reply.ok && reply.error === 'stale_epoch') continue; if (unwrap(reply).operation_id) return; await sleep(5); }
  throw new Error('batch child did not start');
}
function imageFixture() {
  // Original hand-assembled IPL3 fixture configures a 4x2 RGBA5551 VI and loops.
  // It does not use a commercial ROM, game data or a user emulator instance.
  const image = Buffer.alloc(0x1000); image.writeUInt32BE(0x80371240); image.write('BATCH VI FIXTURE', 0x20); image[0x3e] = 0x45;
  const code = [0x3c08a440]; // lui t0, 0xa440
  for (const [offset, value] of [[4, 0x2000], [8, 4], [24, 525], [28, 3093], [32, (3093 << 16) | 3093], [36, (108 << 16) | 116], [40, (34 << 16) | 38], [48, 1024], [52, 1024], [0, 0x302]]) {
    code.push((0x3c090000 | value >>> 16) >>> 0, (0x35290000 | value & 0xffff) >>> 0, (0xad090000 | offset) >>> 0);
  }
  code.push(0x1000ffff, 0); // beq zero, zero, self; nop
  code.forEach((word, i) => image.writeUInt32BE(word, 0x40 + i * 4)); return { image, instructions: code.length };
}
function pngPixels(file) {
  const bytes = fs.readFileSync(file), chunks = []; let width, height;
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') chunks.push(data); at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks)), rgb = [];
  for (let y = 0; y < height; y++) { assert.equal(raw[y * (width * 3 + 1)], 0); rgb.push(...raw.subarray(y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1))); }
  return { width, height, rgb };
}
test('real N64 batch: baseline/load/write/active-VI-run/crop sweep, partial effects, ownership and revocation', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync('/tmp/ares-batch-live-'), identity = { session: 'batch-live', epoch: 1 }, { image, instructions } = imageFixture();
  const rom = path.join(dir, 'fixture.z64'), settings = path.join(dir, 'settings.bml'); fs.writeFileSync(rom, image); fs.writeFileSync(settings, '');
  const child = spawn(host, ['--rom', rom, '--system', 'Nintendo 64', '--settings', settings, '--silent', '--paused', '--save-dir', path.join(dir, 'saves'), '--control-session', identity.session], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); let log = ''; child.stderr.on('data', b => log = (log + b).slice(-20000)); child.stdout.resume();
  const native = new NativeSessionClient(child.stdin, child.stdio[3], identity, () => {}), router = new SessionRouter(); router.attach(native);
  const endpoint = new LocalServiceHost(router,async p=>{if(p.operation==='app_status')return {ready:true};throw new Error('unavailable');}); let peer, other;
  try {
    unwrap(await native.request('session.status')); await endpoint.listen(path.join(dir, 'ipc'));
    peer = new StdioPeer(process.execPath, [path.resolve(__dirname, '../dist/mcp/server.js'), '--connection', endpoint.metadataFile, '--instance', endpoint.instance]); await peer.initialize();
    other = new LocalServiceClient(endpoint.metadataFile, endpoint.instance); unwrap(await other.request('session.status'));
    const stepped = await peer.tool('step_instructions', { n: instructions }); assert.equal(stepped.stop_reason, 'instructions_done', JSON.stringify(stepped));
    const rawFile = path.join(dir, 'raw.bs'); assert.equal((await peer.tool('state_save', { path: rawFile })).error, undefined);
    const layout = unwrap(await native.request('n64.state.layout')), initialized = fs.readFileSync(rawFile);
    initialized[layout.offset + layout.size] = 1; // serialized RDRAM identity mapping, fixture only
    const initializedFile = path.join(dir, 'initialized.bs'); fs.writeFileSync(initializedFile, initialized);
    assert.equal((await peer.tool('state_load', { path: initializedFile })).error, undefined);
    const baseline = path.join(dir, 'baseline.bs'); assert.equal((await peer.tool('state_save', { path: baseline })).error, undefined);
    const recorderRegions=await peer.tool('memory_regions');const rdramRegion=recorderRegions.regions.find(r=>r.name==='RDRAM');
    const sample=await peer.tool('memory_sample',{reads:Array.from({length:128},(_,i)=>({region:rdramRegion.id,offset:0x2000+i*4,length:1024}))});assert.equal(sample.error,undefined,JSON.stringify(sample));
    const samplePage=await peer.tool('memory_capture_read',{handle:sample.handle,range:127,length:4});assert.equal(samplePage.frame_reference.native_session,identity.session);assert.equal(samplePage.frame_reference.presentation,null);
    await peer.tool('write_memory',{region:rdramRegion.id,addr:0x2000+127*4,hex_bytes:'aabbccdd'});
    assert.equal((await peer.tool('memory_capture_read',{handle:sample.handle,range:127,length:4})).hex,samplePage.hex);
    await peer.tool('memory_capture_release',{handle:sample.handle});
    const pairedRecorder=await peer.tool('memory_record_start',{reads:Array.from({length:7},(_,i)=>({region:rdramRegion.id,offset:0x2000+i,length:1})),capacity:200,duration:200});
    const recordingSource=`export default async({mem,frames,input})=>{
      mem.writeU32(0x2000,0x12345678,'rdram');
      const typed={u8:mem.u8(0x2000,'rdram'),u16:mem.u16(0x2000,'rdram'),u32:mem.u32(0x2000,'rdram')};
      input({right:true});const samples=[];
      for(let i=0;i<200;i++){await frames(1);samples.push(Array.from({length:7},(_,j)=>mem.u8(0x2000+j,'rdram')))}
      return {typed,samples};
    }`;
    const script = await peer.tool('run_script', {source:recordingSource});
    assert.equal(script.error,undefined,JSON.stringify(script));
    let job=script;for(let i=0;job.state==='running'&&i<500;i++){await sleep(10);job=await peer.tool('operation_status',{operation_id:script.operation_id});}
    assert.equal(job.stop_reason,'script_done',JSON.stringify(job));
    let scriptBytes=Buffer.alloc(0),scriptPage;
    do {scriptPage=await peer.tool('script_result',{offset:scriptBytes.length});scriptBytes=Buffer.concat([scriptBytes,Buffer.from(scriptPage.hex,'hex')]);}while(scriptBytes.length<scriptPage.bytes);
    assert.equal(scriptPage.native_reads,1403);assert.equal(scriptPage.native_read_bytes,1407);
    console.log('SCRIPT_NATIVE_READ_COST_N64',JSON.stringify({reads:scriptPage.native_reads,bytes:scriptPage.native_read_bytes,native_read_ns:scriptPage.native_read_ns,elapsed_seconds:job.elapsed_seconds,result_bytes:scriptBytes.length}));
    const scriptValue=JSON.parse(scriptBytes.toString());assert.deepEqual(scriptValue.typed,{u8:0x12,u16:0x1234,u32:0x12345678});assert.equal(scriptValue.samples.length,200);
    await peer.tool('memory_record_stop',{handle:pairedRecorder.handle});
    const pairedExport=await peer.tool('memory_capture_export',{handle:pairedRecorder.handle,path:path.join(dir,'paired.json')});assert.equal(pairedExport.error,undefined,JSON.stringify(pairedExport));
    const paired=JSON.parse(fs.readFileSync(pairedExport.path,'utf8'));const pairedRows=Array.from({length:200},()=>[]);for(const c of paired.chunks)pairedRows[c.sequence][c.range]=parseInt(c.hex,16);
    assert.deepEqual(pairedRows,scriptValue.samples);
    await peer.tool('memory_capture_release',{handle:pairedRecorder.handle});

    assert.equal((await peer.tool('controller_state')).ports[0].pending.overridden,false);
    const clipJob=await peer.tool('run_script',{path:path.resolve(__dirname,'../examples/scripts/record.ts'),args:{frames:2,setup:[{address:0x2000,hex:'12345678',view:'rdram'}],fields:[{name:'clip',address:0x2000,type:'u32',view:'rdram',clip:true}],clips:[{start:0x12345600,end:0x12345700,name:'fixture:entry'}]}});
    let clipStatus=clipJob;for(let i=0;clipStatus.state==='running'&&i<200;i++){await sleep(10);clipStatus=await peer.tool('operation_status',{operation_id:clipJob.operation_id});}
    assert.equal(clipStatus.stop_reason,'script_done',JSON.stringify(clipStatus));
    const clipPage=await peer.tool('script_result',{operation_id:clipJob.operation_id});const clipValue=JSON.parse(Buffer.from(clipPage.hex,'hex').toString());assert.equal(clipValue.rows.length,2);assert.deepEqual(clipValue.rows[0].clip,{pointer:0x12345678,clip:'fixture:entry'});
    await peer.tool('state_load',{path:baseline});
    await peer.tool('run_frames',{n:1});
    const configuredExecutor=(await peer.tool('emu_status',{})).executor;
    // Execute hooks see pre-instruction registers, including a branch delay slot.
    assert.equal((await peer.tool('write_memory_va',{addr:'0x3000',view:'rdram',hex_bytes:'2508000110000001000000001000ffff00000000'})).error,undefined);
    assert.equal((await peer.tool('cpu_set_registers',{pc:'0xffffffffa0003000',gpr:{t0:7}})).error,undefined);
    const hooked=await peer.tool('run_script',{source:`export default async({cpu,frames,emu})=>{const hits=[];cpu.onExecute(0x3000,r=>hits.push([r.pc,r.gpr[8],r.delay_slot]));cpu.onExecute(0x80003008,r=>hits.push([r.pc,r.gpr[8],r.delay_slot]));await frames(1);return {hits,executor:emu.info().executor}}`});
    let hookJob=hooked;for(let i=0;hookJob.state==='running'&&i<500;i++){await sleep(10);hookJob=await peer.tool('operation_status',{operation_id:hooked.operation_id});}
    assert.equal(hookJob.stop_reason,'script_done',JSON.stringify(hookJob));
    const hookResult=await peer.tool('script_result',{});const hookValue=JSON.parse(Buffer.from(hookResult.hex,'hex').toString());
    assert.deepEqual(hookValue.hits,[['0xffffffffa0003000','0x7',false],['0xffffffffa0003008','0x8',true]]);
    assert.equal(hookValue.executor,'interpreter');
    assert.equal((await peer.tool('emu_status',{})).executor,configuredExecutor);
    await peer.tool('state_load',{path:baseline});
    const scriptState=path.join(dir,'script-state.bs'),scriptPng=path.join(dir,'script.png');
    const ioJob=await peer.tool('run_script',{source:`export default async({args,emu,frames,mem})=>{await emu.loadState(args.baseline);await frames(1);await emu.saveState(args.state);await emu.screenshot(args.png);return {epoch:emu.info().epoch,value:mem.u32(0x2000,'rdram')}}`,args:{baseline,state:scriptState,png:scriptPng},state_paths:[baseline],output_paths:[scriptState,scriptPng],output_path:path.join(dir,'script-result.json')});
    assert.equal(ioJob.error,undefined,JSON.stringify(ioJob));let ioStatus=ioJob;
    for(let i=0;ioStatus.state==='running'&&i<1000;i++){await sleep(10);ioStatus=await peer.tool('operation_status',{operation_id:ioJob.operation_id});}
    assert.equal(ioStatus.stop_reason,'script_done',JSON.stringify({ioStatus,result:await peer.tool('script_result',{})}));
    for(let i=0;i<100&&ioStatus.script_output?.state==='pending';i++){await sleep(10);ioStatus=await peer.tool('operation_status',{operation_id:ioJob.operation_id});}
    assert.equal(ioStatus.script_output?.state,'committed',JSON.stringify(ioStatus));
    const ioResult=await peer.tool('script_result',{});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'script-result.json'),'utf8')),JSON.parse(Buffer.from(ioResult.hex,'hex').toString()));assert.equal(ioResult.artifacts.length,2);assert(fs.existsSync(scriptState));assert(fs.existsSync(scriptPng));
    const cliScript=path.join(dir,'capture.ts'),cliArgs=path.join(dir,'capture-args.json');
    fs.writeFileSync(cliScript,'export default async({args,emu,frames})=>{await emu.loadState(args.state);await frames(3);await emu.loadState(args.state);await frames(200);await emu.screenshot(args.png);return {frames:200,epoch:emu.info().epoch}}');fs.writeFileSync(cliArgs,JSON.stringify({state:'baseline.bs',png:'relative.png'}));
    const captureCli=spawn(process.execPath,[path.resolve(__dirname,'../dist/cli.js'),'run','capture.ts','--args','capture-args.json','--state','baseline.bs','--artifact','relative.png','--video','relative.avi'],{cwd:dir,env:{...process.env,ARES_SERVICE_DIR:path.join(dir,'ipc')}});let captureOut='',captureErr='';captureCli.stdout.on('data',b=>captureOut+=b);captureCli.stderr.on('data',b=>captureErr+=b);assert.equal((await once(captureCli,'close'))[0],0,captureErr);assert.equal(JSON.parse(captureOut).frames,200);assert(fs.existsSync(path.join(dir,'relative.png')));assert.equal(fs.readFileSync(path.join(dir,'relative.avi')).readUInt32LE(48),200);
    await peer.tool('state_load',{path:baseline});
    const timeline = await peer.tool('batch', { steps: [
      { kind: 'state_load', path: baseline },
      { kind: 'memory_record_start', name: 'timeline', reads: [{ region: 'RDRAM', offset: 0x2000, length: 2 }], capacity: 8 },
      { kind: 'input', right: true }, { kind: 'write', addr: '0x2000', hex: '1234', view: 'rdram' }, { kind: 'run', n: 2 },
      { kind: 'input', right: true, b: true }, { kind: 'write', addr: '0x2000', hex: '5678', view: 'rdram' }, { kind: 'run', n: 1 },
      { kind: 'input' }, { kind: 'memory_record_stop', name: 'timeline' }
    ] });
    assert.equal(timeline.stop_reason, 'batch_done', JSON.stringify(timeline));
    assert.equal(timeline.results[2].data.ports[0].pending.buttons, 1 << 7);
    assert.equal(timeline.results[5].data.ports[0].pending.buttons, (1 << 7) | (1 << 1));
    assert.equal(timeline.results[8].data.ports[0].pending.buttons, 0);
    assert.equal((await peer.tool('controller_state')).ports[0].pending.overridden, false);
    const handle = timeline.results[1].data.handle;
    const recorded = await peer.tool('memory_capture_status', { handle });
    assert.equal(recorded.active, false); assert.equal(recorded.next_sequence, 3);
    for (const [sequence, hex] of [[0, '1234'], [1, '1234'], [2, '5678']]) {
      const sample = await peer.tool('memory_capture_read', { handle, sequence, length: 2 });
      assert.equal(sample.hex, hex); assert.equal(sample.frame, sequence + 1);
    }
    const exported = await peer.tool('memory_capture_export', {handle,path:path.join(dir,'capture.json')});
    assert.equal(exported.samples,3,JSON.stringify(exported));
    const bulk=JSON.parse(fs.readFileSync(exported.path,'utf8'));
    assert.deepEqual(bulk.chunks.map(c=>c.hex),['1234','1234','5678']);
    assert.equal(bulk.metadata.dropped,0);
    await peer.tool('memory_capture_release', { handle });
    const inputError = await peer.tool('batch', { steps: [{ kind: 'memory_record_start', name: 'partial', reads: [{ region: 'RDRAM', offset: 0x2000, length: 2 }] }, { kind: 'input', a: true }, { kind: 'run', n: 1 }, { kind: 'state_load', path: path.join(dir, 'missing.bs') }] });
    assert.equal(inputError.stop_reason, 'step_error');
    const partial = await peer.tool('memory_capture_status', { handle: inputError.results[0].data.handle });
    assert.equal(partial.active, false); assert.equal(partial.next_sequence, 1);
    await peer.tool('memory_capture_release', { handle: partial.handle });
    assert.equal((await peer.tool('controller_state')).ports[0].pending.overridden, false);
    for (const [candidate, hex, rgb] of [['red', 'f801', [255, 0, 0]], ['green', '07c1', [0, 255, 0]]]) {
      const output = path.join(dir, `${candidate}.png`);
      const result = await peer.tool('batch', { steps: [
        { kind: 'state_load', path: baseline }, { kind: 'write', addr: '0x2000', hex: hex.repeat(8), view: 'rdram' },
        { kind: 'run', n: 2 }, { kind: 'screenshot', path: output, region: [1, 0, 2, 2], scale: 2 },
        { kind: 'read', addr: '0x2000', length: 16 }
      ] });
      assert.equal(result.error, undefined, JSON.stringify(result)); assert.equal(result.stop_reason, 'batch_done', JSON.stringify(result)); assert.equal(result.steps_completed, 5);
      assert.equal(result.side_effects_rolled_back, false); assert.equal(result.results[2].data.elapsed_frames, 2); assert.equal(result.results[2].data.stop_reason, 'frames_done');
      assert.equal(result.results[4].data.hex, hex.repeat(8));
      const pixels = pngPixels(output); assert.equal(pixels.width, 4); assert.equal(pixels.height, 4); assert.deepEqual(pixels.rgb, Array.from({ length: 16 }, () => rgb).flat());
    }
    const recordingRegion=unwrap(await native.request('memory.regions')).regions.find(r=>r.name==='RDRAM');
    const cpuRanges=await peer.tool('read_memory_many_va',{reads:[{address:'0x80000000',view:'cpu',length:0x6000},{address:'0xa0000000',view:'cpu',length:1024}]});
    assert.equal(cpuRanges.reads[0].length,0x6000);assert.equal(cpuRanges.reads[1].cache_aware,false);
    const memoryRecording=await peer.tool('memory_record_start',{reads:[{region:recordingRegion.id,offset:0,length:0x6400}],capacity:4,duration:8});
    assert.equal(memoryRecording.error,undefined);
    assert.equal((await peer.tool('run_frames',{n:8})).stop_reason,'frames_done');
    const memoryCost=await peer.tool('memory_capture_status',{handle:memoryRecording.handle});
    assert.equal(memoryCost.next_sequence,8);assert.equal(memoryCost.copied_bytes,8*0x6400);assert.equal(memoryCost.transferred_bytes,0);
    console.log('MEMORY_COPY_COST_N64',JSON.stringify({sample_bytes:0x6400,samples:8,max_copy_ns:memoryCost.max_copy_ns,last_copy_ns:memoryCost.last_copy_ns,transferred_bytes:memoryCost.transferred_bytes}));
    const frameSnapshot=await peer.tool('memory_capture_freeze',{handle:memoryRecording.handle,sequence:memoryCost.first_sequence});assert.equal(frameSnapshot.first_frame,memoryCost.first_frame);
    assert.equal((await peer.tool('memory_capture_release',{handle:frameSnapshot.handle})).released,true);assert.equal((await peer.tool('memory_capture_release',{handle:memoryRecording.handle})).released,true);
    const beforeOffline = unwrap(await native.request('n64.debug.registers')), epochBeforeOffline = native.identity.epoch;
    const offline = await peer.tool('state_peek', { path: baseline, addr: '0x2000', length: 16 });
    assert.equal(offline.hex, '00'.repeat(16)); assert.equal(native.identity.epoch, epochBeforeOffline);
    assert.deepEqual(unwrap(await native.request('n64.debug.registers')), beforeOffline);
    const incompatible = path.join(dir, 'incompatible.bs'), incompatibleBytes = fs.readFileSync(baseline); incompatibleBytes.write('v999', 5); fs.writeFileSync(incompatible, incompatibleBytes);
    const incompatibleBatch = await peer.tool('batch', { steps: [{ kind: 'state_load', path: incompatible }, { kind: 'write', addr: '0x2000', hex: 'ff', view: 'rdram' }] });
    assert.equal(incompatibleBatch.stop_reason, 'step_error'); assert.equal(incompatibleBatch.results[0].error, 'unsupported_version'); assert.equal(incompatibleBatch.steps_completed, 0); assert.equal(incompatibleBatch.steps_attempted, 1);
    assert.equal(native.identity.epoch, epochBeforeOffline);
    const failed = await peer.tool('batch', { steps: [{ kind: 'write', addr: '0x2000', hex: 'aa', view: 'rdram' }, { kind: 'read', addr: '0x7fffff', length: 2 }, { kind: 'write', addr: '0x2000', hex: 'bb', view: 'rdram' }] });
    assert.equal(failed.stop_reason, 'step_error'); assert.equal(failed.results.length, 2); assert.equal(failed.results[1].error, 'out_of_bounds');
    assert.equal((await peer.tool('read_memory_va', { addr: '0x2000', length: 1 })).hex, 'aa');
    const keptGoing = await peer.tool('batch', { stop_on_error: false, steps: [{ kind: 'state_load', path: path.join(dir, 'missing.bs') }, { kind: 'read', addr: '0x2000', length: 1 }] });
    assert.equal(keptGoing.stop_reason, 'batch_done'); assert.equal(keptGoing.results[0].ok, false); assert.equal(keptGoing.results[1].data.hex, 'aa');
    const samples = await peer.tool('batch', { steps: Array.from({length:50},()=>[{kind:'run',n:0},{kind:'read',addr:'0x2000',length:1}]).flat() });
    assert.equal(samples.stop_reason, 'batch_done', JSON.stringify({reason:samples.stop_reason,count:samples.steps_completed,bytes:JSON.stringify(samples).length}));
    assert.equal(samples.results.length, 100); assert.equal(samples.steps, undefined);
    const legacy = await peer.tool('batch', {steps:[{kind:'read',addr:'0x2000',length:2}],legacy_results:true});
    assert.deepEqual(legacy.steps,legacy.results);
    const timed = await peer.tool('batch', { max_seconds: 0.05, steps: [{ kind: 'run', n: 1000000 }, { kind: 'write', addr: '0x2000', hex: 'bb', view: 'rdram' }] });
    assert.equal(timed.stop_reason, 'timeout', JSON.stringify(timed)); assert.equal(timed.results.length, 1); assert.equal(timed.results[0].data.state, 'done'); assert.ok(timed.results[0].data.elapsed_frames < 1000000);
    // Interrupt a long run through UI; foreign mutations must remain excluded.
    const pending = peer.tool('batch', { steps: [{ kind: 'run', n: 1000000 }, { kind: 'write', addr: '0x2000', hex: 'bb', view: 'rdram' }] });
    await waitRun(native);
    const activeBeforeOldCancel = unwrap(await native.request('session.status')).operation_id;
    await peer.tool('cancel_operation', { operation_id: timed.results[0].data.operation_id });
    assert.equal(unwrap(await native.request('session.status')).operation_id, activeBeforeOldCancel, 'cancelling an immutable old result must not revoke the new batch');
    unwrap(await other.request('session.status'));
    assert.equal((await other.request('n64.memory.write', undefined, { address: '0x2000', view: 'rdram', hex: 'cc' })).error, 'busy');
    unwrap(await native.request('session.pause'));
    const paused = await pending; assert.equal(paused.stop_reason, 'paused', JSON.stringify(paused)); assert.equal(paused.results.length, 1); assert.equal(paused.results[0].data.stop_reason, 'paused');
    assert.equal((await peer.tool('read_memory_va', { addr: '0x2000', length: 1 })).hex, 'aa');
    // The authenticated parent can cancel its active child through the existing tool.
    const cancelledBatch = peer.tool('batch', { steps: [{ kind: 'state_load', path: baseline }, { kind: 'write', addr: '0x2000', hex: 'aa', view: 'rdram' }, { kind: 'run', n: 1000000 }, { kind: 'write', addr: '0x2000', hex: 'bb', view: 'rdram' }] });
    cancelledBatch.catch(() => {});
    await waitRun(native);
    const cancel = await peer.tool('cancel_operation'); assert.equal(cancel.stop_reason, 'cancelled', JSON.stringify(cancel));
    const cancelled = await cancelledBatch; assert.equal(cancelled.stop_reason, 'cancelled'); assert.equal(cancelled.results.length, 3);
    const requestId=peer.id+1;
    const abortBatch=peer.request('tools/call',{name:'batch',arguments:{steps:[{kind:'run',n:1000000},{kind:'write',addr:'0x2000',hex:'bb',view:'rdram'}]}},2000).catch(()=>undefined);
    await waitRun(native);
    peer.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId,reason:'batch abort regression'}})+'\n');
    for(let i=0;i<200;++i){const status=unwrap(await native.request('session.status'));if(!status.batch_id&&!status.operation_id)break;await sleep(5);}
    const afterAbort=unwrap(await native.request('session.status'));assert.equal(afterAbort.batch_id,null);assert.equal(afterAbort.operation_id,null);assert.equal(afterAbort.paused,true);
    await abortBatch;assert.equal((await peer.tool('read_memory_va',{addr:'0x2000',length:1})).hex,'aa','MCP batch abort prevents following mutations');
    // Human takeover revokes reservation even without an input override.
    const human = peer.tool('batch', { steps: [{ kind: 'run', n: 1000000 }, { kind: 'write', addr: '0x2000', hex: 'bb', view: 'rdram' }] });
    await waitRun(native);
    child.stdin.write('key A 1\n'); const taken = await human; assert.equal(taken.stop_reason, 'host_input', JSON.stringify(taken)); assert.equal(taken.results.length, 1);
    child.stdin.write('key A 0\n'); unwrap(await native.request('session.pause'));
    // Disconnect a parent connection while its separately owned child is running.
    unwrap(await other.request('session.status'));
    const disconnected = other.request('experiment.batch', undefined, { steps: [{ kind: 'run', n: 1000000 }, { kind: 'write', address: '0x2000', hex: 'dd', view: 'rdram' }], timeoutMs: 20000, stopOnError: true });
    const rejected = assert.rejects(disconnected, /app_disconnected/);
    await waitRun(native);
    other.disconnect(); await rejected;
    for (let i = 0; i < 100; i++) { const status = unwrap(await native.request('session.status')); if (!status.batch_id && !status.operation_id) break; await sleep(5); }
    const afterDisconnect = unwrap(await native.request('session.status')); assert.equal(afterDisconnect.batch_id, null); assert.equal(afterDisconnect.operation_id, null); assert.equal(afterDisconnect.paused, true);
    assert.equal((await peer.tool('read_memory_va', { addr: '0x2000', length: 1 })).hex, 'aa');
    // The native lease also excludes mutations in an idle file-I/O gap.
    const idle = unwrap(await native.request('execution.batchBegin', undefined, { timeoutMs: 1000 }, 'batch-idle'));
    assert.equal(unwrap(await native.request('session.status')).batch_id, idle.batch_id);
    assert.equal((await native.request('n64.memory.write', undefined, { address: '0x2000', view: 'rdram', hex: 'ee' }, 'foreign')).error, 'busy');
    unwrap(await native.request('session.pause'));
    assert.equal((await native.request('n64.memory.write', undefined, { address: '0x2000', view: 'rdram', hex: 'ee' }, 'batch-idle')).error, 'busy');
    unwrap(await native.request('execution.release', undefined, undefined, 'batch-idle'));
    const ownedSource=path.join(dir,'owned-load.ts'),ownedOutput=path.join(dir,'owned-load.json');
    fs.writeFileSync(ownedSource,`export default async({emu,frames,input})=>{await emu.loadState(${JSON.stringify(baseline)});input({right:true});await frames(1);await emu.loadState(${JSON.stringify(baseline)});input.set(1,{left:true});await frames(2);return emu.info()}`);
    const cli=spawn(process.execPath,[path.resolve(__dirname,'../dist/cli.js'),'run',ownedSource,'--state',baseline,'--output',ownedOutput],{env:{...process.env,ARES_SERVICE_DIR:path.join(dir,'ipc')}});let cliOut='',cliErr='';cli.stdout.on('data',b=>cliOut+=b);cli.stderr.on('data',b=>cliErr+=b);const [cliCode]=await once(cli,'close');assert.equal(cliCode,0,cliErr);assert.equal(JSON.parse(cliOut).frame,2);assert.equal(fs.readFileSync(ownedOutput,'utf8'),cliOut);
    await peer.close(); peer = undefined; other.close(); await endpoint.close(); router.detach(); native.close(); child.stdin.end('quit\n'); assert.equal((await closed)[0], 0, log);
  } finally {
    if (peer) await peer.close(); other?.close(); await endpoint.close(); router.detach(); native.close();
    if (child.exitCode === null) { child.kill('SIGKILL'); await closed; } fs.rmSync(dir, { recursive: true, force: true });
  }
});
