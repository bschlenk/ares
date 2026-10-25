const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FrameParser } = require('./dist/protocol.js');
function packet(sequence) {
  const b = Buffer.alloc(72); b.write('AEF2'); b.writeUInt32LE(24, 4);
  b.writeUInt32LE(3, 8); b.writeUInt32LE(2, 12); b.writeUInt32LE(sequence, 16);
  b.writeUInt32LE(7, 20); b.writeDoubleLE(123.5, 24); b.writeDoubleLE(0.25, 32);
  b.writeDoubleLE(1.5, 40);
  for (let i = 48; i < b.length; i++) b[i] = i;
  return b;
}
test('parses arbitrary pipe fragmentation and coalesced frames', () => {
  for (const chunkSize of [1, 3, 47, 48, 49, 72, 1000]) {
    const result = [], parser = new FrameParser(f => result.push(f));
    const bytes = Buffer.concat([packet(1), packet(2), packet(3)]);
    for (let i = 0; i < bytes.length; i += chunkSize) parser.push(bytes.subarray(i, i + chunkSize));
    assert.deepEqual(result.map(f => f.sequence), [1, 2, 3]);
    assert.deepEqual(result[0].pixels, packet(1).subarray(48));
    assert.equal(result[0].nativeMs, 123.5); assert.equal(result[0].inputSequence, 7);
  }
});
test('rejects malformed or oversized payloads before allocating', () => {
  for (const mutate of [b => b.write('NOPE'), b => b.writeUInt32LE(0, 8),
    b => b.writeUInt32LE(0xffffffff, 4), b => b.writeUInt32LE(3, 12), b => b.writeDoubleLE(NaN, 40)]) {
    const b = packet(1); mutate(b);
    assert.throws(() => new FrameParser(() => {}).push(b), /Invalid AEF2/);
  }
});
test('AEF3 preserves frozen identity and logical dimensions across mixed-version fragmentation',()=>{
 const b=Buffer.alloc(120);packet(5).subarray(0,48).copy(b);b.write('AEF3');b.writeDoubleLE(3,48);b.writeDoubleLE(109,56);b.writeDoubleLE(21,64);b.writeUInt32LE(0x1000,72);b.writeUInt32LE(3,76);b.writeUInt32LE(320,80);b.writeUInt32LE(240,84);b.fill(7,96);
 for(const size of [1,47,48,49,95,96,120,1000]){const output=[],parser=new FrameParser(f=>output.push(f)),wire=Buffer.concat([packet(1),b,packet(6)]);for(let n=0;n<wire.length;n+=size)parser.push(wire.subarray(n,n+size));assert.equal(output.length,3);assert.equal(output[1].logicalWidth,320);assert.equal(output[1].logicalHeight,240);assert.equal(output[1].frameReference.vi,109);assert.equal(output[1].frameReference.origin_commit,21);assert.deepEqual(output[1].pixels,b.subarray(96));}
 b.writeDoubleLE(NaN,56);assert.throws(()=>new FrameParser(()=>{}).push(b),/Invalid AEF3/);
});

test('AEF4 geometry is immutable packet metadata with backwards-compatible fragmented framing',()=>{
 const a=Buffer.alloc(152);packet(8).subarray(0,48).copy(a);a.write('AEF4');a.writeDoubleLE(2,48);a.writeDoubleLE(9,56);a.writeDoubleLE(3,64);a.writeUInt32LE(3,76);a.writeUInt32LE(3,80);a.writeUInt32LE(2,84);
 a.writeUInt32LE(6,96);a.writeUInt32LE(4,100);a.writeUInt32LE(1,104);a.writeUInt32LE(2,108);a.writeUInt32LE(90,112);a.writeUInt32LE(1,116);a.fill(11,128);
 for(const step of [1,47,48,95,96,127,128,152,1000]){const rows=[],parser=new FrameParser(f=>rows.push(f)),bytes=Buffer.concat([packet(1),a,packet(2)]);for(let n=0;n<bytes.length;n+=step)parser.push(bytes.subarray(n,n+step));assert.equal(rows.length,3);assert.deepEqual(rows[1].geometry,{canvasWidth:6,canvasHeight:4,cropX:1,cropY:2,rotation:90});assert.deepEqual(rows[1].pixels,a.subarray(128));assert.equal(rows[0].geometry,undefined);}
 for(const [offset,value] of [[96,0],[104,2],[108,5],[112,45],[116,2]]){const bad=Buffer.from(a);bad.writeUInt32LE(value,offset);assert.throws(()=>new FrameParser(()=>{}).push(bad),/Invalid AEF4/);}
 a.writeUInt32LE(0,116);const rows=[];new FrameParser(f=>rows.push(f)).push(a);assert.equal(rows[0].geometry,null);
});
