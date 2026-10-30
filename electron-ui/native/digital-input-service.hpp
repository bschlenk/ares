#pragma once
#include <map>
#include <set>
#include "input-service.hpp"

// All cores expose named Input::Button nodes. Group by their parent device,
// preserving native names and hierarchy rather than inventing a core mask.
struct DigitalInputService {
  using Clock=std::chrono::steady_clock;
  struct Port {
    std::string path,owner;
    std::vector<ares::Node::Input::Button> buttons;
    std::set<std::string> held;
    uint64_t epoch=0,start=0,expires=0,latched=UINT64_MAX;
    Clock::time_point deadline;
  };
  std::vector<Port> ports;
  uint64_t epoch=0,frame=0,takeovers=0;
  static std::string path(ares::Node::Object node) {
    std::string result=node->name().data();
    while((node=ares::Node::parent(node)))result=std::string(node->name().data())+"/"+result;
    return result;
  }
  void bind(ares::Node::System root) {
    ports.clear();if(!root)return;
    std::map<std::string,std::vector<ares::Node::Input::Button>> groups;
    for(auto button:root->find<ares::Node::Input::Button>())groups[path(ares::Node::parent(button))].push_back(button);
    for(auto& [name,buttons]:groups){Port port;port.path=name;port.buttons=buttons;ports.push_back(std::move(port));}
  }
  void releaseAll(){for(auto& p:ports){p.owner.clear();p.held.clear();}}
  bool hasOverrides()const{for(auto& p:ports)if(!p.owner.empty())return true;return false;}
  bool takeover(){if(!hasOverrides())return false;releaseAll();++takeovers;return true;}
  void releaseOwner(const std::string& owner){for(auto& p:ports)if(p.owner==owner){p.owner.clear();p.held.clear();}}
  void service(uint64_t e,uint64_t f){epoch=e;frame=f;for(auto& p:ports)if(!p.owner.empty()&&(p.epoch!=e||f>=p.expires||Clock::now()>=p.deadline)){p.owner.clear();p.held.clear();}}
  std::string state(bool describe=false)const{
    std::string out="{\"epoch\":"+std::to_string(epoch)+",\"frame\":"+std::to_string(frame)+",\"human_takeovers\":"+std::to_string(takeovers)+",\"ports\":[";
    for(size_t i=0;i<ports.size();++i){auto& p=ports[i];if(i)out+=',';out+="{\"port\":"+std::to_string(i+1)+",\"path\":"+controlQuote(p.path)+",\"buttons\":[";
      bool first=true;for(auto button:p.buttons){if(!first)out+=',';first=false;out+=controlQuote(button->name().data());}
      out+="],\"held\":[";first=true;for(auto& name:p.held){if(!first)out+=',';first=false;out+=controlQuote(name);}out+="],\"owner\":"+(p.owner.empty()?"null":controlQuote(p.owner))+",\"start_frame\":"+(p.owner.empty()?"null":std::to_string(p.start))+",\"latched_frame\":"+(p.owner.empty()||p.latched==UINT64_MAX?"null":std::to_string(p.latched))+",\"expires_frame\":"+(p.owner.empty()?"null":std::to_string(p.expires))+"}";
    }
    return out+"],\"max_lease_frames\":600,\"max_lease_ms\":10000}";
  }
  ControlResult execute(const std::string& method,const std::vector<std::string>& args,const std::string& owner,uint64_t e,uint64_t f,bool clockAvailable){
    service(e,f);
    if(method=="input.describe"||method=="input.state")return args.empty()?ControlResult{{},state(true)}:ControlResult{"invalid_request",{}};
    uint32_t port;
    if(method=="input.release"){
      if(args.size()!=1||!MemoryService::number(args[0],port)||port>ports.size())return {"invalid_request",{}};
      if(port && !ports[port-1].owner.empty() && ports[port-1].owner!=owner)return {"busy",{}};
      if(!port)releaseOwner(owner);else{auto& p=ports[port-1];p.owner.clear();p.held.clear();}return {{},state()};
    }
    uint32_t frames,ms;
    if(method!="input.set"||args.size()<4||!MemoryService::number(args[0],port)||!port||port>ports.size()||!MemoryService::number(args[1],frames)||!frames||frames>600||!MemoryService::number(args[2],ms)||!ms||ms>10000)return {"invalid_request",{}};
    if(!clockAvailable)return {"frame_boundary_unavailable",{}};
    auto& p=ports[port-1];if(!p.owner.empty()&&p.owner!=owner)return {"busy",{}};
    std::set<std::string> held;
    if(args[3]!="-")for(size_t i=3;i<args.size();++i){
      auto& hex=args[i];std::string name;
      if(hex.empty()||hex.size()%2||hex.size()>512)return {"invalid_request",{}};
      for(size_t j=0;j<hex.size();j+=2){int a=MemoryService::nibble(hex[j]),b=MemoryService::nibble(hex[j+1]);if(a<0||b<0)return {"invalid_request",{}};name+=char(a*16+b);}
      bool found=false;for(auto button:p.buttons)if(button->name()==name.c_str())found=true;
      if(!found)return {"invalid_button",{}};held.insert(name);
    }else if(args.size()!=4)return {"invalid_request",{}};
    p.owner=owner;p.held=std::move(held);p.epoch=e;p.start=f;p.latched=UINT64_MAX;p.expires=f+frames;p.deadline=Clock::now()+std::chrono::milliseconds(ms);return {{},state()};
  }
  bool apply(ares::Node::Input::Input node,uint64_t e,uint64_t f){
    service(e,f);for(auto& p:ports)if(!p.owner.empty())for(auto button:p.buttons)if(button==node){if(p.latched==UINT64_MAX)p.latched=f;button->setValue(p.held.count(button->name().data())?1:0);return true;}return false;
  }
};
