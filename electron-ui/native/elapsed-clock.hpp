#pragma once
#include <map>
#include "execution-service.hpp"

// Passive waits. Never touches pause, speed, execution ownership or core state.
struct ElapsedClock {
  using Clock = std::chrono::steady_clock;
  struct Wait {
    uint64_t id, epoch, start, target, frame;
    std::string owner, kind, reason;
    Clock::time_point deadline, retainUntil;
  };
  std::map<uint64_t, Wait> waits;
  uint64_t nextId=1;
  void service(uint64_t epoch,uint64_t frame) {
    auto now=Clock::now();
    for(auto it=waits.begin();it!=waits.end();) {
      auto& w=it->second;
      if(!w.reason.empty() && now>=w.retainUntil){it=waits.erase(it);continue;}
      if(w.reason.empty()) {
        if(w.epoch!=epoch)w.reason="reset";
        else {w.frame=frame;if(frame>=w.target)w.reason="frames_elapsed";else if(now>=w.deadline)w.reason="deadline";}
      }
      ++it;
    }
  }
  void interrupt(const std::string& reason) {for(auto& [id,w]:waits)if(w.reason.empty())w.reason=reason;}
  void releaseOwner(const std::string& owner) {for(auto it=waits.begin();it!=waits.end();)if(it->second.owner==owner)it=waits.erase(it);else ++it;}
  static std::string snapshot(const Wait& w) {
    return "{\"wait_id\":"+std::to_string(w.id)+",\"owner\":"+controlQuote(w.owner)+",\"epoch\":"+std::to_string(w.epoch)
      +",\"start_frame\":"+std::to_string(w.start)+",\"target_frame\":"+std::to_string(w.target)+",\"frame\":"+std::to_string(w.frame)
      +",\"elapsed_frames\":"+std::to_string(w.frame-w.start)+",\"frame_kind\":"+controlQuote(w.kind)+",\"state\":"+controlQuote(w.reason.empty()?"waiting":"done")+",\"reason\":"+controlQuote(w.reason)+"}";
  }
  ControlResult execute(const std::string& method,const std::vector<std::string>& args,const std::string& owner,uint64_t epoch,uint64_t frame,const std::string& kind) {
    service(epoch,frame);
    if(method=="clock.waitStart") {
      uint64_t count,ms;
      if(args.size()!=2||!ExecutionService::number(args[0],count)||count>600||!ExecutionService::number(args[1],ms)||!ms||ms>60000||frame>ExecutionService::maxInteger-count)return {"invalid_request",{}};
      if(kind=="unavailable")return {"frame_boundary_unavailable",{}};
      if(waits.size()>=32)return {"wait_limit",{}};
      auto now=Clock::now();auto id=nextId++;
      auto& w=waits.emplace(id,Wait{id,epoch,frame,frame+count,frame,owner,kind,"",now+std::chrono::milliseconds(ms),now+std::chrono::minutes(2)}).first->second;
      service(epoch,frame);auto result=snapshot(w);if(!w.reason.empty())waits.erase(id);return {{},result};
    }
    uint64_t id;
    if(args.size()!=1||!ExecutionService::number(args[0],id))return {"invalid_request",{}};
    auto it=waits.find(id);if(it==waits.end()||it->second.owner!=owner)return {"stale_wait",{}};
    if(method=="clock.waitCancel" && it->second.reason.empty())it->second.reason="cancelled";
    if(method!="clock.waitRead"&&method!="clock.waitCancel")return {"unavailable",{}};
    auto result=snapshot(it->second);if(!it->second.reason.empty())waits.erase(it);return {{},result};
  }
};
