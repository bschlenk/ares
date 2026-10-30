#pragma once
#include "frame-service.hpp"
// Independent managed snapshots: serializer bytes are unmodified. An immutable
// pixel copy is pinned in the same emulation-thread operation, before file I/O.
struct CheckpointService {
  using Clock = std::chrono::steady_clock;
  struct Transfer { uint64_t id; std::string owner; std::vector<uint8_t> bytes; uint64_t written=0; Clock::time_point expires; bool upload=false,recovery=false; };
  std::optional<Transfer> transfer;
  uint64_t nextId=1;
  std::string hash, configuration, reason;
  void releaseOwner(const std::string& owner) { if(transfer && transfer->owner==owner) transfer.reset(); }
  ControlResult execute(const std::string& method,const std::vector<std::string>& args,const std::string& owner,ares::Node::System root,FrameService& frames,uint64_t epoch,uint64_t frame,bool n64,bool busy,bool paused) {
    if(transfer && Clock::now()>=transfer->expires) transfer.reset();
    if(method=="checkpoint.info") return {{},"{\"available\":"+std::string(reason.empty()&&!hash.empty()&&root?"true":"false")+",\"reason\":"+controlQuote(reason)+",\"hash\":"+controlQuote(hash)+",\"configuration\":"+controlQuote(configuration)+"}"};
    if(!root || !reason.empty() || hash.empty()) return {"unavailable",{}};
    if(method=="checkpoint.capture" || method=="checkpoint.upload") {
      if(busy || transfer || nall::GDB::server.hasClient()) return {"busy",{}};
      if(method=="checkpoint.upload") {
        uint64_t size;
        if((args.size()!=1&&args.size()!=2) || (args.size()==2&&args[1]!="1") || !ExecutionService::number(args[0],size) || size<=533 || size>(64ull<<20)) return {"invalid_request",{}};
        transfer=Transfer{nextId++,owner,std::vector<uint8_t>(size),0,Clock::now()+std::chrono::seconds(30),true,args.size()==2};
        return {{},"{\"id\":"+std::to_string(transfer->id)+"}"};
      }
      if(!args.empty()&&args!=std::vector<std::string>{"1"}) return {"invalid_request",{}};
      const auto started=Clock::now();
      auto instant=std::chrono::duration<double,std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
      // Portable saves must synchronize coroutine cores: unsynchronized bytes
      // contain process-local stacks and cannot be reopened in another host.
      // Keep the ordinary run/pause flag untouched while reaching safe points.
      auto state=root->serialize(true);
      if(state.size()<=533 || state.size()>(64ull<<20)) return {"state_unavailable",{}};
      std::shared_ptr<const FrameService::Image> image;
      if(n64) { auto result=FrameService::framebuffer(image,epoch,frame); if(!result.error.empty() && result.error!="vi_blank") return result; }
      else { std::lock_guard guard(frames.mutex); image=frames.presented.packet?std::make_shared<FrameService::Image>(frames.presented):frames.latest; }
      if(!image || image->epoch!=epoch) {
        auto blank=std::make_shared<FrameService::Image>();blank->width=320;blank->height=240;blank->epoch=epoch;blank->frame=frame;
        blank->pixels.resize(320*240*4,0);for(size_t i=3;i<blank->pixels.size();i+=4)blank->pixels[i]=255;image=blank;
      }
      if(!image->width || !image->height) return {"no_frame",{}};
      double aspect=double(image->width)/image->height;
      if(!n64 && image->packet && image->packet->size()>=48) {
        uint64_t bits=0;for(unsigned n=0;n<8;n++)bits|=uint64_t((*image->packet)[40+n])<<(n*8);
        std::memcpy(&aspect,&bits,sizeof(aspect));
        if(!std::isfinite(aspect)||aspect<=0)aspect=double(image->width)/image->height;
      }
      Transfer t{nextId++,owner,{state.data(),state.data()+state.size()},0,Clock::now()+std::chrono::seconds(30),false};
      t.bytes.insert(t.bytes.end(),image->data(),image->data()+image->size()); transfer=std::move(t);
      return {{},"{\"id\":"+std::to_string(transfer->id)+",\"bytes\":"+std::to_string(transfer->bytes.size())+",\"stateBytes\":"+std::to_string(state.size())+",\"width\":"+std::to_string(image->width)+",\"height\":"+std::to_string(image->height)+",\"aspect\":"+std::to_string(aspect)+",\"paused\":"+std::string(paused?"true":"false")+",\"start_frame\":"+std::to_string(frame)+",\"capture_ms\":"+std::to_string(std::chrono::duration<double,std::milli>(Clock::now()-started).count())+",\"capturedAt\":"+std::to_string(instant)+"}"};
    }
    uint64_t id;
    if(args.empty() || !ExecutionService::number(args[0],id)) return {"invalid_request",{}};
    if(!transfer || transfer->id!=id) return {"stale_snapshot",{}};
    if(transfer->owner!=owner) return {"busy",{}};
    if(method=="checkpoint.release" || method=="checkpoint.abort") { if(args.size()!=1)return {"invalid_request",{}};transfer.reset();return {{},"{\"released\":true}"}; }
    uint64_t offset,length;
    if(method=="checkpoint.read") {
      if(transfer->upload || args.size()!=3 || !ExecutionService::number(args[1],offset) || !ExecutionService::number(args[2],length) || !length || length>16384 || offset>transfer->bytes.size() || length>transfer->bytes.size()-offset) return {"out_of_bounds",{}};
      static const char digits[]="0123456789abcdef";std::string hex;hex.reserve(length*2);
      for(uint64_t n=offset;n<offset+length;n++){auto b=transfer->bytes[n];hex+=digits[b>>4];hex+=digits[b&15];}
      return {{},"{\"hex\":"+controlQuote(hex)+"}"};
    }
    if(method=="checkpoint.write") {
      if(!transfer->upload || args.size()!=3 || !ExecutionService::number(args[1],offset) || offset!=transfer->written || args[2].empty() || args[2].size()%2 || args[2].size()>3600) return {"invalid_request",{}};
      length=args[2].size()/2;
      if(offset>transfer->bytes.size() || length>transfer->bytes.size()-offset)return {"out_of_bounds",{}};
      for(char c:args[2])if(MemoryService::nibble(c)<0)return {"invalid_request",{}};
      for(uint64_t n=0;n<length;n++)transfer->bytes[offset+n]=MemoryService::nibble(args[2][n*2])<<4|MemoryService::nibble(args[2][n*2+1]);
      transfer->written+=length;return {{},"{\"written\":"+std::to_string(length)+"}"};
    }
    return {"unavailable",{}}; // Commit is handled by the host's epoch-reset path.
  }
};
