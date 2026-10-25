#pragma once
#include "n64-service.hpp"
#include "execution-service.hpp"
struct TaskService {
  static std::string hex(uint64_t value){return controlQuote(N64Service::hex(value));}
  static std::string task(const ares::Nintendo64::TaskProvenance::Task& t){
    static const char* digits="0123456789abcdef";std::string raw;for(auto byte:t.header){raw+=digits[byte>>4];raw+=digits[byte&15];}
    std::string out="{\"task_id\":"+std::to_string(t.id)+",\"dispatch_frame\":"+std::to_string(t.frame)+",\"origin_commit\":"+std::to_string(t.originCommit)+",\"cpu_pc\":"+hex(t.cpuPc)+",\"rsp_pc\":"+hex(t.rspPc)+",\"descriptor_layout\":\"conventional_ostask_dmem_fc0_candidate\",\"header\":"+controlQuote(raw)+",\"fields\":{";
    const char* names[]={"type","flags","ucode_boot","ucode_boot_size","ucode","ucode_size","ucode_data","ucode_data_size","dram_stack","dram_stack_size","output_buff","output_buff_size","data_ptr","data_size","yield_data_ptr","yield_data_size"};
    for(unsigned n=0;n<16;++n){if(n)out+=',';out+=controlQuote(names[n])+":"+hex(t.field(n));}
    out+="},\"classification\":"+controlQuote(t.field(0)==1?"declared_graphics_candidate":"other_or_unknown")+",\"boot_imem_hash_xxh64\":"+hex(t.bootHash)+",\"previous_identical_descriptor\":"+(t.previousDescriptor?std::to_string(t.previousDescriptor):"null")+",\"resume_mapping\":\"unverified\",\"stopped\":"+(t.stopped?"true":"false")+",\"stopped_frame\":"+std::to_string(t.stoppedFrame)+",\"stop_signal_bits\":"+std::to_string(t.signalBits)+",\"code_overflow\":"+(t.codeOverflow?"true":"false")+",\"target_overflow\":"+(t.targetOverflow?"true":"false")+",\"imem_revisions\":[";
    for(auto& code:t.code){if(out.back()!='[')out+=',';out+="{\"id\":"+std::to_string(code.id)+",\"hash_xxh64\":"+hex(code.hash)+",\"frame\":"+std::to_string(code.frame)+",\"dram_address\":"+hex(code.dram)+",\"imem_address\":"+hex(code.pbus)+",\"bytes\":"+std::to_string(code.bytes)+"}";}
    out+="],\"render_targets\":[";
    for(auto& target:t.targets){if(out.back()!='[')out+=',';out+="{\"address\":"+hex(target.address)+",\"width\":"+std::to_string(target.width)+",\"color_depth\":"+std::to_string(target.depth)+",\"frame\":"+std::to_string(target.frame)+",\"origin_commit\":"+std::to_string(target.originCommit)+",\"draw_commands\":"+std::to_string(target.draws)+",\"association\":\"rsp_dpc_submission\"}";}
    return out+"]}";
  }
  static ControlResult execute(const std::vector<std::string>& args,uint64_t epoch,uint64_t frame){
    using namespace ares::Nintendo64;
    uint64_t id=0;if(args.size()>1||(!args.empty()&&(!ExecutionService::number(args[0],id)||!id)))return {"invalid_request",{}};
    auto& p=taskProvenance;const auto* selected=id?p.find(id):p.latestGraphics();if(id&&!selected)return {"stale_task",{}};
    const bool matrixAvailable=selected&&std::any_of(commandCapture.matrixLatest.begin(),commandCapture.matrixLatest.end(),[&](auto& state){return state->task==selected->id;});
    std::string out="{\"epoch\":"+std::to_string(epoch)+",\"frame\":"+std::to_string(frame)+",\"executor\":"+controlQuote(!rsp.debugControl.active&&Accuracy::RSP::Recompiler&&rsp.recompiler.enabled?"recompiler":"interpreter")+",\"cpu_executor\":"+controlQuote(N64Service::executor())+",\"capture\":\"sp_halt_clear_and_consumed_rdp\",\"interpreter_required\":false,\"retention\":64,\"dropped_tasks\":"+std::to_string(p.dropped)+",\"last_dispatch_id\":"+(p.tasks.empty()?"null":std::to_string(p.tasks.back().id))+",\"task\":"+(selected?task(*selected):"null")+",\"scanouts\":[";
    for(auto& scanout:p.scanouts){if(out.back()!='[')out+=',';out+="{\"frame\":"+std::to_string(scanout.frame)+",\"origin_commit\":"+std::to_string(scanout.originCommit)+",\"origin\":"+hex(scanout.origin)+",\"mapping\":\"candidate_only\",\"reason\":\"address_match_does_not_prove_displayed_pixel_contribution\",\"overflow\":"+(scanout.overflow||p.dropped?"true":"false")+",\"task_candidates\":[";for(auto candidate:scanout.candidates){if(out.back()!='[')out+=',';out+=std::to_string(candidate);}out+="]}";}
    return {{},out+"],\"capture_cost\":{\"scope\":\"descriptor_and_imem_snapshots_only\",\"samples\":"+std::to_string(p.captures)+",\"total_ns\":"+std::to_string(p.totalNs)+",\"max_ns\":"+std::to_string(p.maxNs)+"},\"matrix_state\":{\"available\":"+(matrixAvailable?"true":"false")+",\"reason\":"+(matrixAvailable?"null":"\"no_retained_matrix_state_for_task\"")+",\"profile\":\"f3dex2_fifo_2_04h\",\"service\":\"n64.capture.matrices\"}}"};
  }
};
