#pragma once
#include <array>
#include <cstdint>
#include <vector>
#include <functional>
#include <string>
#include "f3dex2-state.hpp"
namespace ares::Nintendo64 {
// Host-only command viewer state. Adapted from ares-64 RSPCapture/RDPCapture and
// Program::n64AfterRun at 1c9b9637476a83f7b80d3db1115a0f71529820d9.
// Live records are copied at real dispatch/decoder hooks, committed on nonzero
// VI-origin changes, and double-buffered so the committed frame cannot be reused.
struct CommandCapture {
  static constexpr uint32_t Capacity = 4096;
  struct RspRecord {
    uint64_t seq = 0, frame = 0, cycle = 0, bytesIn = 0, bytesOut = 0,taskId=0,sourceVi=0;
    std::array<uint8_t,64> matrixOperand{};
    uint32_t matrixDram=0,matrixDmem=0,matrixDmaCount=0;
    bool matrixCandidate=false,commandComplete=false;
    std::shared_ptr<const F3dex2MatrixState> matrixBefore,matrixAfter;
    std::vector<F3dex2Vertex> drawVertices;
    uint32_t word0 = 0, word1 = 0;
    uint8_t opcode = 0;
    bool overhead = false;
    uint8_t overlayId = 0, wordCount = 0, segmentType = 0;
    std::array<uint32_t, 16> words{};
    std::string overlay, command, args;
    bool wordsTruncated = false;
  };
  struct RdpRecord { uint64_t seq, frame, word0, word1; uint8_t opcode, wordCount; };
  static constexpr uint8_t RdpWords[64] = {
    1,1,1,1,1,1,1,1,4,6,12,14,12,14,20,22,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,2,2,1,1,1,1,1,1,1,1,1,1,
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  };
  bool rspEnabled = false, rdpEnabled = false, segmentOpen = false;
  int32_t sigPc = -1, loopPc = -1, dispatchPc = -1;
  struct QueueConfig {
    bool loaded = false;
    std::array<uint32_t, 5> hooks{}; // command, loop, overlay-load, fetch, fetch-with-ptr
    std::array<std::array<uint32_t, 2>, 5> signature{};
    uint32_t cmdsOffset = 0xa0, cmdsSize = 0x100;
  } queue;
  struct DisplayConfig {
    std::array<uint32_t, 4> signature{0x00196603, 0x000c5840};
    uint8_t count = 2, word0Reg = 25, word1Reg = 24, opcodeShift = 24;
    int32_t loopOffset = -12, dispatchOffset = 20;
  } display;
  bool queueMode = false;
  F3dex2MatrixCapture matrices;
  std::vector<std::shared_ptr<const F3dex2MatrixState>> matrixLatest;
  bool matrixLatestOverflow=false;
  // Compact matrix commands are independent of the verbose command-row quota.
  // Four immutable generations let a UI finish paging while emulation proceeds.
  static constexpr unsigned TransformCapacity=256, TransformHistory=4, TransformTasks=8;
  struct TransformRecord {
    uint64_t seq=0,task=0,vi=0;
    uint32_t word0=0,word1=0;
    bool complete=false,operandValid=false;
    RspMatrixBytes operand{};
    std::shared_ptr<const F3dex2MatrixState> before,after;
    std::shared_ptr<const F3dex2MatrixState> vertexState;
    uint32_t vertexBatches=0;
  };
  struct TransformCapture {
    uint64_t generation=0,vi=0,originCommit=0,observed=0;
    uint32_t origin=0;
    bool matrixOverflow=false;
    std::vector<TransformRecord> entries;
  };
  struct TransformBatch {uint64_t task=0,observed=0;bool matrixOverflow=false;std::vector<TransformRecord> entries;};
  std::vector<TransformBatch> transformBatches;
  std::vector<TransformCapture> transformHistory;
  uint64_t transformGeneration=1,transformVi=UINT64_MAX;
  auto transformBatch(uint64_t task)->TransformBatch& {
    for(auto& batch:transformBatches)if(batch.task==task)return batch;
    if(transformBatches.size()==TransformTasks)transformBatches.erase(transformBatches.begin());
    transformBatches.push_back({task});return transformBatches.back();
  }
  std::function<void(RspRecord&)> annotate;
  uint32_t lastOrigin = 0;
  uint64_t sequence = 0, presentedFrame = 0, generation = 1, segmentStart = 0;
  uint64_t rspObserved = 0, rdpObserved = 0, rspCommitted = 0, rdpCommitted = 0;
  RspRecord segment;
  std::vector<RspRecord> rspLive, rspLatest;
  std::vector<RdpRecord> rdpLive, rdpLatest;
  auto reset() -> void { *this = {}; }
  auto detectRsp() -> void;
  auto rspCodeChanged() -> void;
  auto rspInstruction(uint32_t pc) -> void;
  auto rspFlush(bool completed=true) -> void;
  auto rspDma(uint32_t bytes, bool toRdram) -> void;
  bool matrixSignatureSupported() const {return sigPc>=0&&!queueMode&&display.count==2&&display.signature[0]==0x00196603&&display.signature[1]==0x000c5840&&display.word0Reg==25&&display.word1Reg==24&&display.opcodeShift==24&&display.loopOffset==-12&&display.dispatchOffset==20;}
  bool wantsMatrixOperand() const {return rspEnabled&&segmentOpen&&segment.matrixCandidate;}
  auto rspMatrixOperand(uint32_t dram,uint32_t dmem,const uint8_t* bytes) -> void;
  auto rdpCommand(uint8_t opcode, uint64_t word0, uint64_t word1, uint8_t words) -> void;
  auto afterRun() -> void;
  static auto rspName(uint8_t opcode) -> const char*;
  static auto rdpName(uint8_t opcode) -> const char*;
};
inline CommandCapture commandCapture;
}
