import { Pill, AnalysisStats } from '../types';

export class CVService {
  
  isReady(): boolean {
    return typeof window.cv !== 'undefined' && !!window.cv.Mat;
  }

  /**
   * Helper to determine color name from RGB
   */
  private determineColor(r: number, g: number, b: number): string {
    // Normalize to 0-1
    const r_ = r / 255;
    const g_ = g / 255;
    const b_ = b / 255;
    
    const max = Math.max(r_, g_, b_);
    const min = Math.min(r_, g_, b_);
    let h = 0, s = 0;
    const v = max;
    
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    
    if (max === min) {
      h = 0; 
    } else {
      switch (max) {
        case r_: h = (g_ - b_) / d + (g_ < b_ ? 6 : 0); break;
        case g_: h = (b_ - r_) / d + 2; break;
        case b_: h = (r_ - g_) / d + 4; break;
      }
      h /= 6;
    }
    
    // Convert to degrees/percentage
    const H = h * 360;
    const S = s * 100;
    const V = v * 100;
    
    // Classification Logic
    
    // 1. Achromatic (White/Gray/Black)
    // Relaxed saturation for white (allow small color cast from indoor lights)
    // Increased Value requirement for white to differentiate from Gray
    if (S < 25) {
       if (V > 60) return "白色"; 
       if (V > 30) return "灰色";
       return "黑色"; 
    }

    // 2. Chromatic
    // Adjusted Red range to handle wrap-around better
    if (H < 20 || H >= 340) return "紅色";
    if (H >= 20 && H < 45) return "橘色";
    if (H >= 45 && H < 75) return "黃色";
    if (H >= 75 && H < 165) return "綠色";
    if (H >= 165 && H < 260) return "藍色";
    if (H >= 260 && H < 340) return "紫色";

    return "其他";
  }

  /**
   * Main pipeline function (v7.2 Area Calculation)
   */
  processFrame(
    videoElement: HTMLVideoElement,
    canvasOutput: HTMLCanvasElement,
    width: number,
    height: number
  ): Partial<AnalysisStats> {
    const cv = window.cv;
    if (!cv || !cv.Mat) return {};

    const startTime = performance.now();
    const detectedPills: Pill[] = [];

    // --- MEMORY TRACKING ---
    let src: any = null;
    let srcRGB: any = null;
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
    
    // Loop helpers
    let tempMask: any = null;
    let innerMask: any = null; // New for erosion
    let kernelErode: any = null; // New for erosion
    let compareMat: any = null;
    let tempContours: any = null;
    let tempHierarchy: any = null;

    try {
      const ctx = canvasOutput.getContext('2d');
      if (!ctx) throw new Error("No canvas context");

      ctx.drawImage(videoElement, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      
      src = cv.matFromImageData(imageData);
      
      // Step 1: Preprocessing
      srcRGB = new cv.Mat();
      cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);

      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Blur heavily to remove texture noise inside the pill
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      // Step 2: Canny Edge Detection + Contour Filling
      edges = new cv.Mat();
      cv.Canny(blurred, edges, 30, 100); 

      // Dilate edges slightly
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      edge_dilated = new cv.Mat();
      cv.dilate(edges, edge_dilated, kernel);

      // Find External Contours
      edge_contours = new cv.MatVector();
      edge_hierarchy = new cv.Mat();
      cv.findContours(edge_dilated, edge_contours, edge_hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Create a Solid Mask
      solid_mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U);
      for (let i = 0; i < edge_contours.size(); i++) {
        cv.drawContours(solid_mask, edge_contours, i, new cv.Scalar(255), -1);
      }

      // Step 3: Prepare Background/Foreground for Watershed
      sure_bg = new cv.Mat();
      cv.dilate(solid_mask, sure_bg, kernel, new cv.Point(-1, -1), 3);

      // Step 4: Marker Generation
      dist = new cv.Mat();
      cv.distanceTransform(solid_mask, dist, cv.DIST_L2, 5);
      cv.normalize(dist, dist, 0, 1.0, cv.NORM_MINMAX);

      sure_fg = new cv.Mat();
      cv.threshold(dist, sure_fg, 0.5, 255, cv.THRESH_BINARY);
      
      sure_fg_8u = new cv.Mat();
      sure_fg.convertTo(sure_fg_8u, cv.CV_8U);

      unknown = new cv.Mat();
      cv.subtract(sure_bg, sure_fg_8u, unknown);

      // Step 5: Watershed Execution
      markers = new cv.Mat();
      cv.connectedComponents(sure_fg_8u, markers);

      ones = cv.Mat.ones(markers.rows, markers.cols, cv.CV_32S);
      cv.add(markers, ones, markers);

      markers.setTo(new cv.Scalar(0), unknown);

      cv.watershed(srcRGB, markers);

      // Step 6: Feature Extraction & Classification
      let markersMinMax = cv.minMaxLoc(markers);
      let maxLabel = markersMinMax.maxVal;

      tempMask = cv.Mat.zeros(markers.rows, markers.cols, cv.CV_8U);
      innerMask = new cv.Mat(); // Reuse this
      kernelErode = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)); // Aggressive erosion (9x9)

      compareMat = new cv.Mat(markers.rows, markers.cols, cv.CV_32S); 
      
      tempContours = new cv.MatVector();
      tempHierarchy = new cv.Mat();

      for (let i = 2; i <= maxLabel; i++) {
        compareMat.setTo(new cv.Scalar(i));
        cv.compare(markers, compareMat, tempMask, cv.CMP_EQ);

        cv.findContours(tempMask, tempContours, tempHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        if (tempContours.size() > 0) {
          let contour = tempContours.get(0);
          try {
            let area = cv.contourArea(contour);
            let perimeter = cv.arcLength(contour, true);

            if (area > 200 && area < 8000 && perimeter > 0) {
              
              let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
              
              let M = cv.moments(contour);
              let cx = M.m10 / M.m00;
              let cy = M.m01 / M.m00;

              // --- CORE SAMPLING COLOR EXTRACTION ---
              // Erode the mask to ignore the outer rim (which blends with background)
              cv.erode(tempMask, innerMask, kernelErode);
              
              // Safety check: if pill is too small, erosion might make it disappear. 
              // If disappear, use original mask.
              let nonZero = cv.countNonZero(innerMask);
              let maskToUse = nonZero > 10 ? innerMask : tempMask;

              let meanScalar = cv.mean(srcRGB, maskToUse);
              let r = meanScalar[0];
              let g = meanScalar[1];
              let b = meanScalar[2];
              let colorLabel = this.determineColor(r, g, b);

              let status: 'normal' | 'broken' = circularity > 0.65 ? 'normal' : 'broken';

              detectedPills.push({
                id: i,
                x: cx,
                y: cy,
                area: area,
                radius: Math.sqrt(area / Math.PI),
                color: { r, g, b },
                colorLabel: colorLabel,
                status: status
              });

              // Draw Contour
              let color = status === 'normal' 
                ? new cv.Scalar(0, 255, 0, 255) 
                : new cv.Scalar(255, 140, 0, 255);
              cv.drawContours(srcRGB, tempContours, 0, color, 2);
            }
          } finally {
            contour.delete();
          }
        }
        
        tempContours.delete();
        tempContours = new cv.MatVector();
      }

      // Step 7: Merge Logic
      const MERGE_THRESHOLD = 30;
      const finalPills: Pill[] = [];
      const processedIndices = new Set<number>();

      detectedPills.sort((a, b) => b.radius - a.radius);

      for (let i = 0; i < detectedPills.length; i++) {
        if (processedIndices.has(i)) continue;

        let current = detectedPills[i];
        let totalX = current.x;
        let totalY = current.y;
        let count = 1;

        for (let j = i + 1; j < detectedPills.length; j++) {
          if (processedIndices.has(j)) continue;

          let other = detectedPills[j];
          let dist = Math.sqrt(Math.pow(current.x - other.x, 2) + Math.pow(current.y - other.y, 2));

          if (dist < MERGE_THRESHOLD) {
             totalX += other.x;
             totalY += other.y;
             count++;
             processedIndices.add(j);
          }
        }
        
        current.x = totalX / count;
        current.y = totalY / count;
        finalPills.push(current);
        processedIndices.add(i);
      }

      // Final Visualization (Text)
      finalPills.forEach(pill => {
        let idText = `#${pill.id}`;
        let colorText = pill.colorLabel;
        let areaText = `A:${Math.round(pill.area)}`; // Area text
        
        let orgId = new cv.Point(pill.x - 15, pill.y);
        let orgColor = new cv.Point(pill.x - 20, pill.y + 15);
        let orgArea = new cv.Point(pill.x - 20, pill.y + 30); // Position below color

        // Draw ID (White)
        cv.putText(srcRGB, idText, orgId, cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(255, 255, 255, 255), 1);
        
        // Draw Color (Yellow)
        cv.putText(srcRGB, colorText, orgColor, cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(255, 255, 0, 255), 1);
        
        // Draw Area (Cyan)
        cv.putText(srcRGB, areaText, orgArea, cv.FONT_HERSHEY_SIMPLEX, 0.4, new cv.Scalar(0, 255, 255, 255), 1);
        
        cv.circle(srcRGB, new cv.Point(pill.x, pill.y), 2, new cv.Scalar(0, 255, 255, 255), -1);
      });

      cv.imshow(canvasOutput, srcRGB);

      let normalCount = finalPills.filter(p => p.status === 'normal').length;
      let brokenCount = finalPills.filter(p => p.status === 'broken').length;

      return {
        normalCount,
        brokenCount,
        processingTime: performance.now() - startTime
      };

    } catch (err) {
      console.error("OpenCV Process Error:", err);
      return {};
    } finally {
      // Clean up V6/V7 specific mats
      if (edges) edges.delete();
      if (edge_dilated) edge_dilated.delete();
      if (solid_mask) solid_mask.delete();
      if (edge_contours) edge_contours.delete();
      if (edge_hierarchy) edge_hierarchy.delete();

      // Clean up Standard mats
      if (src) src.delete();
      if (srcRGB) srcRGB.delete();
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
      if (innerMask) innerMask.delete(); // Clean up
      if (kernelErode) kernelErode.delete(); // Clean up
      if (compareMat) compareMat.delete();
      if (tempContours) tempContours.delete();
      if (tempHierarchy) tempHierarchy.delete();
    }
  }
}

export const cvService = new CVService();