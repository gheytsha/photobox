/* ==========================================
   PHOTOBOX KORAN RETRO - Main Application
   ========================================== */

(function () {
  'use strict';

  // --- CONFIG ---
  const CONFIG = {
    burstCount: 8,           // Number of frames to capture
    burstInterval: 120,      // ms between burst frames
    gifWidth: 480,
    gifHeight: 640,
    gifQuality: 10,          // 1=best, 30=fastest
    gifDelay: 150,           // ms between GIF frames
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
    burstProgress: $('#burst-progress'),
    progressFill: $('#progress-fill'),
    progressText: $('#progress-text'),
    btnCapture: $('#btn-capture'),
    gifResult: $('#gif-result'),
    photoLoading: $('#photo-loading'),
    mastheadDate: $('.masthead-date'),
    btnRetake: $('#btn-retake'),
    btnDownloadGif: $('#btn-download-gif'),
    btnDownloadImage: $('#btn-download-image'),
  };

  // --- STATE ---
  let stream = null;
  let capturedFrames = [];
  let generatedGifBlob = null;
  let isCapturing = false;

  // --- INIT ---
  function init() {
    setMastheadDate();
    bindEvents();
    startCamera();
  }

  function setMastheadDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('id-ID', options);
    els.mastheadDate.textContent = dateStr;
  }

  function bindEvents() {
    els.btnCapture.addEventListener('click', handleCapture);
    els.btnRetake.addEventListener('click', handleRetake);
    els.btnDownloadGif.addEventListener('click', handleDownloadGif);
    els.btnDownloadImage.addEventListener('click', handleDownloadImage);
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

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

    // Apply grayscale + heavy grain
    const imageData = ctx.getImageData(0, 0, w, h);
    applyGrayscaleAndGrain(imageData.data, CONFIG.grainIntensity);
    ctx.putImageData(imageData, 0, 0);

    return offCanvas;
  }

  // --- COUNTDOWN ---
  function countdown(seconds) {
    return new Promise((resolve) => {
      els.countdownOverlay.classList.remove('hidden');
      let count = seconds;

      function tick() {
        els.countdownNumber.textContent = count;
        if (count <= 0) {
          els.countdownOverlay.classList.add('hidden');
          resolve();
          return;
        }
        count--;
        setTimeout(tick, 1000);
      }
      tick();
    });
  }

  // --- BURST CAPTURE ---
  function burstCapture() {
    return new Promise((resolve) => {
      const frames = [];
      let captured = 0;

      els.burstProgress.classList.remove('hidden');
      els.progressFill.style.width = '0%';

      function captureNext() {
        if (captured >= CONFIG.burstCount) {
          els.burstProgress.classList.add('hidden');
          resolve(frames);
          return;
        }

        const frame = captureFrame();
        frames.push(frame);
        captured++;

        const pct = (captured / CONFIG.burstCount) * 100;
        els.progressFill.style.width = pct + '%';
        els.progressText.textContent = captured + '/' + CONFIG.burstCount + ' frames';

        setTimeout(captureNext, CONFIG.burstInterval);
      }

      captureNext();
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
      // Countdown
      await countdown(CONFIG.countdownSeconds);

      // Burst capture
      capturedFrames = await burstCapture();

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
    if (generatedGifBlob) {
      const url = URL.createObjectURL(generatedGifBlob);
      els.gifResult.src = url;
      els.gifResult.classList.add('active');
      els.photoLoading.classList.add('hidden');
    }
  }

  function handleRetake() {
    // Reset state
    capturedFrames = [];
    generatedGifBlob = null;
    els.gifResult.src = '';
    els.gifResult.classList.remove('active');
    els.photoLoading.classList.remove('hidden');

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
    const newspaper = document.getElementById('newspaper');

    try {
      const canvas = await captureElementAsImage(newspaper);
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

  // --- SIMPLE ELEMENT CAPTURE ---
  // A lightweight alternative to html2canvas
  function captureElementAsImage(element) {
    return new Promise((resolve) => {
      // Create a canvas that matches the element
      const rect = element.getBoundingClientRect();
      const scale = 2; // 2x for retina
      const canvas = document.createElement('canvas');
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      // Fill background
      ctx.fillStyle = '#f5f0e8';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Draw text representation
      // Since full DOM-to-canvas is complex without html2canvas,
      // we'll draw a simplified version
      drawNewspaperToCanvas(ctx, rect.width, rect.height);

      resolve(canvas);
    });
  }

  function drawNewspaperToCanvas(ctx, w, h) {
    // Background
    ctx.fillStyle = '#f5f0e8';
    ctx.fillRect(0, 0, w, h);

    // Add grain texture
    for (let i = 0; i < w * h * 0.01; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const alpha = Math.random() * 0.03;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Rules
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(30, 20, w - 60, 3);

    // Date
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    ctx.font = '11px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText('Edisi Spesial', 35, 50);
    ctx.fillText(dateStr, w / 2 - 60, 50);
    ctx.fillText('Rp 5.000', w - 90, 50);

    // Masthead title
    ctx.font = '42px "Playfair Display", Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.fillText('SI PALING BLOK M', w / 2, 90);
    ctx.textAlign = 'left';

    // Tagline
    ctx.font = 'italic 12px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.textAlign = 'center';
    ctx.fillText('~ Harian Paling Gaul Se-Jakarta Selatan ~', w / 2, 110);
    ctx.textAlign = 'left';

    // Rule below masthead
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(30, 120, w - 60, 3);

    // Headline
    ctx.font = '900 20px "Playfair Display", Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.fillText('POTRET DIRI DI TENGAH HIRUK PIKUK KOTA', w / 2, 150);
    ctx.textAlign = 'left';

    // Subheadline
    ctx.font = 'italic 13px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#3a3a3a';
    ctx.textAlign = 'center';
    ctx.fillText('Sebuah Eksperimen Fotografi Digital yang Menangkap Jiwa Masa Kini', w / 2, 170);
    ctx.textAlign = 'left';

    // Divider
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(30, 180, w - 60, 1);

    // Photo area - draw the GIF as static image
    const photoY = 195;
    const photoW = w - 60;
    const photoH = photoW * 0.75;
    ctx.fillStyle = '#d0c8b8';
    ctx.fillRect(30, photoY, photoW, photoH);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.strokeRect(30, photoY, photoW, photoH);

    // Draw the captured frame if available
    if (capturedFrames.length > 0) {
      try {
        const frameCanvas = capturedFrames[0];
        ctx.drawImage(frameCanvas, 32, photoY + 2, photoW - 4, photoH - 4);
      } catch (e) {
        // fallback: leave placeholder
      }
    }

    // Caption
    const captionY = photoY + photoH + 15;
    ctx.font = 'italic 10px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText('Fig. 1 — Potret eksklusif yang diambil secara langsung menggunakan teknologi Photobox Retro.', 35, captionY);

    // Article text (simplified)
    const articleY = captionY + 25;
    ctx.font = '13px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#1a1a1a';

    const lines = [
      'DALAM era digital yang serba cepat ini, seni fotografi kembali menemukan ruangnya',
      'di kalangan anak muda Jakarta. Fenomena Photobox Koran Retro menjadi bukti bahwa',
      'nostalgia akan masa lalu tidak pernah benar-benar pudar dari ingatan kolektif kita.',
      '',
      'Blok M, sebagai jantung kegiatan sosial Jakarta Selatan, telah lama menjadi saksi',
      'bisu perkembangan tren anak muda. Dari zaman kaset pita hingga era digital, kawasan',
      'ini terus berevolusi menjadi tempat pertemuan budaya pop dan tradisi.',
    ];

    lines.forEach((line, i) => {
      if (i === 0) {
        // Drop cap
        ctx.font = '900 36px "Playfair Display", Georgia, serif';
        ctx.fillText('D', 35, articleY + i * 18);
        ctx.font = '13px "EB Garamond", Georgia, serif';
        ctx.fillText(line.substring(1), 55, articleY + i * 18);
      } else {
        ctx.fillText(line, 35, articleY + i * 18);
      }
    });

    // Footer
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(30, h - 40, w - 60, 3);
    ctx.font = '10px "EB Garamond", Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText('Halaman 1 dari 1', 35, h - 20);
    ctx.textAlign = 'center';
    ctx.fillText('SI PALING BLOK M © 2026', w / 2, h - 20);
    ctx.textAlign = 'right';
    ctx.fillText('Dicetak di Jakarta Selatan', w - 35, h - 20);
    ctx.textAlign = 'left';
  }

  // --- START ---
  document.addEventListener('DOMContentLoaded', init);
})();
