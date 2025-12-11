import { Pill, AnalysisStats, ClusterStat } from '../types';

export class CVService {
  
  isReady(): boolean {
    return typeof window.cv !== 'undefined' && !!window.cv.Mat;
  }

  /**
   * Apply Gamma Correction manually
   */
  private applyGammaCorrection(cv: any, src: any, dst: any, gamma: number) {
     const lut = new Uint8Array(256);
     for (let i = 0; i < 256; i++) {
        lut[i] = Math.max(0, Math.min(255, Math.pow(i / 255.0, gamma) * 255.0));
     }

     if (src !== dst) {
        src.copyTo(dst);
     }

     const data = dst.data; 
     const len = data.length;
     
     for (let i = 0; i < len; i++) {
         data[i] = lut[data[i]];
     }
  }

  private getHSV(r: number, g: number, b: number) {
    let rabs = r / 255;
    let gabs = g / 255;
    let babs = b / 255;
    let v = Math.max(rabs, gabs, babs);
    let diff = v - Math.min(rabs, gabs, babs);
    let diffc = (c: number) => (v - c) / 6 / diff + 1 / 2;
    let percentRoundFn = (num: number) => Math.round(num * 100) / 100;
    let h = 0, s = 0, rr, gg, bb;

    if (diff == 0) {
        h = s = 0;
    } else {
        s = diff / v;
        rr = diffc(rabs);
        gg = diffc(gabs);
        bb = diffc(babs);

        if (rabs === v) {
            h = bb - gg;
        } else if (gabs === v) {
            h = (1 / 3) + rr - bb;
        } else if (babs === v) {
            h = (2 / 3) + gg - rr;
        }
        if (h < 0) {
            h += 1;
        } else if (h > 1) {
            h -= 1;
        }
    }
    return {
        h: Math.round(h * 360),
        s: percentRoundFn(s * 100),
        v: percentRoundFn(v * 100)
    };
  }

  private clusterPills(pills: Pill[]): { clusteredPills: Pill[], stats: ClusterStat[] } {
    if (pills.length === 0) return { clusteredPills: [], stats: [] };

    const clusters: { 
        label: string; 
        center: Pill; 
        members: Pill[]; 
        colorHex: string;
        colorScalar: any;
    }[] = [];

    const cv = window.cv;
    const clusterColors = [
        { hex: '#00FFFF', scalar: new cv.Scalar(0, 255, 255, 255) },
        { hex: '#FF00FF', scalar: new cv.Scalar(255, 0, 255, 255) },
        { hex: '#FFFF00', scalar: new cv.Scalar(255, 255, 0, 255) },
        { hex: '#00FF00', scalar: new cv.Scalar(0, 255, 0, 255) },
        { hex: '#FFA500', scalar: new cv.Scalar(255, 165, 0, 255) },
        { hex: '#FF0000', scalar: new cv.Scalar(255, 0, 0, 255) },
    ];

    const DISTANCE_THRESHOLD = 0.14; 
    const MAX_AREA_DIFF = 0.35; 
    const MAX_CIRC_DIFF = 0.18; 
    const MAX_SAT_DIFF = 20;   

    const relDiff = (a: number, b: number) => {
        const max = Math.max(Math.abs(a), Math.abs(b));
        if (max === 0) return 0;
        return Math.abs(a - b) / max;
    };

    pills.forEach(pill => {
        let bestClusterIndex = -1;
        let minDistance = Infinity;

        clusters.forEach((cluster, idx) => {
            const c = cluster.center.features;
            const p = pill.features;
            const cRaw = cluster.center; 
            
            if (relDiff(pill.area, cRaw.area) > MAX_AREA_DIFF) return; 
            if (Math.abs(pill.features.circularity - c.circularity) > MAX_CIRC_DIFF) return; 
            if (Math.abs(p.saturation - c.saturation) > MAX_SAT_DIFF) return;

            let hDiff = Math.abs(p.hue - c.hue);
            if (hDiff > 180) hDiff = 360 - hDiff;
            const hDist = hDiff / 180.0;
            const sDist = Math.abs(p.saturation - c.saturation) / 100.0;
            const vDist = Math.abs(p.value - c.value) / 100.0;

            const isGrayscale = p.saturation < 15 || c.saturation < 15;
            const w_hue = isGrayscale ? 0.05 : 0.35; 
            const w_sat = 0.25; 
            const w_val = 0.05; 
            const w_circ = 0.20; 
            const w_size = 0.15;

            const weightedDist = (
                (hDist * w_hue) + 
                (sDist * w_sat) + 
                (vDist * w_val) + 
                (Math.abs(pill.features.circularity - c.circularity) * w_circ) + 
                (relDiff(pill.area, cRaw.area) * w_size)
            ) / (w_hue + w_sat + w_val + w_circ + w_size);

            if (weightedDist < minDistance) {
                minDistance = weightedDist;
                bestClusterIndex = idx;
            }
        });

        if (bestClusterIndex !== -1 && minDistance < DISTANCE_THRESHOLD) {
            clusters[bestClusterIndex].members.push(pill);
        } else {
            const newLabelChar = String.fromCharCode(65 + clusters.length);
            const colorObj = clusterColors[clusters.length % clusterColors.length];
            
            clusters.push({
                label: newLabelChar,
                center: pill,
                members: [pill],
                colorHex: colorObj.hex,
                colorScalar: colorObj.scalar
            });
        }
    });

    const finalPills: Pill[] = [];
    const stats: ClusterStat[] = [];

    clusters.forEach(c => {
        stats.push({
            label: `Group ${c.label}`,
            count: c.members.length,
            color: c.colorHex
        });
        
        c.members.forEach(p => {
            p.clusterLabel = c.label;
            p.clusterColor = c.colorHex;
            p.contourColor = c.colorScalar;
            finalPills.push(p);
        });
    });

    return { clusteredPills: finalPills, stats };
  }

  processFrame(
    videoElement: HTMLVideoElement,
    canvasOutput: HTMLCanvasElement,
    width: number,
    height: number,
    gamma: number,    // New Param
    contrast: number  // New Param
  ): Partial<AnalysisStats> {
    const cv = window.cv;
    if (!cv || !cv.Mat) return {};

    const startTime = performance.now();
    let detectedPills: Pill[] = [];

    let src: any = null;
    let srcRGB: any = null;
    let gammaMat: any = null; 
    let gray: any = null;
    let blurred: any = null;
    let edges: any = null;
    let edge_dilated: any = null;
    let solid_mask: any = null;
    let edge_contours: any = null;
    let edge_hierarchy: any = null;
    let kernel: any = null;
    let sure_bg: any = null;
    let dist: any = null;
    let sure_fg: any = null;
    let sure_fg_8u: any = null;
    let unknown: any = null;
    let markers: any = null;
    let ones: any = null;
    let tempMask: any = null;
    let innerMask: any = null;
    let kernelErode: any = null;
    let compareMat: any = null;
    let tempContours: any = null;
    let tempHierarchy: any = null;
    let hull: any = null;

    try {
      const ctx = canvasOutput.getContext('2d');
      if (!ctx) throw new Error("No canvas context");

      ctx.drawImage(videoElement, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      src = cv.matFromImageData(imageData);
      
      srcRGB = new cv.Mat();
      cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);

      // 1. Apply Contrast (Linear Transform: dest = src * alpha + beta)
      // alpha = contrast, beta = 0
      srcRGB.convertTo(srcRGB, -1, contrast, 0);

      // 2. Apply Gamma Correction (Non-linear)
      gammaMat = new cv.Mat();
      this.applyGammaCorrection(cv, srcRGB, gammaMat, gamma);
      
      // 3. Derive Gray from the ENHANCED image (gammaMat)
      // This ensures detection sees the same "improved" edges that the user sees
      gray = new cv.Mat();
      cv.cvtColor(gammaMat, gray, cv.COLOR_RGB2GRAY); 

      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      edges = new cv.Mat();
      cv.Canny(blurred, edges, 25, 90); 

      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      edge_dilated = new cv.Mat();
      cv.dilate(edges, edge_dilated, kernel);

      edge_contours = new cv.MatVector();
      edge_hierarchy = new cv.Mat();
      cv.findContours(edge_dilated, edge_contours, edge_hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      solid_mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U);
      for (let i = 0; i < edge_contours.size(); i++) {
        cv.drawContours(solid_mask, edge_contours, i, new cv.Scalar(255), -1);
      }

      sure_bg = new cv.Mat();
      cv.dilate(solid_mask, sure_bg, kernel, new cv.Point(-1, -1), 3);

      dist = new cv.Mat();
      cv.distanceTransform(solid_mask, dist, cv.DIST_L2, 5);
      cv.normalize(dist, dist, 0, 1.0, cv.NORM_MINMAX);

      sure_fg = new cv.Mat();
      cv.threshold(dist, sure_fg, 0.5, 255, cv.THRESH_BINARY);
      
      sure_fg_8u = new cv.Mat();
      sure_fg.convertTo(sure_fg_8u, cv.CV_8U);

      unknown = new cv.Mat();
      cv.subtract(sure_bg, sure_fg_8u, unknown);

      markers = new cv.Mat();
      cv.connectedComponents(sure_fg_8u, markers);

      ones = cv.Mat.ones(markers.rows, markers.cols, cv.CV_32S);
      cv.add(markers, ones, markers);

      markers.setTo(new cv.Scalar(0), unknown);

      cv.watershed(gammaMat, markers); // Watershed on ENHANCED image

      let markersMinMax = cv.minMaxLoc(markers);
      let maxLabel = markersMinMax.maxVal;

      tempMask = cv.Mat.zeros(markers.rows, markers.cols, cv.CV_8U);
      innerMask = new cv.Mat(); 
      kernelErode = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      compareMat = new cv.Mat(markers.rows, markers.cols, cv.CV_32S); 
      tempContours = new cv.MatVector();
      tempHierarchy = new cv.Mat();

      hull = new cv.Mat();
      
      for (let i = 2; i <= maxLabel; i++) {
        compareMat.setTo(new cv.Scalar(i));
        cv.compare(markers, compareMat, tempMask, cv.CMP_EQ);

        cv.findContours(tempMask, tempContours, tempHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        if (tempContours.size() > 0) {
          let contour = tempContours.get(0);
          try {
            let area = cv.contourArea(contour);

            if (area > 200 && area < 10000) {
              
              let M = cv.moments(contour);
              let cx = M.m10 / M.m00;
              let cy = M.m01 / M.m00;

              let perimeter = cv.arcLength(contour, true);
              
              let circularity = 0;
              if (perimeter > 0) {
                  circularity = (4 * Math.PI * area) / (perimeter * perimeter);
              }

              cv.convexHull(contour, hull, false, true);
              let convexArea = cv.contourArea(hull);

              let hu0 = 0.0;
              if (M.m00 > 0) {
                 hu0 = (M.mu20 + M.mu02) / (M.m00 * M.m00);
              }
              let huLog = -1 * Math.sign(hu0) * Math.log10(Math.abs(hu0) || 1e-10);

              cv.erode(tempMask, innerMask, kernelErode);
              let nonZero = cv.countNonZero(innerMask);
              let maskToUse = nonZero > 10 ? innerMask : tempMask;

              // Extract color from ENHANCED image (gammaMat)
              let meanScalar = cv.mean(gammaMat, maskToUse); 
              let r = meanScalar[0];
              let g = meanScalar[1];
              let b = meanScalar[2];
              
              const hsv = this.getHSV(r, g, b);
              const boostedSaturation = Math.min(100, hsv.s * 2.5);

              detectedPills.push({
                id: i,
                x: cx,
                y: cy,
                area: area,
                radius: Math.sqrt(area / Math.PI),
                color: { r, g, b },
                features: {
                    hue: hsv.h,
                    saturation: boostedSaturation, 
                    value: hsv.v,
                    perimeter: perimeter,
                    convexArea: convexArea,
                    huMoment: huLog,
                    circularity: circularity
                },
                clusterLabel: '?',
                clusterColor: '#FFFFFF',
                contourColor: new cv.Scalar(255, 255, 255, 255)
              });
            }
          } finally {
            contour.delete();
          }
        }
        tempContours.delete();
        tempContours = new cv.MatVector();
      }

      const { clusteredPills, stats } = this.clusterPills(detectedPills);

      // VISUALIZATION: Show the ENHANCED image so user sees the effect of sliders
      clusteredPills.forEach(pill => {
          const center = new cv.Point(pill.x, pill.y);
          cv.circle(gammaMat, center, pill.radius + 5, pill.contourColor, 3);
          const org = new cv.Point(pill.x - 10, pill.y + 10);
          cv.putText(gammaMat, pill.clusterLabel, org, cv.FONT_HERSHEY_SIMPLEX, 1.0, new cv.Scalar(255, 255, 255, 255), 2);
      });

      cv.imshow(canvasOutput, gammaMat);

      return {
        totalCount: clusteredPills.length,
        clusters: stats,
        processingTime: performance.now() - startTime
      };

    } catch (err) {
      console.error("CV Error", err);
      return {};
    } finally {
      if (hull) hull.delete();
      if (edges) edges.delete();
      if (edge_dilated) edge_dilated.delete();
      if (solid_mask) solid_mask.delete();
      if (edge_contours) edge_contours.delete();
      if (edge_hierarchy) edge_hierarchy.delete();
      if (src) src.delete();
      if (srcRGB) srcRGB.delete();
      if (gammaMat) gammaMat.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (kernel) kernel.delete();
      if (sure_bg) sure_bg.delete();
      if (dist) dist.delete();
      if (sure_fg) sure_fg.delete();
      if (sure_fg_8u) sure_fg_8u.delete();
      if (unknown) unknown.delete();
      if (markers) markers.delete();
      if (ones) ones.delete();
      if (tempMask) tempMask.delete();
      if (innerMask) innerMask.delete();
      if (kernelErode) kernelErode.delete();
      if (compareMat) compareMat.delete();
      if (tempContours) tempContours.delete();
      if (tempHierarchy) tempHierarchy.delete();
    }
  }
}

export const cvService = new CVService();