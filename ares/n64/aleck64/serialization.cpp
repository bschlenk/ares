auto Aleck64::serialize(serializer& s) -> void {
  s(sdram);
  s(vram);
  s(pram);

  s(vdp.io.enable);

  //Aleck64 is serialized last: skip the dipSwitch bytes of legacy v153 states.
  if(s.reading() && s.capacity() - s.size() == System::LegacyStateTrailerSize) {
    n8 dipSwitch[System::LegacyStateTrailerSize];
    s(dipSwitch);
  }
}
