#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"/.. || exit 1

gersemi -i CMakeLists.txt ares cmake nall ruby libco mia electron-ui thirdparty/CMakeLists.txt
