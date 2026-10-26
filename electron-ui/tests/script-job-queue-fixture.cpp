#include "../native/script-job-queue.hpp"
#include <cassert>
#include <iostream>

int main() {
  ScriptJobQueue queue;
  unsigned remaining = 3;
  bool expired = false;
  // Model a native callback/descheduling that uses the rest of a slice after
  // one microtask. The queued continuation must survive and run next tick.
  auto first = queue.pump([&]{return remaining != 0;}, [&]{return expired;}, [&]{--remaining;expired=true;return true;});
  assert(first == ScriptJobQueue::Result::Yielded && remaining == 2);
  auto next = queue.pump([&]{return remaining != 0;}, []{return false;}, [&]{--remaining;return true;});
  assert(next == ScriptJobQueue::Result::Drained && remaining == 0 && queue.jobs == 0);

  // A self-replenishing promise queue still hits the same hard job limit even
  // when every slice yields. The limit cannot reset at a scheduling boundary.
  unsigned executed = 0;
  ScriptJobQueue::Result result;
  do {
    unsigned slice = 0;
    result = queue.pump([]{return true;}, [&]{return slice == 7;}, [&]{++slice;++executed;return true;});
  } while(result == ScriptJobQueue::Result::Yielded);
  assert(result == ScriptJobQueue::Result::JobLimit && executed == 4096);

  queue = {};
  assert(queue.pump([]{return true;}, []{return false;}, []{return false;}) == ScriptJobQueue::Result::Exception);
  std::cout << "SCRIPT_JOB_QUEUE_PASS\n";
}
