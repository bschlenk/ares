#pragma once

// A time slice ending between microtasks is a yield, not a script failure.
// Keep the count across yields so a promise storm cannot evade the hard limit.
struct ScriptJobQueue {
  enum class Result { Drained, Yielded, JobLimit, Exception };
  unsigned jobs = 0;

  template<typename Pending, typename Expired, typename Execute>
  auto pump(Pending pending, Expired expired, Execute execute) -> Result {
    while(pending()) {
      if(jobs >= 4096) return Result::JobLimit;
      if(expired()) return Result::Yielded;
      ++jobs;
      if(!execute()) return Result::Exception;
    }
    jobs = 0;
    return Result::Drained;
  }
};
