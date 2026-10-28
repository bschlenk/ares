#pragma once
#include "input-service.hpp"
#include "execution-service.hpp"

// Standard N64 Gamepad SI-read latches, after axis shaping/opposite cancellation.
// No wall-clock sampling: each event is exactly the 32 bits returned to the game.
struct DemonstrationService {
  using Clock=std::chrono::steady_clock;
  struct Event {uint64_t frame;uint32_t port,data;};
  std::vector<Event> events;
  std::string requester,owner,state="idle",reason,prompt,source="human",rom,session,stateHash;
  uint64_t id=0,nextId=1,epoch=0,start=0,end=0,limit=600,duration=0,cursor=0,port=1;
  bool detached=false,explicitWaiting=false,inputStartReady=false;
  bool complete=false,overflow=false,importing=false,stopPending=false;
  uint64_t stopFrame=0;
  Clock::time_point deadline;
  InputService* input=nullptr;ExecutionService* execution=nullptr;bool* paused=nullptr;
  bool active()const{return state=="armed"||state=="recording"||state=="replaying";}
  void finish(const std::string& why,uint64_t f){
    const bool replay=state=="replaying",capturing=state=="recording";end=f;stopPending=false;
    if(state=="recording")duration=f>=start?f-start:0;
    complete=(why=="requested"||why=="complete")&&!overflow;reason=why;state=(complete||capturing&&overflow)?"ready":"cancelled";if(capturing||state=="cancelled"){*paused=true;input->releaseOwner(owner);}
    if(replay){input->releaseOwner(owner);if(execution->active&&execution->active->owner==owner&&execution->active->kind=="input_replay")execution->complete(why=="complete"?"target_reached":why,*paused);}
  }
  void releaseOwner(const std::string& who,uint64_t f){if(owner==who){if(detached&&active())return;if(active())finish("disconnected",f);events.clear();state="idle";owner.clear();}}
  void tick(uint64_t e,uint64_t f){
    if(!active())return;
    if(e!=epoch){finish("epoch_changed",f);return;}
    if(Clock::now()>=deadline){if(state=="recording")overflow=true;finish(explicitWaiting?(state=="armed"?"waiting_expired":"capture_timeout"):"timeout",f);return;}
    if(state=="recording"&&stopPending&&f>stopFrame){finish("requested",f);*paused=true;return;}
    if(state=="recording"&&f-start>=limit){overflow=true;finish("frames_limit",f);}
    if(state=="replaying"&&f-start>=duration)finish(cursor==events.size()?"complete":"replay_diverged",f);
  }
  uint32_t latch(uint32_t p,uint32_t data,uint64_t e,uint64_t f){
    tick(e,f);if(p!=port)return data;
    if(state=="recording"){
      if(events.size()>=120000){overflow=true;finish("latch_limit",f);return data;}
      events.push_back({f-start,p,data});
    }else if(state=="replaying"){
      if(cursor>=events.size()||events[cursor].frame!=f-start||events[cursor].port!=p){finish("replay_diverged",f);return 0;}
      data=events[cursor++].data;
    }
    return data;
  }
  std::string startedBy;
  uint64_t captureMs=300000;
  std::string status()const{
    return "{\"start_triggers\":"+std::string(port==1?"[\"controller_input\",\"ui_button\",\"mcp\"]":"[\"ui_button\",\"mcp\"]")+",\"input_start_ready\":"+std::string(inputStartReady?"true":"false")+",\"started_by\":"+(startedBy.empty()?"null":controlQuote(startedBy))+",\"capture_boundary\":\"n64_si_gamepad_read\",\"job_id\":"+std::to_string(id)+",\"state\":"+controlQuote(state)+",\"prompt\":"+controlQuote(prompt)+",\"source\":"+controlQuote(source)+",\"port\":"+std::to_string(port)+",\"epoch\":"+std::to_string(epoch)+",\"start_frame\":"+std::to_string(start)+",\"end_frame\":"+std::to_string(end)+",\"duration_frames\":"+std::to_string(duration)+",\"events\":"+std::to_string(events.size())+",\"cursor\":"+std::to_string(cursor)+",\"complete\":"+(complete?"true":"false")+",\"overflow\":"+(overflow?"true":"false")+",\"stop_reason\":"+controlQuote(reason)+",\"rom_sha256\":"+controlQuote(rom)+",\"session\":"+controlQuote(session)+",\"state_sha256\":"+(stateHash.empty()?"null":controlQuote(stateHash))+",\"boundary\":\"n64_si_gamepad_read\",\"axis_convention\":\"signed_8bit_after_gate\",\"rate\":\"vi_relative_variable_latches\",\"version\":1}";
  }
  static bool unhex(const std::string& hex,std::string& out){if(hex=="-"){out.clear();return true;}if(hex.empty()||hex.size()>2048||hex.size()%2)return false;out.clear();for(size_t i=0;i<hex.size();i+=2){unsigned value;auto [end,err]=std::from_chars(hex.data()+i,hex.data()+i+2,value,16);if(err!=std::errc{}||end!=hex.data()+i+2||!value)return false;out+=char(value);}return true;}
  ControlResult execute(const std::string& method,const std::vector<std::string>& a,const std::string& who,uint64_t e,uint64_t f,const std::string& hash,const std::string& nativeSession){
    tick(e,f);
    if(method=="n64.demo.status")return a.empty()?ControlResult{{},status()}:ControlResult{"invalid_request",{}};
    if(method=="n64.demo.request"){
      uint64_t count,ms,p;std::string text;
      uint64_t waitingMs=0;
      if((a.size()!=6&&a.size()!=7)||(a.size()==7&&(!ExecutionService::number(a[6],waitingMs)||!waitingMs||waitingMs>600000))||!ExecutionService::number(a[0],count)||!count||count>36000||!ExecutionService::number(a[1],ms)||!ms||ms>600000||!ExecutionService::number(a[2],p)||p<1||p>4||(a[3]!="human"&&a[3]!="merged")||!unhex(a[4],text)||(a[5]!="-"&&(a[5].size()!=64||a[5].find_first_not_of("abcdef0123456789")!=std::string::npos)))return {"invalid_request",{}};
      if(active()||execution->active&&(execution->active->owner!=who||execution->active->kind!="script")||execution->reservation&&execution->reservation->owner!=who||input->hasOverrides())return {"busy",{}};
      requester=owner=who;detached=false;id=nextId++;epoch=e;start=end=f;duration=cursor=0;port=p;limit=count;source=a[3];prompt=text;rom=hash;session=nativeSession;stateHash=a[5]=="-"?"":a[5];state="armed";startedBy.clear();captureMs=ms;explicitWaiting=a.size()==7;complete=overflow=importing=stopPending=false;reason.clear();events.clear();deadline=Clock::now()+std::chrono::milliseconds(explicitWaiting?waitingMs:ms);*paused=true;return {{},status()};
    }
    if(method=="n64.demo.cancel"&&a.empty()&&!active())return {{},status()};
    if(method!="n64.demo.importBegin"&&who!=owner&&who!=requester&&who!="ui")return {"wrong_owner",{}};
    if(method=="n64.demo.handoff"){
      if(who!=owner||state!="armed"||a.size()!=1||a[0].empty()||a[0].size()>64||a[0].find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")!=std::string::npos)return {"invalid_request",{}};
      owner=a[0];detached=true;return {{},status()};
    }
    if(method=="n64.demo.start"){
      if(a.empty()&&state=="recording")return {{},status()};
      if(!a.empty()||state!="armed")return {"invalid_request",{}};
      if(execution->active||execution->reservation||input->hasOverrides())return {"busy",{}};
      state="recording";startedBy=who=="ui"?"ui_button":"mcp";deadline=Clock::now()+std::chrono::milliseconds(captureMs);start=end=f;epoch=e;*paused=false;return {{},status()};
    }
    if(method=="n64.demo.stop"||method=="n64.demo.cancel"){
      if(!a.empty()||!active())return {"invalid_request",{}};
      if(method=="n64.demo.stop"&&state=="recording"&&!execution->atBoundary){if(!stopPending){stopPending=true;stopFrame=f;}*paused=false;return {{},status()};}
      finish(method=="n64.demo.stop"&&state=="recording"?"requested":"cancelled",f);*paused=true;return {{},status()};
    }
    if(method=="n64.demo.read"){
      uint64_t offset,length;if(a.size()!=2||!ExecutionService::number(a[0],offset)||!ExecutionService::number(a[1],length)||!length||length>128||offset>events.size()||active())return {"invalid_request",{}};
      std::string rows="[";for(uint64_t n=offset;n<events.size()&&n<offset+length;++n){auto& v=events[n];if(n!=offset)rows+=',';rows+="{\"sequence\":"+std::to_string(n)+",\"frame\":"+std::to_string(v.frame)+",\"port\":"+std::to_string(v.port)+",\"raw\":"+std::to_string(v.data)+",\"buttons\":"+std::to_string(v.data>>16)+",\"x\":"+std::to_string(int8_t(v.data>>8))+",\"y\":"+std::to_string(int8_t(v.data))+"}";}return {{},"{\"status\":"+status()+",\"offset\":"+std::to_string(offset)+",\"events\":"+rows+"]}"};
    }
    if(method=="n64.demo.importBegin"){
      uint64_t frames,p;if(a.size()!=3||(a[2]!="-"&&(a[2].size()!=64||a[2].find_first_not_of("abcdef0123456789")!=std::string::npos))||!ExecutionService::number(a[0],frames)||!frames||frames>36000||!ExecutionService::number(a[1],p)||p<1||p>4||active())return {"invalid_request",{}};
      owner=who;id=nextId++;rom=hash;session=nativeSession;epoch=e;stateHash=a[2]=="-"?"":a[2];duration=frames;port=p;events.clear();state="importing";complete=false;importing=true;return {{},status()};
    }
    if(method=="n64.demo.append"){
      if(!importing||a.empty()||a.size()%3||a.size()>96||events.size()+a.size()/3>120000)return {"invalid_request",{}};
      std::vector<Event> batch;uint64_t previous=events.empty()?0:events.back().frame;
      for(size_t i=0;i<a.size();i+=3){uint64_t frame,p,data;if(!ExecutionService::number(a[i],frame)||frame<previous||frame>=duration||!ExecutionService::number(a[i+1],p)||p!=port||!ExecutionService::number(a[i+2],data)||data>UINT32_MAX)return {"invalid_request",{}};batch.push_back({frame,uint32_t(p),uint32_t(data)});previous=frame;}
      events.insert(events.end(),batch.begin(),batch.end());return {{},status()};
    }
    if(method=="n64.demo.importCommit"){if(!a.empty()||!importing||events.empty())return {"invalid_request",{}};importing=false;complete=true;overflow=false;state="ready";return {{},status()};}
    if(method=="n64.demo.replay"){
      if(!a.empty()||state!="ready"||!complete||events.empty()||!duration||rom!=hash)return {"invalid_clip",{}};
      if(input->hasOverrides()||(execution->active&&(execution->active->owner!=who||execution->active->kind!="script"))||execution->reservation&&execution->reservation->owner!=who)return {"busy",{}};
      if(!execution->active){auto op=execution->execute("execution.runFrames",{std::to_string(duration),"600000"},who,e,*paused);if(!op.error.empty())return op;execution->active->kind="input_replay";}
      input->pending[port-1]={who,0,0,0,e};input->service(e,f,Clock::now(),true);state="replaying";start=f;epoch=e;cursor=0;deadline=Clock::now()+std::chrono::minutes(10);return {{},status()};
    }
    return {"unavailable",{}};
  }
};
