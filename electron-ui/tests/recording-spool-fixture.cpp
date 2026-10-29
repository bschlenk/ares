#include <cassert>
#include <iostream>
#include <thread>
#include <sys/resource.h>
#include <csignal>
#include <string>
std::string controlQuote(const std::string& value){return "\""+value+"\"";}
#include "../native/recording-service.hpp"
int main(){
 RecordingService r;
 auto start=[&](uint64_t bytes=1073741824){return r.execute("video.record.scriptStart",{"3600",std::to_string(bytes),"60","60000","1"},"test",1,0,"vi");};
 assert(r.execute("video.record.start",{"3600","1073741824","60","60000","1","framebuffer"},"test",1,0,"vi").error.empty());assert(r.exact);std::vector<uint8_t> initial(16);r.capture(initial.data(),2,2,1,1,"vi",true);r.rebase("test",2);r.capture(initial.data(),2,2,2,1,"vi",true);assert(r.frames.count==2&&r.segments.size()==2);r.reset();
 assert(r.execute("video.record.scriptStart",{"3600","1073741824","60","60000","1","presented"},"test",1,0,"vi").error.empty());assert(!r.exact);r.rebase("test",2);assert(r.available&&r.epoch==2);r.reset();
 assert(start().error.empty());
 std::vector<uint8_t> rgba(320*237*4);
 for(unsigned f=1;f<=1800;++f){
  std::fill(rgba.begin(),rgba.end(),uint8_t(f));r.capture(rgba.data(),320,237,1,f,"vi",true);
  assert(r.active);std::this_thread::sleep_for(std::chrono::milliseconds(1));
 }
 auto ready=r.execute("video.record.begin",{},"test",1,1800,"vi");assert(ready.error.empty());assert(r.frames.count==1800);assert(r.frames.frameBytes==227520);
 for(unsigned f=0;f<1800;++f){std::vector<uint8_t> bytes(3);assert(r.frames.read(uint64_t(f)*227520,bytes));assert(bytes[0]==uint8_t(f+1));}
 struct rusage usage;getrusage(RUSAGE_SELF,&usage);
 std::cout<<"RECORDING_SPOOL_PASS frames="<<r.frames.count<<" bytes="<<r.frames.count*r.frames.frameBytes<<" maxrss="<<usage.ru_maxrss<<"\n";
 assert(r.execute("video.record.release",{std::to_string(r.pin),"1"},"test",1,1800).error.empty());assert(r.segments.empty());
 assert(start(1048576).error.empty());for(unsigned f=1;f<=5;++f)r.capture(rgba.data(),320,237,1,f,"vi",true);
 assert(!r.active&&r.reason=="bytes_limit"&&r.frames.count==4);assert(r.execute("video.record.begin",{},"test",1,5).error.empty());
 r.reset();assert(!r.frames.file);
 assert(start().error.empty());r.capture(rgba.data(),320,237,1,1,"vi",true);r.rebase("test",2);r.capture(rgba.data(),300,237,2,1,"vi",true);assert(r.reason=="dimensions_changed");
 r.reset();assert(start().error.empty());r.capture(rgba.data(),320,237,1,1,"vi",true);r.rebase("test",2);assert(r.frames.count==1&&r.epoch==2&&r.width==320);
 r.capture(rgba.data(),320,237,2,1,"vi",true);assert(r.frames.count==2&&r.segments.size()==2&&r.segments[1].first==1);
 assert(r.segments[0].epoch==1&&r.segments[0].count==1&&r.segments[1].epoch==2);r.reset();
 assert(start().error.empty());r.maxFrames=2;r.capture(rgba.data(),320,237,1,1,"vi",true);r.rebase("test",2);r.capture(rgba.data(),320,237,2,1,"vi",true);assert(!r.active&&r.reason=="frames_limit"&&r.frames.count==2);r.reset();
 // Force a real short disk write. Only full frames before the limit survive.
 std::signal(SIGXFSZ,SIG_IGN);struct rlimit limit;getrlimit(RLIMIT_FSIZE,&limit);limit.rlim_cur=30;assert(!setrlimit(RLIMIT_FSIZE,&limit));
 FrameSpool disk;assert(disk.open());for(unsigned n=0;n<4;++n)assert(disk.append(std::vector<uint8_t>(12,n)));
 assert(!disk.seal());assert(disk.count==2);std::vector<uint8_t> prefix(12);assert(disk.read(12,prefix)&&prefix[0]==1);
}
