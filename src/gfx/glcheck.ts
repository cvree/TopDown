/**
 * IS THIS CONTEXT ACTUALLY USABLE?
 *
 * Nothing in here imports three.js, and that is the point: the question has to
 * be answerable *before* a renderer is constructed, because by the time three
 * asks it the answer arrives as an exception thrown from inside a half-built
 * object — and the visible result of that is the whole client on its error
 * screen because a decorative background could not be drawn.
 *
 * The failure is real and reachable. A browser keeps only a handful of live
 * WebGL contexts — around a dozen and a half in Chrome — and hands back a
 * context that is *already lost* once that budget is gone. A lost context
 * answers `null` to every capability question, including the shader-precision
 * one three.js opens with.
 */

/** Everything three.js needs to have working before it is handed a context. */
export interface GlProbe {
  isContextLost(): boolean;
  getShaderPrecisionFormat(shader: number, precision: number): { precision: number } | null;
  readonly VERTEX_SHADER: number;
  readonly HIGH_FLOAT: number;
}

/**
 * Why this context cannot be rendered with, or null if it can.
 *
 * A string rather than a boolean because the three ways this fails are three
 * different pieces of advice — no context at all is a browser or a policy, a
 * lost one is a budget, and a context that cannot report precision is a driver
 * — and a player who reaches the failure deserves to be told which.
 */
export const contextFault = (gl: GlProbe | null): string | null => {
  if (!gl) return 'the browser returned no context';
  if (gl.isContextLost()) return 'the context was lost before it was used';
  // The exact question three.js asks, asked here where the answer is a value.
  if (!gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT)) {
    return 'the driver reports no shader precision';
  }
  return null;
};
