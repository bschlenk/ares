/** Native Screen canvas pixel edges, before rotation and the final viewport crop.
 * This is not a transform from N64 RDRAM/VI source coordinates. */
export interface VideoGeometry {canvasWidth:number;canvasHeight:number;cropX:number;cropY:number;rotation:0|90|180|270}
/** Canvas/DOMMatrix convention: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export type AffineTransform=readonly [number,number,number,number,number,number];
export function validVideoGeometry(g:VideoGeometry,width:number,height:number):boolean {
  if(!g||![g.canvasWidth,g.canvasHeight,g.cropX,g.cropY,width,height].every(n=>Number.isSafeInteger(n)&&n>=0)||!g.canvasWidth||!g.canvasHeight||g.canvasWidth>65536||g.canvasHeight>65536||!width||!height||![0,90,180,270].includes(g.rotation))return false;
  const turns=g.rotation===90||g.rotation===270;
  return g.cropX+width<=(turns?g.canvasHeight:g.canvasWidth)&&g.cropY+height<=(turns?g.canvasWidth:g.canvasHeight);
}
export function canvasTransform(g:VideoGeometry,width:number,height:number,targetWidth:number,targetHeight:number):AffineTransform|null {
  if(!validVideoGeometry(g,width,height)||![targetWidth,targetHeight].every(n=>Number.isFinite(n)&&n>0))return null;
  const x=targetWidth/width,y=targetHeight/height;
  const m:AffineTransform=g.rotation===90?[0,-y,x,0,-g.cropX*x,(g.canvasWidth-g.cropY)*y]:g.rotation===180?[-x,0,0,-y,(g.canvasWidth-g.cropX)*x,(g.canvasHeight-g.cropY)*y]:g.rotation===270?[0,y,-x,0,(g.canvasHeight-g.cropX)*x,-g.cropY*y]:[x,0,0,y,-g.cropX*x,-g.cropY*y];
  return Object.freeze(m);
}
