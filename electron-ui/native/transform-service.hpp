#pragma once
#include "matrix-service.hpp"
struct TransformService {
  static std::string depth(const std::shared_ptr<const ares::Nintendo64::F3dex2MatrixState>& s){return s&&s->stackValid?std::to_string(s->saved.size()):"null";}
  static std::string state(const ares::Nintendo64::F3dex2MatrixState& s){
    MachineService::Object out;out.number("id",s.id);out.add("code_sha256",controlQuote(s.codeSha256));out.add("modelview_raw",MatrixService::hex(s.modelview));out.add("projection_raw",MatrixService::hex(s.projection));out.add("combined_raw",s.combinedValid?MatrixService::hex(s.combined):"null");out.add("viewport_raw",MatrixService::hex(s.viewport));out.hex("segment4",s.segments[4]);out.add("depth",s.stackValid?std::to_string(s.saved.size()):"null");return out.end();
  }
  static ControlResult execute(const std::vector<std::string>& args,uint64_t epoch,const std::string& session){
    using namespace ares::Nintendo64;auto& c=commandCapture;uint64_t generation,offset,limit;
    if(args.size()!=3||!ExecutionService::number(args[0],generation)||!ExecutionService::number(args[1],offset)||offset>c.TransformCapacity||!ExecutionService::number(args[2],limit)||!limit||limit>32)return {"invalid_request",{}};
    const CommandCapture::TransformCapture* capture=nullptr;
    for(auto& value:c.transformHistory)if(!generation||value.generation==generation)capture=&value;
    if(generation&&!capture)return {"stale_capture",{}};
    const uint64_t retained=capture?capture->entries.size():0,observed=capture?capture->observed:0;
    if(offset>retained)return {"out_of_bounds",{}};
    auto end=std::min<uint64_t>(retained,offset+limit);std::string entries="[";
    for(auto n=offset;n<end;++n){const auto& r=capture->entries[n];MachineService::Object row;
      row.number("seq",r.seq);row.add("task_id",r.task?std::to_string(r.task):"null");row.number("source_vi",r.vi);row.hex("word0",r.word0);row.hex("word1",r.word1);row.add("command_complete",r.complete?"true":"false");row.add("before_depth",depth(r.before));row.add("state",r.after?state(*r.after):"null");row.add("operand_raw",r.operandValid?MatrixService::hex(r.operand):"null");row.add("vertex_state",r.vertexState?state(*r.vertexState):"null");row.number("vertex_batches",r.vertexBatches);
      if(n>offset)entries+=',';entries+=row.end();
    }
    std::string reference="null";
    if(capture)reference="{\"native_session\":"+controlQuote(session)+",\"epoch\":"+std::to_string(epoch)+",\"vi\":"+std::to_string(capture->vi)+",\"boundary\":\"capture_commit\",\"origin\":"+std::to_string(capture->origin)+",\"origin_commit\":"+std::to_string(capture->originCommit)+",\"video_sequence\":null,\"presentation\":null,\"provenance\":\"unmatched\"}";
    return {{},"{\"epoch\":"+std::to_string(epoch)+",\"generation\":"+std::to_string(capture?capture->generation:c.transformGeneration)+",\"frame_reference\":"+reference+",\"profile\":\"f3dex2_fifo_2_04h\",\"capacity\":256,\"history_capacity\":4,\"committed\":"+std::to_string(observed)+",\"retained\":"+std::to_string(retained)+",\"dropped\":"+std::to_string(observed-retained)+",\"truncated\":"+(observed>retained?"true":"false")+",\"matrix_overflow\":"+(capture&&capture->matrixOverflow?"true":"false")+",\"offset\":"+std::to_string(offset)+",\"entries\":"+entries+"],\"next_offset\":"+(end<retained?std::to_string(end):"null")+"}"};
  }
};
