/* ==========================================
   PHOTOBOX KORAN RETRO - Main Application
   ========================================== */

(function () {
  'use strict';

  // --- CONFIG ---
  const CONFIG = {
    burstCount: 8,           // Number of frames to capture
    gifWidth: 240,
    gifHeight: 320,
    gifQuality: 1,
    gifDelay: 200,           // ms between GIF frames
    grainIntensity: 25,      // noise grain strength
    countdownSeconds: 3,
  };

  // --- DOM ELEMENTS ---
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    camera: $('#screen-camera'),
    processing: $('#screen-processing'),
    result: $('#screen-result'),
  };

  const els = {
    video: $('#webcam'),
    previewCanvas: $('#preview-canvas'),
    countdownOverlay: $('#countdown-overlay'),
    countdownNumber: $('#countdown-number'),
    btnCapture: $('#btn-capture'),
    btnMirror: $('#btn-mirror'),
    gifResult: $('#gif-result'),
    photoLoadingGif: $('#photo-loading-gif'),
    staticPhoto: $('#static-photo'),
    mastheadDate: $('.masthead-date'),
    mastheadDateStatic: $('.masthead-date-static'),
    btnRetake: $('#btn-retake'),
    btnDownloadGif: $('#btn-download-gif'),
    btnDownloadImage: $('#btn-download-image'),
    newspaperGif: $('#newspaper-gif'),
    newspaperStatic: $('#newspaper-static'),
  };

  // --- STATE ---
  let stream = null;
  let capturedFrames = [];
  let generatedGifBlob = null;
  let isCapturing = false;
  let isMirrored = true; // Default: mirror ON (selfie mode)

  // --- INIT ---
  function init() {
    setMastheadDate();
    bindEvents();
    els.btnMirror.classList.add('active'); // Default mirror ON
    startCamera();
  }

  function setMastheadDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('id-ID', options);
    els.mastheadDate.textContent = dateStr;
    els.mastheadDateStatic.textContent = dateStr;
  }

  function bindEvents() {
    els.btnCapture.addEventListener('click', handleCapture);
    els.btnRetake.addEventListener('click', handleRetake);
    els.btnDownloadGif.addEventListener('click', handleDownloadGif);
    els.btnDownloadImage.addEventListener('click', handleDownloadImage);
    els.btnMirror.addEventListener('click', handleMirrorToggle);
  }

  // --- SCREEN MANAGEMENT ---
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo(0, 0);
  }

  // --- CAMERA ---
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      els.video.srcObject = stream;
      await els.video.play();
      applyMirror();
      initPreviewCanvas();
    } catch (err) {
      alert('Tidak dapat mengakses kamera. Pastikan izin kamera telah diberikan.\n\n' + err.message);
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  // --- MIRROR ---
  function applyMirror() {
    if (isMirrored) {
      els.video.classList.add('mirrored');
      els.previewCanvas.classList.add('mirrored');
    } else {
      els.video.classList.remove('mirrored');
      els.previewCanvas.classList.remove('mirrored');
    }
  }

  function handleMirrorToggle() {
    isMirrored = !isMirrored;
    els.btnMirror.classList.toggle('active', isMirrored);
    applyMirror();
  }

  // --- PREVIEW CANVAS (grayscale + grain) ---
  let previewCtx = null;
  let animFrameId = null;

  function initPreviewCanvas() {
    const canvas = els.previewCanvas;
    previewCtx = canvas.getContext('2d', { willReadFrequently: true });
    drawPreviewLoop();
  }

  function drawPreviewLoop() {
    const video = els.video;
    const canvas = els.previewCanvas;
    const ctx = previewCtx;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    function draw() {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Apply grayscale + grain to preview
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyGrayscaleAndGrain(imageData.data, 10); // lighter grain for preview
      ctx.putImageData(imageData, 0, 0);

      animFrameId = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopPreviewLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // --- IMAGE PROCESSING ---
  function applyGrayscaleAndGrain(data, grainAmount) {
    for (let i = 0; i < data.length; i += 4) {
      // Grayscale using luminance
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      // Add grain noise
      const noise = (Math.random() - 0.5) * grainAmount;
      const val = Math.min(255, Math.max(0, gray + noise));
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
  }

  function captureFrame() {
    const video = els.video;
    const w = CONFIG.gifWidth;
    const h = CONFIG.gifHeight;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = w;
    offCanvas.height = h;
    const ctx = offCanvas.getContext('2d');

    // Draw video frame centered and cropped
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    // Apply horizontal flip if mirrored
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Apply grayscale + heavy grain
    const imageData = ctx.getImageData(0, 0, w, h);
    applyGrayscaleAndGrain(imageData.data, CONFIG.grainIntensity);
    ctx.putImageData(imageData, 0, 0);

    return offCanvas;
  }

  // --- COUNTDOWN + BURST CAPTURE (combined) ---
  function countdownWithCapture(seconds, frameCount) {
    return new Promise((resolve) => {
      els.countdownOverlay.classList.remove('hidden');
      let count = seconds;
      const frames = [];
      const totalMs = seconds * 1000;
      const intervalMs = totalMs / frameCount;
      const startTime = Date.now();

      // Capture frames at intervals during countdown
      function captureLoop() {
        const elapsed = Date.now() - startTime;
        const expectedFrames = Math.min(frameCount, Math.floor(elapsed / intervalMs) + 1);

        while (frames.length < expectedFrames) {
          frames.push(captureFrame());
        }

        if (frames.length >= frameCount) {
          resolve(frames);
          return;
        }

        setTimeout(captureLoop, Math.max(10, intervalMs / 2));
      }

      // Update countdown display
      function tick() {
        els.countdownNumber.textContent = count;
        if (count <= 0) {
          els.countdownOverlay.classList.add('hidden');
          return;
        }
        count--;
        setTimeout(tick, 1000);
      }

      tick();
      captureLoop();
    });
  }

  // --- GIF CREATION ---
  function createGif(frames) {
    return new Promise((resolve, reject) => {
      const gif = new GIF({
        workers: 2,
        quality: CONFIG.gifQuality,
        width: CONFIG.gifWidth,
        height: CONFIG.gifHeight,
        workerScript: 'gif.worker.js',
        repeat: 0, // loop forever
      });

      frames.forEach((frame) => {
        gif.addFrame(frame, { delay: CONFIG.gifDelay, copy: true });
      });

      gif.on('finished', function (blob) {
        resolve(blob);
      });

      gif.on('progress', function (p) {
        // Could show progress here
      });

      gif.render();
    });
  }

  // --- EVENT HANDLERS ---
  async function handleCapture() {
    if (isCapturing) return;
    isCapturing = true;
    els.btnCapture.disabled = true;

    try {
      // Countdown + burst capture berjalan bersamaan
      capturedFrames = await countdownWithCapture(CONFIG.countdownSeconds, CONFIG.burstCount);

      // Stop preview to save resources
      stopPreviewLoop();

      // Show processing screen
      showScreen('processing');

      // Create GIF
      generatedGifBlob = await createGif(capturedFrames);

      // Show result
      displayResult();
      showScreen('result');
    } catch (err) {
      console.error('Capture error:', err);
      alert('Terjadi kesalahan saat mengambil foto: ' + err.message);
    } finally {
      isCapturing = false;
      els.btnCapture.disabled = false;
    }
  }

  function displayResult() {
    console.log('displayResult called, gifBlob size:', generatedGifBlob ? generatedGifBlob.size : 'null');

    // Set GIF to animated newspaper
    if (generatedGifBlob && generatedGifBlob.size > 0) {
      const url = URL.createObjectURL(generatedGifBlob);
      els.gifResult.src = url;
      els.gifResult.classList.add('active');
      els.photoLoadingGif.classList.add('hidden');
    } else {
      els.photoLoadingGif.innerHTML = '<span style="color:#c00">Gagal membuat GIF. Coba lagi.</span>';
    }

    // Set static photo (first frame) to static newspaper
    if (capturedFrames.length > 0) {
      const staticCanvas = els.staticPhoto;
      const sourceCanvas = capturedFrames[0];
      staticCanvas.width = sourceCanvas.width;
      staticCanvas.height = sourceCanvas.height;
      staticCanvas.style.width = '100%';
      staticCanvas.style.height = '100%';
      staticCanvas.style.objectFit = 'cover';
      const ctx = staticCanvas.getContext('2d');
      ctx.drawImage(sourceCanvas, 0, 0);
    }
  }

  function handleRetake() {
    // Reset state
    capturedFrames = [];
    generatedGifBlob = null;
    els.gifResult.src = '';
    els.gifResult.classList.remove('active');
    els.photoLoadingGif.classList.remove('hidden');
    els.photoLoadingGif.innerHTML = '<span>MEMUAT FOTO...</span>';

    // Clear static photo
    const ctx = els.staticPhoto.getContext('2d');
    ctx.clearRect(0, 0, els.staticPhoto.width, els.staticPhoto.height);

    // Restart camera
    startCamera();
    showScreen('camera');
  }

  function handleDownloadGif() {
    if (!generatedGifBlob) return;
    const url = URL.createObjectURL(generatedGifBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'si-paling-blok-m-photo.gif';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleDownloadImage() {
    const newspaper = els.newspaperStatic;

    try {
      // Temporarily remove transform scaling for accurate capture
      const originalTransform = newspaper.style.transform;
      newspaper.style.transform = 'none';

      const canvas = await html2canvas(newspaper, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f5f0e8',
        logging: false,
      });

      // Restore transform
      newspaper.style.transform = originalTransform;

      canvas.toBlob(function (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'si-paling-blok-m-koran.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (err) {
      console.error('Download error:', err);
      alert('Gagal mengunduh gambar koran.');
    }
  }

  // --- START ---
  document.addEventListener('DOMContentLoaded', init);
})();
