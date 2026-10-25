import type { PluginContext } from '../../plugins/sdk.js';

export function activate(ctx:PluginContext) {
  ctx.ui.registerOverlay('crosshair',overlay=>{
    // The div already follows the displayed screen. No #screen/body queries.
    const canvas=document.createElement('canvas');
    canvas.style.width='100%';canvas.style.height='100%';
    overlay.element.append(canvas);
    const draw=canvas.getContext('2d')!;
    const resize=overlay.onResize(size=>{
      canvas.width=size.pixelWidth;
      canvas.height=size.pixelHeight;
      if(size.logicalWidth&&size.logicalHeight)
        draw.setTransform(size.pixelWidth/size.logicalWidth,0,0,size.pixelHeight/size.logicalHeight,0,0);
    });
    const stop=ctx.scope.onFrame({source:'export default({emu})=>({vi:emu.frame})'},sample=>{
      overlay.present(sample,()=>{
        const {logicalWidth:w,logicalHeight:h}=overlay.size;
        draw.clearRect(0,0,w,h);
        draw.strokeStyle='#ffea00';draw.lineWidth=1;
        draw.beginPath();draw.moveTo(w/2-8,h/2);draw.lineTo(w/2+8,h/2);
        draw.moveTo(w/2,h/2-8);draw.lineTo(w/2,h/2+8);draw.stroke();
        draw.fillStyle='#fff';draw.font='10px monospace';draw.fillText(`VI ${(sample.value as {vi:number}).vi}`,8,16);
      });
    });
    return ()=>{resize();void stop();};
  });
}
