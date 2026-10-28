#pragma once
#include <quickjs.h>
#include <atomic>
#include <charconv>
#include <chrono>
#include <functional>
#include <string>
#include <vector>
#include <map>
#include "execution-service.hpp"
#include "script-job-queue.hpp"

// One isolated runtime per exclusive job. Only the emulation thread enters JS.
struct ScriptService {
  using Clock = std::chrono::steady_clock;
  JSRuntime* runtime = nullptr;
  JSContext* context = nullptr;
  JSValue promise = JS_UNDEFINED, resolve = JS_UNDEFINED, hostResolve=JS_UNDEFINED, hostReject=JS_UNDEFINED;
  std::string hostRequest, hostKind, artifacts="[]";
  unsigned artifactCount=0;
  std::function<ControlResult(const std::string&,const std::vector<std::string>&)> demonstration;
  ScriptJobQueue jobQueue;
  uint64_t hostId=0;
  bool hostWaiting=false;
  ExecutionService* execution = nullptr;
  bool* paused = nullptr;
  uint64_t readCalls=0, readBytes=0, readNs=0;
  uint64_t lastOperation = 0;
  uint64_t epoch = 0, target = 0, framesUsed = 0, frameLimit = 1000000;
  std::string owner, source, args, result, error, logs = "[]";
  struct Completion {std::string owner,result,error,logs,artifacts,reason; uint64_t epoch,reads,bytes,ns; Clock::time_point expires;};
  std::map<uint64_t,Completion> completions;
  void expireCompletions(){for(auto it=completions.begin();it!=completions.end();)if(it->second.expires<Clock::now())it=completions.erase(it);else ++it;}
  size_t expected = 0, logBytes = 0;
  bool waiting = false, running = false, readOnly = false, observing = false, completionTicket = true;
  uint64_t observedFrame=UINT64_MAX, publishedFrame=0, observerEvery=4, publishedSequence=0;
  std::function<void(const ScriptService&)> onSample;
  uint64_t observerReadBytes=0,observerSkipped=0,lastPublishedBoundary=0;
  unsigned observerBudgetMs=2;bool observerPush=false,observerOrigin=false;
  struct Hook { uint32_t address; JSValue callback; bool active=true; };
  std::vector<Hook> hooks;
  uint64_t hookFrame=UINT64_MAX, hookCount=0;
  Clock::duration hookCost{};
  std::function<bool(uint64_t,uint32_t&)> normalizeHook;
  std::function<void(bool)> hooksChanged;

  Clock::time_point deadline, budget;
  std::function<bool()> cancelled;
  std::function<ControlResult(uint64_t, const std::string&, size_t, std::vector<uint8_t>&)> read;
  std::function<ControlResult(uint64_t, const std::string&, const std::vector<uint8_t>&)> write;
  std::function<ControlResult(const std::vector<std::string>&)> input;
  std::function<void()> cleanup;
  std::function<ControlResult(const std::string&,uint32_t,uint32_t,std::vector<uint8_t>&)> regionRead;
  std::function<std::string()> info;

  ~ScriptService() { destroy(); }
  void destroy() {
    if(context) { for(auto& hook:hooks)JS_FreeValue(context,hook.callback);hooks.clear(); JS_FreeValue(context,hostResolve);JS_FreeValue(context,hostReject); JS_FreeValue(context, promise); JS_FreeValue(context, resolve); JS_FreeContext(context); }
    if(runtime) JS_FreeRuntime(runtime);
    runtime=nullptr;context=nullptr;promise=resolve=hostResolve=hostReject=JS_UNDEFINED;waiting=false;hostWaiting=false;hostRequest.clear();
  }
  static ScriptService& self(JSContext* c) { return *static_cast<ScriptService*>(JS_GetContextOpaque(c)); }
  static int interrupt(JSRuntime*, void* opaque) {
    auto& s=*static_cast<ScriptService*>(opaque);
    return Clock::now()>=s.deadline || Clock::now()>=s.budget || (s.cancelled && s.cancelled());
  }
  std::string valueText(JSValueConst value,const char* fallback) {
    size_t length=0;const char* text=JS_ToCStringLen(context,&length,value);if(!text)return fallback;
    size_t end=std::min(length,size_t(4096));while(end<length&&end&&(uint8_t(text[end])&0xc0)==0x80)--end;
    std::string out(text,end);JS_FreeCString(context,text);return out;
  }
  std::string exception() {
    JSValue value=JS_GetException(context);auto out=valueText(value,"script_exception");JS_FreeValue(context,value);return out;
  }
  static JSValue fail(JSContext* c,const std::string& message) { return JS_ThrowInternalError(c,"%s",message.c_str()); }
  static bool number(JSContext* c,JSValueConst v,uint64_t& n,uint64_t max=0xffffffffull) {
    double x;if(JS_ToFloat64(c,&x,v)<0||!std::isfinite(x)||x<0||x>max||std::floor(x)!=x)return false;n=uint64_t(x);return true;
  }
  static bool address(JSContext* c,JSValueConst v,uint64_t& n) {
    if(JS_IsNumber(v))return number(c,v,n);
    size_t length=0;const char* text=JS_ToCStringLen(c,&length,v);if(!text)return false;if(length>32){JS_FreeCString(c,text);return false;}std::string value(text,length);JS_FreeCString(c,text);
    int base=10;const char* begin=value.data();if(value.starts_with("0x")||value.starts_with("0X")){begin+=2;base=16;}
    auto parsed=std::from_chars(begin,value.data()+value.size(),n,base);return parsed.ec==std::errc{}&&parsed.ptr==value.data()+value.size();
  }
  static JSValue memoryRead(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t address,length;
    if(argc!=3||!ScriptService::address(c,argv[0],address)||!number(c,argv[1],length,65536)||!length)return fail(c,"invalid_memory_range");
    if(!JS_IsString(argv[2]))return fail(c,"invalid_memory_view");
    const char* view=JS_ToCString(c,argv[2]);if(!view)return JS_EXCEPTION;std::string v=view;JS_FreeCString(c,view);
    if(s.observing&&(length>65536-s.observerReadBytes))return fail(c,"observer_copy_budget");if(s.observing)s.observerReadBytes+=length;
    auto began=Clock::now();std::vector<uint8_t> bytes;auto r=s.read(address,v,length,bytes);++s.readCalls;s.readBytes+=bytes.size();s.readNs+=std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now()-began).count();if(!r.error.empty())return fail(c,r.error);s.jobQueue.progress();
    return JS_NewArrayBufferCopy(c,bytes.data(),bytes.size());
  }
  static JSValue region(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t offset,length;
    if(argc!=3||!number(c,argv[1],offset)||!number(c,argv[2],length,65536)||!length)return fail(c,"invalid_memory_range");
    size_t size;const char* name=JS_ToCStringLen(c,&size,argv[0]);if(!name)return JS_EXCEPTION;if(size>256){JS_FreeCString(c,name);return fail(c,"invalid_region");}std::string id(name,size);JS_FreeCString(c,name);
    if(s.observing&&(length>65536-s.observerReadBytes))return fail(c,"observer_copy_budget");if(s.observing)s.observerReadBytes+=length;
    auto began=Clock::now();std::vector<uint8_t> bytes;auto r=s.regionRead(id,offset,length,bytes);++s.readCalls;s.readBytes+=bytes.size();s.readNs+=std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now()-began).count();if(!r.error.empty())return fail(c,r.error);s.jobQueue.progress();
    return JS_NewArrayBufferCopy(c,bytes.data(),bytes.size());
  }
  static JSValue position(JSContext* c,JSValueConst,int,JSValueConst*) {
    auto& s=self(c);auto json=s.info();return JS_ParseJSON(c,json.data(),json.size(),"emu-info");
  }
  static JSValue memoryWrite(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t address;
    if(s.readOnly)return fail(c,"read_only_callback");
    if(argc!=3||!ScriptService::address(c,argv[0],address))return fail(c,"invalid_memory_range");
    size_t length=0;uint8_t* data=JS_GetArrayBuffer(c,&length,argv[1]);
    if(!data||!length||length>1024)return fail(c,"invalid_memory_range");
    if(!JS_IsString(argv[2]))return fail(c,"invalid_memory_view");
    const char* view=JS_ToCString(c,argv[2]);if(!view)return JS_EXCEPTION;std::string v=view;JS_FreeCString(c,view);
    auto r=s.write(address,v,std::vector<uint8_t>(data,data+length));if(!r.error.empty())return fail(c,r.error);s.jobQueue.progress();return JS_UNDEFINED;
  }
  static JSValue advance(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t n;
    if(s.readOnly)return fail(c,"read_only_callback");
    if(argc!=1||!number(c,argv[0],n,1000000)||s.waiting||s.hostWaiting||n>s.frameLimit-s.framesUsed)return fail(c,"invalid_frame_advance");
    if(n&&!s.execution->supported)return fail(c,"frame_boundary_unavailable");
    JSValue functions[2];JSValue p=JS_NewPromiseCapability(c,functions);if(JS_IsException(p))return p;
    JS_FreeValue(c,functions[1]);s.resolve=functions[0];s.waiting=true;s.framesUsed+=n;s.target=s.execution->frame+n;
    if(n){*s.paused=false;if(s.execution->onStart)s.execution->onStart();}
    return p;
  }
  static JSValue setInput(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);if(s.readOnly)return fail(c,"read_only_callback");if(argc!=4)return fail(c,"invalid_input");
    std::vector<std::string> values;
    for(int i=0;i<4;++i){size_t length;const char* text=JS_ToCStringLen(c,&length,argv[i]);if(!text)return JS_EXCEPTION;if(length>32){JS_FreeCString(c,text);return fail(c,"invalid_input");}values.emplace_back(text,length);JS_FreeCString(c,text);}
    auto r=s.input(values);if(!r.error.empty())return fail(c,r.error);s.jobQueue.progress();return JS_UNDEFINED;
  }
  static JSValue log(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);if(argc!=1)return fail(c,"invalid_log");
    size_t length;const char* text=JS_ToCStringLen(c,&length,argv[0]);if(!text)return JS_EXCEPTION;
    if(length>4096 || s.logBytes+length>16384){JS_FreeCString(c,text);return fail(c,"log_limit");}
    JSValue string=JS_NewStringLen(c,text,length);JS_FreeCString(c,text);if(JS_IsException(string))return string;
    JSValue json=JS_JSONStringify(c,string,JS_UNDEFINED,JS_UNDEFINED);JS_FreeValue(c,string);if(JS_IsException(json))return json;
    size_t encodedLength;const char* encoded=JS_ToCStringLen(c,&encodedLength,json);
    if(!encoded){JS_FreeValue(c,json);return JS_EXCEPTION;}
    if(s.logs.size()+encodedLength+1>16384){JS_FreeCString(c,encoded);JS_FreeValue(c,json);return fail(c,"log_limit");}
    if(s.logs.size()>2)s.logs.insert(s.logs.size()-1,",");s.logs.insert(s.logs.size()-1,std::string(encoded,encodedLength));s.logBytes+=length;
    JS_FreeCString(c,encoded);JS_FreeValue(c,json);return JS_UNDEFINED;
  }
  static JSValue demo(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);if(s.readOnly||!s.demonstration||argc!=2)return fail(c,"invalid_demonstration");
    const char* method=JS_ToCString(c,argv[0]);const char* words=JS_ToCString(c,argv[1]);if(!method||!words){if(method)JS_FreeCString(c,method);if(words)JS_FreeCString(c,words);return JS_EXCEPTION;}
    std::string name=method,text=words;JS_FreeCString(c,method);JS_FreeCString(c,words);
    if(text.size()>4096||name!="request"&&name!="status"&&name!="start"&&name!="stop"&&name!="cancel"&&name!="replay")return fail(c,"invalid_demonstration");
    std::istringstream stream(text);std::vector<std::string> args;std::string word;while(stream>>word)args.push_back(word);
    auto result=s.demonstration("n64.demo."+name,args);if(!result.error.empty())return fail(c,result.error.c_str());return JS_ParseJSON(c,result.json.data(),result.json.size(),"demonstration");
  }
  static JSValue host(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);if(s.readOnly||s.waiting||s.hostWaiting||argc!=2||s.hostId>=64||!JS_IsString(argv[1]))return fail(c,"invalid_host_work");
    size_t kindLength;const char* kind=JS_ToCStringLen(c,&kindLength,argv[0]);if(!kind)return JS_EXCEPTION;if(kindLength>32){JS_FreeCString(c,kind);return fail(c,"invalid_host_work");}s.hostKind.assign(kind,kindLength);JS_FreeCString(c,kind);
    if(s.hostKind!="state_load"&&s.hostKind!="state_save"&&s.hostKind!="screenshot"&&s.hostKind!="input_export"&&s.hostKind!="input_import")return fail(c,"invalid_host_work");
    if(s.hostKind!="state_load"&&s.artifactCount>=8)return fail(c,"artifact_limit");
    JSValue encoded=JS_JSONStringify(c,argv[1],JS_UNDEFINED,JS_UNDEFINED);if(JS_IsException(encoded))return encoded;
    size_t length;const char* text=JS_ToCStringLen(c,&length,encoded);if(!text||length>8192){if(text)JS_FreeCString(c,text);JS_FreeValue(c,encoded);return fail(c,"invalid_path");}
    s.hostRequest="{\"id\":"+std::to_string(++s.hostId)+",\"kind\":"+controlQuote(s.hostKind)+",\"path\":"+std::string(text,length)+"}";
    JS_FreeCString(c,text);JS_FreeValue(c,encoded);
    JSValue functions[2];auto promise=JS_NewPromiseCapability(c,functions);if(JS_IsException(promise))return promise;
    s.hostResolve=functions[0];s.hostReject=functions[1];s.hostWaiting=true;return promise;
  }
  static JSValue hook(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t address;uint32_t physical;
    if(s.readOnly||argc!=2||s.hooks.size()>=64||!ScriptService::address(c,argv[0],address)||address%4||!JS_IsFunction(c,argv[1])||!s.normalizeHook||!s.normalizeHook(address,physical))return fail(c,"invalid_execute_hook");
    s.hooks.push_back({physical,JS_DupValue(c,argv[1])});if(s.hooksChanged)s.hooksChanged(true);
    return JS_NewUint32(c,s.hooks.size()-1);
  }
  static JSValue unhook(JSContext* c,JSValueConst,int argc,JSValueConst* argv) {
    auto& s=self(c);uint64_t id;if(s.readOnly||argc!=1||!number(c,argv[0],id)||id>=s.hooks.size())return fail(c,"invalid_hook");
    s.hooks[id].active=false;return JS_UNDEFINED;
  }
  bool executeHook(uint32_t address,const std::string& registers) {
    if(!running||!error.empty())return false;
    if(hookFrame!=execution->frame){hookFrame=execution->frame;hookCount=0;hookCost=Clock::duration::zero();}
    for(auto& hook:hooks)if(hook.active&&hook.address==address) {
      if(++hookCount>4096||hookCost>=std::chrono::milliseconds(25)){error="hook_callback_limit";return false;}
      auto started=Clock::now();budget=started+std::chrono::milliseconds(25)-hookCost;
      JSValue snapshot=JS_ParseJSON(context,registers.data(),registers.size(),"registers");
      if(JS_IsException(snapshot)){error=exception();return false;}
      readOnly=true;JSValue value=JS_Call(context,hook.callback,JS_UNDEFINED,1,&snapshot);readOnly=false;JS_FreeValue(context,snapshot);
      hookCost+=Clock::now()-started;
      if(JS_IsException(value))error=exception();
      else if(JS_PromiseState(context,value)>=0||JS_IsJobPending(runtime))error="async_hook_callback";
      JS_FreeValue(context,value);if(!error.empty())return false;
    }
    return true;
  }
  void finish(const std::string& reason) {
    if(!running)return;
    running=false;waiting=false;
    if(observing&&observerPush&&onSample&&(reason!="observer_stopped"||!error.empty())&&reason!="disconnected"&&reason!="shutdown"){
      if(error.empty())error=reason;publishedFrame=execution->frame;++publishedSequence;onSample(*this);
    }
    if(hooksChanged)hooksChanged(false);
    if(cleanup)cleanup();
    if(!observing && execution->active && execution->active->owner==owner)execution->complete(reason,*paused);
    if(!observing && execution->reservation && execution->reservation->owner==owner)execution->reservation.reset();
    if(!observing&&completionTicket)completions.emplace(lastOperation,Completion{owner,result,error,logs,artifacts,reason,epoch,readCalls,readBytes,readNs,Clock::now()+std::chrono::seconds(60)});
    destroy();
  }
  void pump(bool originBoundary=false) {
    if(!running)return;
    if(observing) {
      if(observerOrigin!=originBoundary)return;
      if(Clock::now()>=deadline){error="observer_deadline";finish("observer_stopped");return;}
      const auto coordinate=observerOrigin?ares::Nintendo64::executionCoordinate.originCommit:execution->frame;
      if(*paused || execution->active || execution->reservation || observedFrame==coordinate || !originBoundary&&!execution->atBoundary)return;
      observedFrame=coordinate;
      if(observedFrame%observerEvery)return;
      const auto due=(observedFrame-lastPublishedBoundary)/observerEvery;if(due>1)observerSkipped+=due-1;lastPublishedBoundary=observedFrame;observerReadBytes=0;
      budget=Clock::now()+std::chrono::milliseconds(observerBudgetMs);readOnly=true;
      JSValue value=JS_Call(context,promise,JS_UNDEFINED,0,nullptr);
      if(JS_IsException(value))error=exception();
      else if(JS_PromiseState(context,value)>=0||JS_IsJobPending(runtime))error="async_observer_callback";
      if(error.empty()) {
        JSValue json=JS_JSONStringify(context,value,JS_UNDEFINED,JS_UNDEFINED);
        if(JS_IsException(json))error=exception();
        else {size_t length;const char* text=JS_ToCStringLen(context,&length,json);if(!text||JS_IsUndefined(json)||length>8192)error="observer_result_limit";else {result.assign(text,length);publishedFrame=execution->frame;++publishedSequence;}if(text)JS_FreeCString(context,text);}
        JS_FreeValue(context,json);
      }
      JS_FreeValue(context,value);readOnly=false;
      if(!error.empty()){finish("observer_failed");return;}if(observerPush&&onSample)onSample(*this);return;
    }
    if(!execution->active || execution->active->owner!=owner || execution->active->epoch!=epoch || !execution->reservation) {if(error.empty())error="ownership_revoked";finish("script_interrupted");return;}
    budget=Clock::now()+std::chrono::milliseconds(25);
    if(!error.empty()){finish("script_failed");return;}
    if(interrupt(runtime,this)){error="interrupted";finish("script_interrupted");return;}
    if(waiting && execution->frame>=target) {
      waiting=false;*paused=true;jobQueue.progress();
      JSValue v=JS_Call(context,resolve,JS_UNDEFINED,0,nullptr);JS_FreeValue(context,resolve);resolve=JS_UNDEFINED;
      if(JS_IsException(v)){error=exception();JS_FreeValue(context,v);finish("script_failed");return;}JS_FreeValue(context,v);
    }
    JSContext* jobContext;
    auto jobs=jobQueue.pump([&]{return JS_IsJobPending(runtime);},
      [&]{return Clock::now()>=budget;},
      [&]{return JS_ExecutePendingJob(runtime,&jobContext)>=0;});
    if(jobs==ScriptJobQueue::Result::Yielded)return;
    if(jobs==ScriptJobQueue::Result::JobLimit){error="promise_job_limit: pending_jobs="+std::to_string(jobQueue.executed)+" host_progress="+std::to_string(jobQueue.progressEvents)+" reads="+std::to_string(readCalls)+" frames="+std::to_string(framesUsed);finish("script_failed");return;}
    if(jobs==ScriptJobQueue::Result::Exception){error=exception();finish("script_failed");return;}
    int state=JS_PromiseState(context,promise);
    if(state==JS_PROMISE_REJECTED){JSValue v=JS_PromiseResult(context,promise);error=valueText(v,"script_rejected");JS_FreeValue(context,v);finish("script_failed");return;}
    if(state==JS_PROMISE_FULFILLED) {
      JSValue v=JS_PromiseResult(context,promise);
      JSValue json=JS_JSONStringify(context,v,JS_UNDEFINED,JS_UNDEFINED);JS_FreeValue(context,v);
      if(JS_IsException(json)){error=exception();finish("script_failed");return;}
      size_t length;const char* text=JS_ToCStringLen(context,&length,json);
      if(!text || JS_IsUndefined(json) || length>4*1024*1024)error="result_limit_or_not_json";
      else result.assign(text,length);
      if(text)JS_FreeCString(context,text);JS_FreeValue(context,json);finish(error.empty()?"script_done":"script_failed");return;
    }
    if(!waiting&&!hostWaiting){error="unresolved_promise";finish("script_failed");}
  }
  ControlResult execute(const std::string& method,const std::vector<std::string>& a,const std::string& who,uint64_t e) {
    if(method=="script.pending") {
      if(who!=owner)return {"stale_script",{}};
      bool owns=running&&execution->active&&execution->active->owner==owner&&execution->active->epoch==e&&execution->reservation&&execution->reservation->owner==owner;
      return {{},"{\"running\":"+std::string(owns?"true":"false")+",\"pending\":"+(owns&&hostWaiting?hostRequest:"null")+"}"};
    }
    if(method=="script.resolve") {
      uint64_t id;if(!running||who!=owner||e!=epoch||!execution->active||execution->active->owner!=owner||!execution->reservation||!hostWaiting||a.size()!=3||!ExecutionService::number(a[0],id)||id!=hostId||(a[1]!="0"&&a[1]!="1")||a[2].size()>3072||a[2].size()%2)return {"stale_script",{}};
      std::string json;for(size_t i=0;i<a[2].size();i+=2){int hi=MemoryService::nibble(a[2][i]),lo=MemoryService::nibble(a[2][i+1]);if(hi<0||lo<0)return {"invalid_request",{}};json+=char(hi*16+lo);}
      budget=Clock::now()+std::chrono::milliseconds(25);
      JSValue value=JS_ParseJSON(context,json.data(),json.size(),"host-result");if(JS_IsException(value))return {"invalid_request",{}};
      auto returned=JS_Call(context,a[1]=="1"?hostResolve:hostReject,JS_UNDEFINED,1,&value);JS_FreeValue(context,value);
      if(a[1]=="1"&&hostKind!="state_load"){if(artifactCount++)artifacts.insert(artifacts.size()-1,",");artifacts.insert(artifacts.size()-1,hostRequest);}
      hostWaiting=false;JS_FreeValue(context,hostResolve);JS_FreeValue(context,hostReject);hostResolve=hostReject=JS_UNDEFINED;
      if(JS_IsException(returned)){error=exception();}JS_FreeValue(context,returned);return {{},"{\"resolved\":true}"};
    }
    if(method=="script.stop") {if(who!=owner)return {"stale_script",{}};finish("observer_stopped");return {{},"{\"stopped\":true}"};}
    if(method=="script.ack") {
      uint64_t id;if(a.size()!=1||!ExecutionService::number(a[0],id))return {"invalid_request",{}};
      auto it=completions.find(id);if(it==completions.end()||it->second.owner!=who)return {"stale_script_result",{}};
      completions.erase(it);return {{},"{\"released\":true}"};
    }
    if(method=="script.read") {
      expireCompletions();
      uint64_t offset,length,requested=0;
      if((a.size()!=2&&a.size()!=3)||!ExecutionService::number(a[0],offset)||!ExecutionService::number(a[1],length)||!length||length>16384||(a.size()==3&&!ExecutionService::number(a[2],requested)))return {"invalid_request",{}};
      if(!requested)requested=lastOperation;
      const Completion* saved=nullptr;auto found=completions.find(requested);
      if(found!=completions.end())saved=&found->second;
      if(saved?saved->owner!=who:(who!=owner||requested!=lastOperation))return {"stale_script_result",{}};
      const auto& value=saved?saved->result:result;const auto& failure=saved?saved->error:error;
      if(offset>value.size())return {"invalid_request",{}};
      auto part=value.substr(offset,length);return {{},"{\"complete\":"+std::string(saved?"true":"false")+",\"result_epoch\":"+std::to_string(saved?saved->epoch:epoch)+",\"stop_reason\":"+controlQuote(saved?saved->reason:"")+",\"native_reads\":"+std::to_string(saved?saved->reads:readCalls)+",\"native_read_bytes\":"+std::to_string(saved?saved->bytes:readBytes)+",\"native_read_ns\":"+std::to_string(saved?saved->ns:readNs)+",\"operation_id\":"+std::to_string(requested)+",\"hex\":"+controlQuote(MemoryTools::hex(std::vector<uint8_t>(part.begin(),part.end()),0,part.size()))+",\"bytes\":"+std::to_string(value.size())+",\"error\":"+controlQuote(failure)+",\"artifacts\":"+(saved?saved->artifacts:artifacts)+",\"logs\":"+(saved?saved->logs:logs)+(observing?",\"active\":"+std::string(running?"true":"false")+",\"frame\":"+std::to_string(publishedFrame):"")+"}"};
    }
    if(method=="script.prepare") {
      expireCompletions();if(completions.size()>=4)return {"script_result_backpressure",{}};
      uint64_t bytes;if(a.size()!=1||!ExecutionService::number(a[0],bytes)||!bytes||bytes>256*1024)return {"invalid_request",{}};
      if(running||execution->active||execution->reservation)return {"busy",{}};
      owner=who;epoch=e;source.clear();result.clear();error.clear();logs="[]";artifacts="[]";lastOperation=0;expected=bytes;execution->reservation=ExecutionService::Reservation{execution->nextId++,owner,Clock::now()+std::chrono::seconds(5)};return {{},"{\"ready\":true}"};
    }
    if(who!=owner||e!=epoch)return {"stale_script",{}};
    if(method=="script.write") {
      if(a.size()!=1||a[0].size()%2||a[0].size()>2048||source.size()+a[0].size()/2>expected)return {"invalid_request",{}};
      for(size_t i=0;i<a[0].size();i+=2){int hi=MemoryService::nibble(a[0][i]),lo=MemoryService::nibble(a[0][i+1]);if(hi<0||lo<0)return {"invalid_request",{}};source+=char(hi*16+lo);}return {{},"{\"written\":true}"};
    }
    if((method!="script.start"&&method!="script.observe")||(a.size()!=2&&(method!="script.observe"||(a.size()!=3&&a.size()!=4&&a.size()!=5)))||source.size()!=expected)return {"invalid_request",{}};
    uint64_t milliseconds,limit;if(!ExecutionService::number(a[0],milliseconds)||!milliseconds||milliseconds>600000||!ExecutionService::number(a[1],limit)||limit>1000000)return {"invalid_request",{}};
    observerEvery=4;if(a.size()>=3&&(!ExecutionService::number(a[2],observerEvery)||!observerEvery||observerEvery>120))return {"invalid_request",{}};
    observerOrigin=a.size()==5&&a[4]=="vi_origin";if(a.size()==5&&a[4]!="vi"&&a[4]!="vi_origin")return {"invalid_request",{}};
    if(observerOrigin&&execution->frameKind!="vi")return {"frame_boundary_unavailable",{}};
    observerPush=a.size()>=4&&a[3]=="1";if(a.size()>=4&&a[3]!="0"&&a[3]!="1")return {"invalid_request",{}};
    if(execution->active)return {"busy",{}};
    if(!execution->reservation||execution->reservation->owner!=owner)return {"script_preparation_revoked",{}};
    if(method=="script.observe"&&!execution->supported){execution->reservation.reset();return {"frame_boundary_unavailable",{}};}
    auto now=Clock::now();deadline=now+std::chrono::milliseconds(milliseconds);budget=now+std::chrono::milliseconds(25);
    jobQueue={};readCalls=readBytes=readNs=0;frameLimit=limit;framesUsed=0;result.clear();error.clear();logs="[]";artifacts="[]";artifactCount=0;hostId=0;logBytes=0;destroy();
    runtime=JS_NewRuntime();if(!runtime){execution->reservation.reset();return {"script_oom",{}};}
    JS_SetMemoryLimit(runtime,16*1024*1024);JS_SetMaxStackSize(runtime,512*1024);JS_SetInterruptHandler(runtime,interrupt,this);
    context=JS_NewContext(runtime);if(!context){destroy();execution->reservation.reset();return {"script_oom",{}};}JS_SetContextOpaque(context,this);
    JSValue global=JS_GetGlobalObject(context);
    for(auto entry:std::vector<std::pair<const char*,JSCFunction*>>{{"__demo",demo},{"__host",host},{"__region",region},{"__info",position},{"__hook",hook},{"__unhook",unhook},{"__read",memoryRead},{"__write",memoryWrite},{"__frames",advance},{"__input",setInput},{"__log",log}})JS_SetPropertyStr(context,global,entry.first,JS_NewCFunction(context,entry.second,entry.first,4));
    JS_FreeValue(context,global);
    execution->reservation=ExecutionService::Reservation{execution->nextId++,owner,deadline};
    execution->active=ExecutionService::Operation{execution->nextId++,e,execution->frame,ExecutionService::maxInteger,0,owner,"script",execution->atBoundary,now,deadline};
    lastOperation=execution->active->id;
    observing=method=="script.observe";if(observing&&observerPush)deadline=Clock::time_point::max();completionTicket=!observing;lastPublishedBoundary=observerOrigin?ares::Nintendo64::executionCoordinate.originCommit:execution->frame;observedFrame=UINT64_MAX;bool previousPause=*paused;
    execution->instructionCount=0;
    running=true;*paused=true;
    readOnly=observing;
    promise=JS_Eval(context,source.c_str(),source.size(),"script.js",JS_EVAL_TYPE_GLOBAL);readOnly=false;
    if(JS_IsException(promise)){
      error=exception();
      if(observing){observing=false;finish("script_failed");*paused=previousPause;return {"observer_start_failed",{}};}
      finish("script_failed");
    }
    if(observing && running) {
      auto id=execution->active->id;execution->active.reset();execution->reservation.reset();*paused=previousPause;
      return {{},"{\"observer_id\":"+std::to_string(id)+"}"};
    }
    // Return the handle before servicing user code continuations.
    return {{},running?execution->snapshot(*execution->active):execution->finished.back().second};
  }
};
