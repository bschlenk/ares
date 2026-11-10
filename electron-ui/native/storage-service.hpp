#pragma once
#include <filesystem>
#include <map>
#include <stdexcept>

// Electron policy only. MIA/desktop loaders retain their original path calculations.
struct StorageService {
  struct Resource { std::string source, destination, identity; };
  std::map<std::string, Resource> resources;
  bool preparing = false, personal = false;
  int barrier = -1, depth = 0;

  static std::string key(const string& value) {
    return std::filesystem::absolute(value.data()).lexically_normal().string();
  }
  static std::string quote(const std::string& value) {
    std::string out = "\"";
    for(unsigned char c : value) {
      if(c == '"' || c == '\\') { out += '\\'; out += c; }
      else if(c < 32) { char escaped[7]; snprintf(escaped,sizeof(escaped),"\\u%04x",c); out += escaped; }
      else out += c;
    }
    return out + "\"";
  }
  void install(bool prepare) {
    preparing = prepare;
    mia::storageHooks.preparing = prepare;
    mia::storageHooks.read = [this](const string& path) { return read(path); };
    mia::storageHooks.write = [this](const string& path, std::span<const u8> bytes) { return write(path,bytes); };
    mia::storageHooks.transaction = [this](bool begin) {
#ifndef _WIN32
      if(preparing) return;
      if(begin) { if(depth++ == 0 && flock(barrier, LOCK_EX)) fail("storage_barrier_failed"); }
      else if(--depth == 0 && flock(barrier, LOCK_UN)) std::terminate();
#endif
    };
  }
  [[noreturn]] static void fail(const char* error) { throw std::runtime_error(error); }
  void configure(const std::string& filename) {
#ifndef _WIN32
    auto json = JSON::unserialize(string::read(filename.c_str()));
    if(json["version"].natural() != 1) fail("invalid_storage_transaction");
    personal = json["personal"].boolean();
    barrier = json["barrier"].natural();
    struct stat st;
    if(barrier < 4 || fstat(barrier,&st) || !S_ISREG(st.st_mode)) fail("invalid_storage_barrier");
    for(auto row : json["resources"]) {
      Resource resource{row["source"].string().data(), row["destination"].string().data(), row["identity"].string().data()};
      if(resource.source.empty() || resource.destination.empty() || resource.destination[0] != '/') fail("invalid_storage_resource");
      resources.emplace(key(resource.source.c_str()),std::move(resource));
    }
    install(false);
#else
    fail("storage_transactions_unsupported_platform");
#endif
  }
  auto resource(const string& path) -> Resource& {
    auto identity = key(path);
    if(preparing) { resources.emplace(identity, Resource{identity,identity,{}}); return resources.at(identity); }
    auto found = resources.find(identity);
    if(found == resources.end()) fail("storage_unprepared_resource");
    if(personal) {
      std::error_code error;
      auto resolved = std::filesystem::weakly_canonical(identity,error).string();
      if(error || resolved != found->second.destination) fail("storage_path_changed");
    }
    return found->second;
  }
#ifndef _WIN32
  // Walk from the root with directory descriptors; never follow a changed symlink
  // or reopen a pathname after validation. Missing private parents are created here.
  static int openFile(const std::string& pathname, bool writing, bool absent = false) {
    auto path = std::filesystem::path(pathname).lexically_normal();
    if(!path.is_absolute()) fail("storage_absolute_path_required");
    int directory = open("/",O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if(directory < 0) fail("storage_open_failed");
    auto parent = path.parent_path();
    for(auto component : parent.relative_path()) {
      if(writing && mkdirat(directory,component.c_str(),0700) && errno != EEXIST) { close(directory); fail("storage_directory_failed"); }
      int next = openat(directory,component.c_str(),O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      close(directory); directory = next;
      if(directory < 0) { if(!writing && errno == ENOENT) return -1; fail("storage_path_changed"); }
    }
    int fd = openat(directory,path.filename().c_str(),O_NOFOLLOW | O_CLOEXEC | (writing ? O_RDWR | (absent ? O_CREAT | O_EXCL : 0) : O_RDONLY),0600);
    int error = errno; close(directory);
    if(fd < 0) { if(!writing && error == ENOENT) return -1; fail("storage_open_failed"); }
    struct stat st;
    if(fstat(fd,&st) || !S_ISREG(st.st_mode)) { close(fd); fail("storage_not_regular_file"); }
    return fd;
  }
#endif
  static void validate(int fd, Resource& resource, bool creating = false) {
#ifndef _WIN32
    struct stat st;
    if(fstat(fd,&st)) fail("storage_stat_failed");
    auto identity = std::to_string(st.st_dev) + ":" + std::to_string(st.st_ino);
    if(resource.identity.empty() && creating) resource.identity = identity;
    else if(identity != resource.identity) { close(fd); fail("storage_file_changed"); }
#endif
  }
  auto read(const string& path) -> std::vector<u8> {
    auto& entry = resource(path);
    auto& resolved = entry.destination;
    if(preparing) return {};
#ifndef _WIN32
    int fd = openFile(resolved,false);
    if(fd < 0) return {};
    validate(fd,entry);
    struct stat st;
    if(fstat(fd,&st) || st.st_size < 0 || uint64_t(st.st_size) > 512ull*1024*1024) { close(fd); fail("storage_read_size"); }
    std::vector<u8> bytes(st.st_size);
    size_t offset = 0;
    while(offset < bytes.size()) { auto count = ::read(fd,bytes.data()+offset,bytes.size()-offset); if(count <= 0) { close(fd); fail("storage_read_failed"); } offset += count; }
    close(fd); return bytes;
#else
    fail("storage_transactions_unsupported_platform");
#endif
  }
  auto write(const string& path, std::span<const u8> bytes) -> bool {
    auto& entry = resource(path);
    auto& resolved = entry.destination;
    if(preparing) return true;
#ifndef _WIN32
    // Every direct helper is protected, and outer loader save/unload guards hold
    // this same barrier for the complete group (including nested peripheral saves).
    mia::StorageTransaction transaction;
    if(entry.identity.empty()) for(auto& [source, other] : resources) if(other.destination == resolved && !other.identity.empty()) entry.identity = other.identity;
    int fd = openFile(resolved,true,entry.identity.empty());
    validate(fd,entry,true);
    if(ftruncate(fd,bytes.size())) { close(fd); fail("storage_write_failed"); }
    size_t offset = 0;
    while(offset < bytes.size()) { auto count = pwrite(fd,bytes.data()+offset,bytes.size()-offset,offset); if(count <= 0) { close(fd); fail("storage_write_failed"); } offset += count; }
    int result = fsync(fd); close(fd);
    if(result) fail("storage_flush_failed");
    return true;
#else
    fail("storage_transactions_unsupported_platform");
#endif
  }
  auto inventory() -> std::string {
    std::string output = "{\"version\":1,\"resources\":[";
    bool first = true;
    for(auto& [identity, resource] : resources) {
      if(!first) output += ','; first = false;
      output += "{\"source\":" + quote(identity) + ",\"scope\":\"file\"}";
    }
    return output + "]}";
  }
};
