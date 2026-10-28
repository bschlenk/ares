#include <cassert>
#include "../native/input-start-gate.hpp"
int main(){
 InputStartGate g;InputStartGate::Sample neutral,press;press.mask=1u<<4;
 g.observe(press);g.arm(true);assert(!g.neutral);g.observe(press);assert(!g.triggered);
 g.observe(neutral);assert(g.neutral&&!g.triggered);g.observe(press);assert(g.triggered&&g.holding);
 assert(g.observe(neutral).mask==press.mask);assert(g.latched().mask==0);g.latched();assert(!g.holding);
 g.arm(false);g.observe(press);assert(!g.triggered);
 g.observe(neutral);g.arm(true);auto drift=neutral;drift.axes[0]=100;g.observe(drift);assert(!g.triggered);
 auto stick=neutral;stick.axes[0]=10000;g.observe(stick);assert(g.triggered);
 g.cancel();g.observe(neutral);g.arm(true);auto unmapped=neutral;unmapped.mask=1u<<24;g.observe(unmapped);assert(!g.triggered);
}
