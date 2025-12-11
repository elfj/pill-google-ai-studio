import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Play, Square, Activity, Clock, Cpu, Settings, Layers, Lightbulb, Sun, Contrast } from 'lucide-react';
import { cvService } from './services/cvService';
import { AnalysisStats } from './types';

const App: React.FC = () => {
  // State
  const [cvReady, setCvReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Settings
  const [fpsTarget, setFpsTarget] = useState(1);
  const [gamma, setGamma] = useState(1.5);    // Default 1.5 (Darkens highlights)
  const [contrast, setContrast] = useState(1.0); // Default 1.0 (Normal)

  const [stats, setStats] = useState<AnalysisStats>({
    totalCount: 0,
    clusters: [],
    processingTime: 0,
    fps: 0,
    status: '等待系統初始化...'
  });

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(0);

  // Initialize OpenCV
  useEffect(() => {
    const checkCv = setInterval(() => {
      if (cvService.isReady()) {
        setCvReady(true);
        setStats(s => ({ ...s, status: 'OpenCV 視覺引擎已就緒' }));
        clearInterval(checkCv);
      }
    }, 500);
    return () => clearInterval(checkCv);
  }, []);

  // Camera Control
  const startCamera = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'environment',
          // @ts-ignore
          exposureMode: 'continuous', 
          // @ts-ignore
          whiteBalanceMode: 'continuous' 
        } 
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraActive(true);
          setStats(s => ({ ...s, status: '相機已啟動' }));
          
          if (canvasRef.current && videoRef.current) {
             canvasRef.current.width = 640;
             canvasRef.current.height = 480;
          }
        };
      }
    } catch (err) {
      console.error("Camera Error", err);
      // Fallback
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
             videoRef.current.srcObject = stream;
             videoRef.current.play();
             setCameraActive(true);
          }
      } catch (e) {
         setStats(s => ({ ...s, status: '相機啟動失敗: 請確認權限' }));
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setCameraActive(false);
      setIsAnalyzing(false);
      setStats(s => ({ ...s, status: '相機已停止' }));
    }
  };

  // Analysis Loop
  const processLoop = useCallback((timestamp: number) => {
    if (!isAnalyzing || !videoRef.current || !canvasRef.current) {
       // Pass-through view if analyzing is off
       if (cameraActive && videoRef.current && canvasRef.current) {
           const ctx = canvasRef.current.getContext('2d');
           // Draw video directly if not analyzing, but maybe we want to show preview of gamma?
           // For now, raw video in preview mode is safer.
           ctx?.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
       }
       requestRef.current = requestAnimationFrame(processLoop);
       return;
    }

    const interval = 1000 / fpsTarget;
    const elapsed = timestamp - lastFrameTimeRef.current;

    if (elapsed > interval) {
      lastFrameTimeRef.current = timestamp - (elapsed % interval);
      
      const width = canvasRef.current.width;
      const height = canvasRef.current.height;
      
      const result = cvService.processFrame(
          videoRef.current, 
          canvasRef.current, 
          width, 
          height, 
          gamma, 
          contrast
      );
      
      frameCountRef.current++;
      if (timestamp - lastFpsUpdateRef.current >= 1000) {
        const currentFps = frameCountRef.current;
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = timestamp;
        
        setStats(prev => ({
          ...prev,
          totalCount: result.totalCount ?? 0,
          clusters: result.clusters ?? [],
          processingTime: Math.round(result.processingTime ?? 0),
          fps: currentFps,
          status: 'AI 分析中'
        }));
      }
    }

    requestRef.current = requestAnimationFrame(processLoop);
  }, [isAnalyzing, fpsTarget, cameraActive, gamma, contrast]); // Depend on gamma/contrast

  useEffect(() => {
    requestRef.current = requestAnimationFrame(processLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [processLoop]);

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
      {/* Left Panel: Display */}
      <div className="w-full md:w-[70%] h-[60vh] md:h-full relative bg-black flex items-center justify-center border-b md:border-b-0 md:border-r border-gray-700 shadow-xl">
        {!cvReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-50">
            <div className="text-xl animate-pulse text-blue-400 font-bold tracking-wider">正在載入 OpenCV 電腦視覺核心...</div>
          </div>
        )}
        
        <video 
          ref={videoRef} 
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none" 
          playsInline 
          muted 
        />
        
        <canvas 
          ref={canvasRef} 
          className="absolute z-10 block max-w-full max-h-full shadow-lg border border-gray-800"
        />
        
        {!cameraActive && (
          <div className="z-20 text-gray-500 flex flex-col items-center">
            <Camera size={64} className="mb-4 opacity-50" />
            <p className="text-lg">請啟動相機開始</p>
          </div>
        )}
      </div>

      {/* Right Panel: Controls */}
      <div className="w-full md:w-[30%] h-[40vh] md:h-full bg-gray-900 p-6 flex flex-col justify-between overflow-y-auto">
        
        <div>
          <header className="mb-4 border-b border-gray-700 pb-4">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="text-blue-500" />
              PillVision Pro <span className="text-xs bg-purple-600 px-2 py-0.5 rounded text-white ml-2">v9.6</span>
            </h1>
          </header>
          
          <div className="bg-yellow-900/30 border border-yellow-800 p-3 rounded mb-4">
             <div className="flex items-center gap-2 text-yellow-500 font-bold text-sm mb-1">
                 <Lightbulb size={14} /> 影像優化建議
             </div>
             <p className="text-xs text-yellow-200/80 leading-relaxed">
                 若藥丸過亮，請將 Gamma 調大 (>1.0) 以恢復細節。<br/>
                 若對比不夠，請提高對比度 (>1.0)。
             </p>
          </div>

          {/* Settings Group */}
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 space-y-4 mb-4">
              
              {/* FPS */}
              <div>
                <label className="flex justify-between text-sm text-gray-300 mb-1">
                    <span className="flex items-center gap-2"><Settings size={14}/> 分析頻率</span>
                    <span className="font-mono text-blue-400">{fpsTarget} FPS</span>
                </label>
                <input 
                type="range" min="1" max="5" step="1" 
                value={fpsTarget} onChange={(e) => setFpsTarget(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              {/* Gamma */}
              <div>
                <label className="flex justify-between text-sm text-gray-300 mb-1">
                    <span className="flex items-center gap-2"><Sun size={14}/> 曝光修正 (Gamma)</span>
                    <span className="font-mono text-yellow-400">{gamma.toFixed(1)}</span>
                </label>
                <input 
                type="range" min="0.5" max="3.0" step="0.1" 
                value={gamma} onChange={(e) => setGamma(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
              </div>

              {/* Contrast */}
              <div>
                <label className="flex justify-between text-sm text-gray-300 mb-1">
                    <span className="flex items-center gap-2"><Contrast size={14}/> 對比度 (Contrast)</span>
                    <span className="font-mono text-green-400">{contrast.toFixed(1)}</span>
                </label>
                <input 
                type="range" min="0.5" max="2.0" step="0.1" 
                value={contrast} onChange={(e) => setContrast(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                />
              </div>
          </div>

          {/* Dynamic Cluster List */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-3">
               <h3 className="text-sm uppercase tracking-wider text-gray-400 flex items-center gap-2">
                 <Layers size={14} /> 分群結果
               </h3>
               <span className="text-xs text-gray-500">總數: {stats.totalCount}</span>
            </div>
            
            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
               {stats.clusters.length === 0 && (
                 <div className="text-gray-600 text-sm text-center py-4 border border-gray-800 rounded border-dashed">
                   尚未偵測到藥物
                 </div>
               )}
               
               {stats.clusters.map((cluster) => (
                 <div key={cluster.label} className="flex justify-between items-center bg-gray-800 p-3 rounded-lg border-l-4" style={{ borderLeftColor: cluster.color }}>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cluster.color }}></div>
                        <span className="font-bold text-white">{cluster.label}</span>
                    </div>
                    <span className="font-mono text-xl font-bold text-gray-200">{cluster.count}</span>
                 </div>
               ))}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
             <button 
                onClick={cameraActive ? stopCamera : startCamera}
                disabled={!cvReady}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
                  cameraActive 
                    ? "bg-gray-700 hover:bg-gray-600 text-white" 
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
             >
                <Camera size={18} />
                {cameraActive ? "關閉相機" : "啟動相機"}
             </button>
             
             {isAnalyzing ? (
               <button 
                  onClick={() => setIsAnalyzing(false)}
                  className="flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50 transition-all"
               >
                  <Square size={18} fill="currentColor" />
                  停止分析
               </button>
             ) : (
               <button 
                  onClick={() => setIsAnalyzing(true)}
                  disabled={!cameraActive}
                  className="flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  <Play size={18} fill="currentColor" />
                  開始分析
               </button>
             )}
          </div>
          
          <div className="flex justify-between text-xs text-gray-500 px-1">
             <span className="flex items-center gap-1"><Clock size={10}/> {stats.processingTime}ms</span>
             <span className="flex items-center gap-1"><Cpu size={10}/> {stats.fps}FPS</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;