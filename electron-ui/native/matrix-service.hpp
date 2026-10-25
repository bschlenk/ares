#pragma once
#include "machine-service.hpp"
#include "execution-service.hpp"
#include <sstream>
#include <iomanip>
struct MatrixService {
  template<size_t N>static std::string hex(const std::array<uint8_t,N>& bytes){static const char* digits="0123456789abcdef";std::string value;for(auto b:bytes){value+=digits[b>>4];value+=digits[b&15];}return controlQuote(value);}
  static int32_t fixed(const ares::Nintendo64::RspMatrixBytes& bytes,unsigned n){return int32_t((uint32_t(bytes[2*n])<<24)|(uint32_t(bytes[2*n+1])<<16)|(uint32_t(bytes[32+2*n])<<8)|bytes[33+2*n]);}
  static std::string decimal(double value){std::ostringstream out;out<<std::setprecision(17)<<value;return out.str();}
  static std::string matrix(const ares::Nintendo64::RspMatrixBytes& bytes){
    std::string fixedValues="[",values="[";for(unsigned n=0;n<16;++n){if(n){fixedValues+=',';values+=',';}auto v=fixed(bytes,n);fixedValues+=std::to_string(v);values+=decimal(double(v)/65536);}
    return "{\"raw\":"+hex(bytes)+",\"fixed\":"+fixedValues+"],\"values\":"+values+"]}";
  }
  static std::string state(const ares::Nintendo64::F3dex2MatrixState& s){
    MachineService::Object out;out.number("id",s.id);out.add("task_id",s.task?std::to_string(s.task):"null");out.number("source_vi",s.vi);out.number("command_seq",s.command);
    out.add("code_sha256",controlQuote(s.codeSha256));out.add("profile","\"f3dex2_fifo_2_04h\"");out.add("provenance","\"actual_rsp_state\"");out.add("boundary",controlQuote(s.after?"after_command":"before_command"));
    out.add("modelview",matrix(s.modelview));out.add("projection",matrix(s.projection));out.add("combined",s.combinedValid?matrix(s.combined):"null");out.add("combined_raw",hex(s.combined));
    std::string viewport="[",segments="[",saved="[";
    for(unsigned n=0;n<8;++n){if(n)viewport+=',';viewport+=std::to_string(int16_t(uint16_t(s.viewport[2*n])<<8|s.viewport[2*n+1]));}
    for(auto segment:s.segments){if(segments.back()!='[')segments+=',';segments+=controlQuote(N64Service::hex(segment));}
    bool complete=s.stackValid;for(auto& value:s.saved){if(saved.back()!='[')saved+=',';saved+=value?matrix(*value):"null";if(!value)complete=false;}
    out.add("viewport","{\"raw\":"+hex(s.viewport)+",\"s16\":"+viewport+"],\"xy_subpixel_bits\":2}");out.add("segments",segments+"]");
    out.add("stack","{\"base\":"+controlQuote(N64Service::hex(s.base))+",\"pointer\":"+controlQuote(N64Service::hex(s.pointer))+",\"depth\":"+(s.stackValid?std::to_string(s.saved.size()):"null")+",\"complete\":"+(complete?"true":"false")+",\"saved_source\":\"observed_rsp_dma_writes\",\"saved_ram_current\":false,\"saved\":"+saved+"]}");
    return out.end();
  }
  static std::string vertex(const ares::Nintendo64::F3dex2Vertex& v){
    auto half=[&](unsigned offset){return int16_t(uint16_t(v.raw[offset])<<8|v.raw[offset+1]);};
    std::string clip="[";for(unsigned n=0;n<4;++n){if(n)clip+=',';clip+=std::to_string(int32_t((uint32_t(uint16_t(half(n*2)))<<16)|uint16_t(half(8+n*2))));}
    return "{\"index\":"+std::to_string(v.index)+",\"transform_state_id\":"+(v.transform?std::to_string(v.transform->id):"null")+",\"modified\":"+(v.modified?"true":"false")+",\"raw\":"+hex(v.raw)+",\"clip_fixed\":"+clip+"],\"screen_xy\":["+decimal(double(half(0x18))/4)+","+decimal(double(half(0x1a))/4)+"]}";
  }
  static ControlResult execute(const std::vector<std::string>& args,uint64_t epoch){
    auto& c=ares::Nintendo64::commandCapture;uint64_t generation,offset,limit;
    if(args.size()!=3||!ExecutionService::number(args[0],generation)||!ExecutionService::number(args[1],offset)||offset>512||!ExecutionService::number(args[2],limit)||!limit||limit>8)return {"invalid_request",{}};
    if(generation&&generation!=c.generation)return {"stale_capture",{}};
    if(offset>c.matrixLatest.size())return {"out_of_bounds",{}};
    auto end=std::min<uint64_t>(c.matrixLatest.size(),offset+limit);std::string entries="[";
    for(auto n=offset;n<end;++n){auto value=state(*c.matrixLatest[n]);if(entries.size()+value.size()>45000&&n>offset){end=n;break;}if(n>offset)entries+=',';entries+=value;}
    return {{},"{\"epoch\":"+std::to_string(epoch)+",\"generation\":"+std::to_string(c.generation)+",\"profile\":\"f3dex2_fifo_2_04h\",\"live_profile_supported\":"+(c.matrices.refreshCode()?"true":"false")+",\"capacity\":512,\"stack_capacity\":32,\"overflow\":"+(c.matrixLatestOverflow?"true":"false")+",\"retained\":"+std::to_string(c.matrixLatest.size())+",\"offset\":"+std::to_string(offset)+",\"entries\":"+entries+"],\"next_offset\":"+(end<c.matrixLatest.size()?std::to_string(end):"null")+"}"};
  }
};
