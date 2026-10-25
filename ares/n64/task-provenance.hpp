#pragma once
#include <array>
#include <vector>
#include <cstdint>
#include <algorithm>
#include <chrono>
#include <memory>
#include <string>
#include "f3dex2-state.hpp"

namespace ares::Nintendo64 {
// Always-on, bounded dispatch metadata. No instruction tracing or executor switch.
// DMEM 0xFC0 is the conventional OSTask ABI, not a guessed RDRAM address.
// Arbitrary microcode can use it differently, so decoded fields remain candidates.
struct TaskProvenance {
  using YieldBytes=std::array<uint8_t,0xc00>;
  struct YieldMatrices {uint32_t base=0;std::map<uint32_t,RspMatrixBytes> pushes;std::array<F3dex2Vertex,32> vertices;};
  struct Code { uint64_t id=0,hash=0,frame=0; uint32_t dram=0,pbus=0,bytes=0; };
  struct Target {uint32_t address=0,width=0,depth=0;uint64_t frame=0,originCommit=0,draws=0;};
  struct Task {
    uint64_t id=0,frame=0,originCommit=0,cpuPc=0,bootHash=0,previousDescriptor=0,stoppedFrame=0;
    uint32_t rspPc=0,signalBits=0;bool stopped=false,codeOverflow=false,targetOverflow=false;
    uint64_t logicalId=0,resumeFrom=0,resumedBy=0,pendingResume=0;
    bool breakObserved=false,yieldVerified=false,resumeVerified=false,resumeEntrySeen=false;
    uint32_t yieldAddress=0;
    std::string yieldSha256,resumeReason="not_a_resume_submission";
    std::shared_ptr<const YieldBytes> yieldBytes,restoreBytes;
    std::shared_ptr<const YieldMatrices> yieldMatrices;
    std::array<uint8_t,64> yieldHeader{};
    std::array<uint8_t,64> header{};
    std::vector<Code> code;
    std::vector<Target> targets;
    uint32_t field(unsigned index)const{uint32_t value=0;for(unsigned n=0;n<4;++n)value=(value<<8)|header[index*4+n];return value;}
  };
  struct Scanout {uint64_t frame=0,originCommit=0;uint32_t origin=0;std::vector<uint64_t> candidates;bool overflow=false;};
  static constexpr size_t MaxTasks=64,MaxCode=8,MaxTargets=16,MaxScanouts=8;
  uint64_t epoch=1,nextId=1,nextCode=1,active=0,dropped=0,totalNs=0,maxNs=0,captures=0;
  uint64_t submissionTask=0;
  uint64_t dmaPendingTask=0,dmaCurrentTask=0;
  uint32_t colorAddress=0,colorWidth=0,colorDepth=0;
  bool haveColor=false;
  std::vector<Task> tasks;
  std::vector<Scanout> scanouts;
  void reset(uint64_t e){const auto taskId=nextId,codeId=nextCode;*this={};epoch=e;nextId=taskId;nextCode=codeId;}
  Task* find(uint64_t id){if(!id)return nullptr;for(auto it=tasks.rbegin();it!=tasks.rend();++it)if(it->id==id)return &*it;return nullptr;}
  const Task* find(uint64_t id)const{if(!id)return nullptr;for(auto it=tasks.rbegin();it!=tasks.rend();++it)if(it->id==id)return &*it;return nullptr;}
  const Task* latestGraphics()const{for(auto it=tasks.rbegin();it!=tasks.rend();++it)if(it->field(0)==1)return &*it;return nullptr;}
  void started(uint64_t pc);
  void imemDma(uint32_t dram,uint32_t pbus,uint32_t bytes);
  void stopped(uint32_t signals,bool architecturalBreak=false);
  bool knownYieldProfile()const;
  void yieldDma(bool write,uint64_t taskId,uint32_t dram,uint32_t pbus,uint32_t length,const uint8_t* bytes);
  void resumeEntry();
  void consume(uint8_t opcode,uint64_t word,uint64_t taskId);
  void scanout(uint64_t frame,uint64_t originCommit,uint32_t origin,uint32_t width=0,uint32_t height=0){
    Scanout value{frame,originCommit,origin};
    // Address matches are candidates only: partial writes/blends and buffer reuse
    // prevent these records from proving which tasks contributed displayed pixels.
    // VI may start inside a color target (Kirby skips its first scanline).
    // A bounded source-range match is still only a candidate, never pixel proof.
    // Prefer recent submissions so old reused buffers cannot crowd them out.
    for(auto it=tasks.rbegin();it!=tasks.rend();++it)for(auto& target:it->targets){
      const uint64_t row=uint64_t(target.width)*(target.depth==2?2:target.depth==3?4:0);
      const bool inside=width&&height&&height<=4096&&target.width==width&&row&&origin>=target.address&&uint64_t(origin-target.address)<row*height;
      if(target.draws&&(target.address==origin||inside)){
        if(value.candidates.size()<8)value.candidates.push_back(it->id);else value.overflow=true;break;
      }
    }
    if(scanouts.size()==MaxScanouts)scanouts.erase(scanouts.begin());scanouts.push_back(std::move(value));
  }
};
inline TaskProvenance taskProvenance;
}
