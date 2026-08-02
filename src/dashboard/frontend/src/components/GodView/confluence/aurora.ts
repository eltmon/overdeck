export interface AuroraController {
  setEnergy(value: number): void;
  resize(): void;
  dispose(): void;
}

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uEnergy;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(17.3,9.1);a*=.55;}return v;}
void main(){
  vec2 uv = gl_FragCoord.xy/uRes;
  vec2 p = (gl_FragCoord.xy - .5*uRes)/uRes.y;
  float t = uTime*.05;
  vec3 col = vec3(.016,.023,.048);                       /* deep space base */
  /* nebula (spectrum deck) */
  float warp = fbm(p*2.2 - vec2(t*.6, t*.3));
  float n = fbm(p*1.55 + vec2(t, -t*.7) + warp*.85);
  col += vec3(.022,.090,.165) * smoothstep(.34,.86,n) * (.55 + uEnergy*.7);
  col += vec3(.150,.048,.220) * smoothstep(.55,.96, fbm(p*2.6 - vec2(t*.8, 0.) + warp*.4)) * (.4 + uEnergy*.65);
  col += vec3(.000,.330,.430) * pow(smoothstep(.60,.985,n), 3.) * (.45 + uEnergy*1.4);
  /* aurora bands (river) */
  float speed = .4 + uEnergy*1.6;
  for(int i=0;i<3;i++){
    float fi = float(i);
    float y = uv.y + (fbm(vec2(uv.x*2.2 + t*4.*speed*(1.+fi*.35), fi*3.7 + t*3.)) - .5)*.55 - .22 - fi*.22;
    float band = exp(-abs(y)*9.0);
    vec3 tint = mix(vec3(0.,.83,1.), vec3(.62,.31,.87), fi/2.);
    if(i==2) tint = mix(tint, vec3(1.,.18,.49), .35);
    col += tint * band * (.08 + uEnergy*.26);
  }
  /* starfield twinkle */
  vec2 sp = floor(p*220.);
  float star = step(.9975, hash(sp));
  col += vec3(.75,.88,1.) * star * (.25+.35*sin(uTime*2.2+hash(sp+7.)*40.)) * .55;
  /* perspective grid floor (spectrum deck) */
  float hor = .30;
  if (uv.y < hor) {
    float z = 1./max(hor - uv.y, .0012);
    vec2 gp = vec2(p.x*z*.85, z*.5 - uTime*1.15);
    vec2 gf = abs(fract(gp)-.5);
    float line = smoothstep(.085,.02, min(gf.x,gf.y) * (.3 + z*.13));
    float fade = exp(-z*.62) * smoothstep(.0,.05, hor-uv.y);
    col += vec3(.0,.42,.58) * line * fade * (.45 + uEnergy*.85);
    col += vec3(.0,.26,.44) * smoothstep(.012,.0, hor-uv.y) * .5;      /* horizon glow */
    col += vec3(.5,.09,.4) * smoothstep(.004,.0, hor-uv.y) * .3;
  }
  /* scanline shimmer + vignette */
  col *= .965 + .035*sin(gl_FragCoord.y*1.7 + uTime*5.);
  float r = length(p*vec2(.82,1.05));
  col *= 1. - smoothstep(.62,1.25,r)*.5;
  gl_FragColor = vec4(col,1.);
}`;

const FALLBACK_BACKGROUND = 'radial-gradient(ellipse at 50% 30%, #101a33 0%, #0a0e1a 70%)';

function styleCanvas(canvas: HTMLCanvasElement): void {
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '0';
  canvas.style.display = 'block';
}

function createNullAurora(canvas: HTMLCanvasElement): AuroraController {
  canvas.style.background = FALLBACK_BACKGROUND;
  return {
    setEnergy() {},
    resize() {},
    dispose() {},
  };
}

export function createAurora(canvas: HTMLCanvasElement): AuroraController {
  styleCanvas(canvas);

  try {
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return createNullAurora(canvas);

    const mk = (type: number, src: string) => { const s = gl.createShader(type); if (!s) throw new Error('Unable to create WebGL shader'); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'WebGL shader compilation failed'); return s; };
    const glProg = gl.createProgram();
    if (!glProg) throw new Error('Unable to create WebGL program');
    gl.attachShader(glProg, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(glProg, mk(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(glProg);
    if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProg) ?? 'WebGL program link failed');
    gl.useProgram(glProg);
    const buf = gl.createBuffer();
    if (!buf) throw new Error('Unable to create WebGL buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProg, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const glU = { res: gl.getUniformLocation(glProg,'uRes'), time: gl.getUniformLocation(glProg,'uTime'), energy: gl.getUniformLocation(glProg,'uEnergy') };

    canvas.style.background = '';
    let energy = 0.35;
    let frameId = 0;
    let disposed = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const frame = (now: number) => {
      if (disposed) return;
      if (!document.hidden) {
        gl.uniform2f(glU.res, canvas.width, canvas.height);
        gl.uniform1f(glU.time, now / 1000);
        gl.uniform1f(glU.energy, energy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      frameId = window.requestAnimationFrame(frame);
    };

    resize();
    frameId = window.requestAnimationFrame(frame);

    return {
      setEnergy(value) {
        energy = value;
        if (!document.hidden) gl.uniform1f(glU.energy, energy);
      },
      resize,
      dispose() {
        if (disposed) return;
        disposed = true;
        window.cancelAnimationFrame(frameId);
        gl.deleteBuffer(buf);
        gl.deleteProgram(glProg);
      },
    };
  } catch (error) {
    console.warn('WebGL unavailable, canvas-only mode', error);
    return createNullAurora(canvas);
  }
}
