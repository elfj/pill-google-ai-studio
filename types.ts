export interface Pill {
  id: number;
  x: number;
  y: number;
  area: number;
  radius: number;
  color: { r: number; g: number; b: number };
  colorLabel: string;
  status: 'normal' | 'broken';
}

export interface AnalysisStats {
  normalCount: number;
  brokenCount: number;
  processingTime: number;
  fps: number;
  status: string;
}

// Minimal type definition for OpenCV.js
export type Mat = any;

export interface MatConstructor {
  new (): Mat;
  new (rows: number, cols: number, type: number): Mat;
  new (rows: number, cols: number, type: number, scalar: any): Mat;
  ones: (rows: number, cols: number, type: number) => Mat;
  zeros: (rows: number, cols: number, type: number) => Mat;
}

export interface OpenCV {
  Mat: MatConstructor;
  MatVector: new () => any;
  Size: new (w: number, h: number) => any;
  Point: new (x: number, y: number) => any;
  Scalar: new (v0: number, v1?: number, v2?: number, v3?: number) => any;
  
  // Core
  imshow: (canvasSource: string | HTMLCanvasElement, mat: Mat) => void;
  imread: (imageSource: HTMLImageElement | HTMLCanvasElement | string) => Mat;
  matFromImageData: (imageData: ImageData) => Mat;
  split: (src: Mat, mv: any) => void;
  resize: (src: Mat, dst: Mat, dsize: any, fx?: number, fy?: number, interpolation?: number) => void;
  countNonZero: (src: Mat) => number;
  
  // Image Processing
  cvtColor: (src: Mat, dst: Mat, code: number) => void;
  threshold: (src: Mat, dst: Mat, thresh: number, maxVal: number, type: number) => void;
  adaptiveThreshold: (src: Mat, dst: Mat, maxValue: number, adaptiveMethod: number, thresholdType: number, blockSize: number, C: number) => void;
  GaussianBlur: (src: Mat, dst: Mat, ksize: any, sigmaX: number, sigmaY?: number) => void;
  Canny: (image: Mat, edges: Mat, threshold1: number, threshold2: number, apertureSize?: number, L2gradient?: boolean) => void;
  morphologyEx: (src: Mat, dst: Mat, op: number, kernel: Mat, anchor?: any, iterations?: number) => void;
  dilate: (src: Mat, dst: Mat, kernel: Mat, anchor?: any, iterations?: number) => void;
  erode: (src: Mat, dst: Mat, kernel: Mat, anchor?: any, iterations?: number) => void;
  distanceTransform: (src: Mat, dst: Mat, distanceType: number, maskSize: number) => void;
  normalize: (src: Mat, dst: Mat, alpha: number, beta: number, normType: number) => void;
  subtract: (src1: Mat, src2: Mat, dst: Mat, mask?: Mat, dtype?: number) => void;
  add: (src1: Mat, src2: Mat, dst: Mat, mask?: Mat, dtype?: number) => void;
  connectedComponents: (image: Mat, labels: Mat) => number;
  watershed: (image: Mat, markers: Mat) => void;
  
  // Contours & Analysis
  findContours: (image: Mat, contours: any, hierarchy: Mat, mode: number, method: number) => void;
  contourArea: (contour: any) => number;
  arcLength: (contour: any, closed: boolean) => number;
  mean: (src: Mat, mask?: Mat) => any;
  minMaxLoc: (src: Mat, mask?: Mat) => { minVal: number, maxVal: number, minLoc: any, maxLoc: any };
  inRange: (src: Mat, lowerb: any, upperb: any, dst: Mat) => void;
  compare: (src1: Mat, src2: Mat, dst: Mat, cmpop: number) => void;
  moments: (src: Mat, binaryImage?: boolean) => any;
  
  // Drawing
  circle: (img: Mat, center: any, radius: number, color: any, thickness?: number) => void;
  putText: (img: Mat, text: string, org: any, fontFace: number, fontScale: number, color: any, thickness?: number) => void;
  drawContours: (image: Mat, contours: any, contourIdx: number, color: any, thickness?: number) => void;
  getStructuringElement: (shape: number, size: any) => Mat;
  
  // Constants
  CV_8U: number;
  CV_32S: number;
  CV_32F: number;
  CV_8UC1: number;
  
  COLOR_RGBA2RGB: number;
  COLOR_RGBA2GRAY: number;
  COLOR_RGB2HSV: number;
  
  THRESH_BINARY: number;
  THRESH_BINARY_INV: number;
  THRESH_OTSU: number;
  ADAPTIVE_THRESH_GAUSSIAN_C: number;
  
  MORPH_OPEN: number;
  MORPH_CLOSE: number;
  MORPH_RECT: number;
  
  DIST_L2: number;
  NORM_MINMAX: number;
  
  CMP_EQ: number;
  
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  FONT_HERSHEY_SIMPLEX: number;
}

declare global {
  interface Window {
    cv: OpenCV;
  }
}