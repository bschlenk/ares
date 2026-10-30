import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import {WebSocketServer} from 'ws';
import {PluginNetwork} from '../dist/plugins/network.js';
import {NETWORK_LIMITS as L} from '../dist/plugins/network-contracts.js';
import {validateManifest} from '../dist/plugins/manifest.js';
import {pluginBridgeResult} from '../dist/plugins/admission.js';
import {createPluginNetworking} from '../dist/browser/plugins/network-client.js';
const guard=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(run){
  const seen=[],peers=new Set();let otherOrigin;
  const server=http.createServer((req,res)=>{
    seen.push({url:req.url,headers:req.headers});
    if(req.url==='/hang-headers')return;
    if(req.url==='/hang'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');return;}
    if(req.url==='/gzip'){res.setHeader('content-encoding','gzip');res.end(gzipSync('x'.repeat(100000)));return;}
    if(req.url==='/redirect'){res.writeHead(302,{location:otherOrigin+'/target'});res.end();return;}
    if(req.url==='/loop'){res.writeHead(302,{location:'/loop'});res.end();return;}
    if(req.url==='/empty'){res.writeHead(204);res.end();return;}
    if(req.url==='/error'){res.writeHead(404);res.end('missing');return;}
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.setHeader('content-type','application/json');res.setHeader('set-cookie','browser=secret');res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString(),cookie:req.headers.cookie??null,authorization:req.headers.authorization??null}));});
  });
  const other=http.createServer((req,res)=>{seen.push({url:'other:'+req.url,headers:req.headers});res.end(JSON.stringify(req.headers));});
  const wss=new WebSocketServer({noServer:true});server.on('upgrade',(req,socket,head)=>{
    if(req.url==='/ws-redirect'){socket.end(`HTTP/1.1 302 Found\r\nLocation: ${otherOrigin.replace('http','ws')}/target\r\nContent-Length: 0\r\n\r\n`);return;}
    wss.handleUpgrade(req,socket,head,ws=>{peers.add(ws);ws.on('close',()=>peers.delete(ws));
      if(req.url==='/flood'){for(let i=0;i<70;i++)ws.send('x');}
      else if(req.url==='/large')ws.send('x'.repeat(L.socketMessageBytes+1));
      else ws.on('message',(data,binary)=>ws.send(data,{binary}));
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>other.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;otherOrigin=`http://127.0.0.1:${other.address().port}`;
  const broker=new PluginNetwork(),origins=[origin],call=p=>broker.call('one',origins,p,guard);
  const start=(id,url='/echo',options={})=>call({operation:'start',id,url:origin+url,options});
  const bytes=async id=>{const list=[];for(;;){const c=await call({operation:'read',id});if(c.done)return Buffer.concat(list);list.push(Buffer.from(c.bytes));}};
  const scope=new AbortController(),effects=new Set(),add=dispose=>{const d=()=>{effects.delete(d);return dispose();};effects.add(d);return d;};
  const sdk=createPluginNetworking(p=>pluginBridgeResult(()=>broker.call('one',[origin,origin.replace('http','ws')],p,guard)),scope.signal,add,guard);
  try{await run({seen,peers,broker,origins,origin,otherOrigin,call,start,bytes,scope,effects,sdk});}
  finally{scope.abort();broker.releaseOwner('one');broker.releaseOwner('two');for(const ws of peers)ws.terminate();wss.close();server.closeAllConnections();other.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>other.close(r))]);}
}
const manifest=(capabilities=['network.request'],origins=['https://example.com'])=>({id:'test.network',name:'Network',version:'1.0.0',apiVersion:1,entry:'plugin.js',capabilities,network:{origins},contributes:{}});
test('network manifests normalize exact origins and reject broad or undeclared grants',()=>{
  assert.deepEqual(validateManifest(manifest(undefined,['HTTPS://Example.com:443/'])).network.origins,['https://example.com']);
  assert.deepEqual(validateManifest(manifest(['network.websocket'],['wss://example.com'])).network.origins,['wss://example.com']);
  for(const origin of ['*','https://*.example.com','file:///tmp','https://user:pass@example.com','https://example.com/path','https://example.com?x','https://example.com#x','https://exa\nmple.com'])assert.throws(()=>validateManifest(manifest(undefined,[origin])));
  for(const m of [manifest([],['https://example.com']),manifest(['network.request'],['wss://example.com']),manifest(['network.websocket'],['https://example.com']),manifest(undefined,[]),manifest(undefined,['https://example.com','https://example.com:443']),{...manifest(),network:undefined}])assert.throws(()=>validateManifest(m));
});
test('HTTP posts preserve status/body; redirects check every origin and strip credentials; no cookie jar',()=>fixture(async({broker,origin,otherOrigin,seen,start,call,bytes})=>{
  const head=await start('post','/echo',{method:'POST',headers:{Authorization:'Bearer owned'},body:'{"a":1}'});assert.equal(head.status,200);assert.equal(head.headers['set-cookie'],undefined);
  assert.deepEqual(JSON.parse((await bytes('post')).toString()),{method:'POST',body:'{"a":1}',cookie:null,authorization:'Bearer owned'});
  await start('next');assert.equal(JSON.parse((await bytes('next')).toString()).cookie,null);
  assert.equal((await start('missing','/error')).status,404);assert.equal((await bytes('missing')).toString(),'missing');assert.equal((await start('empty','/empty')).body,false);
  await assert.rejects(broker.call('one',[origin],{operation:'start',id:'bad',url:otherOrigin+'/target',options:{}},guard),/network_origin_denied/);
  await assert.rejects(start('redirect','/redirect'),/network_origin_denied/);assert(!seen.some(r=>r.url.startsWith('other:')));await assert.rejects(start('loop','/loop'),/network_too_many_redirects/);
  assert.equal((await broker.call('one',[origin,otherOrigin],{operation:'start',id:'allowed',url:origin+'/redirect',options:{headers:{Authorization:'secret','X-Secret':'secret'}}},guard)).redirected,true);
  const received=JSON.parse((await bytes('allowed')).toString());assert.equal(received.authorization,undefined);assert.equal(received['x-secret'],undefined);
  for(const url of ['file:///tmp/a','http://user:pass@127.0.0.1/','http://127.0.0.1\n:80/'])await assert.rejects(broker.call('one',[origin],{operation:'start',id:'invalid',url,options:{}},guard),/network_invalid_url/);
}));
test('HTTP streaming, owner cancellation, deadlines, decoded-byte limits and admission are enforced',()=>fixture(async({broker,origins,call,start})=>{
  await start('stream','/hang');assert.match(Buffer.from((await call({operation:'read',id:'stream'})).bytes).toString(),/first/);
  await assert.rejects(broker.call('two',origins,{operation:'cancel',id:'stream'},guard),/network_owner_denied/);
  const pending=call({operation:'read',id:'stream'});await pause(10);await call({operation:'cancel',id:'stream'});await assert.rejects(pending,/network_cancelled/);
  await assert.rejects(start('timeout','/hang-headers',{timeoutMs:30}),/network_timeout/);
  await start('zip','/gzip',{maxResponseBytes:100});await assert.rejects(call({operation:'read',id:'zip'}),/network_response_too_large/);
  for(const headers of [{Cookie:'secret'},{Host:'other'},{'X-A':'a\nb'},{'X-B':'x'.repeat(17000)}])await assert.rejects(start('header','/echo',{headers}),/network_(forbidden_header|invalid_headers|headers_too_large)/);
  for(let i=0;i<L.perOwner;i++)await start('held'+i,'/hang');await assert.rejects(start('overload'),/network_overload/);
  await broker.call('two',origins,{operation:'start',id:'other-owner',url:origins[0]+'/hang',options:{}},guard);
  broker.releaseOwner('one');assert.match(Buffer.from((await broker.call('two',origins,{operation:'read',id:'other-owner'},guard)).bytes).toString(),/first/);await start('after');await call({operation:'cancel',id:'after'});
}));
test('fetch SDK returns native Response streams and disposes consumed, cancelled and aborted effects',()=>fixture(async({sdk,origin,scope,effects,broker})=>{
  const response=await sdk.fetch(origin+'/echo',{method:'POST',body:'snowman ☃'});assert.equal(response.url,origin+'/echo');assert.equal((await response.json()).body,'snowman ☃');assert.equal(effects.size,0);
  const empty=await sdk.fetch(origin+'/empty');assert.equal(empty.status,204);assert.equal(await empty.text(),'');
  const unused=await sdk.fetch(origin+'/hang');await unused.body.cancel();assert.equal(effects.size,0);
  const headerAbort=new AbortController(),headers=sdk.fetch(origin+'/hang-headers',{signal:headerAbort.signal});setTimeout(()=>headerAbort.abort(),10);await assert.rejects(headers,/Abort/);
  const cancel=new AbortController(),stream=await sdk.fetch(origin+'/hang',{signal:cancel.signal}),reader=stream.body.getReader();await reader.read();cancel.abort();await assert.rejects(reader.read(),/Abort/);
  const scoped=await sdk.fetch(origin+'/hang'),pending=scoped.text();scope.abort();broker.releaseOwner('one');await assert.rejects(pending,/Abort/);assert.equal(effects.size,0);
}));
test('WebSockets enforce origins, ownership, redirects, queue/payload bounds and preserve binary/text',()=>fixture(async({broker,origin,otherOrigin})=>{
  const wsOrigin=origin.replace('http','ws'),origins=[wsOrigin],call=p=>broker.call('one',origins,p,guard);
  await assert.rejects(call({operation:'socketOpen',id:'denied',url:otherOrigin.replace('http','ws')+'/echo'}),/network_origin_denied/);await assert.rejects(call({operation:'socketOpen',id:'redirect',url:wsOrigin+'/ws-redirect'}),/network_socket_failed/);
  await call({operation:'socketOpen',id:'socket',url:wsOrigin+'/echo',protocols:['chat']});await call({operation:'socketSend',id:'socket',data:'hello'});assert.deepEqual(await call({operation:'socketRead',id:'socket'}),{type:'message',data:'hello'});
  await call({operation:'socketSend',id:'socket',data:new Uint8Array([0,255])});assert.deepEqual([...((await call({operation:'socketRead',id:'socket'})).data)],[0,255]);
  await assert.rejects(broker.call('two',origins,{operation:'socketClose',id:'socket'},guard),/network_owner_denied/);
  await broker.call('two',origins,{operation:'socketOpen',id:'other-socket',url:wsOrigin+'/echo'},guard);
  const pending=call({operation:'socketRead',id:'socket'});await pause(10);broker.releaseOwner('one');await assert.rejects(pending,/network_cancelled/);
  await broker.call('two',origins,{operation:'socketSend',id:'other-socket',data:'still owned'},guard);assert.equal((await broker.call('two',origins,{operation:'socketRead',id:'other-socket'},guard)).data,'still owned');
  for(const [id,url,error] of [['flood','/flood','network_socket_overflow'],['large','/large','network_socket_failed']]){
    await call({operation:'socketOpen',id,url:wsOrigin+url});await pause(50);let last;for(let i=0;i<75;i++){last=await call({operation:'socketRead',id});if(last.type!=='message')break;}assert.equal(last.type,'error');assert.equal(last.error,error);
  }
}));
test('socket SDK exposes stream, send, close metadata and scope cancellation',()=>fixture(async({sdk,origin,scope,effects,broker})=>{
  const socket=await sdk.connect(origin.replace('http','ws')+'/echo',{protocols:['chat']}),reader=socket.messages.getReader();assert.equal(socket.protocol,'chat');await socket.send('hello');assert.equal((await reader.read()).value,'hello');await socket.close(1000,'done');assert.deepEqual(await socket.closed,{code:1000,reason:'done'});assert.equal((await reader.read()).done,true);assert.equal(effects.size,0);
  const cancelled=await sdk.connect(origin.replace('http','ws')+'/echo');await cancelled.messages.cancel();assert.equal((await cancelled.closed).code,1000);
  const next=await sdk.connect(origin.replace('http','ws')+'/echo'),pending=next.messages.getReader().read();scope.abort();broker.releaseOwner('one');await assert.rejects(pending,/Abort/);assert.equal((await next.closed).code,1006);assert.equal(effects.size,0);
}));
test('registry enforces grants, active scopes and revokes transfers on disable',async()=>{
  const {PluginRegistry}=await import('../dist/plugins/registry.js'),root=await fs.mkdtemp('/tmp/ares-network-registry-'),sources=[];
  await fixture(async({origin})=>{
    let registry;
    try{
      for(const [id,capabilities] of [['allowed',['network.request']],['denied',[]]]){const source=path.join(root,id);sources.push(source);await fs.mkdir(source);const m={...manifest(capabilities,[origin]),id:'test.'+id};if(!capabilities.length)delete m.network;await fs.writeFile(path.join(source,'manifest.json'),JSON.stringify(m));await fs.writeFile(path.join(source,'plugin.js'),'export function activate(){}');}
      const identity={session:'network',epoch:1},native={request:async()=>({protocol:1,id:'r',...identity,ok:true,result:{released:true}})};registry=new PluginRegistry(path.join(root,'bundled'),path.join(root,'data'),native,()=>identity);await registry.initialize(sources);registry.attach();registry.observe({protocol:1,id:'s',...identity,ok:true,result:{paused:false,system:'Game Boy',synthetic:false,capabilities:[]}});
      const tokens={};for(const id of ['allowed','denied']){await registry.enable('test.'+id,true);tokens[id]=registry.catalog().plugins.find(p=>p.manifest?.id==='test.'+id).lease.token;}
      const p={operation:'start',id:'request',url:origin+'/hang',options:{}};await assert.rejects(registry.network(tokens.allowed,p),/plugin_not_ready/);registry.finish(tokens.allowed);registry.finish(tokens.denied);await assert.rejects(registry.network(tokens.denied,p),/plugin_capability_denied/);await assert.rejects(registry.network(tokens.allowed,{operation:'socketOpen',id:'ws',url:origin.replace('http','ws')}),/plugin_capability_denied/);await registry.network(tokens.allowed,p);await registry.enable('test.allowed',false);await assert.rejects(registry.network(tokens.allowed,{operation:'read',id:'request'}),/stale_plugin_scope/);
    }finally{await registry?.close();await fs.rm(root,{recursive:true,force:true});}
  });
});
