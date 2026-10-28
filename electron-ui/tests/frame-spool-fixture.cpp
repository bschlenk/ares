#include <cassert>
#include <cstdint>
#include <iostream>
#include "../native/frame-spool.hpp"
int main() {
  FrameSpool spool;
  assert(spool.open());
  constexpr size_t size = 320 * 237 * 3;
  for(unsigned n = 0; n < 1800; ++n) {
    std::vector<uint8_t> frame(size, uint8_t(n));
    // This fixture paces the producer; overload is separately tested below.
    while(!spool.append(frame)) std::this_thread::yield();
  }
  assert(spool.seal()); assert(spool.count == 1800);
  std::vector<uint8_t> frame(size);
  for(unsigned n = 0; n < 1800; ++n) {
    assert(spool.read(uint64_t(n) * size, frame));
    for(auto byte : frame) assert(byte == uint8_t(n));
  }
  assert(!spool.append(std::vector<uint8_t>(FrameSpool::queueLimit + 1)));
  spool.clear(); assert(!spool.file && !spool.count);
  assert(spool.open()); assert(spool.append(std::vector<uint8_t>(12, 42)));
  assert(spool.seal()); frame.resize(12); assert(spool.read(0, frame));
  assert(frame[0] == 42); std::cout << "FRAME_SPOOL_PASS: 1800 ordered 320x237 frames; bounded 16 MiB queue\n";
}
