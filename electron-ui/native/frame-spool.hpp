#pragma once
#include <cstdio>
#include <sys/stat.h>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

// Anonymous disk storage. Capture only enqueues; a full queue stops capture
// rather than blocking a render callback or dropping a frame inside the clip.
struct FrameSpool {
  std::mutex mutex;
  std::condition_variable changed;
  std::deque<std::vector<uint8_t>> queue;
  FILE* file = nullptr;
  std::thread worker;
  bool stopping = false, failed = false, writing = false;
  size_t count = 0, frameBytes = 0, queuedBytes = 0;
  static constexpr size_t queueLimit = 16ull << 20;
  ~FrameSpool() { clear(); }
  void clear() {
    { std::lock_guard lock(mutex); stopping = true; changed.notify_all(); }
    if(worker.joinable()) worker.join();
    if(file) std::fclose(file);
    file = nullptr; queue.clear(); count = frameBytes = queuedBytes = 0;
    stopping = failed = writing = false;
  }
  bool open() {
    clear(); file = std::tmpfile(); if(!file) return false;std::setvbuf(file,nullptr,_IONBF,0);
    worker = std::thread([this] {
      std::unique_lock lock(mutex);
      for(;;) {
        changed.wait(lock, [this] { return stopping || !queue.empty(); });
        if(stopping) return;
        auto bytes = std::move(queue.front()); queue.pop_front(); writing = true;
        lock.unlock();
        bool ok = std::fwrite(bytes.data(), 1, bytes.size(), file) == bytes.size();
        lock.lock(); queuedBytes -= bytes.size(); writing = false;
        if(!ok) { failed = true; queue.clear(); queuedBytes = 0; }
        changed.notify_all();
      }
    });
    return true;
  }
  bool append(std::vector<uint8_t> bytes) {
    std::lock_guard lock(mutex);
    if(failed || !file || bytes.size() > queueLimit - queuedBytes) return false;
    frameBytes = bytes.size(); queuedBytes += bytes.size(); ++count;
    queue.push_back(std::move(bytes)); changed.notify_all(); return true;
  }
  bool seal() {
    std::unique_lock lock(mutex);
    changed.wait(lock, [this] { return queue.empty() && !writing; });
    if(file && std::fflush(file)) failed = true;
    // Only complete frames form the readable prefix after a disk failure.
    if(failed && file) { struct stat info{};count = !::fstat(::fileno(file),&info)&&frameBytes ? std::min(count,size_t(info.st_size)/frameBytes) : 0;std::clearerr(file); }
    return !failed;
  }
  bool read(uint64_t offset, std::vector<uint8_t>& bytes) {
    return file && !std::fseek(file, long(offset), SEEK_SET) && std::fread(bytes.data(), 1, bytes.size(), file) == bytes.size();
  }
};
