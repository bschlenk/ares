# Read-only Game Boy execution evidence

`CPU Execution State` is a generic debugger memory region, format
`ares.gb.execution.v1`, size 160 bytes. It is available for GB/GBC through the
existing memory-region APIs, including native, CLI/MCP and plugin `memory.readMany`.
It has no write callback, does not run the CPU bus and never advances emulation.
Read it together with application RAM in one frozen sample. A PC snapshot alone
is not an application input-wait guarantee.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `GBEX` |
| 4 | 1 | Version 1 |
| 5 | 1 | bit 0 CGB model; bit 1 CGB mode |
| 6 | 1 | bit 0 IME; bit 1 halt; bit 2 stop |
| 7 | 1 | Reserved zero |
| 8 | 12 | Little-endian PC, SP, AF, BC, DE, HL |
| 20 | 3 | Interrupt flag, enable, latched requests |
| 23 | 1 | Current WRAM bank register |
| 24 | 8 | Reserved zero |
| 32 | 64 | Stack bytes at unsigned `SP + offset`, zero for invalid addresses |
| 96 | 64 | Corresponding per-byte validity, 0 or 1 |

Only internal WRAM (`c000`–`dfff`), its echo (`e000`–`fdff`), and HRAM
(`ff80`–`fffe`) are valid stack sources. GBC WRAM uses the current effective bank.
Addresses beyond `ffff` do not wrap. Unmapped/ROM/IO/external RAM is invalid;
zero data must not be interpreted without its validity byte. ROM banking identity
is not supplied by this region. A consumer requiring mapped ROM identity must
verify it independently in the same sample or keep its classification unknown.

The core may be suspended inside an instruction when a frame is submitted. PC
can therefore point at an operand or just beyond an instruction; stack writes
may be in progress. Interrupt registers and stack bytes are evidence, not a
pre-decoded call stack. Consumers must validate call sites, interrupt frames,
application-specific code identity and transitions. Do not expose debug controls
to a playing model or promote cursor artwork/stale application RAM into proof.

`tests/gb-execution.test.js` uses original synthetic ROMs for GB/GBC and checks
nested stack/register values, selected CGB WRAM-bank coherence, invalid stack
bounds, rejected writes and continued normal execution. It does not claim
application-specific menu acceptance.
