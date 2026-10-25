#pragma once
#include <array>
#include <vector>
#include <map>
#include <set>
#include <memory>
#include <optional>
#include <string>
namespace ares::Nintendo64 {
using RspMatrixBytes=std::array<uint8_t,64>;
struct F3dex2MatrixState {
  uint64_t id=0,task=0,vi=0,command=0;
  std::string codeSha256;
  bool after=false,combinedValid=false,stackValid=false;
  uint32_t base=0,pointer=0;
  RspMatrixBytes modelview{},projection{},combined{};
  std::array<uint8_t,16> viewport{};
  std::array<uint32_t,16> segments{};
  // Historical values actually DMA-written by the RSP, not current RAM rereads.
  std::vector<std::optional<RspMatrixBytes>> saved;
  bool same(const F3dex2MatrixState& b)const {
    return task==b.task&&combinedValid==b.combinedValid&&stackValid==b.stackValid&&base==b.base&&pointer==b.pointer&&modelview==b.modelview&&projection==b.projection&&combined==b.combined&&viewport==b.viewport&&segments==b.segments&&saved==b.saved;
  }
};
struct F3dex2Vertex {
  uint8_t index=0;bool modified=false;
  std::shared_ptr<const F3dex2MatrixState> transform;
  std::array<uint8_t,40> raw{};
};
struct F3dex2MatrixCapture {
  static constexpr unsigned MaxStates=512,MaxStack=32;
  bool dirty=true,codeKnown=false,known=false,overflow=false;
  uint64_t nextId=1,task=0;uint32_t base=0;
  std::string codeHash;
  std::map<uint32_t,RspMatrixBytes> pushes;
  std::set<uint64_t> admitted;
  std::shared_ptr<const F3dex2MatrixState> current;
  std::array<F3dex2Vertex,32> vertices{};
  bool refreshCode();
  void taskChanged();
  void unknownCommand(){current.reset();pushes.clear();for(auto& v:vertices)v={};}
  auto admit(std::shared_ptr<const F3dex2MatrixState> value)->std::shared_ptr<const F3dex2MatrixState>;
  auto snapshot(uint64_t command,bool after)->std::shared_ptr<const F3dex2MatrixState>;
  void pushed(uint32_t address,const uint8_t* bytes);
  void vertexLoaded(uint32_t word0,std::shared_ptr<const F3dex2MatrixState> state);
  auto draw(uint32_t word0,uint32_t word1)->std::vector<F3dex2Vertex>;
  void modified(uint32_t word0);
  void nextGeneration(){admitted.clear();overflow=false;}
};
}
