import { Pill, AnalysisStats } from '../types';

export class CVService {
  
  isReady(): boolean {
    return typeof window.cv !== 'undefined' && !!window.cv.Mat;
  }

  /**
   * Main pipeline function (v4.0 HSV Saturation Algorithm)
   * 
   * PROBLEM: Yellow pills on white background have similar intensity (Grayscale fails).
   * SOLUTION: Yellow has high Saturation, White has low Saturation.
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
    // All mats declared here must be deleted in finally
    let src: any = null;
    let srcRGB: any = null;
    let hsv: any = null;
    let planes: any = null;
    let s_channel: any = null;
    let binary: any = null;
    let kernel: any = null;
    let opening: any = null;
    let sure_bg: any = null;
    let dist: any = null;
    let sure_fg: any = null;
    let sure_fg_8u: any = null;
    let unknown: any = null;
    let markers: any = null;
    let ones: any = null;
    
    // Loop helpers
    let tempMask: any = null;
    let compareMat: any = null;
    let tempContours: any = null;
    let tempHierarchy: any = null;

    try {
      const ctx = canvasOutput.getContext('2d');
      if (!ctx) throw new Error("No canvas context");

      // Draw video to canvas to get pixel data
      ctx.drawImage(videoElement, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      
      // Load Image
      src = cv.matFromImageData(imageData);
      
      // Step 1: Preprocessing & HSV Conversion
      srcRGB = new cv.Mat();
      cv.cvtColor(src, srcRGB, cv.COLOR_RGBA2RGB);

      hsv = new cv.Mat();
      cv.cvtColor(srcRGB, hsv, cv.COLOR_RGB2HSV);

      // Split Channels to get Saturation
      planes = new cv.MatVector();
      cv.split(hsv, planes);
      s_channel = planes.get(1); // Index 1 is Saturation

      // Threshold on Saturation Channel
      // White background -> Low Saturation (< ~20)
      // Yellow Pills -> High Saturation
      binary = new cv.Mat();
      cv.threshold(s_channel, binary, 50, 255, cv.THRESH_BINARY);

      // Step 2: Noise Removal & Background
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      opening = new cv.Mat();
      cv.morphologyEx(binary, opening, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);

      sure_bg = new cv.Mat();
      cv.dilate(opening, sure_bg, kernel, new cv.Point(-1, -1), 2);

      // Step 3: Marker Generation
      dist = new cv.Mat();
      cv.distanceTransform(opening, dist, cv.DIST_L2, 3);
      
      // Normalize distance transform to 0-1 for consistent thresholding
      cv.normalize(dist, dist, 0, 1.0, cv.NORM_MINMAX);

      sure_fg = new cv.Mat();
      // Threshold at 0.5 to get sure foreground (seeds)
      cv.threshold(dist, sure_fg, 0.5, 255, cv.THRESH_BINARY);
      
      sure_fg_8u = new cv.Mat();
      sure_fg.convertTo(sure_fg_8u, cv.CV_8U);

      unknown = new cv.Mat();
      cv.subtract(sure_bg, sure_fg_8u, unknown);

      // Step 4: Watershed Execution
      markers = new cv.Mat();
      cv.connectedComponents(sure_fg_8u, markers);

      // Add 1 to markers (Background becomes 1)
      ones = cv.Mat.ones(markers.rows, markers.cols, cv.CV_32S);
      cv.add(markers, ones, markers);

      // Mark unknown region as 0
      markers.setTo(new cv.Scalar(0), unknown);

      // Run Watershed
      cv.watershed(srcRGB, markers);

      // Step 5: Feature Extraction & Classification
      let markersMinMax = cv.minMaxLoc(markers);
      let maxLabel = markersMinMax.maxVal;

      tempMask = cv.Mat.zeros(markers.rows, markers.cols, cv.CV_8U);
      // Create a comparison matrix of the same size as markers for the loop
      compareMat = new cv.Mat(markers.rows, markers.cols, cv.CV_32S); 
      
      tempContours = new cv.MatVector();
      tempHierarchy = new cv.Mat();

      for (let i = 2; i <= maxLabel; i++) {
        // Create mask for current label using compare/setTo instead of inRange with Scalar
        // This avoids "Cannot pass ... as a Mat" errors with Scalars
        compareMat.setTo(new cv.Scalar(i));
        cv.compare(markers, compareMat, tempMask, cv.CMP_EQ);

        // Find contours
        cv.findContours(tempMask, tempContours, tempHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        if (tempContours.size() > 0) {
          let contour = tempContours.get(0);
          try {
            let area = cv.contourArea(contour);
            let perimeter = cv.arcLength(contour, true);

            // Filter Noise (Area > 150) and Huge blobs (Area < 5000)
            if (area > 150 && area < 5000 && perimeter > 0) {
              
              // Calculate Circularity
              // Perfect Circle = 1.0
              let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
              
              // Moments for centroid
              let M = cv.moments(contour);
              let cx = M.m10 / M.m00;
              let cy = M.m01 / M.m00;

              // Logic: Normal vs Broken
              // Normal pills are round (Circularity > 0.75)
              // Fragments/Halves are less round (Circularity <= 0.75)
              let status: 'normal' | 'broken' = circularity > 0.75 ? 'normal' : 'broken';

              detectedPills.push({
                id: i,
                x: cx,
                y: cy,
                radius: Math.sqrt(area / Math.PI),
                color: { r: 0, g: 0, b: 0 }, // Color not used for logic anymore
                status: status
              });

              // Visualization
              // Green (0, 255, 0) for Normal, Orange/Red (255, 100, 0) for Broken
              let color = status === 'normal' 
                ? new cv.Scalar(0, 255, 0, 255) 
                : new cv.Scalar(255, 140, 0, 255);
                
              cv.drawContours(srcRGB, tempContours, 0, color, 2);
            }
          } finally {
            contour.delete();
          }
        }
        
        // Clean up loop vector
        tempContours.delete();
        tempContours = new cv.MatVector();
      }

      // Step 6: Final Draw (Text)
      detectedPills.forEach(pill => {
        let text = `#${pill.id}`;
        let org = new cv.Point(pill.x - 10, pill.y);
        cv.putText(srcRGB, text, org, cv.FONT_HERSHEY_SIMPLEX, 0.5, new cv.Scalar(255, 255, 255, 255), 1);
      });

      // Output to canvas
      cv.imshow(canvasOutput, srcRGB);

      let normalCount = detectedPills.filter(p => p.status === 'normal').length;
      let brokenCount = detectedPills.filter(p => p.status === 'broken').length;

      return {
        normalCount,
        brokenCount,
        processingTime: performance.now() - startTime
      };

    } catch (err) {
      console.error("OpenCV Process Error:", err);
      return {};
    } finally {
      // Clean up ALL OpenCV objects
      if (src) src.delete();
      if (srcRGB) srcRGB.delete();
      if (hsv) hsv.delete();
      if (planes) planes.delete();
      if (s_channel) s_channel.delete();
      if (binary) binary.delete();
      if (kernel) kernel.delete();
      if (opening) opening.delete();
      if (sure_bg) sure_bg.delete();
      if (dist) dist.delete();
      if (sure_fg) sure_fg.delete();
      if (sure_fg_8u) sure_fg_8u.delete();
      if (unknown) unknown.delete();
      if (markers) markers.delete();
      if (ones) ones.delete();
      
      if (tempMask) tempMask.delete();
      if (compareMat) compareMat.delete(); // Clean up compareMat
      if (tempContours) tempContours.delete();
      if (tempHierarchy) tempHierarchy.delete();
    }
  }
}

export const cvService = new CVService();