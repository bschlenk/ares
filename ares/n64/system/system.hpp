struct System {
  Node::System node;
  VFS::Pak pak;
  bool homebrewMode = false;
  bool deterministicEntropy = false;
  bool expansionPak = true;
  u8 configuredControllerPakBankCount = 1;
  u8 controllerPakBankCount = 1;

  enum class Model : u32 { Nintendo64, Aleck64 };
  enum class Region : u32 { NTSC, PAL };

  auto name() const -> string { return information.name; }
  auto model() const -> Model { return information.model; }
  auto region() const -> Region { return information.region; }
  auto _DD() const -> bool { return information.dd; }
  auto frequency() const -> u32 { return information.frequency; }
  auto videoFrequency() const -> u32 { return information.videoFrequency; }

  //system.cpp
  auto game() -> string;
  auto run() -> void;
  auto prepareVideo() -> void;
  auto load(Node::System& node, string name) -> bool;
  auto unload() -> void;
  auto save() -> void;
  auto power(bool reset) -> void;

  //serialization.cpp
  auto stateVersion() const -> string;
  //v153 states saved before the arcade DIP switch refactor end with two
  //retired Aleck64 dipSwitch bytes; loaders accept that legacy trailer.
  static constexpr u32 LegacyStateTrailerSize = 2;
  auto inspectStateRdramLayout() -> std::pair<u64, u64>;
  auto serialize(bool synchronize = true) -> serializer;
  auto unserialize(serializer&) -> bool;

private:
  struct Information {
    string name = "Nintendo 64";
    Model model = Model::Nintendo64;
    Region region = Region::NTSC;
    u32 frequency = 93'750'000 * 2;
    u32 videoFrequency = 48'681'818;
    bool dd = false;
  } information;
  
  atomic<bool> _vulkanNeedsLoad = false;

  auto initDebugHooks() -> void;
  auto _power(bool reset) -> void;

  //serialization.cpp
  auto serializeHeader(serializer&, bool synchronize) -> void;
  auto serializePrefix(serializer&) -> void;
  auto serialize(serializer&, bool synchronize) -> void;
};

extern System system;
extern Random random;

auto Model::Nintendo64() -> bool { return system.model() == System::Model::Nintendo64; }
auto Model::Aleck64() -> bool { return system.model() == System::Model::Aleck64; }
auto Region::NTSC() -> bool { return system.region() == System::Region::NTSC; }
auto Region::PAL() -> bool { return system.region() == System::Region::PAL; }
auto _DD() -> bool { return system._DD(); }
