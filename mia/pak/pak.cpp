auto Pak::create(string name) -> std::shared_ptr<Pak> {
  auto pak = std::make_shared<Pak>();
  pak->pak = std::make_shared<vfs::directory>();
  pak->pak->setAttribute("name", name);
  pak->pak->setAttribute("type", "Pak");
  return pak;
}

auto Pak::name(string location) const -> string {
  return Location::prefix(location);
}

auto Pak::read(string location) -> std::vector<u8> {
  //attempt to match known extensions
  auto extensions = this->extensions();
  for(auto& extension : extensions) extension.prepend("*.");
  auto memory = read(location, extensions);

  //failing that, read whatever exists
  if(memory.empty()) memory = read(location, {"*"});

  return memory;
}

auto Pak::read(string location, std::vector<string> match) -> std::vector<u8> {
  std::vector<u8> memory;
  std::vector<u8> ips_patch;
  std::vector<u8> bps_patch;

  if(file::exists(location)) {
    //support IPS or BPS patches next to the file
    bps_patch = file::read({Location::notsuffix(location), ".bps"});
    if (bps_patch.empty()) {
      ips_patch = file::read({Location::notsuffix(location), ".ips"});
    }

    if(location.iendsWith(".zip")) {
      Decode::ZIP archive;
      if(archive.open(location)) {
        for(auto& file : archive.file) {
          for(auto& pattern : match) {
            if(file.name.imatch(pattern)) {
              memory = archive.extract(file);
              break;
            }
          }
          if(!memory.empty()) break;
        }
        if(!memory.empty()) {
          //support BPS patches inside the ZIP archive
          for(auto& file : archive.file) {
            if(file.name.imatch("*.bps")) {
              bps_patch = archive.extract(file);
              break;
            } else if (file.name.imatch("*.ips")) {
              ips_patch = archive.extract(file);
              break;
            }
          }
        }
      }
    } else {
      for(auto& pattern : match) {
        if(location.imatch(pattern)) {
          memory = file::read(location);
          break;
        }
      }
    }
  }

  //attempt to apply IPS or BPS patch if one was found, favoring BPS
  if(!bps_patch.empty()) {
    if(auto output = Beat::Single::apply(memory, bps_patch)) {
      memory.clear();
      memory.resize(output->size());
      if(output->size()) memcpy(memory.data(), output->data(), output->size());
    }
  } else if (!ips_patch.empty()) {
    if (auto output = IPS::apply(memory, ips_patch)) {
      memory.clear();
      memory.resize(output->size());
      if(output->size()) memcpy(memory.data(), output->data(), output->size());
    }
  }

  return memory;
}

auto Pak::append(std::vector<u8>& output, string filename) -> bool {
  if(!file::exists(filename)) return false;
  auto input = file::read(filename);
  auto size = output.size();
  output.resize(size + input.size());
  if(!input.empty()) memcpy(output.data() + size, input.data(), input.size());
  return true;
}

auto Pak::load(string name, string extension, string location) -> bool {
  if(!pak) return false;
  if(!location) location = this->location;
  if(auto load = pak->write(name)) {
    auto memory = readPersistent(saveLocation(location, name, extension));
    if(!memory.empty()) {
      if(!load->size()) load->resize(memory.size());
      load->write({memory.data(), memory.size()});
      load->setAttribute("loaded", true);
      return true;
    }
  }
  return false;
}

auto Pak::save(string name, string extension, string location) -> bool {
  if(!pak) return false;
  if(!location) location = this->location;
  if(auto save = pak->read(name)) {
    return writePersistent(saveLocation(location, name, extension), {save->data(), save->size()});
  }
  return true;
}

auto Pak::load(Markup::Node node, string extension, string location) -> bool {
  string name;
  if(auto architecture = node["architecture"].string()) name.append(architecture, ".");
  name.append(node["content"].string(), ".");
  name.append(node["type"].string());
  name.downcase();
  auto size = node["size"].natural();
  pak->append(name, size);
  if(auto fp = pak->write(name)) {
    //pak->append() will allocate memory using 0x00 bytes.
    //but it's more compatible to initialize RAM to 0xff bytes.
    memory::fill<u8>(fp->data(), fp->size(), 0xff);
  }
  return load(name, extension, location);
}

auto Pak::save(Markup::Node node, string extension, string location) -> bool {
  string name;
  if(auto architecture = node["architecture"].string()) name.append(architecture, ".");
  name.append(node["content"].string(), ".");
  name.append(node["type"].string());
  name.downcase();
  auto size = node["size"].natural();
  return save(name, extension, location);
}

auto Pak::saveLocation(string location, string name, string extension) -> string {
  string saveLocation;
  if(auto path = mia::saveLocation()) {
    //if the user has chosen a specific location to save files to ...
    saveLocation = {path, this->saveName(), "/", Location::prefix(location), extension};
  } else if(directory::exists(location)) {
    //if this is a pak ...
    saveLocation = {location, name};
  } else if(file::exists(location)) {
    //if this is a ROM ...
    saveLocation = {Location::notsuffix(location), extension};
  } else {
    //if no path information is available ...
    saveLocation = {mia::homeLocation(), "Saves/", this->name(), ".", extension, "/", name};
  }
  //try to ensure the directory exists ...
  if(!storageHooks.read && !storageHooks.write) directory::create(Location::path(saveLocation));
  return saveLocation;
}

// Read/write PCM in memory: no codec may reopen an unlocked persistence path.
auto Pak::loadPersistentWave(const string& location, bool initialize) -> bool {
  auto bytes = readPersistent(location);
  if(bytes.empty() && !initialize) return false;
  u32 frequency = 44100, bits = 16, channels = 1;
  size_t start = 0, length = 0;
  auto little = [&](size_t offset, size_t size) -> u64 {
    if(offset + size > bytes.size()) throw std::runtime_error("invalid_persistent_wave");
    u64 value = 0; for(size_t n = 0; n < size; ++n) value |= u64(bytes[offset+n]) << (n*8); return value;
  };
  if(!bytes.empty()) {
    if(bytes.size() < 44 || memcmp(bytes.data(), "RIFF", 4) || memcmp(bytes.data()+8, "WAVE", 4)) throw std::runtime_error("invalid_persistent_wave");
    bool format = false;
    for(size_t offset = 12; offset + 8 <= bytes.size();) {
      size_t size = little(offset+4,4), payload = offset+8;
      if(size > bytes.size()-payload) throw std::runtime_error("invalid_persistent_wave");
      if(!memcmp(bytes.data()+offset,"fmt ",4)) {
        if(size < 16 || little(payload,2) != 1) throw std::runtime_error("invalid_persistent_wave");
        channels = little(payload+2,2); frequency = little(payload+4,4); bits = little(payload+14,2); format = true;
      }
      if(!memcmp(bytes.data()+offset,"data",4)) { start = payload; length = size; }
      offset = payload + size + (size & 1);
    }
    if(!format || !frequency || !channels || channels > 2 || !bits || bits > 32 || bits % 8 || !start) throw std::runtime_error("invalid_persistent_wave");
  }
  const size_t stride = bits/8 * channels;
  std::vector<u8> output;
  for(size_t offset = start; offset < start + length; offset += stride) {
    if(offset + stride > start + length) throw std::runtime_error("invalid_persistent_wave");
    auto sample = little(offset,bits/8);
    if(bits > 8) sample ^= u64(1) << (bits-1);
    sample = sample * 65535 / ((u64(1) << bits)-1);
    for(unsigned n = 0; n < 8; ++n) output.push_back(sample >> (n*8));
  }
  if(!pak) pak = std::make_shared<vfs::directory>();
  if(auto previous = pak->read("program.tape")) pak->remove(previous);
  pak->append("program.tape",output);
  pak->setAttribute("range",65535);
  pak->setAttribute("frequency",frequency);
  pak->setAttribute("length",output.size()/8);
  pak->setAttribute("tape",true);
  pak->setAttribute("writable",true);
  pak->setAttribute("modified",false);
  return true;
}

auto Pak::savePersistentWave(const string& location) -> bool {
  if(storageHooks.preparing) return writePersistent(location,{});
  auto input = pak->read("program.tape");
  if(!input) return false;
  auto frequency = pak->attribute("frequency").natural();
  auto range = pak->attribute("range").natural();
  if(!frequency || !range || input->size()/8 > (0xffffffffull-36)/2) return false;
  std::vector<u8> bytes;
  auto text = [&](const char* value) { for(size_t n=0;n<4;++n) bytes.push_back(value[n]); };
  auto little = [&](u64 value, unsigned size) { for(unsigned n=0;n<size;++n) bytes.push_back(value >> (n*8)); };
  auto size = input->size()/8*2;
  text("RIFF"); little(36+size,4); text("WAVE"); text("fmt "); little(16,4); little(1,2); little(1,2);
  little(frequency,4); little(frequency*2,4); little(2,2); little(16,2); text("data"); little(size,4);
  input->seek(0);
  for(size_t n=0;n<size/2;++n) { auto sample=input->readl(8); little((sample*65535/range)^0x8000,2); }
  return writePersistent(location,bytes);
}
