const state = {
  watchId: null,
  destination: null,
  threshold: 500,
  tracking: false,
  alarmActive: false,
  alarmTriggered: false,
  vibrateInterval: null,
};

let audioContext, beepInterval, vibrationInterval;

const elements = {
  destinationForm: document.getElementById('destinationForm'),
  destinationInput: document.getElementById('destinationInput'),
  thresholdSelect: document.getElementById('thresholdSelect'),
  setDestinationBtn: document.getElementById('setDestinationBtn'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  trackingStatus: document.getElementById('trackingStatus'),
  distanceText: document.getElementById('distanceText'),
  destinationNameText: document.getElementById('destinationNameText'),
  notesBlock: document.getElementById('notesBlock'),
  alarmOverlay: document.getElementById('alarmOverlay'),
  dismissAlarmBtn: document.getElementById('dismissAlarmBtn'),
  darkModeToggle: document.getElementById('darkModeToggle'),
  mapPlaceholder: document.getElementById('mapPlaceholder'),
  alarmCountDisplay: document.getElementById('alarmCountDisplay'),
};

const app = {
  init() {
    this.bindEvents();
    this.updateStatus();
    this.applySystemTheme();
    this.initAlarmCounter();
  },

  bindEvents() {
    elements.destinationForm.addEventListener('submit', this.onSetDestination.bind(this));
    elements.startBtn.addEventListener('click', this.onStartTracking.bind(this));
    elements.stopBtn.addEventListener('click', this.onStopTracking.bind(this));
    elements.dismissAlarmBtn.addEventListener('click', this.dismissAlarm.bind(this));
    elements.darkModeToggle.addEventListener('click', this.toggleDarkMode.bind(this));
    elements.thresholdSelect.addEventListener('change', this.onThresholdChange.bind(this));
  },

  updateSelectedDestination() {
    elements.destinationNameText.textContent = state.destination ? state.destination.name : 'No destination selected';
  },

  applySystemTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (!localStorage.getItem('smartTravelAlarmTheme')) {
      document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
    } else {
      document.documentElement.dataset.theme = localStorage.getItem('smartTravelAlarmTheme');
    }
    this.updateThemeIcon();
  },

  initAlarmCounter() {
    const alarmCount = parseInt(localStorage.getItem('alarmCount') || '0', 10);
    elements.alarmCountDisplay.textContent = `🔔 Users Helped: ${alarmCount}`;
  },

  updateThemeIcon() {
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    elements.darkModeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  },

  toggleDarkMode() {
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem('smartTravelAlarmTheme', nextTheme);
    this.updateThemeIcon();
  },

  onThresholdChange(event) {
    state.threshold = Number(event.target.value);
  },

  async onSetDestination(event) {
    event.preventDefault();
    const name = elements.destinationInput.value.trim();
    if (!name) {
      this.showNote('Please enter a destination name before starting tracking.');
      return;
    }

    // Track destination set event
    if (typeof gtag !== 'undefined') {
      gtag('event', 'destination_set');
    }

    this.showNote('Acquiring current location to set a destination...');

    let coordinates = { lat: 37.7749, lon: -122.4194 };
    if (navigator.geolocation) {
      try {
        const position = await this.getCurrentPositionAsync();
        coordinates = {
          lat: position.coords.latitude + 0.0012,
          lon: position.coords.longitude + 0.0012,
        };
      } catch (error) {
        console.warn('Could not read current position, using fallback destination coordinates.', error);
      }
    } else {
      console.warn('Geolocation is not available; using fallback destination coordinates.');
    }

    state.destination = {
      name,
      coordinates,
    };

    this.updateSelectedDestination();
    this.showNote(`Destination set: ${name}. Ready to start tracking.`);
  },

  getCurrentPositionAsync() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 2000,
        }
      );
    });
  },

  onStartTracking() {
    if (!state.destination) {
      this.showNote('Set your destination first.');
      return;
    }

    // Track start tracking event
    if (typeof gtag !== 'undefined') {
      gtag('event', 'start_tracking_clicked');
    }

    if (!state.destination.coordinates) {
      this.showNote('Waiting for destination coordinates. Please try again in a moment.');
      return;
    }

    if (!navigator.geolocation) {
      this.showNote('Geolocation is not supported by your browser.');
      return;
    }

    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    state.tracking = true;
    state.alarmTriggered = false;
    this.updateStatus();

    this.showNote('Requesting location permission. Please allow access to start tracking.');

    state.watchId = navigator.geolocation.watchPosition(
      this.onLocationUpdate.bind(this),
      this.onLocationError.bind(this),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 11000,
      }
    );
  },

  onStopTracking() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }

    this.stopAlarm();

    state.tracking = false;
    state.alarmTriggered = false;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    this.showNote('Tracking stopped. You can restart anytime.');
    this.updateStatus();
  },

  onLocationUpdate(position) {
    const { latitude, longitude } = position.coords;
    const currentCoordinates = { lat: latitude, lon: longitude };
    const destinationCoordinates = state.destination.coordinates;

    const remaining = this.calculateDistance(currentCoordinates, destinationCoordinates);
    elements.distanceText.textContent = this.formatDistance(remaining);
    this.updateStatusCards();
    this.updateMapPreview(currentCoordinates, destinationCoordinates);

    if (remaining <= state.threshold && state.tracking && !state.alarmTriggered) {
      this.triggerAlarm();
    }
  },

  calculateDistance(current, destination) {
    if (!destination) return Infinity;
    const toRad = degrees => degrees * (Math.PI / 180);
    const lat1 = current.lat;
    const lon1 = current.lon;
    const lat2 = destination.lat;
    const lon2 = destination.lon;

    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },


  formatDistance(meters) {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  },

  // Start the alarm only once when the bus stop threshold is reached.
  triggerAlarm() {
    if (state.alarmTriggered) return;

    state.alarmTriggered = true;
    state.alarmActive = true;
    elements.alarmOverlay.classList.remove('hidden');
    this.startVibration();
    this.startBeep();

    // Increment alarm counter
    const currentCount = parseInt(localStorage.getItem('alarmCount') || '0', 10);
    const newCount = currentCount + 1;
    localStorage.setItem('alarmCount', newCount.toString());
    elements.alarmCountDisplay.textContent = `🔔 Users Helped: ${newCount}`;

    console.log('Alarm triggered');
    this.showNote('Stop reached — wake up! The alarm is now active.');
  },

  stopAlarm() {
    if (!state.alarmActive && !state.alarmTriggered) return;

    state.alarmActive = false;
    state.alarmTriggered = false;
    this.hideAlarm();
    this.stopVibration();
    this.stopBeep();
    console.log('Alarm stopped');
  },

  dismissAlarm() {
    this.stopAlarm();
    this.showNote('Alarm stopped. Tracking remains active until you press Stop.');
  },

  hideAlarm() {
    elements.alarmOverlay.classList.add('hidden');
  },

  vibrateDevice() {
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 150, 200, 150, 300]);
      window.clearInterval(state.vibrateInterval);
      state.vibrateInterval = window.setInterval(() => navigator.vibrate([200, 150, 200]), 1200);
    }
  },

  startVibration() {
    if ('vibrate' in navigator) {
      vibrationInterval = window.setInterval(() => {
        navigator.vibrate([200, 150, 200, 150, 300]);
      }, 1200);
    }
  },

  stopVibration() {
    if (vibrationInterval) {
      window.clearInterval(vibrationInterval);
      vibrationInterval = null;
    }
    if ('vibrate' in navigator) {
      navigator.vibrate(0);
    }
  },

  startBeep() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      beepInterval = window.setInterval(() => {
        this.playBeep();
      }, 1000);
    } catch (error) {
      console.error('Web Audio API not supported:', error);
    }
  },

  stopBeep() {
    if (beepInterval) {
      window.clearInterval(beepInterval);
      beepInterval = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  },

  playBeep() {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.type = 'square';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  },

  updateMapPreview(current, destination) {
    const svg = this.buildMapSvg(current, destination);
    elements.mapPlaceholder.innerHTML = svg;
  },

  buildMapSvg(current, destination) {
    const width = 540;
    const height = 380;
    const centerX = width * 0.28;
    const centerY = height * 0.56;
    const spanX = width * 0.38;
    const spanY = height * 0.30;

    const deltaLon = destination.lon - current.lon;
    const deltaLat = destination.lat - current.lat;
    const maxLon = 0.02;
    const maxLat = 0.015;

    const destX = centerX + Math.max(-1, Math.min(1, deltaLon / maxLon)) * spanX;
    const destY = centerY - Math.max(-1, Math.min(1, deltaLat / maxLat)) * spanY;

    const markerCurrent = `<circle cx="${centerX}" cy="${centerY}" r="14" fill="#7de2a8" stroke="#fff" stroke-width="4"/>`;
    const markerDestination = `<circle cx="${destX.toFixed(2)}" cy="${destY.toFixed(2)}" r="14" fill="#50c6ff" stroke="#fff" stroke-width="4"/>`;
    const curveX = centerX + (destX - centerX) * 0.5;
    const curveY = centerY + (destY - centerY) * 0.35;

    const path = `<path d="M ${centerX} ${centerY} Q ${curveX.toFixed(2)} ${curveY.toFixed(2)}, ${destX.toFixed(2)} ${destY.toFixed(2)}" fill="none" stroke="rgba(80,198,255,0.8)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;

    return `${this.getMapSvgTemplate(width, height, markerCurrent, markerDestination, path)}`;
  },

  getMapSvgTemplate(width, height, markerCurrent, markerDestination, path) {
    return `
      <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Map preview">
        <defs>
          <linearGradient id="bgGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0b1830" />
            <stop offset="100%" stop-color="#071321" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bgGradient)" rx="30"/>
        <g opacity="0.92">
          <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="24" fill="rgba(255,255,255,0.02)" />
          <g stroke="rgba(255,255,255,0.08)" stroke-width="1">
            <path d="M 36 110 H ${width - 36}"/>
            <path d="M 36 220 H ${width - 36}"/>
            <path d="M 36 330 H ${width - 36}"/>
          </g>
        </g>
        ${path}
        ${markerCurrent}
        ${markerDestination}
      </svg>
    `;
  },

  onLocationError(error) {
    let message = 'Unable to retrieve location.';
    switch (error.code) {
      case error.PERMISSION_DENIED:
        message = 'Location permission denied. Please allow location access to use tracking.';
        break;
      case error.POSITION_UNAVAILABLE:
        message = 'GPS signal unavailable. Try moving outdoors or restarting the app.';
        break;
      case error.TIMEOUT:
        message = 'Location request timed out. Please try again.';
        break;
    }
    this.showNote(message);
    this.onStopTracking();
  },

  updateStatus() {
    elements.trackingStatus.textContent = state.tracking ? 'Active' : 'Stopped';
    elements.distanceText.textContent = state.destination ? 'Waiting...' : '—';
    elements.destinationNameText.textContent = state.destination ? state.destination.name : 'No destination selected';
  },

  updateStatusCards() {
    elements.trackingStatus.textContent = state.tracking ? 'Active' : 'Stopped';
  },

  showNote(message) {
    elements.notesBlock.textContent = message;
  },
};

app.init();
