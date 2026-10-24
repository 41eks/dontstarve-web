import { runBench, runDomBench, runThreeBench } from './bench';

const params = new URLSearchParams(location.search);
const mode = params.get('mode');

/** Stand-in for the game's continuous software-GL rendering, to test GPU-process contention. */
function startWebglLoad(): void {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl')!;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source); gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER,
    'precision highp float; uniform float t; void main(){ float v = 0.; for (int i = 0; i < 300; i++) v += sin(gl_FragCoord.x * .01 + float(i) + t) * cos(gl_FragCoord.y * .01 - float(i)); gl_FragColor = vec4(vec3(v * .001), 1.); }'));
  gl.linkProgram(program); gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const time = gl.getUniformLocation(program, 't');
  const frame = (now: number) => { gl.uniform1f(time, now / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
if (params.has('load')) startWebglLoad();
const heading = Number(params.get('heading') ?? -90);
if (mode === 'dom') {
  (window as any).bench = await runDomBench(document.body, params.get('element') === 'img' ? 'img' : 'canvas', heading);
} else if (mode === 'three-worker' || mode === 'three-main') {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  document.body.append(canvas);
  if (mode === 'three-main') (window as any).bench = await runThreeBench(canvas, heading);
  else {
    const worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });
    const three = canvas.transferControlToOffscreen();
    worker.onmessage = ({ data }) => { (window as any).bench = data; };
    worker.postMessage({ three, heading }, [three]);
  }
} else if (mode === 'worker') {
  const worker = new Worker(new URL('./bench.worker.ts', import.meta.url), { type: 'module' });
  const specs: [string, boolean][] = [['transferred default', false], ['transferred willRead', true]];
  const canvases = specs.map(([name, willRead]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    document.body.append(canvas);
    return [name, canvas.transferControlToOffscreen(), willRead] as [string, OffscreenCanvas, boolean];
  });
  worker.onmessage = ({ data }) => { (window as any).bench = data; };
  worker.postMessage({ canvases }, canvases.map(([, canvas]) => canvas));
} else {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  document.body.append(canvas);
  (window as any).bench = await runBench([['html default', canvas.getContext('2d')!]], Number(params.get('heading') ?? -90));
}
