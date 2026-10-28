#pragma once
#include <array>
#include <cstdint>
#include <deque>
// Protected by the host input mutex. Physical mapped port-one samples only.
struct InputStartGate {
  struct Sample { uint32_t mask=0; std::array<int,4> axes{}; };
  bool armed=false, neutral=false, triggered=false, holding=false, overflow=false;
  std::deque<Sample> transitions;
  Sample current, first, latest;
  static bool deliberate(const Sample& s) {
    // N64 uses D-pad, A/B, Start, bumpers/trigger and both mapped sticks.
    constexpr uint32_t mapped=0xf | (1u<<4) | (1u<<6) | (1u<<9) | (1u<<10) | (1u<<11) | (1u<<13);
    if(s.mask&mapped)return true;
    for(auto axis:s.axes)if(axis>4096||axis<-4096)return true;
    return false;
  }
  void arm(bool selectedPort) {armed=selectedPort;neutral=!deliberate(current);triggered=holding=overflow=false;transitions.clear();}
  void cancel() {armed=triggered=holding=overflow=false;transitions.clear();}
  Sample observe(Sample sample) {
    if(holding && (sample.mask!=latest.mask || sample.axes!=latest.axes)) {
      if(transitions.size()<128)transitions.push_back(sample);else overflow=true;
    }
    current=latest=sample;
    if(armed&&!triggered) {
      if(!deliberate(sample))neutral=true;
      else if(neutral){first=sample;triggered=holding=true;armed=false;}
    }
    return holding?first:sample;
  }
  Sample latched() {if(!transitions.empty()){first=transitions.front();transitions.pop_front();return first;}holding=false;return latest;}
};
