import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Play, Square, Activity, AlertTriangle, Clock, Cpu, Settings, CheckCircle } from 'lucide-react';
import { cvService } from './services/cvService';
import { AnalysisStats } from './types';

const App: React.FC = () => {
  // State
  const [cvReady, setCvReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fpsTarget, setFpsTarget] = useState(2);
  const [stats, setStats] = useState<AnalysisStats>({
    normalCount: 0,
    brokenCount: 0,
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
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          facingMode: 'environment'
        } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraActive(true);
          setStats(s => ({ ...s, status: '相機已啟動 - 等待分析' }));
          
          if (canvasRef.current && videoRef.current) {
             canvasRef.current.width = 640;
             canvasRef.current.height = 480;
          }
        };
      }
    } catch (err) {
      console.error("Camera Error", err);
      setStats(s => ({ ...s, status: '相機啟動失敗' }));
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
      
      const result = cvService.processFrame(videoRef.current, canvasRef.current, width, height);
      
      frameCountRef.current++;
      if (timestamp - lastFpsUpdateRef.current >= 1000) {
        const currentFps = frameCountRef.current;
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = timestamp;
        
        setStats(prev => ({
          ...prev,
          normalCount: result.normalCount ?? 0,
          brokenCount: result.brokenCount ?? 0,
          processingTime: Math.round(result.processingTime ?? 0),
          fps: currentFps,
          status: '分析進行中 (HSV+Watershed)'
        }));
      }
    }

    requestRef.current = requestAnimationFrame(processLoop);
  }, [isAnalyzing, fpsTarget, cameraActive]);

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
            <p className="text-lg">請啟動相機開始 (HSV Saturation Mode)</p>
          </div>
        )}
      </div>

      {/* Right Panel: Controls */}
      <div className="w-full md:w-[30%] h-[40vh] md:h-full bg-gray-900 p-6 flex flex-col justify-between overflow-y-auto">
        
        <div>
          <header className="mb-8 border-b border-gray-700 pb-4">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="text-blue-500" />
              PillVision Pro <span className="text-xs bg-purple-600 px-2 py-0.5 rounded text-white ml-2">v4.0</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">HSV 分水嶺演算法 | 黃色藥錠專用</p>
          </header>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-green-500 transition-colors">
              <div className="text-gray-400 text-xs mb-1 uppercase tracking-wider flex items-center gap-1">
                 <CheckCircle size={12} className="text-green-500" /> 正常藥錠
              </div>
              <div className="text-3xl font-mono font-bold text-green-400">{stats.normalCount}</div>
            </div>
            
            <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-orange-500 transition-colors">
              <div className="text-gray-400 text-xs mb-1 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle size={12} className="text-orange-500" /> 異常/碎片
              </div>
              <div className="text-3xl font-mono font-bold text-orange-500">
                {stats.brokenCount}
              </div>
            </div>

            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
              <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                <Clock size={12} /> 處理時間
              </div>
              <div className="text-xl font-mono text-yellow-400">{stats.processingTime} ms</div>
            </div>

            <div className="bg-gray-800 p-3 rounded-lg border border-gray-700">
              <div className="text-gray-400 text-xs mb-1 flex items-center gap-1">
                <Cpu size={12} /> FPS
              </div>
              <div className="text-xl font-mono text-cyan-400">{stats.fps}</div>
            </div>
          </div>
          
          <div className="bg-black/30 p-3 rounded border border-gray-800 mb-6">
            <div className="text-xs text-gray-500 mb-1">系統狀態</div>
            <div className="text-sm text-green-400 font-mono animate-pulse">{stats.status}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4">
          
          <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
             <label className="flex justify-between text-sm text-gray-300 mb-2">
                <span className="flex items-center gap-2"><Settings size={14}/> 分析頻率 (FPS)</span>
                <span className="font-mono text-blue-400">{fpsTarget} FPS</span>
             </label>
             <input 
               type="range" 
               min="1" 
               max="5" 
               step="1" 
               value={fpsTarget}
               onChange={(e) => setFpsTarget(parseInt(e.target.value))}
               className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
             />
             <div className="flex justify-between text-xs text-gray-500 mt-1">
               <span>省電 (1)</span>
               <span>即時 (5)</span>
             </div>
          </div>

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
        </div>
      </div>
    </div>
  );
};

export default App;