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

  function handleDownloadImage() {
    try {
      const canvas = renderNewspaperToCanvas();
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'si-paling-blok-m-koran.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
      alert('Gagal mengunduh gambar koran.');
    }
  }

  function renderNewspaperToCanvas() {
    const W = 780;
    const pad = 35;
    const contentW = W - pad * 2;
    const scale = 2; // retina
    let y = 0;

    // First pass: calculate total height
    const lineH = 22;
    const articleLines = [
      'DALAM era digital yang serba cepat ini, seni fotografi kembali menemukan ruangnya di kalangan anak muda Jakarta. Fenomena Photobox Koran Retro menjadi bukti bahwa nostalgia akan masa lalu tidak pernah benar-benar pudar dari ingatan kolektif kita.',
      'Blok M, sebagai jantung kegiatan sosial Jakarta Selatan, telah lama menjadi saksi bisu perkembangan tren anak muda. Dari zaman kaset pita hingga era digital, kawasan ini terus berevolusi menjadi tempat pertemuan budaya pop dan tradisi.',
      '"Kami ingin menghadirkan sesuatu yang berbeda," ujar seorang pengembang aplikasi ini. "Menggabungkan teknologi modern dengan estetika koran vintage menciptakan pengalaman yang unik dan tak terlupakan."',
    ];

    // Calculate heights
    const mastheadH = 120;
    const headlineH = 70;
    const photoH = Math.round(contentW * 0.5 * 0.75); // main article area photo
    const captionH = 45;
    const articleTextH = articleLines.length * 60 + 40;
    const sidebarH = 350;
    const mainArticleH = photoH + captionH + articleTextH;
    const contentH = Math.max(mainArticleH, sidebarH);
    const footerH = 50;
    const totalH = mastheadH + headlineH + contentH + footerH + 20;

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // === BACKGROUND ===
    ctx.fillStyle = '#f5f0e8';
    ctx.fillRect(0, 0, W, totalH);

    // Grain texture
    for (let i = 0; i < W * totalH * 0.005; i++) {
      const gx = Math.random() * W;
      const gy = Math.random() * totalH;
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`;
      ctx.fillRect(gx, gy, 1, 1);
    }

    // === MASTHEAD ===
    // Top rule
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(pad, 10, contentW, 4);

    // Top info
    ctx.font = '12px Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    const dateStr = new Date().toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    ctx.textAlign = 'left';
    ctx.fillText('Edisi Spesial', pad, 32);
    ctx.textAlign = 'center';
    ctx.fillText(dateStr, W / 2, 32);
    ctx.textAlign = 'right';
    ctx.fillText('Rp 5.000', W - pad, 32);
    ctx.textAlign = 'left';

    // Title
    ctx.font = '52px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.fillText('SI PALING BLOK M', W / 2, 82);
    ctx.textAlign = 'left';

    // Tagline
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.textAlign = 'center';
    ctx.fillText('~ Harian Paling Gaul Se-Jakarta Selatan ~', W / 2, 100);
    ctx.textAlign = 'left';

    // Bottom rule
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(pad, 110, contentW, 3);

    y = 125;

    // === HEADLINE ===
    ctx.font = 'bold 22px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.fillText('POTRET DIRI DI TENGAH HIRUK PIKUK KOTA', W / 2, y + 20);

    ctx.font = 'italic 14px Georgia, serif';
    ctx.fillStyle = '#3a3a3a';
    ctx.fillText('Sebuah Eksperimen Fotografi Digital yang Menangkap Jiwa Masa Kini', W / 2, y + 42);
    ctx.textAlign = 'left';

    // Divider
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(pad, y + 55, contentW, 1);

    y = y + 65;

    // === CONTENT GRID ===
    const mainW = contentW - 250;
    const sideX = pad + mainW + 20;

    // --- MAIN ARTICLE ---
    // Photo
    const photoY = y;
    const photoW = mainW;
    const photoHH = Math.round(photoW * 0.75);

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, photoY, photoW, photoHH);

    // Draw captured photo
    if (capturedFrames.length > 0) {
      const src = capturedFrames[0];
      ctx.drawImage(src, pad + 1, photoY + 1, photoW - 2, photoHH - 2);
    } else {
      ctx.fillStyle = '#d0c8b8';
      ctx.fillRect(pad + 1, photoY + 1, photoW - 2, photoHH - 2);
    }

    // Caption
    const capY = photoY + photoHH + 12;
    ctx.font = 'italic 11px Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText('Fig. 1 \u2014 Potret eksklusif yang diambil secara langsung', pad, capY);
    ctx.fillText('menggunakan teknologi Photobox Retro.', pad, capY + 14);

    // Article text
    let artY = capY + 40;
    ctx.font = '14px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';

    articleLines.forEach((line) => {
      // Drop cap
      ctx.font = 'bold 40px Georgia, serif';
      ctx.fillText(line[0], pad, artY);
      ctx.font = '14px Georgia, serif';
      // Wrap remaining text
      const remaining = line.substring(1);
      const words = remaining.split(' ');
      let lineText = '';
      let lineNum = 0;
      const maxTextW = mainW - 25;

      words.forEach((word) => {
        const test = lineText + word + ' ';
        if (ctx.measureText(test).width > maxTextW && lineText.length > 0) {
          ctx.fillText(lineText, pad + 22, artY + lineNum * 20);
          lineText = word + ' ';
          lineNum++;
        } else {
          lineText = test;
        }
      });
      if (lineText.length > 0) {
        ctx.fillText(lineText, pad + 22, artY + lineNum * 20);
      }
      artY += (lineNum + 1) * 20 + 16;
    });

    // --- SIDEBAR ---
    let sideY = y;

    // Tips
    ctx.font = 'bold 12px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('TIPS FOTO RETRO', sideX, sideY);
    sideY += 5;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(sideX, sideY, 210, 2);
    sideY += 18;

    const tips = [
      '1. Pastikan pencahayaan cukup terang',
      '2. Pose dengan percaya diri',
      '3. Gunakan latar belakang sederhana',
      '4. Ekspresikan diri sebebas mungkin',
      '5. Hasil terbaik dalam cahaya alami',
    ];
    ctx.font = '12px Georgia, serif';
    ctx.fillStyle = '#3a3a3a';
    tips.forEach((tip) => {
      ctx.fillText(tip, sideX, sideY);
      sideY += 20;
    });

    sideY += 15;

    // Iklan
    ctx.font = 'bold 12px Georgia, serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('IKLAN BARIS', sideX, sideY);
    sideY += 5;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(sideX, sideY, 210, 2);
    sideY += 18;

    const ads = [
      'DIJUAL: Kamera Polaroid vintage',
      'kondisi mulus. Hub: 0812-XXXX-XXXX',
      '',
      'CARI KAWAN: Komunitas fotografi',
      'film Jakarta. CP: @jakarta_filmcam',
      '',
      'SEWA STUDIO: Foto retro murah',
      'meriah. Jl. Blok M No. 42',
    ];
    ctx.font = '11px Georgia, serif';
    ctx.fillStyle = '#3a3a3a';
    ads.forEach((ad) => {
      if (ad.length > 0) ctx.fillText(ad, sideX, sideY);
      sideY += 16;
    });

    sideY += 15;

    // Quote box
    ctx.fillStyle = '#e8dfd3';
    ctx.fillRect(sideX - 5, sideY, 220, 80);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(sideX - 5, sideY, 220, 80);

    ctx.font = 'italic 11px Georgia, serif';
    ctx.fillStyle = '#3a3a3a';
    wrapText(ctx, '"Hidup itu seperti kamera, fokus pada apa yang penting, tangkap momen terbaik."', sideX, sideY + 18, 200, 16);

    ctx.font = '10px Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.fillText('~ Anonim, Pengunjung Blok M', sideX, sideY + 70);

    // === FOOTER ===
    const footerY = totalH - 40;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(pad, footerY, contentW, 3);

    ctx.font = '11px Georgia, serif';
    ctx.fillStyle = '#6b6b6b';
    ctx.textAlign = 'left';
    ctx.fillText('Halaman 1 dari 1', pad, footerY + 20);
    ctx.textAlign = 'center';
    ctx.fillText('SI PALING BLOK M \u00A9 2026', W / 2, footerY + 20);
    ctx.textAlign = 'right';
    ctx.fillText('Dicetak di Jakarta Selatan', W - pad, footerY + 20);
    ctx.textAlign = 'left';

    return canvas;
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    words.forEach((word) => {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        ctx.fillText(line, x, currentY);
        line = word + ' ';
        currentY += lineH;
      } else {
        line = test;
      }
    });
    if (line.length > 0) ctx.fillText(line, x, currentY);
  }

  // --- START ---
  document.addEventListener('DOMContentLoaded', init);
})();
