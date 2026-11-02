/** Shared native-pixel renderer. No CPU readback, screenshots or per-pixel JSON. */
export class VideoCanvas {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private width = 0;
  private height = 0;
  private valid = false;
  constructor(readonly canvas: HTMLCanvasElement, filtering: 'nearest' | 'linear' = 'nearest') {
    const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, preserveDrawingBuffer: true});
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('Cannot create shader');
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(error || 'Shader compilation failed');
      }
      return s;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('Cannot create WebGL program');
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = vec2(p.x, 1.0-p.y);
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D frame;
void main() { color = texture(frame, uv); }`);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(error || 'Program link failed');
    }
    this.program = program; gl.useProgram(program);
    const texture = gl.createTexture();
    if (!texture) { gl.deleteProgram(program); throw new Error('Cannot create texture'); }
    this.texture = texture; gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = filtering === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  upload(frame: {width: number; height: number; pixels: Uint8Array<ArrayBuffer>}) {
    const gl = this.gl;
    this.valid = true;
    if (frame.width !== this.width || frame.height !== this.height) {
      this.width = frame.width; this.height = frame.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frame.width, frame.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.pixels);
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frame.width, frame.height, gl.RGBA, gl.UNSIGNED_BYTE, frame.pixels);
  }
  draw() {
    if (!this.valid) { this.clear(); return; }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
  clear() { this.valid = false; this.gl.clearColor(0, 0, 0, 1); this.gl.clear(this.gl.COLOR_BUFFER_BIT); }
  dispose() {
    this.gl.deleteTexture(this.texture); this.gl.deleteProgram(this.program);
    // Release Chromium’s active-context slot before a plugin remount creates another.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
