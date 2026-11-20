import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import {
  advanceOceanShadingTime,
  injectOceanShading,
  oceanShadingMaterialUniforms,
  oceanShadingUniforms,
  setOceanTint,
} from '../src/oceanShading';

afterEach(() => setOceanTint(undefined));

function basicShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

it("injects anim.ksh's float and ocean blend into three's sprite shader, after its projection", () => {
  for (const source of [
    { kind: 'attributes' } as const,
    oceanShadingMaterialUniforms({ float: [0, 0, 0], blend: 0 }),
  ]) {
    const shader = basicShader();
    injectOceanShading(shader, source);
    // Every hook landed, and three's projection stays for the lighting's own project_vertex hook.
    expect(shader.vertexShader).toContain('#include <project_vertex>');
    expect(shader.vertexShader).toContain('dstShaderTime * 3.0');
    expect(shader.vertexShader).toContain(
      source.kind === 'attributes' ? 'attribute vec4 spriteOcean' : 'dstFloatParams',
    );
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.fragmentShader).toContain('texture2D(dstOceanTint');
    expect(shader.uniforms.dstShaderTime).toBe(oceanShadingUniforms.dstShaderTime);
  }
});

it('shares the scene clock and the ocean tint, white without an ocean', () => {
  const before = oceanShadingUniforms.dstShaderTime.value;
  advanceOceanShadingTime(0.5);
  advanceOceanShadingTime(-1);
  expect(oceanShadingUniforms.dstShaderTime.value).toBe(before + 0.5);
  const neutral = oceanShadingUniforms.dstOceanTint.value;
  const ocean = new THREE.Texture();
  setOceanTint(ocean, new THREE.Vector4(-10, -10, 0.05, 0.05));
  expect(oceanShadingUniforms.dstOceanTint.value).toBe(ocean);
  expect(oceanShadingUniforms.dstOceanExtents.value.toArray()).toEqual([-10, -10, 0.05, 0.05]);
  setOceanTint(undefined);
  expect(oceanShadingUniforms.dstOceanTint.value).toBe(neutral);
});
