/* script.js - Aurum Atelier: High-Speed AR & Auto-Try Integration */

const IMAGE_COUNTS = {
  gold_earrings: 5, 
  gold_necklaces: 5,
  diamond_earrings: 5, 
  diamond_necklaces: 6
};

/* DOM Elements */
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const indicatorDot = document.getElementById('indicator-dot');
const indicatorText = document.getElementById('indicator-text');

/* App State */
let earringImg = null, necklaceImg = null, currentType = '';
let isProcessingHand = false;
let isProcessingFace = false;

/* --- Gesture State --- */
let lastGestureTime = 0;
const GESTURE_COOLDOWN = 800; // ms between swipes
let previousHandX = null;     // To track movement

/* --- Try All / Gallery State --- */
let autoTryRunning = false;
let autoSnapshots = [];
let autoTryIndex = 0;
let autoTryTimeout = null;

/* --- Asset Preloading Cache --- */
const preloadedAssets = {};

async function preloadCategory(type) {
  if (preloadedAssets[type]) return; 
  preloadedAssets[type] = [];
  const count = IMAGE_COUNTS[type];
  
  for(let i=1; i<=count; i++) {
    const src = `${type}/${i}.png`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    preloadedAssets[type].push(img);
  }
}

/* --- UI Indicator Helpers --- */
function updateHandIndicator(detected) {
  if (detected) {
    indicatorDot.style.background = "#00ff88"; 
    indicatorText.textContent = "Hand Detected - Swipe to Browse";
  } else {
    indicatorDot.style.background = "#555"; 
    indicatorText.textContent = "Show Hand to Control";
    previousHandX = null; // Reset tracking if hand is lost
  }
}

function flashIndicator(color) {
    indicatorDot.style.background = color;
    setTimeout(() => { 
        indicatorDot.style.background = "#00ff88";
    }, 300);
}

/* ---------- HAND DETECTION (SWIPE LOGIC) ---------- */
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0, 
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((results) => {
  isProcessingHand = false; 
  const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
  updateHandIndicator(hasHand);

  if (!hasHand || autoTryRunning) return;

  // Gesture Logic
  const now = Date.now();
  if (now - lastGestureTime < GESTURE_COOLDOWN) return;

  const landmarks = results.multiHandLandmarks[0];
  const indexTip = landmarks[8]; // Index finger tip
  const currentX = indexTip.x;   // 0.0 (left) to 1.0 (right)

  // We need a previous frame to compare movement
  if (previousHandX !== null) {
      const diff = currentX - previousHandX;
      
      // Threshold: How fast/far you moved since last frame
      // Negative diff = Moving Right (in mirrored selfie view usually)
      // Positive diff = Moving Left
      const SWIPE_THRESHOLD = 0.04; 

      if (diff < -SWIPE_THRESHOLD) { 
        // Swiped Right (Next)
        navigateJewelry(1);
        lastGestureTime = now;
        flashIndicator("#d4af37");
        previousHandX = null; // Reset to require new motion
      } 
      else if (diff > SWIPE_THRESHOLD) { 
        // Swiped Left (Previous)
        navigateJewelry(-1);
        lastGestureTime = now;
        flashIndicator("#d4af37");
        previousHandX = null; // Reset to require new motion
      }
  }

  // Update history only if we didn't just trigger
  if (now - lastGestureTime > 100) {
      previousHandX = currentX;
  }
});

/* ---------- FACE MESH ---------- */
const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({ refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

faceMesh.onResults((results) => {
  isProcessingFace = false;
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
  
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  // Mirror the video to make it feel natural
  canvasCtx.translate(canvasElement.width, 0);
  canvasCtx.scale(-1, 1);
  canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
  
  // Flip back for drawing jewelry correctly if needed, or calculate landmarks mirrored
  // Note: MediaPipe landmarks are normalized. 
  // Let's stick to standard drawing but ensure ears are correct side.

  if (results.multiFaceLandmarks && results.multiFaceLandmarks[0]) {
    const lm = results.multiFaceLandmarks[0];
    
    // Landmarks
    const leftEar = { x: lm[132].x * canvasElement.width, y: lm[132].y * canvasElement.height };
    const rightEar = { x: lm[361].x * canvasElement.width, y: lm[361].y * canvasElement.height };
    const neck = { x: lm[152].x * canvasElement.width, y: lm[152].y * canvasElement.height };
    const earDist = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);

    // Render Earrings
    if (earringImg && earringImg.complete) {
      let ew = earDist * 0.25;
      let eh = (earringImg.height/earringImg.width) * ew;
      canvasCtx.drawImage(earringImg, leftEar.x - ew/2, leftEar.y, ew, eh);
      canvasCtx.drawImage(earringImg, rightEar.x - ew/2, rightEar.y, ew, eh);
    }
    
    // Render Necklace
    if (necklaceImg && necklaceImg.complete) {
      let nw = earDist * 1.2;
      let nh = (necklaceImg.height/necklaceImg.width) * nw;
      canvasCtx.drawImage(necklaceImg, neck.x - nw/2, neck.y + (earDist*0.2), nw, nh);
    }
  }
  canvasCtx.restore();
});

/* ---------- CAMERA & APP INIT ---------- */
async function init() {
  const camera = new Camera(videoElement, {
    onFrame: async () => {
      if (!isProcessingFace) { isProcessingFace = true; await faceMesh.send({image: videoElement}); }
      if (!isProcessingHand) { isProcessingHand = true; await hands.send({image: videoElement}); }
    },
    width: 1280, height: 720
  });
  camera.start();
}

/* ---------- NAVIGATION & SELECTION ---------- */
function navigateJewelry(dir) {
  if (!currentType || !preloadedAssets[currentType]) return;
  
  const list = preloadedAssets[currentType];
  let currentImg = currentType.includes('earrings') ? earringImg : necklaceImg;
  
  let idx = list.indexOf(currentImg);
  let nextIdx = (idx + dir + list.length) % list.length;
  
  const nextItem = list[nextIdx];
  if (currentType.includes('earrings')) earringImg = nextItem;
  else necklaceImg = nextItem;
}

function selectJewelryType(type) {
  currentType = type;
  preloadCategory(type); 
  
  const container = document.getElementById('jewelry-options');
  container.innerHTML = '';
  container.style.display = 'flex';
  
  for(let i=1; i<=IMAGE_COUNTS[type]; i++) {
    const btnImg = new Image();
    btnImg.src = `${type}/${i}.png`;
    btnImg.className = "thumb-btn"; 
    btnImg.onclick = () => {
        const fullImg = preloadedAssets[type][i-1];
        if (type.includes('earrings')) earringImg = fullImg;
        else necklaceImg = fullImg;
    };
    container.appendChild(btnImg);
  }
}

function toggleCategory(cat) {
  document.getElementById('subcategory-buttons').style.display = 'flex';
  const subs = document.querySelectorAll('.subpill');
  subs.forEach(b => b.style.display = b.innerText.toLowerCase().includes(cat) ? 'inline-block' : 'none');
}

/* ---------- TRY ALL (AUTO CAPTURE) ---------- */
async function toggleTryAll() {
  if (!currentType) {
    alert("Please select a sub-category (e.g. Gold Earrings) first!");
    return;
  }
  
  if (autoTryRunning) {
    stopAutoTry();
  } else {
    startAutoTry();
  }
}

function startAutoTry() {
  autoTryRunning = true;
  autoSnapshots = [];
  autoTryIndex = 0;
  
  const btn = document.getElementById('tryall-btn');
  btn.textContent = "STOPPING...";
  btn.classList.add('active');
  
  runAutoStep();
}

function stopAutoTry() {
  autoTryRunning = false;
  if (autoTryTimeout) clearTimeout(autoTryTimeout);
  
  const btn = document.getElementById('tryall-btn');
  btn.textContent = "Try All";
  btn.classList.remove('active');
  
  if (autoSnapshots.length > 0) showGallery();
}

async function runAutoStep() {
  if (!autoTryRunning) return;

  const assets = preloadedAssets[currentType];
  if (!assets || autoTryIndex >= assets.length) {
    stopAutoTry();
    return;
  }

  // Set current jewelry
  const targetImg = assets[autoTryIndex];
  if (currentType.includes('earrings')) earringImg = targetImg;
  else necklaceImg = targetImg;

  // Wait for AR positioning to settle, then snap
  autoTryTimeout = setTimeout(() => {
    captureToGallery();
    autoTryIndex++;
    runAutoStep();
  }, 1500); 
}

function captureToGallery() {
  const dataUrl = canvasElement.toDataURL('image/png');
  autoSnapshots.push(dataUrl);
  
  // Flash Effect
  const flash = document.getElementById('flash-overlay');
  if(flash) {
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 100);
  }
}

/* ---------- GALLERY & LIGHTBOX (ZOOM) ---------- */
function showGallery() {
  const modal = document.getElementById('gallery-modal');
  const grid = document.getElementById('gallery-grid');
  if(!modal || !grid) return;

  grid.innerHTML = '';
  
  // Create Thumbnails
  autoSnapshots.forEach((src, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = "gallery-item-wrapper";
    
    const img = document.createElement('img');
    img.src = src;
    img.className = "gallery-thumb";
    
    // Add Click listener for Lightbox Zoom
    img.onclick = () => openLightbox(src);
    
    wrapper.appendChild(img);
    grid.appendChild(wrapper);
  });
  
  modal.style.display = 'flex';
}

function openLightbox(src) {
    const lightbox = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-image');
    
    lightboxImg.src = src;
    lightbox.style.display = 'flex';
}

function closeLightbox() {
    document.getElementById('lightbox-overlay').style.display = 'none';
}

function closeGallery() {
  document.getElementById('gallery-modal').style.display = 'none';
}

/* ---------- INITIALIZATION ---------- */
window.onload = init;
window.toggleCategory = toggleCategory;
window.selectJewelryType = selectJewelryType;
window.toggleTryAll = toggleTryAll;
window.closeGallery = closeGallery;
window.closeLightbox = closeLightbox;