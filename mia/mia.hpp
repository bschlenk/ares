#include <array>
#include <span>

#include <nall/nall.hpp>
#include <nall/cd.hpp>
#include <nall/ips.hpp>
#include <nall/span-helpers.hpp>
#include <nall/vfs.hpp>
#include <nall/beat/single/apply.hpp>
#include <nall/decode/cue.hpp>
#include <nall/string/markup/json.hpp>
#if defined(ARES_ENABLE_CHD)
#include <nall/decode/chd.hpp>
#endif
#include <nall/decode/wav.hpp>
#include <nall/decode/mmi.hpp>
#include <nall/encode/wav.hpp>
using namespace nall;

#include <ares/ares.hpp>
#include <ares/resource/resource.hpp>
#include <mia/resource/resource.hpp>

enum ResultEnum {
  successful,
  noFileSelected,
  databaseNotFound,
  romNotFoundInDatabase,
  romNotFound,
  invalidROM,
  unsupportedMedia,
  wrongMediaType,
  couldNotParseManifest,
  noFirmware,
  otherError
};

struct LoadResult {
  ResultEnum result;

  string info;
  string mediaType;
  string firmwareType;
  string firmwareSystemName;
  string firmwareRegion;

  LoadResult(ResultEnum r) : result(r) {}

  LoadResult(ResultEnum r, string i) : result(r), info(i) {}

  bool operator==(const LoadResult& other) {
    return result == other.result;
  }
  bool operator!=(const LoadResult& other) {
    return result != other.result;
  }
};

namespace mia {
  #include "settings/settings.hpp"
  #include "pak/pak.hpp"
  #include "system/system.hpp"
  #include "medium/medium.hpp"

  extern std::function<string ()> homeLocation;
  extern std::function<string ()> saveLocation;
  auto setHomeLocation(std::function<string ()>) -> void;
  auto setSaveLocation(std::function<string ()>) -> void;
  auto setResourceResolver(std::function<string (const string&)>) -> void;
  // Optional frontend persistence policy. Without hooks, retain upstream behavior.
  struct StorageHooks {
    bool preparing = false;
    std::function<std::vector<u8> (const string&)> read;
    std::function<bool (const string&, std::span<const u8>)> write;
    std::function<void (bool)> transaction;
  };
  extern StorageHooks storageHooks;
  auto readPersistent(const string&) -> std::vector<u8>;
  auto writePersistent(const string&, std::span<const u8>) -> bool;
  struct StorageTransaction {
    StorageTransaction() { if(storageHooks.transaction) storageHooks.transaction(true); }
    ~StorageTransaction() { if(storageHooks.transaction) storageHooks.transaction(false); }
  };
  auto construct() -> void;
  auto identify(const string& filename) -> std::vector<string>;
  auto import(std::shared_ptr<Pak>, const string& filename) -> bool;

}
