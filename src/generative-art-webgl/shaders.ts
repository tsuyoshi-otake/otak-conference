// WebGL shader sources
export const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_velocity;
  attribute float a_age;
  attribute float a_lifespan;
  attribute vec3 a_color;
  
  uniform vec2 u_resolution;
  uniform float u_time;
  
  varying float v_alpha;
  varying vec3 v_color;
  
  void main() {
    vec2 position = a_position / u_resolution * 2.0 - 1.0;
    gl_Position = vec4(position * vec2(1, -1), 0, 1);
    
    float lifeFactor = a_age / a_lifespan;
    float fadeIn = min(1.0, a_age / 20.0);
    float fadeOut = 1.0 - lifeFactor * lifeFactor;
    v_alpha = fadeIn * fadeOut * 0.8;
    
    float speed = length(a_velocity);
    v_color = a_color + vec3(speed * 0.1);
    
    gl_PointSize = 2.0 + speed * 2.0;
  }
`;

export const fragmentShaderSource = `
  precision mediump float;
  
  varying float v_alpha;
  varying vec3 v_color;
  
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    
    if (dist > 0.5) {
      discard;
    }
    
    float alpha = v_alpha * (1.0 - dist * 2.0);
    gl_FragColor = vec4(v_color, alpha);
  }
`;
