#pragma once
#include <cstdint>

// A time slice ending between microtasks is a yield, not a script failure.
// Keep the count across yields so a promise storm cannot evade the hard limit.
struct ScriptJobQueue {
  enum class Result { Drained, Yielded, JobLimit, Exception };
  unsigned jobs = 0;
  uint64_t executed = 0, progressEvents = 0;
  // Only observable host progress earns another microtask budget.
  void progress() { jobs = 0; ++progressEvents; }

  template<typename Pending, typename Expired, typename Execute>
  auto pump(Pending pending, Expired expired, Execute execute) -> Result {
    while(pending()) {
      if(jobs >= 4096) return Result::JobLimit;
      if(expired()) return Result::Yielded;
      ++jobs; ++executed;
      if(!execute()) return Result::Exception;
    }
    jobs = 0;
    return Result::Drained;
  }
};
