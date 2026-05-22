/**
 * Simplex Noise — Pure Browser JavaScript
 * Ported from the Java Minecraft 1.12.2 terrain generator.
 * Used for overworld terrain, cave systems, and biome blending.
 */
'use strict';

const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

class SimplexNoise {
  constructor(seed) {
    seed = (seed ^ 0xDEAD) | 0;
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Seeded Fisher-Yates shuffle
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = Math.imul(s, 1664525) + 1013904223 >>> 0;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  _dot2(g, x, y) { return g[0]*x + g[1]*y; }
  _dot3(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

  noise2D(xin, yin) {
    const F2 = 0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
    const s = (xin+yin)*F2;
    const i = Math.floor(xin+s), j = Math.floor(yin+s);
    const t = (i+j)*G2, X0=i-t, Y0=j-t;
    const x0=xin-X0, y0=yin-Y0;
    let i1,j1;
    if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    const x1=x0-i1+G2, y1=y0-j1+G2, x2=x0-1+2*G2, y2=y0-1+2*G2;
    const ii=i&255, jj=j&255;
    const gi0=this.permMod12[ii+this.perm[jj]];
    const gi1=this.permMod12[ii+i1+this.perm[jj+j1]];
    const gi2=this.permMod12[ii+1+this.perm[jj+1]];
    let t0=0.5-x0*x0-y0*y0, n0=0;
    if(t0>0){t0*=t0;n0=t0*t0*this._dot2(GRAD3[gi0],x0,y0);}
    let t1=0.5-x1*x1-y1*y1, n1=0;
    if(t1>0){t1*=t1;n1=t1*t1*this._dot2(GRAD3[gi1],x1,y1);}
    let t2=0.5-x2*x2-y2*y2, n2=0;
    if(t2>0){t2*=t2;n2=t2*t2*this._dot2(GRAD3[gi2],x2,y2);}
    return 70*(n0+n1+n2);
  }

  noise3D(xin, yin, zin) {
    const F3=1/3, G3=1/6;
    const s=(xin+yin+zin)*F3;
    const i=Math.floor(xin+s),j=Math.floor(yin+s),k=Math.floor(zin+s);
    const t=(i+j+k)*G3,X0=i-t,Y0=j-t,Z0=k-t;
    const x0=xin-X0,y0=yin-Y0,z0=zin-Z0;
    let i1,j1,k1,i2,j2,k2;
    if(x0>=y0){
      if(y0>=z0){i1=1;j1=0;k1=0;i2=1;j2=1;k2=0;}
      else if(x0>=z0){i1=1;j1=0;k1=0;i2=1;j2=0;k2=1;}
      else{i1=0;j1=0;k1=1;i2=1;j2=0;k2=1;}
    }else{
      if(y0<z0){i1=0;j1=0;k1=1;i2=0;j2=1;k2=1;}
      else if(x0<z0){i1=0;j1=1;k1=0;i2=0;j2=1;k2=1;}
      else{i1=0;j1=1;k1=0;i2=1;j2=1;k2=0;}
    }
    const x1=x0-i1+G3,y1=y0-j1+G3,z1=z0-k1+G3;
    const x2=x0-i2+2*G3,y2=y0-j2+2*G3,z2=z0-k2+2*G3;
    const x3=x0-1+3*G3,y3=y0-1+3*G3,z3=z0-1+3*G3;
    const ii=i&255,jj=j&255,kk=k&255;
    const gi0=this.permMod12[ii+this.perm[jj+this.perm[kk]]];
    const gi1=this.permMod12[ii+i1+this.perm[jj+j1+this.perm[kk+k1]]];
    const gi2=this.permMod12[ii+i2+this.perm[jj+j2+this.perm[kk+k2]]];
    const gi3=this.permMod12[ii+1+this.perm[jj+1+this.perm[kk+1]]];
    let tt,n0=0,n1=0,n2=0,n3=0;
    tt=0.6-x0*x0-y0*y0-z0*z0; if(tt>0){tt*=tt;n0=tt*tt*this._dot3(GRAD3[gi0],x0,y0,z0);}
    tt=0.6-x1*x1-y1*y1-z1*z1; if(tt>0){tt*=tt;n1=tt*tt*this._dot3(GRAD3[gi1],x1,y1,z1);}
    tt=0.6-x2*x2-y2*y2-z2*z2; if(tt>0){tt*=tt;n2=tt*tt*this._dot3(GRAD3[gi2],x2,y2,z2);}
    tt=0.6-x3*x3-y3*y3-z3*z3; if(tt>0){tt*=tt;n3=tt*tt*this._dot3(GRAD3[gi3],x3,y3,z3);}
    return 32*(n0+n1+n2+n3);
  }

  octave2D(x,z,octaves,persistence,scale){
    let total=0,freq=1/scale,amp=1,max=0;
    for(let i=0;i<octaves;i++){
      total+=this.noise2D(x*freq,z*freq)*amp;
      max+=amp; amp*=persistence; freq*=2;
    }
    return total/max;
  }
  octave3D(x,y,z,octaves,persistence,scale){
    let total=0,freq=1/scale,amp=1,max=0;
    for(let i=0;i<octaves;i++){
      total+=this.noise3D(x*freq,y*freq,z*freq)*amp;
      max+=amp; amp*=persistence; freq*=2;
    }
    return total/max;
  }
}

if(typeof module!=='undefined') module.exports={SimplexNoise};
else self.SimplexNoise=SimplexNoise;
