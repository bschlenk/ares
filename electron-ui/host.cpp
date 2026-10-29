#include "native/input-start-gate.hpp"
// Native Electron host. stdout is exclusively the AEF2 binary protocol.
#include <atomic>
#include <array>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>
#include <csignal>
#include <cmath>
#ifndef _WIN32
#include <unistd.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#endif
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "native/runtime/runtime.hpp"
#include <n64/n64.hpp>
#include <ares/frame-observer.hpp>
#include <nall/gdb/server.hpp>
#include "native/session-service.hpp"
#include "native/n64-service.hpp"
#include "native/machine-service.hpp"
#include "native/rsp-debug-service.hpp"
#include "native/task-service.hpp"
#include "native/rdp-capture-service.hpp"
#include "native/inspection-service.hpp"
#include "native/stack-service.hpp"
#include "native/call-service.hpp"
#include "native/viewer-service.hpp"
#include "native/memory-experiment.hpp"
#include "native/input-service.hpp"
#include "native/demonstration-service.hpp"
#include "native/trace-service.hpp"
#include "native/dma-service.hpp"
#include "native/profiler-service.hpp"
#include "native/tap-service.hpp"
#include "native/frame-service.hpp"
#include "native/audio-service.hpp"
#include "native/recording-service.hpp"
#include "native/state-snapshot.hpp"
#include "native/state-loader.hpp"
#include "native/settings-service.hpp"
#include "native/script-service.hpp"

using Clock = std::chrono::steady_clock;
struct Host : ares::Platform {
  InputService injectedInput;
  DemonstrationService demonstration;
  FrameService captures;
  AudioService audioCapture;
  RecordingService recording;
  StateSnapshot stateSnapshot;
  StateLoader stateLoader;
  std::atomic<bool> takeoverRequested{false};
  InputStartGate inputStart;
  uint64_t armedInputJob=0;
  ares::Node::System root;
  string contentHash;
  uint64_t contentSize = 0;
  std::shared_ptr<HID::Joypad> joypad;
  std::shared_ptr<HID::Keyboard> keyboard;
  std::shared_ptr<HID::Mouse> mouse;
  string systemName = "Game Boy";
  std::atomic<double> refreshRate{59.7275};
  ruby::Audio output;
  std::vector<ares::Node::Audio::Stream> streams;
  SessionService service;
  MemoryService memory;
  std::atomic<bool> quit{false};
  std::atomic<uint64_t> controls{0}; // sequence << 32 | button mask
  std::atomic<uint32_t> appliedInput{0};
  bool sound = true;
  std::atomic<bool> fastForward{false};
  FILE* frameOutput = stdout;
  std::mutex mutex;
  std::condition_variable wake;
  bool credit = false, available = false;
  std::shared_ptr<std::vector<uint8_t>> latest;
  std::vector<std::shared_ptr<std::vector<uint8_t>>> framePool;
  uint32_t sequence = 0, rateFrames = 0;
  double recentVps = 0;
  Clock::time_point rateStarted = Clock::now();
  double framesPerSecond() { std::lock_guard guard(mutex); return Clock::now()-captured > std::chrono::seconds(1) ? 0 : recentVps; }
  Clock::time_point started = Clock::now(), captured;

  static void put32(uint8_t* p, uint32_t v) {
    for(int i = 0; i < 4; i++) p[i] = v >> (8 * i);
  }
  static void put64(uint8_t* p, double v) {
    uint64_t bits; std::memcpy(&bits, &v, 8);
    for(int i = 0; i < 8; i++) p[i] = bits >> (8 * i);
  }
  auto pak(ares::Node::Object node) -> std::shared_ptr<vfs::directory> override {
    return emulator ? emulator->pak(node) : nullptr;
  }
  void setupInput() {
    joypad = std::make_shared<HID::Joypad>(); joypad->setID(0xe1ec0003);
    for(auto name : {"X", "Y", "RX", "RY"}) joypad->axes().append(name);
    for(unsigned i = 0; i < 32; i++) joypad->buttons().append({i});
    keyboard = std::make_shared<HID::Keyboard>(); keyboard->setID(0xe1ec0001);
    mouse = std::make_shared<HID::Mouse>(); mouse->setID(0xe1ec0002);
    mouse->appendAxis("X"); mouse->appendAxis("Y");
    for(auto name : {"Left", "Middle", "Right", "Extra"}) mouse->buttons().append(name);
    inputManager.devices = {joypad, keyboard, mouse};
    auto bind = [](InputMapping& mapping, u64 id, unsigned group, unsigned index, const char* qualifier = "") {
      mapping.unbind();
      mapping.bind(0, string{"0x", hex(id), "/", group, "/", index, qualifier});
    };
    auto& pad = virtualPorts[0].pad;
    InputMapping* buttons[] = {&pad.up, &pad.down, &pad.left, &pad.right,
      &pad.south, &pad.east, &pad.west, &pad.north, &pad.select, &pad.start,
      &pad.l_bumper, &pad.r_bumper, &pad.l_trigger, &pad.r_trigger, &pad.lstick_click, &pad.rstick_click,
      &pad.one, &pad.two, &pad.three, &pad.four, &pad.five, &pad.six, &pad.seven, &pad.eight,
      &pad.nine, &pad.zero, &pad.star, &pad.clear, &pad.pound, &pad.point, &pad.end};
    for(unsigned i = 0; i < std::size(buttons); i++) bind(*buttons[i], joypad->id(), HID::Joypad::Button, i);
    InputMapping* halves[] = {&pad.lstick_left, &pad.lstick_right, &pad.lstick_up, &pad.lstick_down,
      &pad.rstick_left, &pad.rstick_right, &pad.rstick_up, &pad.rstick_down};
    for(unsigned i = 0; i < 8; i++) bind(*halves[i], joypad->id(), HID::Joypad::Axis, i / 2, i % 2 ? "/Hi" : "/Lo");
    auto& pointer = virtualPorts[0].mouse;
    bind(pointer.x, mouse->id(), HID::Mouse::Axis, 0); bind(pointer.y, mouse->id(), HID::Mouse::Axis, 1);
    InputMapping* mouseButtons[] = {&pointer.left, &pointer.middle, &pointer.right, &pointer.extra};
    for(unsigned i = 0; i < 4; i++) bind(*mouseButtons[i], mouse->id(), HID::Mouse::Button, i);
    // Imported physical-device assignments must not override the Electron virtual pad.
    for(auto& entry : emulators) for(auto& port : entry->ports) for(auto& device : port.devices) {
      for(auto& node : device.inputs) if(node.directMapping) node.directMapping->unbind();
      for(auto& pair : device.pairs) {
        if(pair.directMappingLo) pair.directMappingLo->unbind();
        if(pair.directMappingHi) pair.directMappingHi->unbind();
      }
    }
    runtime.keyboardCaptured = true;
  }
  auto status(string_view message) -> void override { std::cerr << string{message}.data() << "\n"; }
  auto refreshRateHint(double rate) -> void override { if(rate > 1 && rate < 300) refreshRate = rate; }
  auto attach(ares::Node::Object node) -> void override {
    if(auto stream = node->cast<ares::Node::Audio::Stream>()) {
      stream->setResamplerFrequency(48000);
      streams.push_back(stream);
    }
  }
  auto audio(ares::Node::Audio::Stream) -> void override {
    if(streams.empty()) return;
    for(;;) {
      for(auto& stream : streams) if(!stream->pending()) return;
      double mixed[2]{};
      for(auto& stream : streams) {
        double samples[2]{};
        auto channels = stream->read(samples);
        mixed[0] += samples[0];
        mixed[1] += samples[channels == 1 ? 0 : 1];
      }
      for(auto& sample : mixed) sample = std::clamp(sample, -1.0, 1.0) * settings.audio.volume;
      audioCapture.push(mixed[0], mixed[1]);
      if(settings.audio.mute) mixed[0] = mixed[1] = 0.0;
      if(sound && !fastForward.load() && !service.execution.active && !service.paused) output.output(mixed);
    }
  }
  auto input(ares::Node::Input::Input node) -> void override {
    if(!injectedInput.apply(node, service.epoch, ares::Nintendo64::executionCoordinate.frame) && emulator) emulator->input(node);
    appliedInput = controls.load() >> 32;
  }
  auto detach(ares::Node::Object node) -> void override {
    captures.forget(node.get());
    if(auto stream = node->cast<ares::Node::Audio::Stream>()) std::erase(streams, stream);
  }
  auto video(ares::Node::Video::Screen screen, const u32* data, u32 pitch, u32 width, u32 height) -> void override { emitVideo(screen,data,pitch,width,height); }
  void emitVideo(ares::Node::Video::Screen screen,const u32* data,u32 pitch,u32 width,u32 height,bool preview=false) {
    auto now = Clock::now();
    std::lock_guard lock(mutex);
    ++rateFrames;
    auto interval = std::chrono::duration<double>(now-rateStarted).count();
    if(interval >= 1) { recentVps=rateFrames/interval;rateFrames=0;rateStarted=now; }
    // Reuse presentation packets unless the writer or a bounded screenshot pin
    // still owns them. Debug screenshots share these bytes instead of copying
    // a second RGBA image on every frame.
    latest.reset();
    for(auto& buffer : framePool) if(buffer.use_count() == 1) { latest = buffer; break; }
    if(!latest) { latest = std::make_shared<std::vector<uint8_t>>(); framePool.push_back(latest); }
    latest->resize(128 + size_t(width) * height * 4);
    auto p = latest->data();
    std::memcpy(p, "AEF4", 4);
    put32(p + 4, width * height * 4); put32(p + 8, width); put32(p + 12, height);
    put32(p + 16, ++sequence); put32(p + 20, appliedInput);
    put64(p + 24, std::chrono::duration<double, std::milli>(now - started).count());
    // Explicit conversion handles ARGB words and non-contiguous source rows.
    double aspect = double(width) / height;
    if(screen && screen->height() && screen->scaleY() && screen->aspectY()) {
      aspect = (screen->width() * screen->scaleX() * screen->aspectX()) /
               (screen->height() * screen->scaleY() * screen->aspectY());
      if(screen->rotation() == 90 || screen->rotation() == 270) aspect = 1.0 / aspect;
    }
    put64(p + 40, aspect);
    auto tag=preview?FrameService::Tag{}:screen?captures.tag(screen.get()):FrameService::Tag{service.epoch,service.execution.frame};
    put64(p+48,double(tag.epoch));put64(p+56,double(tag.frame));put64(p+64,double(tag.originCommit));
    put32(p+72,tag.origin);put32(p+76,preview?0u:(tag.epoch?1u:0u)|(systemName=="Nintendo 64"?2u:0u)|(!screen?4u:systemName!="Nintendo 64"?8u:0u));
    uint32_t logicalHeight=tag.logicalHeight?tag.logicalHeight:height;
    if(systemName=="Nintendo 64"&&!preview){
      logicalHeight=height;
      #if defined(VULKAN)
      if(ares::Nintendo64::vulkan.enable)logicalHeight=height/std::max(1u,uint32_t(ares::Nintendo64::vulkan.outputUpscale));
      #endif
    }
    put32(p+80,tag.logicalWidth?tag.logicalWidth:width);put32(p+84,logicalHeight);put64(p+88,0);
    put32(p+96,0);put32(p+100,0);put32(p+104,0);put32(p+108,0);put32(p+112,0);put32(p+116,0);put64(p+120,0);
    if(screen&&!preview){
      const auto g=screen->presentationGeometry();
      put32(p+96,g.canvasWidth);put32(p+100,g.canvasHeight);put32(p+104,g.cropX);put32(p+108,g.cropY);put32(p+112,g.rotation);
      const bool turns=g.rotation==90||g.rotation==270;
      const auto cw=turns?g.canvasHeight:g.canvasWidth,ch=turns?g.canvasWidth:g.canvasHeight;
      const bool known=g.rotation==0||g.rotation==90||g.rotation==180||g.rotation==270;
      put32(p+116,known&&g.cropX<=cw&&g.cropY<=ch&&width<=cw-g.cropX&&height<=ch-g.cropY?1:0);
    }
    p += 128;
    for(uint32_t y = 0; y < height; y++) {
      auto row = reinterpret_cast<const u32*>(reinterpret_cast<const uint8_t*>(data) + y * pitch);
      for(uint32_t x = 0; x < width; x++) {
        auto color = row[x];
        *p++ = color >> 16; *p++ = color >> 8; *p++ = color; *p++ = 255;
      }
    }
    if(!preview)captures.observe(screen.get(), latest->data() + 128, width, height, sequence, screen ? 0 : service.epoch, screen ? 0 : service.execution.frame, latest,128);
    captured = now; available = true; wake.notify_one();
  }
  // Present restored RAM pixels without running the core or feeding recording taps.
  bool showPausedFramebuffer() {
    if(!service.paused||systemName!="Nintendo 64"){if(std::getenv("ARES_DEBUG_PREVIEW"))std::cerr<<"preview skipped: paused="<<service.paused<<" system="<<systemName.data()<<"\n";return false;}
    std::shared_ptr<const FrameService::Image> image;
    auto snapshot=FrameService::framebuffer(image,service.epoch,service.execution.frame,false);
    if(!snapshot.error.empty()||uint64_t(image->width)*image->height>1920*1080){if(std::getenv("ARES_DEBUG_PREVIEW"))std::cerr<<"preview unavailable: "<<snapshot.error<<"\n";uint32_t black=0xff000000u;emitVideo(ares::Nintendo64::vi.screen,&black,4,1,1,true);return false;}
    std::vector<uint32_t> pixels(uint64_t(image->width)*image->height);
    for(size_t n=0;n<pixels.size();++n){auto p=image->data()+n*4;pixels[n]=0xff000000u|uint32_t(p[0])<<16|uint32_t(p[1])<<8|p[2];}
    emitVideo(ares::Nintendo64::vi.screen,pixels.data(),image->width*4,image->width,image->height,true);
    if(std::getenv("ARES_DEBUG_PREVIEW"))std::cerr<<"preview queued: "<<image->width<<"x"<<image->height<<"\n";
    return true;
  }
  void writeFrames() {
    std::shared_ptr<std::vector<uint8_t>> frame;
    while(!quit) {
      {
        std::unique_lock lock(mutex);
        wake.wait(lock, [&] { return quit || (credit && available); });
        if(quit) break;
        frame = latest; available = false; credit = false;
        put64(frame->data() + 32, std::chrono::duration<double, std::milli>(Clock::now() - captured).count());
      }
      if(std::fwrite(frame->data(), 1, frame->size(), frameOutput) != frame->size() || std::fflush(frameOutput)) {
        quit = true; break;
      }
      frame.reset();
    }
  }
  void readCommands() {
    std::string line;
    std::array<int, 4> previousAxes{};
    // Bound input before allocating an arbitrarily large line.
    char ch;
    while(std::cin.get(ch)) {
      if(ch != '\n') {
        if(line.size() >= 65536) break;
        line += ch; continue;
      }
      std::istringstream command(line);
      std::string name; command >> name;
      if(name != "ack" && name != "input" && name != "key" && name != "mouse" && name != "clear" && name != "fastforward" && name != "quit") {
        if(!service.output || !service.enqueue(line)) break;
        line.clear(); continue;
      }
      if(name == "ack") { std::lock_guard lock(mutex); credit = true; wake.notify_one(); }
      if(name == "input") {
        uint32_t seq, mask;
        if(command >> seq >> mask) {
          int axes[4]{}; command >> axes[0] >> axes[1] >> axes[2] >> axes[3];
          bool moved = (mask & ~uint32_t(controls.load())) != 0;
          for(unsigned i = 0; i < 4; ++i) {
            axes[i] = std::clamp(axes[i], -32767, 32767);
            moved |= std::abs(axes[i]) > 4096 && std::abs(axes[i] - previousAxes[i]) > 4096;
            previousAxes[i] = axes[i];
          }
          if(moved) takeoverRequested = true;
          std::lock_guard lock(runtime.inputMutex);
          InputStartGate::Sample sample;sample.mask=mask;for(unsigned i=0;i<4;++i)sample.axes[i]=axes[i];
          auto applied=inputStart.observe(sample);
          mask=applied.mask;for(unsigned i=0;i<4;++i)axes[i]=applied.axes[i];
          if(joypad) {
            for(unsigned i = 0; i < 4; i++) joypad->axes().input(i).setValue(std::clamp(axes[i], -32767, 32767));
            for(unsigned i = 0; i < 32; i++) joypad->buttons().input(i).setValue((mask >> i) & 1);
          }
          controls = (uint64_t(seq) << 32) | mask;
        }
      }
      if(name == "key" && keyboard) {
        std::string key; int value;
        if(command >> key >> value && key.size() <= 32) {
          std::lock_guard lock(runtime.inputMutex);
          auto found = keyboard->buttons().find(key.c_str());
          if(!found && keyboard->buttons().size() < 128) { keyboard->buttons().append(key.c_str()); found = keyboard->buttons().find(key.c_str()); }
          if(found) {
            auto& button = keyboard->buttons().input(*found);
            if(value && !button.value()) takeoverRequested = true;
            button.setValue(value != 0);
          }
        }
      }
      if(name == "mouse" && mouse) {
        int x, y; unsigned mask;
        if(command >> x >> y >> mask) {
          std::lock_guard lock(runtime.inputMutex);
          mouse->motion(0).move(std::clamp(x, -32767, 32767)); mouse->motion(1).move(std::clamp(y, -32767, 32767));
          for(unsigned i = 0; i < 4; i++) {
            auto& button = mouse->buttons().input(i);
            if(((mask >> i) & 1) && !button.value()) takeoverRequested = true;
            button.setValue((mask >> i) & 1);
          }
        }
      }
      if(name == "fastforward") { unsigned value = 0; command >> value; fastForward = value == 1; }
      if(name == "clear") {
        fastForward = false;
        std::lock_guard lock(runtime.inputMutex);
        if(keyboard) for(auto& key : keyboard->buttons()) key.setValue(0);
        if(mouse) for(auto& button : mouse->buttons()) button.setValue(0);
      }
      if(name == "quit") break;
      line.clear();
    }
    quit = true; wake.notify_all();
  }
};

int main(int argc, char** argv) {
#ifndef _WIN32
  // Kernel-owned claim lock: survives stale connection records, releases on death.
  // Keep the inode in place; unlinking advisory locks permits split ownership.
  if(argc == 3 && std::string(argv[1]) == "--service-lock") {
    int fd = open(argv[2], O_CREAT | O_RDWR | O_NOFOLLOW, 0600);
    struct stat st;
    if(fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != getuid() || (st.st_mode & 077) || flock(fd, LOCK_EX | LOCK_NB)) return 3;
    std::cout << "locked\n" << std::flush;
    char byte;
    while(read(STDIN_FILENO, &byte, 1) > 0) {}
    close(fd); return 0;
  }
#endif
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);
#else
  std::signal(SIGPIPE, SIG_IGN);
#endif
  Host host;
  // Core/MIA diagnostics may use print()/printf()/cout. Keep their stdout
  // separate from the protocol, including diagnostics emitted during gameplay.
#ifdef _WIN32
  host.frameOutput = _fdopen(_dup(_fileno(stdout)), "wb");
  _dup2(_fileno(stderr), _fileno(stdout));
#else
  host.frameOutput = fdopen(dup(fileno(stdout)), "wb");
  dup2(fileno(stderr), fileno(stdout));
#endif
  if(!host.frameOutput) { std::cerr << "Cannot open frame transport\n"; return 1; }
  bool synthetic = false, identifyOnly = false, listSystems = false, inspectSettings = false;
  unsigned width = 640, height = 480;
  std::string rom, saveDirectory, settingsFile, settingsOverlay, selectedSystem;
  string resourceDirectory = Path::program();
  std::vector<string> extraMedia;
  for(int i = 1; i < argc; i++) {
    std::string arg = argv[i];
    if(arg == "--debug-capture") host.captures.enabled = true;
    else if(arg == "--debug-provenance") ares::Nintendo64::dmaProvenance.enabled = true;
    else if(arg == "--silent") host.sound = false;
    else if(arg == "--control-session" && i + 1 < argc) {
      host.service.session = argv[++i];
      if(host.service.session.empty() || host.service.session.size() > 64 || host.service.session.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != std::string::npos) return 2;
#ifdef _WIN32
      host.service.output = _fdopen(3, "wb");
#else
      host.service.output = fdopen(3, "wb");
#endif
      if(!host.service.output) return 2;
    }
    else if(arg == "--paused") host.service.paused = true;
    else if(arg == "--synthetic") synthetic = true;
    else if(arg == "--1080p") { width = 1920; height = 1080; }
    else if(arg == "--systems") listSystems = true;
    else if(arg == "--settings-info") inspectSettings = true;
    else if(arg == "--settings-overlay" && i + 1 < argc) settingsOverlay = argv[++i];
    else if(arg == "--settings" && i + 1 < argc) settingsFile = argv[++i];
    else if(arg == "--system" && i + 1 < argc) selectedSystem = argv[++i];
    else if(arg == "--media" && i + 1 < argc) extraMedia.push_back(argv[++i]);
    else if(arg == "--resource-dir" && i + 1 < argc) resourceDirectory = argv[++i];
    else if(arg == "--save-dir" && i + 1 < argc) saveDirectory = argv[++i];
    else if(arg == "--identify" && i + 1 < argc) { identifyOnly = true; rom = argv[++i]; }
    else if(arg == "--rom" && i + 1 < argc) rom = argv[++i];
    else { std::cerr << "Usage: ares-electron-host [--rom file | --identify file | --synthetic [--1080p]] [--silent] [--save-dir directory] [--resource-dir directory]\n"; return 2; }
  }
  ares::Nintendo64::dmaProvenance.reset(host.service.epoch);
  ares::Nintendo64::taskProvenance.reset(host.service.epoch);
  if(!resourceDirectory.endsWith("/")) resourceDirectory.append("/");
  mia::setResourceResolver([resourceDirectory](const string& name) -> string {
    return {resourceDirectory, name};
  });
  Emulator::construct();
  if(listSystems) { for(auto& entry : emulators) std::fprintf(host.frameOutput, "%s\n", entry->name.data()); return 0; }
  static_cast<Markup::Node&>(settings) = BML::unserialize(string::read(settingsFile.c_str()), " ");
  if(inspectSettings) {
    auto json = settingsInfo();
    std::fprintf(host.frameOutput, "%s\n", json.c_str());
    return 0;
  }
  if(!synthetic && rom.empty()) { std::cerr << "A ROM is required\n"; return 2; }
  // Electron owns this separate, immutable launch snapshot. Never modify imported BML.
  if(!settingsOverlay.empty()) {
    auto overlay = BML::unserialize(string::read(settingsOverlay.c_str()), " ");
    visitSettings(overlay, {}, [&](const string& key, const string& value) { settings(key).setValue(value); });
  }
  settings.process(true); // Read configuration only; never rewrite the desktop settings.
  if(saveDirectory.empty()) saveDirectory = std::string(Path::program().data()) + "electron-data/saves/";
  if(saveDirectory.back() != '/') saveDirectory += '/';
  directory::create(saveDirectory.c_str());
  settings.paths.saves = saveDirectory.c_str();
  mia::setSaveLocation([&]() -> string { return settings.paths.saves; });
  // Imported desktop paths must not redirect writable system data out of the profile.
  settings.paths.home = {saveDirectory.c_str(), "../systems/"};
  mia::setHomeLocation([&]() -> string { return settings.paths.home; });
  ares::platform = &host;
  ares::Memory::FixedAllocator::get();
  if(!synthetic) {
    auto matches = mia::identify(rom.c_str());
    // MIA considers monochrome GB cartridges compatible with both GB models.
    if(matches.size() == 2 && std::ranges::all_of(matches, [](const auto& name) {
      return name == "Game Boy" || name == "Game Boy Color";
    })) {
      auto probe = mia::Medium::create("Game Boy");
      if(probe->load(rom.c_str()) != successful) return 2;
      auto bytes = probe->pak->read("program.rom"); bytes->seek(0x143);
      matches = {bytes->read() & 0x80 ? "Game Boy Color" : "Game Boy"};
    }
    if(!selectedSystem.empty()) matches = {selectedSystem.c_str()};
    // The registry, rather than a second hand-maintained whitelist, determines support.
    std::erase_if(matches, [](const auto& name) {
      return std::ranges::none_of(emulators, [&](const auto& entry) { return entry->name == name; });
    });
    if(matches.empty()) { std::cerr << "Could not identify a compiled system. Select the system explicitly.\n"; return 2; }
    if(identifyOnly) { for(auto& match : matches) std::fprintf(host.frameOutput, "%s\n", match.data()); return 0; }
    if(matches.size() != 1) { std::cerr << "Ambiguous ROM: select a system explicitly.\n"; return 2; }
    for(auto& entry : emulators) if(entry->name == matches.front()) emulator = entry;
    if(!emulator) { std::cerr << "System is not compiled into this host\n"; return 2; }
    host.systemName = emulator->name;
    runtime.mediaQueue = extraMedia;
    host.setupInput();
    if(host.sound) {
      if(!host.output.create()) { std::cerr << "Native audio unavailable; use --silent to test without it\n"; return 1; }
      host.output.setBlocking(true);
    }
    if(!emulator->load(string{rom.c_str()})) {
      if(emulator->root) emulator->root->unload();
      emulator.reset(); return 1;
    }
    host.root = emulator->root;
    if(auto bytes = emulator->game->pak->read("program.rom")) {
      host.contentSize = bytes->size();
      host.contentHash = nall::Hash::SHA256({bytes->data(), bytes->size()}).digest();
    }
    updatePalette();
  }
  std::cerr << "ready: " << (synthetic ? "synthetic RGBA source" : host.systemName.data())
            << "; audio=" << (!synthetic && host.sound ? "native SDL" : "off") << "\n";
  auto memoryRoot = host.root;
  std::array<uint8_t, 256> fixtureMemory;
  if(synthetic) {
    // Explicit synthetic debugger nodes exercise access metadata without a ROM.
    for(size_t i = 0; i < fixtureMemory.size(); ++i) fixtureMemory[i] = i;
    memoryRoot = std::make_shared<ares::Core::System>("Synthetic");
    auto ram = memoryRoot->append<ares::Node::Debugger::Memory>("Fixture RAM");
    ram->setSize(fixtureMemory.size());
    ram->setRead([&](u32 offset) -> u8 { return fixtureMemory[offset]; });
    ram->setWrite([&](u32 offset, u8 byte) { fixtureMemory[offset] = byte; });
    auto rom = memoryRoot->append<ares::Node::Debugger::Memory>("Fixture read-only");
    rom->setSize(fixtureMemory.size());
    rom->setRead([&](u32 offset) -> u8 { return fixtureMemory[offset]; });
    auto absent = memoryRoot->append<ares::Node::Debugger::Memory>("Fixture unavailable");
    absent->setSize(16);
  }
  host.memory.bind(memoryRoot, host.service.session, memoryRoot && memoryRoot->name() == "Nintendo 64");
  // The core debugger's RDRAM callback follows chip initialization/degradation
  // and can consume guest RNG. Universal host offsets mean raw physical storage.
  if(memoryRoot && memoryRoot->name() == "Nintendo 64") for(auto& region : host.memory.regions) if(region.node->name() == "RDRAM") {
    region.hostCpuRead = [](uint32_t offset) -> uint8_t {
      using namespace ares::Nintendo64;
      auto& line=cpu.dcache.line(0xffffffff80000000ull|offset);
      if(line.hit(offset))return cpu.dcache.readDebug<Byte>(0xffffffff80000000ull|offset,offset);
      return static_cast<Memory::Writable&>(rdram.ram).read<Byte>(offset);
    };
    region.hostRead = [](uint32_t offset) -> uint8_t { return static_cast<ares::Nintendo64::Memory::Writable&>(ares::Nintendo64::rdram.ram).read<ares::Nintendo64::Byte>(offset); };
  }
  std::thread reader([&] { host.readCommands(); });
  std::thread writer([&] { host.writeFrames(); });
  std::thread replies;
  if(host.service.output) replies = std::thread([&] { host.service.writeReplies(); });
  // Padded synthetic rows exercise pitch handling, not just tightly packed data.
  std::vector<u32> pixels(synthetic ? (width + 8) * height : 0);
  auto deadline = Clock::now();
  uint32_t tick = 0;
  unsigned syntheticPhase = 0;
  bool n64 = !synthetic && host.root && host.root->name() == "Nintendo 64";
  auto& execution = host.service.execution;
  ScriptService scriptService;
  std::map<uint64_t,std::unique_ptr<ScriptService>> observers;
  std::map<std::string,std::unique_ptr<ScriptService>> observerPreparations;
  uint64_t observerRotation=0;
  N64Service n64Service; n64Service.available = n64;
  TraceService traceService; traceService.available = n64;
  TapService tapService;
  RspDebugService rspDebugService;
  RdpCaptureService rdpCaptureService;
  rdpCaptureService.romIdentity = [&] {
    MachineService::Object game;
    game.add("sha256", controlQuote(host.contentHash.data())); game.number("size", host.contentSize);
    if(emulator && emulator->game && emulator->game->pak) {
      game.add("title", controlQuote(emulator->game->pak->attribute("title").data()));
      game.add("id", controlQuote(emulator->game->pak->attribute("id").data()));
    }
    return game.end();
  };
  InspectionService inspectionService;
  CallService callService;
  ViewerService viewerService;
  if(n64) viewerService.loadRom(rom);
  host.service.statusFields = [&] {
    MachineService::Object status;
    if(host.contentHash) {
      MachineService::Object game; game.add("sha256", controlQuote(host.contentHash.data()));
      game.number("size", host.contentSize); game.add("kind", controlQuote("program.rom"));
      status.add("game", game.end());
    } else status.add("game", "null");
    status.add("loaded", host.root ? "true" : "false");status.number("protocol_version",1);
    status.add("vps",std::to_string(host.framesPerSecond()));
    status.add("gdbHalted",nall::GDB::server.isHalted() ? "true" : "false");status.add("gdb_client",nall::GDB::server.hasClient() ? "true" : "false");
    if(n64) {
      using namespace ares::Nintendo64;
      auto& debug=cpu.debugControl;
      status.hex("pc",cpu.ipu.pc);status.number("presented_frame",commandCapture.presentedFrame);
      status.add("cpu_halted",debug.halted ? "true" : "false");status.add("stopped",host.service.paused || debug.halted ? "true" : "false");
      MachineService::Object mode;mode.add("executor",controlQuote(N64Service::executor()));mode.add("recompiler_enabled",cpu.recompiler.enabled ? "true" : "false");
      mode.number("breakpoints",debug.breakpoints.size());mode.number("watchpoints",debug.watchpoints.size());mode.add("interpreter_forced",debug.active || rsp.debugControl.active ? "true" : "false");
      mode.add("renderer",controlQuote(vulkan.enable ? "Vulkan" : "software"));mode.add("expansion_pak",ares::Nintendo64::system.expansionPak ? "true" : "false");mode.number("rdram_size",rdram.ram.size);
      mode.add("rsp_debugger_active",rsp.debugControl.active ? "true" : "false");mode.add("run_ahead_during_operations","false");mode.add("rewind_during_operations","false");
      status.add("debug_mode",mode.end());status.add("input",host.injectedInput.state());status.add("last_stop",N64Service::stop(host.service.epoch));status.add("call_recovery_pending",callService.savedValid ? "true" : "false");
      MachineService::Object save;
      const char* type=cartridge.eeprom.size ? "EEPROM" : cartridge.ram.size ? "RAM" : cartridge.flash.size ? "Flash" : "None";
      const char* extension=cartridge.eeprom.size ? ".eeprom" : cartridge.ram.size ? ".ram" : ".flash";
      const char* filename=cartridge.eeprom.size ? "save.eeprom" : cartridge.ram.size ? "save.ram" : "save.flash";
      save.add("type",controlQuote(type));save.number("size",cartridge.eeprom.size ? cartridge.eeprom.size : cartridge.ram.size ? cartridge.ram.size : cartridge.flash.size);
      if(emulator && emulator->game) {
        auto game=emulator->game;auto file=game->pak->read(filename);
        save.add("loaded_from_file",file && file->attribute("loaded").boolean() ? "true" : "false");
        save.add("resolved_path",std::string(type)=="None" ? "null" : controlQuote(string{settings.paths.saves,game->saveName(),"/",Location::prefix(game->location),extension}.data()));
      }
      status.add("save",save.end());
      status.add("operation",execution.active ? "{\"operation_id\":"+std::to_string(execution.active->id)+",\"kind\":"+controlQuote(execution.active->kind)+",\"state\":\"running\"}" : "null");
    }
    auto result=status.end();return ","+result.substr(1,result.size()-2);
  };
  inspectionService.presentedFrame = [] {return ares::Nintendo64::commandCapture.presentedFrame;};
  inspectionService.vps = [&] {return host.framesPerSecond();};
  ProfilerService profilerService; profilerService.available = n64;
  DmaService dmaService; dmaService.available = n64;
  execution.cpuSupported = n64;
  host.injectedInput.available = n64||synthetic;
  host.demonstration.input=&host.injectedInput;host.demonstration.execution=&execution;host.demonstration.paused=&host.service.paused;
  ares::Nintendo64::executionCoordinate.inputLatch=[&](unsigned port,uint32_t data){auto value=host.demonstration.latch(port,data,host.service.epoch,ares::Nintendo64::executionCoordinate.frame);
    if(port==1){std::lock_guard lock(runtime.inputMutex);if(host.inputStart.holding){auto latest=host.inputStart.latched();if(host.joypad){for(unsigned i=0;i<4;++i)host.joypad->axes().input(i).setValue(latest.axes[i]);for(unsigned i=0;i<32;++i)host.joypad->buttons().input(i).setValue((latest.mask>>i)&1);}}}
    return value;};
  bool samplingOrigin=false;
  host.service.memoryTools.frameReference=[&](uint64_t frame,bool boundary){
    boundary=boundary||samplingOrigin;
    std::string candidates="[";
    if(n64)for(auto it=ares::Nintendo64::taskProvenance.scanouts.rbegin();it!=ares::Nintendo64::taskProvenance.scanouts.rend();++it)if(it->frame==frame&&it->originCommit==ares::Nintendo64::executionCoordinate.originCommit){for(auto id:it->candidates){if(candidates.back()!='[')candidates+=',';candidates+=std::to_string(id);}break;}
    candidates+=']';
    return "{\"task_mapping\":\"candidate_only\",\"task_candidates\":"+candidates+",\"native_session\":"+controlQuote(host.service.session)+",\"epoch\":"+std::to_string(host.service.epoch)+",\"vi\":"+(execution.frameKind=="vi"||execution.frameKind=="synthetic-vi"?std::to_string(frame):"null")+",\"boundary\":"+controlQuote(!boundary?"safe_point":samplingOrigin?"vi_origin":execution.frameKind=="unavailable"?host.service.memoryTools.observedKind:execution.frameKind)+",\"origin\":"+(n64?std::to_string(uint32_t(ares::Nintendo64::vi.io.dramAddress)):"null")+",\"origin_commit\":"+(n64?std::to_string(ares::Nintendo64::executionCoordinate.originCommit):"null")+",\"video_sequence\":null,\"presentation\":null,\"provenance\":\"unmatched\"}";
  };
  const void* memoryScreen = nullptr;
  if(!n64 && !synthetic && memoryRoot) for(auto screen : memoryRoot->find<ares::Node::Video::Screen>()) { if(!memoryScreen) memoryScreen = screen.get(); }
  if(memoryScreen) host.service.memoryTools.observedKind = "primary-screen-frame";
  ares::Video::frameSubmittedObserver = [&](const void* screen) {
    if(screen == memoryScreen && memoryScreen) {
      auto& tools = host.service.memoryTools;
      tools.sync(host.service.epoch);
      tools.boundary(host.service.epoch, ++tools.observedFrame);
    }
    auto& vi=ares::Nintendo64::vi.io;
    uint32_t logicalHeight=n64?uint32_t((uint64_t(vi.vend>vi.vstart?(uint32_t(vi.vend)-uint32_t(vi.vstart))>>1:0)*(uint32_t(vi.yscale)&0xfff))>>10):0;
    if(n64)ares::Nintendo64::taskProvenance.scanout(ares::Nintendo64::executionCoordinate.frame,ares::Nintendo64::executionCoordinate.originCommit,vi.dramAddress,vi.width,logicalHeight);
    host.captures.submitted(screen,host.service.epoch,n64?ares::Nintendo64::executionCoordinate.frame:execution.frame,n64?ares::Nintendo64::executionCoordinate.originCommit:0,n64?uint32_t(vi.dramAddress):0,n64?uint32_t(vi.width):0,logicalHeight);
  };
  host.captures.onCapture = [&](const uint8_t* pixels, uint32_t w, uint32_t h, uint64_t epoch, uint64_t frame) { host.recording.capture(pixels, w, h, epoch, frame); };
  host.service.videoRequest = [&](const std::string& method, const std::vector<std::string>& args, const std::string& owner) {
    if(method.starts_with("video.record.")) {
      auto result = host.recording.execute(method, args, owner, host.service.epoch, execution.frame, execution.frameKind);
      return result;
    }
    return host.captures.execute(method, args, owner, host.service.epoch, execution.frame, n64, execution.frameKind, host.service.paused);
  };
  host.service.runtimeRequest = [&](const std::string& method, const std::vector<std::string>& args) {
    if(method == "runtime.provenance") {
      if(args.size() != 1 || (args[0] != "0" && args[0] != "1")) return ControlResult{"invalid_request", {}};
      auto& provenance = ares::Nintendo64::dmaProvenance;
      if(args[0] == "1") provenance.enable(); else provenance.disable();
      return ControlResult{{}, std::string("{\"enabled\":") + (provenance.enabled ? "true}" : "false}")};
    }
    return configureRuntime(method, args, bool(execution.active) || bool(execution.reservation) || host.stateLoader.upload.has_value());
  };
  host.service.audioRequest = [&](const std::string& method, const std::vector<std::string>& args, const std::string& owner) {
    return host.audioCapture.execute(method, args, owner, !host.streams.empty());
  };
  host.service.onReleaseOwner = [&](const std::string& owner) { for(auto it=observers.begin();it!=observers.end();)if(it->second->owner==owner){it->second->finish("disconnected");it=observers.erase(it);}else ++it;observerPreparations.erase(owner); host.demonstration.releaseOwner(owner,execution.frame); host.injectedInput.releaseOwner(owner); profilerService.releaseOwner(owner); host.captures.releaseOwner(owner); host.audioCapture.releaseOwner(owner); host.recording.releaseOwner(owner); host.stateSnapshot.releaseOwner(owner); host.stateLoader.releaseOwner(owner); rspDebugService.releaseOwner(owner); rdpCaptureService.releaseOwner(owner); inspectionService.releaseOwner(owner); callService.releaseOwner(owner); viewerService.releaseOwner(owner); };
  host.service.beforeRequest = [&](const std::string& method, const std::string& owner) -> std::string {
    host.demonstration.tick(host.service.epoch,execution.frame);
    const bool demoScriptLifecycle = (owner==host.demonstration.owner||owner==host.demonstration.requester) && (method=="execution.status" || method=="execution.cancel" || method=="script.pending" || method=="script.read" || method=="script.ack" || method=="script.resolve");
    if(host.demonstration.state=="armed"&&!demoScriptLifecycle&&method!="execution.release"&&method!="session.reset"&&!method.starts_with("n64.demo.")&&method!="session.status"&&method!="runtime.settings"&&method!="video.record.status"&&!method.starts_with("n64.state.")&&!method.starts_with("memory.read"))return "demonstration_armed";
    if(host.demonstration.state=="replaying"&&method=="n64.input.set")return "busy";
    if(host.demonstration.state=="replaying"&&(owner=="ui"||owner==host.demonstration.owner)&&(method=="n64.input.release"||method=="session.pause"||method=="execution.cancel"))host.demonstration.finish("cancelled",execution.frame);
    if(host.demonstration.state=="recording"&&host.demonstration.source=="human"&&(method.starts_with("n64.input.")&&method!="n64.input.state"||method.starts_with("execution.run")||method=="execution.stepInstructions"||method.starts_with("script.start")))return "demonstration_human_only";
    rspDebugService.service(execution, host.service.paused);
    if(!rspDebugService.permitted(method, owner, bool(execution.active))) return "busy";
    auto& load = host.stateLoader;
    if(load.upload && Clock::now() >= load.upload->deadline) load.reset();
    if(load.upload && (method == "session.pause" || method == "session.resume") && owner != "ui" && owner != load.upload->owner) return "busy";
    if(!load.upload || method.starts_with("n64.state.load")) return {};
    static const std::vector<std::string> allowed = {
      "runtime.settings", "session.status", "session.pause", "session.resume", "session.reset", "execution.status", "execution.cancel", "execution.release", "execution.batchCheck",
      "n64.capture.control", "n64.capture.rsp", "n64.capture.rdp", "n64.capture.matrices", "n64.capture.transforms", "n64.cpu.stack", "n64.render.probe", "n64.dump.read", "n64.dump.release", "n64.cpu.disassemble", "n64.rsp.registers", "n64.rdp.state", "n64.peripheral.registers", "n64.rsp.lastTask",
      "memory.regions", "memory.read", "memory.readMany", "memory.snapshot.capture", "memory.recorder.start", "memory.recorder.stop", "memory.capture.status", "memory.capture.read", "memory.capture.release", "memory.snapshot.compare", "memory.capture.freeze", "memory.query.start", "memory.query.advance", "memory.query.page", "memory.query.release", "memory.snapshot.changes", "n64.memory.read", "n64.memory.readMany", "n64.debug.registers", "n64.debug.lastStop", "n64.debug.breakList", "n64.debug.watchList",
      "n64.input.state", "n64.profiler.top", "n64.dma.log", "n64.trace.page", "n64.state.format", "n64.state.layout", "n64.state.read", "n64.state.release",
      "video.begin", "video.read", "video.release", "video.record.status", "video.record.read", "video.record.release", "audio.status", "audio.read", "audio.release"
    };
    return std::find(allowed.begin(), allowed.end(), method) != allowed.end() ? std::string{} : "busy";
  };
  host.service.n64Request = [&](const std::string& method, const std::vector<std::string>& args, const std::string& owner) {
    if(method.starts_with("n64.demo.")){
      if(!n64&&!synthetic)return ControlResult{"unavailable",{}};
      auto result=host.demonstration.execute(method,args,owner,host.service.epoch,execution.frame,host.contentHash.data(),host.service.session);
      if(result.error.empty()&&method=="n64.demo.request"){std::lock_guard lock(runtime.inputMutex);host.armedInputJob=host.demonstration.id;host.inputStart.arm(host.demonstration.port==1);host.demonstration.inputStartReady=host.inputStart.neutral;}
      if(result.error.empty()&&method=="n64.demo.request")host.showPausedFramebuffer();
      if(result.error.empty()&&method=="n64.demo.handoff"){std::lock_guard lock(host.recording.mutex);if(host.recording.owner==owner)host.recording.owner=host.demonstration.owner;}
      return result;
    }
    if(method=="n64.rsp.lastTask")return n64?TaskService::execute(args,host.service.epoch,execution.frame):ControlResult{"unavailable",{}};
    if(method.starts_with("n64.capture.")) return viewerService.execute(method, args, owner, host.service.epoch, n64, bool(execution.active) || bool(execution.reservation) || host.stateLoader.upload.has_value(),host.service.session);
    if(method == "n64.cpu.call" || method == "n64.cpu.callRecover") return callService.execute(method, args, owner, host.service.epoch, n64, execution, host.service.paused);
    if(method == "n64.cpu.stack") return StackService::execute(args, n64, host.service.epoch, execution.frame);
    if(method == "n64.render.probe" || method.starts_with("n64.dump.")) return inspectionService.execute(method, args, owner, host.service.epoch, execution.frame, n64, bool(execution.active) || bool(execution.reservation), host.service.paused);
    if(method == "n64.rdp.captureStart" || method == "n64.rdp.capturePage") return rdpCaptureService.execute(method, args, owner, host.service.epoch, n64, host.service.paused, execution);
    if(method == "n64.rsp.debug" || method == "n64.rsp.break" || method == "n64.rsp.step" || method == "n64.rsp.run" || method == "n64.rsp.stop") return rspDebugService.execute(method, args, owner, host.service.epoch, n64, execution, host.service.paused);
    if(method == "n64.rsp.registers") rspDebugService.observe(owner);
    if(method == "n64.cpu.setRegisters" || method == "n64.cpu.disassemble" || method == "n64.rsp.registers" || method == "n64.rdp.state" || method == "n64.peripheral.registers") {
      auto result = MachineService::execute(method, args, host.service.epoch, execution.frame, n64, bool(execution.active), host.service.paused);
      if(n64) execution.executor = N64Service::executor();
      return result;
    }
    if(method == "n64.memory.writeMany") return MemoryExperiment::execute(args, owner, host.service.epoch, n64, execution, host.service.paused);
    if(method.starts_with("n64.state.load")) {
      if(method == "n64.state.loadCommit" && host.stateLoader.upload && host.takeoverRequested.load()) {
        host.stateLoader.reset(); if(!host.injectedInput.takeover()) ++host.injectedInput.takeovers;
        ares::Nintendo64::cpu.debugControl.resume(); host.service.paused = false;
        return ControlResult{"state_load_cancelled", {}};
      }
      auto savedInput = host.injectedInput.pending; auto oldFrame = execution.frame;
      auto result = host.stateLoader.execute(method, args, owner, n64, bool(execution.active) && !(scriptService.running && scriptService.hostWaiting && (scriptService.hostKind=="state_load"||scriptService.hostKind=="input_prepare") && scriptService.owner==owner), host.service.paused, host.stateSnapshot);
      if(host.stateLoader.touched) {
        ++host.service.epoch; host.service.memoryTools.sync(host.service.epoch);
        host.demonstration.tick(host.service.epoch,0);
        host.injectedInput.releaseAll(); host.injectedInput.operationRunning = false;
        traceService.reset(); profilerService.reset(); rdpCaptureService.reset(); inspectionService.reset(); callService.reset(); viewerService.reset(); host.captures.reset(host.service.epoch);
        host.audioCapture.reset(); host.recording.rebase(owner,host.service.epoch); host.stateSnapshot.reset();
        ares::Nintendo64::executionCoordinate.reset();
        ares::Nintendo64::executionCoordinate.atBoundary = false; // restored VI phase is not an observed boundary
        ares::Nintendo64::dmaProvenance.reset(host.service.epoch);
        ares::Nintendo64::taskProvenance.reset(host.service.epoch);
        ares::Nintendo64::cpu.debugControl.power();
        execution.frame = 0; execution.atBoundary = false; execution.finished.clear();
        if(scriptService.running && scriptService.hostWaiting && (scriptService.hostKind=="state_load"||scriptService.hostKind=="input_prepare") && scriptService.owner==owner && execution.active) {
          if(scriptService.hooksChanged)scriptService.hooksChanged(false);
          for(auto& hook:scriptService.hooks)JS_FreeValue(scriptService.context,hook.callback);scriptService.hooks.clear();
          scriptService.epoch=host.service.epoch;execution.active->epoch=host.service.epoch;execution.active->start=0;
        }
        host.output.clear();
        bool keep = result.error.empty() && args[2] == "1";
        if(keep) for(unsigned port = 0; port < 4; ++port) if(savedInput[port].owner == owner) {
          auto neutral = savedInput[port]; neutral.buttons = 0; neutral.x = neutral.y = 0; neutral.epoch = host.service.epoch;
          if(neutral.expiresFrame != UINT64_MAX) neutral.expiresFrame = neutral.expiresFrame > oldFrame ? neutral.expiresFrame - oldFrame : 0;
          host.injectedInput.pending[port] = neutral;
        }
        host.injectedInput.epoch = host.service.epoch;
        host.injectedInput.service(host.service.epoch, 0, InputService::Clock::now(), true);
        host.service.paused = !result.error.empty() || args[1] != "1";
        if(result.error.empty()) {
          result.json.pop_back();
          result.json += ",\"version\":" + controlQuote(ares::Nintendo64::system.stateVersion().data()) + ",\"epoch\":" + std::to_string(host.service.epoch) + ",\"frame\":0,\"at_frame_boundary\":false,\"pc\":" + controlQuote(N64Service::hex(ares::Nintendo64::cpu.pipeline.pc))
            + ",\"stopped\":" + (host.service.paused ? "true" : "false") + ",\"paused\":" + (host.service.paused ? "true" : "false") + ",\"running\":" + (host.service.paused ? "false" : "true") + ",\"input\":" + host.injectedInput.state() + "}";
        }
      }
      if(result.error.empty()&&method=="n64.state.loadCommit")host.showPausedFramebuffer();
      return result;
    }
    if(method == "n64.state.begin" || method == "n64.state.read" || method == "n64.state.release") return host.stateSnapshot.execute(method, args, owner, host.service.epoch, execution.frame, n64, bool(execution.active) && !(scriptService.running && scriptService.hostWaiting && (scriptService.hostKind=="state_save"||scriptService.hostKind=="input_prepare") && scriptService.owner==owner), host.service.paused);
    if(method == "n64.state.format" || method == "n64.state.layout") {
      if(!args.empty()) return ControlResult{"invalid_request", {}};
      if(method == "n64.state.layout" && !n64) return ControlResult{"unavailable", {}};
      auto& system = ares::Nintendo64::system;
      auto json = std::string("{\"version\":") + controlQuote(system.stateVersion().data()) + ",\"signature\":" + std::to_string(ares::SerializerSignature) + ",\"header_size\":533";
      if(method == "n64.state.format") {
        json += ",\"slots\":[";
        if(emulator && emulator->game) for(unsigned slot = 1; slot <= 9; ++slot) {
          if(slot > 1) json += ',';
          // Match legacy slot names without locate()'s directory creation.
          auto location = emulator->game->location;
          string slotPath = settings.paths.saves ? string{settings.paths.saves, host.root->name(), "/", Location::prefix(location), ".bs", slot}
                                                : string{Location::notsuffix(location), ".bs", slot};
          json += controlQuote(slotPath.data());
        }
        json += ']';
      }
      if(method == "n64.state.layout") {
        auto [offset, size] = system.inspectStateRdramLayout();
        json += ",\"offset\":" + std::to_string(offset) + ",\"size\":" + std::to_string(size) + ",\"storage\":\"lsb32\"";
      }
      return ControlResult{{}, json + "}"};
    }
    if(method == "n64.input.tap") return tapService.execute(args, owner, host.service.epoch, host.service.paused, host.injectedInput, execution);
    // Keep the tapped port stable for its entire owned interval.
    if(tapService.active() && (method == "n64.input.set" || method == "n64.input.release") && !args.empty() &&
       (args[0] == "0" || args[0] == std::to_string(tapService.port))) return ControlResult{"busy", {}};
    if(method.starts_with("n64.profiler.")) return profilerService.execute(method, args, owner, bool(execution.active));
    if(method == "n64.dma.log") return dmaService.execute(args);
    if(method.starts_with("n64.trace.")) return traceService.execute(method, args, owner, host.service.epoch, host.service.paused, execution);
    if(method.starts_with("n64.input.")) return host.injectedInput.execute(method, args, owner, host.service.epoch, execution.frame, execution.active ? execution.active->owner : "");
    auto result = n64Service.execute(method, args, host.service.epoch, bool(execution.active) && !(scriptService.running&&scriptService.hostWaiting&&scriptService.hostKind=="input_prepare"&&scriptService.owner==owner&&method=="n64.memory.write"));
    if(n64) execution.executor = N64Service::executor();
    return result;
  };
  if(n64) {
    auto& debug = ares::Nintendo64::cpu.debugControl;
    host.service.onPause = [&] { host.stateLoader.reset(); rspDebugService.reset(); };
    host.service.onResume = [&](bool keepOverrides, const std::string& owner) {
      host.stateLoader.reset(); rspDebugService.reset();
      if(!keepOverrides) {
        if(owner == "ui") host.injectedInput.releaseAll();
        else host.injectedInput.releaseOwner(owner);
      }
      debug.resume(); execution.executor = N64Service::executor();
    };
    execution.onStart = [&] {
      host.injectedInput.start(host.service.epoch, execution.frame);
      debug.resume();
      if(execution.instructionCount) debug.requestStepInstructions(execution.instructionCount);
      execution.executor = N64Service::executor();
    };
    execution.onFinish = [&](const std::string& reason) { rspDebugService.finish(reason); rdpCaptureService.finish(reason); traceService.finish(reason); tapService.finish(reason, host.injectedInput, host.service.epoch, execution.frame); host.injectedInput.finish(host.service.epoch, execution.frame); debug.stepping = false; debug.stepRemaining = 0; debug.updateActive(); };
    execution.registerSnapshot = [&] { return N64Service::registers(debug.snapshot()); };
    execution.debugSnapshot = [&] { return debug.halted && execution.active && execution.active->slices ? N64Service::stop(host.service.epoch) : "{\"valid\":false}"; };
  }
  if(synthetic){execution.onStart=[&]{host.injectedInput.start(host.service.epoch,execution.frame);};execution.onFinish=[&](const std::string&){host.injectedInput.finish(host.service.epoch,execution.frame);};}
  execution.supported = synthetic || n64;
  execution.frameKind = synthetic ? "synthetic-vi" : n64 ? "vi" : "unavailable";
  execution.executor = synthetic ? "synthetic" : n64 ? (ares::Nintendo64::Accuracy::CPU::Recompiler && ares::Nintendo64::cpu.recompiler.enabled ? "recompiler" : "interpreter") : "unavailable";
  ares::Nintendo64::executionCoordinate.reset();
  // Yield even during ordinary N64 play so UI control stays serviceable if VI is
  // inactive. This is an outer CPU-loop budget, not an instruction-step count.
  if(n64) ares::Nintendo64::executionCoordinate.sliceBudget = 20000;
  scriptService.execution=&execution;scriptService.paused=&host.service.paused;
  scriptService.cancelled=[&] {
    if(host.quit || host.takeoverRequested.load())return true;
    std::lock_guard guard(host.service.lock);
    for(auto& line:host.service.requests) {
      std::istringstream in(line);std::string prefix,version,id,session,epoch,method,value,who="ui";
      in>>prefix>>version>>id>>session>>epoch>>method;
      while(in>>value)if(value.starts_with("owner="))who=value.substr(6);
      if(prefix=="control" && version=="1" && session==host.service.session && epoch==std::to_string(host.service.epoch) && (who==scriptService.owner||who=="ui") && (method=="execution.cancel"||method=="execution.release"||method=="session.pause"||method=="session.reset"))return true;
    }
    return false;
  };
  const std::string scriptConfiguration=BML::serialize(settings).data();
  auto scriptInfo=[&](const ScriptService& job){auto config=scriptConfiguration+host.service.runtimeRequest("runtime.settings",{}).json;auto configHash=nall::Hash::SHA256({reinterpret_cast<const uint8_t*>(config.data()),config.size()}).digest();auto sourceHash=nall::Hash::SHA256({reinterpret_cast<const uint8_t*>(job.source.data()),job.source.size()}).digest();return "{\"capture_generation\":"+std::to_string(ares::Nintendo64::commandCapture.transformGeneration)+",\"frame_reference\":"+host.service.memoryTools.frameReference(execution.frame,execution.atBoundary)+",\"epoch\":"+std::to_string(host.service.epoch)+",\"frame\":"+std::to_string(execution.frame)+",\"frame_kind\":"+controlQuote(execution.frameKind)+",\"executor\":"+controlQuote(execution.executor)+",\"rom_sha256\":"+controlQuote(host.contentHash.data())+",\"config_sha256\":"+controlQuote(configHash.data())+",\"source_sha256\":"+controlQuote(sourceHash.data())+",\"n64_memory\":"+(n64?"true":"false")+"}";};
  scriptService.info=[&]{return scriptInfo(scriptService);};
  scriptService.canAdvance=[&]{return host.demonstration.state!="armed";};
  scriptService.demonstration=[&](const std::string& method,const std::vector<std::string>& args){
    auto result=host.demonstration.execute(method,args,scriptService.owner,host.service.epoch,execution.frame,host.contentHash.data(),host.service.session);
    if(result.error.empty()&&method=="n64.demo.request"){std::lock_guard lock(runtime.inputMutex);host.armedInputJob=host.demonstration.id;host.inputStart.arm(host.demonstration.port==1);host.demonstration.inputStartReady=host.inputStart.neutral;}
    if(result.error.empty()&&method=="n64.demo.request")host.showPausedFramebuffer();
    return result;
  };
  scriptService.regionRead=[&](const std::string& name,uint32_t offset,uint32_t length,std::vector<uint8_t>& bytes)->ControlResult {
    MemoryService::Region* match=nullptr;
    for(auto& region:host.memory.regions)if(region.id==name||region.node->name()==name.c_str()){if(match)return {"ambiguous_region",{}};match=&region;}
    if(!match)return {"unknown_region",{}};
    if(!match->supported||!match->node->readable())return {"region_not_readable",{}};
    if(offset>match->node->size()||length>match->node->size()-offset)return {"out_of_bounds",{}};
    bytes.reserve(length);for(uint32_t i=0;i<length;++i)bytes.push_back(match->read(offset+i));return {{},"{}"};
  };
  scriptService.read=[&](uint64_t address,const std::string& view,size_t length,std::vector<uint8_t>& bytes)->ControlResult {
    if(!n64)return {"n64_memory_unavailable",{}};
    return N64Service::memory("n64.memory.read",{N64Service::hex(address),view,std::to_string(length)},false,false,65536,&bytes);
  };
  scriptService.write=[&](uint64_t address,const std::string& view,const std::vector<uint8_t>& bytes)->ControlResult {
    if(host.demonstration.state=="armed")return {"demonstration_armed",{}};
    if(!n64)return {"n64_memory_unavailable",{}};
    return N64Service::memory("n64.memory.write",{N64Service::hex(address),view,MemoryTools::hex(bytes,0,bytes.size())},false);
  };
  scriptService.input=[&](const std::vector<std::string>& values) {
    auto args=values;args.push_back("0");args.push_back("0");
    return host.injectedInput.execute("n64.input.set",args,scriptService.owner,host.service.epoch,execution.frame,scriptService.owner);
  };
  scriptService.normalizeHook=[&](uint64_t address,uint32_t& physical){nall::string error;return n64 && ares::Nintendo64::cpu.debugControl.normalizeAddress(address,4,physical,error);};
  scriptService.hooksChanged=[&](bool enabled){
    auto& debug=ares::Nintendo64::cpu.debugControl;
    if(enabled)debug.executeObserver=[&](uint64_t pc,uint32_t physical){if(std::none_of(scriptService.hooks.begin(),scriptService.hooks.end(),[&](const auto& hook){return hook.active&&hook.address==physical;}))return true;return scriptService.executeHook(physical,N64Service::registers(ares::Nintendo64::cpu.debugControl.snapshot()));};
    else {debug.executeObserver={};if(!scriptService.error.empty()&&debug.halted)debug.resume();}
    debug.updateActive();
  };
  scriptService.cleanup=[&] {if(host.demonstration.state=="armed"&&host.demonstration.owner==scriptService.owner&&scriptService.error.empty())host.demonstration.detached=true;if(host.demonstration.state=="replaying"&&host.demonstration.owner==scriptService.owner)host.demonstration.finish(host.demonstration.cursor==host.demonstration.events.size()&&execution.frame-host.demonstration.start>=host.demonstration.duration?"complete":"cancelled",execution.frame);host.injectedInput.releaseOwner(scriptService.owner);};
  auto configureObserver=[&](ScriptService& job){
    job.execution=&execution;job.paused=&host.service.paused;
    job.read=scriptService.read;job.regionRead=scriptService.regionRead;
    job.info=[&,ptr=&job]{return scriptInfo(*ptr);};
    job.cancelled=[&]{return host.quit.load();};
    job.onSample=[&](const ScriptService& sample){
      auto reference=host.service.memoryTools.frameReference(sample.publishedFrame,true);
      host.service.notify(sample.lastOperation,"{\"event\":\"observer_sample\",\"session\":"+controlQuote(host.service.session)+",\"epoch\":"+std::to_string(host.service.epoch)+",\"owner\":"+controlQuote(sample.owner)+",\"observer_id\":"+std::to_string(sample.lastOperation)+",\"sequence\":"+std::to_string(sample.publishedSequence)+",\"native_skipped\":"+std::to_string(sample.observerSkipped)+",\"frame_reference\":"+reference+",\"value\":"+(sample.result.empty()?"null":sample.result)+",\"error\":"+controlQuote(sample.error)+"}\n");
    };
  };
  host.service.scriptRequest=[&](const std::string& method,const std::vector<std::string>& args,const std::string& owner){
    if(method.starts_with("script.observer")) {
      const auto suffix=method.substr(15);
      if(suffix=="Prepare"){
        if(observerPreparations.count(owner))return ControlResult{"observer_preparation_busy",{}};
        for(auto it=observers.begin();it!=observers.end();)if(!it->second->running)it=observers.erase(it);else ++it;
        unsigned owned=0;for(auto& [id,job]:observers)if(job->owner==owner)++owned;
        if(observers.size()+observerPreparations.size()>=8||owned>=4)return ControlResult{"observer_limit",{}};
        auto job=std::make_unique<ScriptService>();configureObserver(*job);
        auto reply=job->execute("script.prepare",args,owner,host.service.epoch);
        if(reply.error.empty())observerPreparations.emplace(owner,std::move(job));
        return reply;
      }
      if(suffix=="Write"||suffix=="Start"){
        auto it=observerPreparations.find(owner);if(it==observerPreparations.end())return ControlResult{"stale_observer",{}};
        auto reply=it->second->execute(suffix=="Write"?"script.write":"script.observe",args,owner,host.service.epoch);
        if(suffix=="Start"){if(reply.error.empty())observers.emplace(it->second->lastOperation,std::move(it->second));observerPreparations.erase(it);}
        return reply;
      }
      uint64_t id=0;auto values=args;
      if((suffix=="Read"&&values.size()==3)||(suffix=="Stop"&&values.size()==1)){
        if(!ExecutionService::number(values.back(),id)||!id)return ControlResult{"invalid_request",{}};
        if(suffix=="Stop")values.clear();
      }else{
        for(auto& [key,job]:observers)if(job->owner==owner){if(id)return ControlResult{"ambiguous_observer",{}};id=key;}
      }
      auto it=observers.find(id);if(it==observers.end()||it->second->owner!=owner)return ControlResult{"stale_observer",{}};
      auto reply=it->second->execute(suffix=="Read"?"script.read":"script.stop",values,owner,host.service.epoch);
      if(suffix=="Stop"&&reply.error.empty())observers.erase(it);
      return reply;
    }
    return scriptService.execute(method,args,owner,host.service.epoch);
  };
  uint64_t observerBudgetFrame=UINT64_MAX,observerBudgetEpoch=0;
  Clock::duration observerSpent{};
  auto pumpObservers=[&](bool origin){
    if(observers.empty())return;
    const auto frame=execution.frame;
    if(observerBudgetFrame!=frame||observerBudgetEpoch!=host.service.epoch){observerBudgetFrame=frame;observerBudgetEpoch=host.service.epoch;observerSpent={};}
    const auto started=Clock::now();std::vector<uint64_t> order;
    for(auto& [id,job]:observers)order.push_back(id);
    const auto first=observerRotation++%order.size();samplingOrigin=origin;
    for(size_t n=0;n<order.size();++n){
      auto& job=*observers.at(order[(first+n)%order.size()]);
      if(job.running&&job.epoch!=host.service.epoch)job.finish("reset");
      if(observerSpent+Clock::now()-started>=std::chrono::milliseconds(6))break;
      job.pump(origin);
    }
    samplingOrigin=false;observerSpent+=Clock::now()-started;
  };
  if(n64)ares::Nintendo64::executionCoordinate.originObserver=[&]{pumpObservers(true);};
  uint64_t previewEpoch = 0;
  auto previewDeadline = Clock::now();
  while(!host.quit) {
    if(n64) {
      execution.frame = ares::Nintendo64::executionCoordinate.frame;
      execution.atBoundary = ares::Nintendo64::executionCoordinate.atBoundary;
      execution.supported = !nall::GDB::server.hasClient();
      execution.instructions = ares::Nintendo64::cpu.debugControl.instructionsRetired;
      execution.executor = N64Service::executor();
    }
    host.demonstration.tick(host.service.epoch,execution.frame);
    if(n64||synthetic) host.injectedInput.service(host.service.epoch, execution.frame);
    rspDebugService.service(execution, host.service.paused);
    bool wasControlled = bool(execution.active);
    if(!host.service.dispatch(synthetic ? "Synthetic" : std::string(host.systemName.data()), synthetic, [&] {
      host.injectedInput.releaseAll(); traceService.reset(); profilerService.reset();
      host.captures.reset(host.service.epoch + 1);
      host.audioCapture.reset();
      host.recording.reset();
      host.stateSnapshot.reset();
      host.stateLoader.reset(); rspDebugService.reset(); rdpCaptureService.reset(); inspectionService.reset(); callService.reset(); viewerService.reset();
      ares::Nintendo64::executionCoordinate.reset(); syntheticPhase = 0;
      ares::Nintendo64::dmaProvenance.reset(host.service.epoch + 1);
      ares::Nintendo64::taskProvenance.reset(host.service.epoch+1);
      if(host.root) { host.output.clear(); host.root->power(); }
    }, host.memory)) { host.quit = true; break; }
    bool inputStarted=false;
    {std::lock_guard lock(runtime.inputMutex);
      if(host.demonstration.state=="armed") {
        if(host.armedInputJob!=host.demonstration.id){host.armedInputJob=host.demonstration.id;host.inputStart.arm(host.demonstration.port==1);}
        host.demonstration.inputStartReady=host.inputStart.neutral;
        if(host.inputStart.triggered&&!execution.active&&!execution.reservation){auto started=host.demonstration.execute("n64.demo.start",{},host.demonstration.owner,host.service.epoch,execution.frame,host.demonstration.rom,host.demonstration.session);inputStarted=started.error.empty();if(inputStarted)host.demonstration.startedBy="controller_input";}
      }else if(host.demonstration.state!="recording"){
        if(host.inputStart.holding&&host.joypad){auto latest=host.inputStart.latest;for(unsigned i=0;i<4;++i)host.joypad->axes().input(i).setValue(latest.axes[i]);for(unsigned i=0;i<32;++i)host.joypad->buttons().input(i).setValue((latest.mask>>i)&1);}
        host.inputStart.cancel();
      }
      if(host.inputStart.overflow&&host.demonstration.state=="recording")host.demonstration.finish("input_transition_overflow",execution.frame);
    }
    bool takeover = host.takeoverRequested.exchange(false) && !inputStarted && host.demonstration.state!="armed";
    if(takeover&&host.demonstration.state=="replaying")host.demonstration.finish("host_input",execution.frame);
    bool rspTakeover = takeover && n64 && rspDebugService.active();
    bool batchTakeover = takeover && n64 && execution.reservation.has_value();
    if(batchTakeover) execution.reservation.reset();
    bool loadTakeover = takeover && n64 && host.stateLoader.upload.has_value();
    if(loadTakeover) host.stateLoader.reset();
    bool inputTakeover = takeover && n64 && host.injectedInput.takeover();
    if((loadTakeover || batchTakeover || rspTakeover) && !inputTakeover) ++host.injectedInput.takeovers;
    if(loadTakeover || inputTakeover || batchTakeover || rspTakeover) {
      execution.complete("host_input", host.service.paused);
      rspDebugService.reset();
      ares::Nintendo64::cpu.debugControl.resume();
      host.service.paused = false;
    }
    if(!wasControlled && execution.active && host.sound) host.output.clear();
    scriptService.pump();
    pumpObservers(false);
    if(host.service.previewReset) {
      if(previewEpoch != host.service.epoch) { previewEpoch = host.service.epoch; previewDeadline = Clock::now() + std::chrono::seconds(2); }
      if(!host.service.paused || execution.active || Clock::now() >= previewDeadline) host.service.previewReset = false;
    }
    if(host.service.paused && (!execution.active || scriptService.running) && !host.service.previewReset) {
      if(host.sound && !synthetic) host.output.clear();
      host.service.waitForRequest(std::chrono::milliseconds(10));
      deadline = Clock::now(); continue;
    }
    bool controlled = bool(execution.active);
    auto frameBefore = execution.frame;
    if(synthetic) {
      // Two deterministic slices per synthetic VI: the first ends mid-frame.
      execution.atBoundary = (++syntheticPhase == 2);
      if(!execution.atBoundary) { if(execution.active) ++execution.active->slices; continue; }
      syntheticPhase = 0;
      for(unsigned p=1;p<=4;++p){auto& input=host.injectedInput.latched[p-1];uint32_t raw=0;static const unsigned bits[]={31,30,29,28,27,26,25,24,19,18,17,16,21,20};for(unsigned i=0;i<14;++i)if(input.buttons&(1u<<i))raw|=1u<<bits[i];raw|=uint32_t(uint8_t(input.x/386))<<8|uint8_t(input.y/386);host.demonstration.latch(p,raw,host.service.epoch,execution.frame);}
      ++execution.frame;
      host.appliedInput = host.controls.load() >> 32;
      for(unsigned y = 0; y < height; y++) for(unsigned x = 0; x < width; x++) {
        pixels[y * (width + 8) + x] = 0xff000000u | ((x + tick) % 256 << 16) | ((y + tick) % 256 << 8) | (tick % 256);
      }
      host.video({}, pixels.data(), (width + 8) * 4, width, height); ++tick;
    } else { host.root->run(); profilerService.afterRun(); if(n64) ares::Nintendo64::commandCapture.afterRun(); }
    if(execution.active) ++execution.active->slices;
    if(n64) {
      execution.frame = ares::Nintendo64::executionCoordinate.frame;
      execution.atBoundary = ares::Nintendo64::executionCoordinate.atBoundary;
    }
    // Screen presentation can be asynchronous. Stop at the emulated frame,
    // rather than running ahead until its video callback catches up.
    if(host.service.previewReset && (!n64 || execution.frame != frameBefore)) {
      host.service.previewReset = false;
      if(host.sound) host.output.clear();
    }
    if(execution.atBoundary && execution.frame != frameBefore && host.recording.exact) {
      if(synthetic){auto& image=host.captures.presented;if(image.packet)host.recording.capture(image.data(),image.width,image.height,host.service.epoch,execution.frame,execution.frameKind,true);}
      else if(n64){std::shared_ptr<const FrameService::Image> image;auto result=FrameService::framebuffer(image,host.service.epoch,execution.frame);if(result.error.empty())host.recording.capture(image->data(),image->width,image->height,host.service.epoch,execution.frame,execution.frameKind,true);else {std::lock_guard lock(host.recording.mutex);host.recording.finish("capture_unavailable");}}
    }
    if(execution.atBoundary && execution.frame != frameBefore) host.service.memoryTools.boundary(host.service.epoch, execution.frame);
    if(n64) {
      auto& debug = ares::Nintendo64::cpu.debugControl;
      execution.instructions = debug.instructionsRetired;
      execution.executor = N64Service::executor();
      callService.service(execution, host.service.paused);
      if(rspDebugService.active() && ares::Nintendo64::rsp.debugControl.stopped) { execution.complete(ares::Nintendo64::rsp.debugControl.reason, host.service.paused); host.service.paused = true; }
      if(debug.halted) { execution.complete(scriptService.running && !scriptService.error.empty() ? "script_failed" : N64Service::reason(debug.stop.reason), host.service.paused); host.service.paused = true; }
    }
    execution.service(host.service.paused);
    // Freeze ordinary-play VI observers before the next control dispatch can
    // pause or mutate this boundary. This also leaves a matching final sample
    // when the user pauses; the loop-head pump remains for origin/idle handling.
    if(execution.atBoundary && execution.frame != frameBefore) pumpObservers(false);
    if(controlled || host.fastForward.load()) { deadline = Clock::now(); continue; }
    if((synthetic || !host.sound) && (!n64 || execution.frame != frameBefore || ares::Nintendo64::executionCoordinate.livenessYield)) {
      deadline += std::chrono::nanoseconds(synthetic ? 16666667 : int64_t(1e9 / host.refreshRate.load()));
      std::this_thread::sleep_until(deadline);
      if(Clock::now() - deadline > std::chrono::milliseconds(100)) deadline = Clock::now();
    }
  }
  for(auto& [id,job]:observers)job->finish("shutdown");
  scriptService.finish("shutdown");
  execution.complete("shutdown", host.service.paused);
  host.quit = true; host.wake.notify_all();
  host.service.close();
  writer.join(); reader.join();
  if(replies.joinable()) replies.join();
  if(host.root) {
    emulator->unload(); host.streams.clear(); host.root.reset(); emulator.reset();
  }
  ares::Nintendo64::executionCoordinate.originObserver = {};
  ares::Video::frameSubmittedObserver = {};
  std::cerr << "stopped\n";
  ares::platform = nullptr;
}
