#include <ruby/ruby.hpp>

#if defined(PLATFORM_WINDOWS)
  #include <nall/windows/windows.hpp>
  #include <mmsystem.h>
#endif

using namespace nall;
using namespace ruby;

#include <ruby/audio/audio.cpp>
