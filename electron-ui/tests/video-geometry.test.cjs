const {test}=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),path=require('node:path');
const {canvasTransform,validVideoGeometry}=require('../dist/services/video-geometry.js');
const transform=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
test('screen crop and rotation transforms predict actual native pixel output at CSS and DPR sizes',()=>{
 const fixture=process.env.ARES_CPU_FIXTURE||path.resolve(__dirname,'../../build-electron-make/bin/ares-electron-cpu-fixture');
 const rows=execFileSync(fixture,{encoding:'utf8',timeout:15000}).split('\n').filter(s=>s.startsWith('SCREEN_GEOMETRY_JSON ')).map(s=>JSON.parse(s.slice(21)));
 assert.equal(rows.length,4,'Rebuild the CPU fixture with geometry coverage');
 for(const row of rows){const {width,height,pixels,...g}=row;assert(validVideoGeometry(g,width,height));
  for(const [w,h] of [[width,height],[640,240],[701.5,333.25],[1403,666.5]]){
   const m=canvasTransform(g,width,height,w,h);assert(Object.isFrozen(m));
   pixels.forEach((value,n)=>{const [x,y]=transform(m,value%g.canvasWidth+0.5,Math.floor(value/g.canvasWidth)+0.5);assert(Math.abs(x-(n%width+0.5)*w/width)<1e-8);assert(Math.abs(y-(Math.floor(n/width)+0.5)*h/height)<1e-8);});
  }
 }
});
test('unavailable and malformed native geometry cannot become a guessed transform',()=>{
 const g={canvasWidth:640,canvasHeight:480,cropX:0,cropY:0,rotation:0};
 for(const invalid of [{...g,cropX:2},{...g,rotation:45},{...g,canvasWidth:NaN},{...g,cropY:-1},{...g,canvasHeight:0}])assert.equal(canvasTransform(invalid,640,480,320,240),null);
 assert.equal(canvasTransform(g,640,480,0,240),null);assert.equal(canvasTransform(g,640,480,Infinity,240),null);
});
