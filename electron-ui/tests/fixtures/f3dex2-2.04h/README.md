Matching F3DEX2 FIFO 2.04H fixture, generated from the CC0 assembly at
https://github.com/Mr-Wiseguy/f3dex2/tree/bd31393fd02b89e024b043c8c50c9a5a10143fb6
using armips 62adab4ef30da765f5cf22a451eb08a59c54dc8b.

Reproduce from that source revision:

    make F3DEX2_2.04H ARMIPS=/path/to/armips CPP='clang -E -x c -P'

Copy the resulting .code and .data files here. MD5 checks supplied by the source:
code d3a58568fa7cf042de370912a47c3b5f; data 6639b2fd15a73c5446aff592bb599983.
No ROM or game state is required to execute this fixture. The matrices, display
lists, vertices and render target used by the test are independently generated.
