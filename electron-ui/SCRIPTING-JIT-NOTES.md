# Execute-hook JIT investigation

The first implementation uses DebugControl::executeObserver and marks the debug
engine active for its entire lifetime. CPU::instruction consequently selects the
interpreter. Matching uses the normalized physical address before the instruction
executes; branch delay slots retain their architectural pre-instruction snapshot.
A sparse lookup avoids building register snapshots for nonmatching instructions.

Adding a check only at recompiler block entry is insufficient. A target may be an
internal instruction, an internal branch entry, or a branch delay slot. Existing
blocks can also outlive a hook registration or replacement. Precise snapshots
require materializing cached architectural registers before entering a callback.

A next implementation needs a hook-generation number on translations, invalidation
when definitions change, and either guarded internal entry checks or block splits
at every matching instruction. A hooked-block interpreter fallback also needs
precise entry state and proof for exceptions, delay slots and self-modifying code.
No sparse-JIT performance or correctness claim is made by this implementation.

The generated N64 fixture tests entry registers and delay-slot tuples. Callback
budgets and hook lifetime restoration are independent of interpreter speed. Real
project benchmarking should compare the same ROM/state, VI count, executor,
callback count and renderer with trace_calls; synthetic fixtures cannot establish
a Kirby speedup. The optimization remains an investigation, as scoped in slice 6.

A private Kirby baseline comparison was subsequently run for 100 VIs, loading the
identical saved state before each mode, with no injected input. The execute hook
matched `0x800a19ec`; trace_calls filtered targets to the same four-byte entry
range and captured a0/a1/ra. Both observed 44 entries. Native operation times
were 4.518048 s (hook) and 4.512473 s (trace); both reported interpreter and
restored recompiler afterward. This single measurement shows no meaningful
speed difference. It does not establish equivalence of entry versus call-site
register values, nor a sparse-JIT speedup.
