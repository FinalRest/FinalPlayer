// FinalPlayer - Complete JavaScript Implementation
// Following the detailed plan and manual

class FinalPlayer {
    constructor() {
        this.audioContext = null;
        this.mediaElementSource = null;
        this.analyser = null;
        this.gainNode = null;
        this.eqNodes = [];
        this.visualizerAnimationId = null;
        
        this.currentTrack = null;
        this.queue = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.shuffle = false;
        this.repeat = 'none'; // 'none', 'one', 'all'
        
        this.library = new Map();
        this.playlists = new Map();
        this.albums = new Map();
        this.artists = new Map();
        this.assets = new Map();
        
        this.db = null;
        this.settings = {
            volume: 0.7,
            theme: 'dark',
            eqPreset: 'flat',
            customEq: new Array(10).fill(0)
        };
        
        this.init();
    }

    async init() {
        await this.initDB();
        await this.loadSettings();
        await this.loadLibrary();
        this.setupUI();
        this.setupAudioContext();
        this.setupEventListeners();
        this.setupMediaSession();
        this.loadTheme();
    }

    // =====================
    // Database Management
    // =====================
    
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('FinalPlayerDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Tracks store
                if (!db.objectStoreNames.contains('tracks')) {
                    const tracksStore = db.createObjectStore('tracks', { keyPath: 'id' });
                    tracksStore.createIndex('title', 'title');
                    tracksStore.createIndex('artist', 'artist');
                    tracksStore.createIndex('album', 'album');
                }
                
                // Assets store (blobs, covers, etc)
                if (!db.objectStoreNames.contains('assets')) {
                    db.createObjectStore('assets', { keyPath: 'id' });
                }
                
                // Playlists store
                if (!db.objectStoreNames.contains('playlists')) {
                    db.createObjectStore('playlists', { keyPath: 'id' });
                }
                
                // Albums store
                if (!db.objectStoreNames.contains('albums')) {
                    db.createObjectStore('albums', { keyPath: 'id' });
                }
                
                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
                
                // Themes store
                if (!db.objectStoreNames.contains('themes')) {
                    db.createObjectStore('themes', { keyPath: 'id' });
                }
            };
        });
    }

    async saveToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getFromStore(storeName, key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllFromStore(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // =====================
    // Audio Context Setup
    // =====================
    
    async setupAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Get audio element
            const audioElement = document.getElementById('audioElement');
            
            // Create media element source
            this.mediaElementSource = this.audioContext.createMediaElementSource(audioElement);
            
            // Create gain node
            this.gainNode = this.audioContext.createGain();
            
            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            
            // Create EQ nodes (10 bands)
            this.createEQNodes();
            
            // Connect the audio graph
            this.connectAudioGraph();
            
            // Set initial volume
            this.setVolume(this.settings.volume);
            
        } catch (error) {
            console.error('Failed to setup audio context:', error);
            this.showToast('Error al inicializar el contexto de audio', 'error');
        }
    }

    createEQNodes() {
        const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        
        this.eqNodes = frequencies.map((freq, index) => {
            const filter = this.audioContext.createBiquadFilter();
            
            if (index === 0) {
                filter.type = 'lowshelf';
            } else if (index === frequencies.length - 1) {
                filter.type = 'highshelf';
            } else {
                filter.type = 'peaking';
                filter.Q.value = 1;
            }
            
            filter.frequency.value = freq;
            filter.gain.value = 0;
            
            return filter;
        });
    }

    connectAudioGraph() {
        // Connect: source -> gain -> eq nodes -> analyser -> destination
        this.mediaElementSource.connect(this.gainNode);
        
        // Chain EQ nodes
        let currentNode = this.gainNode;
        this.eqNodes.forEach(eqNode => {
            currentNode.connect(eqNode);
            currentNode = eqNode;
        });
        
        // Connect to analyser and destination
        currentNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
    }

    // =====================
    // Media Management
    // =====================
    
    async importFiles(files) {
        const supportedTypes = ['audio/', 'video/'];
        const validFiles = Array.from(files).filter(file => 
            supportedTypes.some(type => file.type.startsWith(type))
        );

        if (validFiles.length === 0) {
            this.showToast('No se encontraron archivos de audio/video válidos', 'error');
            return;
        }

        this.showToast(`Importando ${validFiles.length} archivos...`, 'info');

        for (const file of validFiles) {
            await this.processFile(file);
        }

        await this.updateLibraryDisplay();
        this.showToast(`${validFiles.length} archivos importados exitosamente`, 'success');
    }

    async processFile(file) {
        const trackId = this.generateId();
        const assetId = this.generateId();

        // Extract basic metadata
        const metadata = await this.extractMetadata(file);
        
        // Create track record
        const track = {
            id: trackId,
            title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
            artist: metadata.artist || 'Artista Desconocido',
            album: metadata.album || 'Álbum Desconocido',
            trackNumber: metadata.trackNumber || 1,
            duration: metadata.duration || 0,
            fileBlobId: assetId,
            mimeType: file.type,
            coverAssetId: null,
            addedAt: Date.now(),
            tags: [],
            customFields: {}
        };

        // Save file blob as asset
        const asset = {
            id: assetId,
            type: file.type.startsWith('audio/') ? 'audio' : 'video',
            blob: file,
            filename: file.name,
            size: file.size
        };

        // Save to database
        await this.saveToStore('tracks', track);
        await this.saveToStore('assets', asset);

        // Update in-memory collections
        this.library.set(trackId, track);
        this.assets.set(assetId, asset);

        // Auto-create album
        await this.autoCreateAlbum(track);
    }

    async extractMetadata(file) {
        return new Promise((resolve) => {
            const audio = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
            const url = URL.createObjectURL(file);
            
            audio.addEventListener('loadedmetadata', () => {
                const metadata = {
                    duration: audio.duration || 0
                };
                
                URL.revokeObjectURL(url);
                resolve(metadata);
            });

            audio.addEventListener('error', () => {
                URL.revokeObjectURL(url);
                resolve({ duration: 0 });
            });

            audio.src = url;
        });
    }

    async autoCreateAlbum(track) {
        const albumId = `album_${track.album}_${track.artist}`.replace(/\s+/g, '_').toLowerCase();
        
        let album = this.albums.get(albumId);
        if (!album) {
            album = {
                id: albumId,
                name: track.album,
                artist: track.artist,
                trackIds: [],
                coverAssetId: null,
                createdAt: Date.now()
            };
            this.albums.set(albumId, album);
        }

        if (!album.trackIds.includes(track.id)) {
            album.trackIds.push(track.id);
            await this.saveToStore('albums', album);
        }
    }

    // =====================
    // Playback Control
    // =====================
    
    async play(track = null) {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        if (track) {
            await this.loadTrack(track);
        }

        const audioElement = document.getElementById('audioElement');
        const videoElement = document.getElementById('videoElement');
        
        try {
            if (this.currentTrack) {
                const currentElement = this.getCurrentMediaElement();
                await currentElement.play();
                this.isPlaying = true;
                this.updatePlayButton();
                this.updateMediaSession();
                this.startVisualizer();
            }
        } catch (error) {
            console.error('Playback error:', error);
            this.showToast('Error al reproducir el archivo', 'error');
        }
    }

    pause() {
        const currentElement = this.getCurrentMediaElement();
        if (currentElement) {
            currentElement.pause();
            this.isPlaying = false;
            this.updatePlayButton();
            this.stopVisualizer();
        }
    }

    async loadTrack(track) {
        if (!track || !this.assets.has(track.fileBlobId)) {
            console.error('Track or asset not found');
            return;
        }

        this.currentTrack = track;
        const asset = this.assets.get(track.fileBlobId);
        const blob = asset.blob;
        const url = URL.createObjectURL(blob);

        // Determine which element to use
        const isVideo = asset.type === 'video';
        const audioElement = document.getElementById('audioElement');
        const videoElement = document.getElementById('videoElement');

        // Hide/show appropriate elements
        audioElement.style.display = isVideo ? 'none' : 'block';
        videoElement.style.display = isVideo ? 'block' : 'none';

        const currentElement = isVideo ? videoElement : audioElement;
        
        // Clean up previous URL
        if (currentElement.src) {
            URL.revokeObjectURL(currentElement.src);
        }

        currentElement.src = url;
        
        // Update UI
        this.updatePlayerDisplay();
        this.updateProgressBar();

        // Save current track to settings
        this.settings.lastTrackId = track.id;
        await this.saveSettings();
    }

    getCurrentMediaElement() {
        if (!this.currentTrack) return null;
        
        const asset = this.assets.get(this.currentTrack.fileBlobId);
        if (!asset) return null;

        return asset.type === 'video' ? 
            document.getElementById('videoElement') : 
            document.getElementById('audioElement');
    }

    async playNext() {
        if (this.queue.length === 0) return;

        let nextIndex;
        if (this.shuffle) {
            nextIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            nextIndex = (this.currentIndex + 1) % this.queue.length;
        }

        this.currentIndex = nextIndex;
        const nextTrack = this.library.get(this.queue[nextIndex]);
        if (nextTrack) {
            await this.play(nextTrack);
        }
    }

    async playPrevious() {
        if (this.queue.length === 0) return;

        let prevIndex;
        if (this.shuffle) {
            prevIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            prevIndex = this.currentIndex === 0 ? this.queue.length - 1 : this.currentIndex - 1;
        }

        this.currentIndex = prevIndex;
        const prevTrack = this.library.get(this.queue[prevIndex]);
        if (prevTrack) {
            await this.play(prevTrack);
        }
    }

    setVolume(volume) {
        if (this.gainNode) {
            this.gainNode.gain.value = volume;
            this.settings.volume = volume;
            document.getElementById('volumeSlider').value = volume * 100;
        }
    }

    seek(position) {
        const currentElement = this.getCurrentMediaElement();
        if (currentElement && currentElement.duration) {
            currentElement.currentTime = position;
        }
    }

    // =====================
    // Equalizer
    // =====================
    
    setEQGain(bandIndex, gain) {
        if (this.eqNodes[bandIndex]) {
            this.eqNodes[bandIndex].gain.value = gain;
            this.settings.customEq[bandIndex] = gain;
        }
    }

    applyEQPreset(presetName) {
        const presets = {
            flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            rock: [5, 4, 2, -1, -0.5, 1, 2, 3, 4, 5],
            pop: [2, 1, 0, 1, 2, 2, 1, 0, 1, 2],
            jazz: [4, 2, 1, 2, -1, -1, 0, 1, 2, 3],
            classical: [3, 2, 1, 0, 0, 0, 1, 2, 3, 4],
            bass: [6, 4, 2, 1, 0, 0, 0, 0, 0, 0],
            custom: this.settings.customEq
        };

        const preset = presets[presetName] || presets.flat;
        preset.forEach((gain, index) => {
            this.setEQGain(index, gain);
        });

        this.settings.eqPreset = presetName;
        this.updateEQDisplay();
    }

    updateEQDisplay() {
        const sliders = document.querySelectorAll('.eq-slider');
        const values = document.querySelectorAll('.eq-value');
        
        sliders.forEach((slider, index) => {
            const gain = this.eqNodes[index].gain.value;
            slider.value = gain;
            if (values[index]) {
                values[index].textContent = `${gain.toFixed(1)}dB`;
            }
        });
    }

    // =====================
    // Visualizer
    // =====================
    
    startVisualizer() {
        if (!this.analyser) return;

        const canvas = document.getElementById('visualizerCanvas');
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isPlaying) return;

            this.visualizerAnimationId = requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(dataArray);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const barWidth = canvas.width / bufferLength * 2.5;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
                
                const hue = (i / bufferLength) * 360;
                ctx.fillStyle = `hsla(${hue}, 70%, 60%, 0.8)`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                x += barWidth + 1;
            }
        };

        draw();
    }

    stopVisualizer() {
        if (this.visualizerAnimationId) {
            cancelAnimationFrame(this.visualizerAnimationId);
            this.visualizerAnimationId = null;
        }
    }

    // =====================
    // UI Management
    // =====================
    
    setupUI() {
        this.resizeCanvases();
        window.addEventListener('resize', () => this.resizeCanvases());
    }

    resizeCanvases() {
        const canvas = document.getElementById('visualizerCanvas');
        const eqCanvas = document.getElementById('eqVisualizerCanvas');
        
        [canvas, eqCanvas].forEach(c => {
            if (c) {
                const rect = c.getBoundingClientRect();
                c.width = rect.width * window.devicePixelRatio;
                c.height = rect.height * window.devicePixelRatio;
                const ctx = c.getContext('2d');
                ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            }
        });
    }

    updatePlayerDisplay() {
        if (!this.currentTrack) {
            document.getElementById('trackTitle').textContent = 'Sin reproducción';
            document.getElementById('trackArtist').textContent = '-';
            document.getElementById('playerCover').src = '';
            return;
        }

        document.getElementById('trackTitle').textContent = this.currentTrack.title;
        document.getElementById('trackArtist').textContent = this.currentTrack.artist;
        
        // Update cover
        this.updatePlayerCover();
    }

    async updatePlayerCover() {
        const coverImg = document.getElementById('playerCover');
        const coverVideo = document.getElementById('playerCoverVideo');
        
        if (this.currentTrack && this.currentTrack.coverAssetId) {
            const coverAsset = this.assets.get(this.currentTrack.coverAssetId);
            if (coverAsset) {
                const url = URL.createObjectURL(coverAsset.blob);
                
                if (coverAsset.type === 'video') {
                    coverVideo.src = url;
                    coverVideo.classList.add('active');
                    coverImg.classList.remove('active');
                } else {
                    coverImg.src = url;
                    coverImg.classList.add('active');
                    coverVideo.classList.remove('active');
                }
                return;
            }
        }
        
        // Default cover
        coverImg.src = '';
        coverVideo.src = '';
        coverImg.classList.add('active');
        coverVideo.classList.remove('active');
    }

    updatePlayButton() {
        const playIcon = document.querySelector('.play-icon');
        const pauseIcon = document.querySelector('.pause-icon');
        
        if (this.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        }
    }

    updateProgressBar() {
        const currentElement = this.getCurrentMediaElement();
        if (!currentElement) return;

        const updateProgress = () => {
            if (!this.isPlaying) return;
            
            const progress = (currentElement.currentTime / currentElement.duration) * 100;
            const progressFill = document.getElementById('progressFill');
            const progressSlider = document.getElementById('progressSlider');
            const timeCurrent = document.getElementById('timeCurrent');
            const timeTotal = document.getElementById('timeTotal');
            
            progressFill.style.width = `${progress}%`;
            progressSlider.value = progress;
            timeCurrent.textContent = this.formatTime(currentElement.currentTime);
            timeTotal.textContent = this.formatTime(currentElement.duration);
            
            requestAnimationFrame(updateProgress);
        };
        
        updateProgress();
    }

    async updateLibraryDisplay() {
        const tracksGrid = document.getElementById('tracksGrid');
        tracksGrid.innerHTML = '';

        for (const [trackId, track] of this.library) {
            const trackElement = this.createTrackElement(track);
            tracksGrid.appendChild(trackElement);
        }
    }

    createTrackElement(track) {
        const div = document.createElement('div');
        div.className = 'track-item';
        div.dataset.trackId = track.id;
        
        div.innerHTML = `
            <div class="track-cover"></div>
            <div class="track-info">
                <div class="track-name">${track.title}</div>
                <div class="track-artist">${track.artist}</div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.queue = [track.id];
            this.currentIndex = 0;
            this.play(track);
        });

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTrackContextMenu(e, track);
        });

        return div;
    }

    // =====================
    // Event Listeners
    // =====================
    
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                this.switchView(view);
                this.updateNavigation(item);
            });
        });

        // Player controls
        document.getElementById('playPauseBtn').addEventListener('click', () => {
            if (this.isPlaying) {
                this.pause();
            } else {
                this.play();
            }
        });

        document.getElementById('nextBtn').addEventListener('click', () => this.playNext());
        document.getElementById('prevBtn').addEventListener('click', () => this.playPrevious());

        // Volume control
        document.getElementById('volumeSlider').addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });

        // Progress control
        document.getElementById('progressSlider').addEventListener('input', (e) => {
            const currentElement = this.getCurrentMediaElement();
            if (currentElement && currentElement.duration) {
                const seekTime = (e.target.value / 100) * currentElement.duration;
                this.seek(seekTime);
            }
        });

        // File import
        document.getElementById('importBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.importFiles(e.target.files);
            }
        });

        // Drag and drop
        const dropZone = document.getElementById('dropZone');
        const mainContent = document.querySelector('.main-content');

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            mainContent.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        mainContent.addEventListener('dragenter', () => dropZone.classList.add('active'));
        mainContent.addEventListener('dragleave', (e) => {
            if (!mainContent.contains(e.relatedTarget)) {
                dropZone.classList.remove('active');
            }
        });
        mainContent.addEventListener('drop', (e) => {
            dropZone.classList.remove('active');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.importFiles(files);
            }
        });

        // Equalizer
        document.getElementById('equalizerBtn').addEventListener('click', () => {
            this.toggleEqualizer();
        });

        document.getElementById('closeEqBtn').addEventListener('click', () => {
            this.hideEqualizer();
        });

        document.querySelectorAll('.eq-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const bandIndex = Array.from(document.querySelectorAll('.eq-slider')).indexOf(slider);
                this.setEQGain(bandIndex, parseFloat(e.target.value));
                this.updateEQDisplay();
            });
        });

        document.getElementById('eqPresetSelect').addEventListener('change', (e) => {
            this.applyEQPreset(e.target.value);
        });

        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.toggleThemeEditor();
        });

        // Theme editor
        this.setupThemeEditorEvents();

        // Media element events
        const audioElement = document.getElementById('audioElement');
        const videoElement = document.getElementById('videoElement');

        [audioElement, videoElement].forEach(element => {
            element.addEventListener('ended', () => {
                if (this.repeat === 'one') {
                    element.currentTime = 0;
                    element.play();
                } else if (this.repeat === 'all' || this.queue.length > 1) {
                    this.playNext();
                } else {
                    this.pause();
                }
            });

            element.addEventListener('error', (e) => {
                console.error('Media error:', e);
                this.showToast('Error al reproducir el archivo', 'error');
            });
        });
    }

    setupThemeEditorEvents() {
        // Color controls
        document.getElementById('accentColor').addEventListener('change', (e) => {
            this.setThemeVariable('--accent', e.target.value);
        });

        document.getElementById('bgColor').addEventListener('change', (e) => {
            this.setThemeVariable('--bg-primary', e.target.value);
        });

        document.getElementById('textColor').addEventListener('change', (e) => {
            this.setThemeVariable('--text-primary', e.target.value);
        });

        // Glass opacity
        document.getElementById('glassOpacity').addEventListener('input', (e) => {
            const opacity = e.target.value / 100;
            this.setThemeVariable('--glass-opacity', opacity);
            document.querySelector('#glassOpacity + .slider-value').textContent = `${e.target.value}%`;
        });

        // Blur amount
        document.getElementById('blurAmount').addEventListener('input', (e) => {
            this.setThemeVariable('--blur-amount', `${e.target.value}px`);
            document.querySelector('#blurAmount + .slider-value').textContent = `${e.target.value}px`;
        });

        // Background options
        document.querySelectorAll('.bg-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.bg-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                
                if (option.dataset.bg === 'image' || option.dataset.bg === 'video') {
                    document.getElementById('bgFileInput').click();
                }
            });
        });

        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.applyThemePreset(btn.dataset.preset);
            });
        });

        // Close theme editor
        document.getElementById('closeThemeBtn').addEventListener('click', () => {
            this.hideThemeEditor();
        });
    }

    // =====================
    // Theme Management
    // =====================
    
    setThemeVariable(property, value) {
        document.documentElement.style.setProperty(property, value);
    }

    applyThemePreset(presetName) {
        const presets = {
            dark: {
                '--accent': '#6366f1',
                '--bg-primary': '#0f172a',
                '--bg-secondary': '#1e293b',
                '--text-primary': '#ffffff',
                '--text-secondary': '#94a3b8'
            },
            neon: {
                '--accent': '#00ffff',
                '--bg-primary': '#0a0a0a',
                '--bg-secondary': '#1a1a1a',
                '--text-primary': '#ffffff',
                '--text-secondary': '#00ffff'
            },
            pastel: {
                '--accent': '#f0abfc',
                '--bg-primary': '#fdf4ff',
                '--bg-secondary': '#fae8ff',
                '--text-primary': '#581c87',
                '--text-secondary': '#86198f'
            },
            minimal: {
                '--accent': '#000000',
                '--bg-primary': '#ffffff',
                '--bg-secondary': '#f5f5f5',
                '--text-primary': '#000000',
                '--text-secondary': '#666666'
            }
        };

        const preset = presets[presetName];
        if (preset) {
            Object.entries(preset).forEach(([property, value]) => {
                this.setThemeVariable(property, value);
            });
            
            this.settings.theme = presetName;
            this.saveSettings();
        }
    }

    loadTheme() {
        if (this.settings.theme && this.settings.theme !== 'dark') {
            this.applyThemePreset(this.settings.theme);
        }
        
        // Apply custom EQ settings
        this.applyEQPreset(this.settings.eqPreset);
    }

    toggleThemeEditor() {
        const editor = document.getElementById('themeEditor');
        editor.classList.toggle('hidden');
    }

    hideThemeEditor() {
        document.getElementById('themeEditor').classList.add('hidden');
    }

    // =====================
    // Playlist Management
    // =====================
    
    async createPlaylist(name, description = '') {
        const playlist = {
            id: this.generateId(),
            name,
            description,
            trackIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await this.saveToStore('playlists', playlist);
        this.playlists.set(playlist.id, playlist);
        
        this.showToast('Playlist creada exitosamente', 'success');
        return playlist;
    }

    async addToPlaylist(playlistId, trackId) {
        const playlist = this.playlists.get(playlistId);
        if (!playlist || !this.library.has(trackId)) return;

        if (!playlist.trackIds.includes(trackId)) {
            playlist.trackIds.push(trackId);
            playlist.updatedAt = Date.now();
            
            await this.saveToStore('playlists', playlist);
            this.showToast('Canción agregada a la playlist', 'success');
        }
    }

    async removeFromPlaylist(playlistId, trackId) {
        const playlist = this.playlists.get(playlistId);
        if (!playlist) return;

        const index = playlist.trackIds.indexOf(trackId);
        if (index > -1) {
            playlist.trackIds.splice(index, 1);
            playlist.updatedAt = Date.now();
            
            await this.saveToStore('playlists', playlist);
            this.showToast('Canción removida de la playlist', 'success');
        }
    }

    // =====================
    // View Management
    // =====================
    
    switchView(viewName) {
        // Hide all views
        document.querySelectorAll('.view-container').forEach(view => {
            view.classList.add('hidden');
        });

        // Show selected view
        const targetView = document.getElementById(`${viewName}View`);
        if (targetView) {
            targetView.classList.remove('hidden');
        }

        // Load view data
        this.loadViewData(viewName);
    }

    updateNavigation(activeItem) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        activeItem.classList.add('active');
    }

    async loadViewData(viewName) {
        switch (viewName) {
            case 'library':
                await this.updateLibraryDisplay();
                break;
            case 'playlists':
                await this.updatePlaylistsDisplay();
                break;
            case 'albums':
                await this.updateAlbumsDisplay();
                break;
            case 'artists':
                await this.updateArtistsDisplay();
                break;
        }
    }

    async updatePlaylistsDisplay() {
        const grid = document.getElementById('playlistsGrid');
        grid.innerHTML = '';

        for (const [playlistId, playlist] of this.playlists) {
            const element = this.createPlaylistElement(playlist);
            grid.appendChild(element);
        }
    }

    createPlaylistElement(playlist) {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.dataset.playlistId = playlist.id;
        
        div.innerHTML = `
            <div class="playlist-cover"></div>
            <div class="playlist-info">
                <div class="playlist-name">${playlist.name}</div>
                <div class="playlist-description">${playlist.trackIds.length} canciones</div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.loadPlaylist(playlist);
        });

        return div;
    }

    loadPlaylist(playlist) {
        this.queue = [...playlist.trackIds];
        this.currentIndex = 0;
        
        if (this.queue.length > 0) {
            const firstTrack = this.library.get(this.queue[0]);
            if (firstTrack) {
                this.play(firstTrack);
            }
        }
        
        this.updateQueueDisplay();
    }

    async updateAlbumsDisplay() {
        const grid = document.getElementById('albumsGrid');
        grid.innerHTML = '';

        for (const [albumId, album] of this.albums) {
            const element = this.createAlbumElement(album);
            grid.appendChild(element);
        }
    }

    createAlbumElement(album) {
        const div = document.createElement('div');
        div.className = 'album-item';
        div.dataset.albumId = album.id;
        
        div.innerHTML = `
            <div class="album-cover"></div>
            <div class="album-info">
                <div class="album-name">${album.name}</div>
                <div class="album-artist">${album.artist}</div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.loadAlbum(album);
        });

        return div;
    }

    loadAlbum(album) {
        this.queue = [...album.trackIds];
        this.currentIndex = 0;
        
        if (this.queue.length > 0) {
            const firstTrack = this.library.get(this.queue[0]);
            if (firstTrack) {
                this.play(firstTrack);
            }
        }
        
        this.updateQueueDisplay();
    }

    async updateArtistsDisplay() {
        const artists = new Map();
        
        // Group tracks by artist
        for (const [trackId, track] of this.library) {
            const artistName = track.artist;
            if (!artists.has(artistName)) {
                artists.set(artistName, {
                    name: artistName,
                    trackIds: [],
                    albumCount: new Set()
                });
            }
            
            const artist = artists.get(artistName);
            artist.trackIds.push(trackId);
            artist.albumCount.add(track.album);
        }

        const grid = document.getElementById('artistsGrid');
        grid.innerHTML = '';

        for (const [artistName, artist] of artists) {
            const element = this.createArtistElement(artist);
            grid.appendChild(element);
        }
    }

    createArtistElement(artist) {
        const div = document.createElement('div');
        div.className = 'artist-item';
        
        div.innerHTML = `
            <div class="artist-cover"></div>
            <div class="artist-info">
                <div class="artist-name">${artist.name}</div>
                <div class="artist-stats">${artist.trackIds.length} canciones, ${artist.albumCount.size} álbumes</div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.loadArtist(artist);
        });

        return div;
    }

    loadArtist(artist) {
        this.queue = [...artist.trackIds];
        this.currentIndex = 0;
        
        if (this.queue.length > 0) {
            const firstTrack = this.library.get(this.queue[0]);
            if (firstTrack) {
                this.play(firstTrack);
            }
        }
        
        this.updateQueueDisplay();
    }

    // =====================
    // Queue Management
    // =====================
    
    toggleQueue() {
        const panel = document.getElementById('queuePanel');
        panel.classList.toggle('hidden');
        
        if (!panel.classList.contains('hidden')) {
            this.updateQueueDisplay();
        }
    }

    updateQueueDisplay() {
        const list = document.getElementById('queueList');
        list.innerHTML = '';

        this.queue.forEach((trackId, index) => {
            const track = this.library.get(trackId);
            if (track) {
                const element = this.createQueueItemElement(track, index);
                list.appendChild(element);
            }
        });
    }

    createQueueItemElement(track, index) {
        const div = document.createElement('div');
        div.className = `queue-item ${index === this.currentIndex ? 'playing' : ''}`;
        div.dataset.index = index;
        
        div.innerHTML = `
            <div class="queue-item-cover"></div>
            <div class="queue-item-info">
                <div class="queue-item-title">${track.title}</div>
                <div class="queue-item-artist">${track.artist}</div>
            </div>
        `;

        div.addEventListener('click', () => {
            this.currentIndex = index;
            this.play(track);
        });

        return div;
    }

    // =====================
    // Equalizer UI
    // =====================
    
    toggleEqualizer() {
        const panel = document.getElementById('equalizerPanel');
        panel.classList.toggle('hidden');
        
        if (!panel.classList.contains('hidden')) {
            this.updateEQDisplay();
            this.startEQVisualizer();
        } else {
            this.stopEQVisualizer();
        }
    }

    hideEqualizer() {
        document.getElementById('equalizerPanel').classList.add('hidden');
        this.stopEQVisualizer();
    }

    startEQVisualizer() {
        if (!this.analyser) return;

        const canvas = document.getElementById('eqVisualizerCanvas');
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (document.getElementById('equalizerPanel').classList.contains('hidden')) return;

            requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(dataArray);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            const barWidth = canvas.width / bufferLength;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;
                
                ctx.fillStyle = `hsl(${(i / bufferLength) * 360}, 70%, 50%)`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                
                x += barWidth;
            }
        };

        draw();
    }

    stopEQVisualizer() {
        // Visualization will stop automatically when panel is hidden
    }

    // =====================
    // Context Menus
    // =====================
    
    showTrackContextMenu(event, track) {
        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'context-menu glass-panel';
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.zIndex = '1000';
        menu.style.minWidth = '200px';
        menu.style.padding = '8px';
        menu.style.borderRadius = '12px';
        
        menu.innerHTML = `
            <div class="context-item" data-action="play">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Reproducir
            </div>
            <div class="context-item" data-action="addToQueue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 12l-4-4v3H2v2h8v3l4-4z"/>
                </svg>
                Agregar a Cola
            </div>
            <div class="context-item" data-action="editMetadata">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>
                </svg>
                Editar Metadatos
            </div>
            <div class="context-item" data-action="delete">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"/>
                </svg>
                Eliminar
            </div>
        `;

        document.body.appendChild(menu);

        // Add event listeners
        menu.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                await this.handleContextAction(action, track);
                document.body.removeChild(menu);
            });
        });

        // Remove menu when clicking outside
        const removeMenu = (e) => {
            if (!menu.contains(e.target)) {
                if (document.body.contains(menu)) {
                    document.body.removeChild(menu);
                }
                document.removeEventListener('click', removeMenu);
            }
        };
        
        setTimeout(() => document.addEventListener('click', removeMenu), 100);
    }

    async handleContextAction(action, track) {
        switch (action) {
            case 'play':
                this.queue = [track.id];
                this.currentIndex = 0;
                await this.play(track);
                break;
                
            case 'addToQueue':
                if (!this.queue.includes(track.id)) {
                    this.queue.push(track.id);
                    this.showToast('Agregado a la cola de reproducción', 'success');
                }
                break;
                
            case 'editMetadata':
                this.showMetadataEditor(track);
                break;
                
            case 'delete':
                if (confirm('¿Está seguro de que desea eliminar esta canción?')) {
                    await this.deleteTrack(track.id);
                }
                break;
        }
    }

    // =====================
    // Metadata Editor
    // =====================
    
    showMetadataEditor(track) {
        const modal = document.getElementById('metadataModal');
        
        // Fill form with current data
        document.getElementById('metaTitle').value = track.title;
        document.getElementById('metaArtist').value = track.artist;
        document.getElementById('metaAlbum').value = track.album;
        document.getElementById('metaTrackNumber').value = track.trackNumber;
        
        // Set cover preview
        if (track.coverAssetId && this.assets.has(track.coverAssetId)) {
            const coverAsset = this.assets.get(track.coverAssetId);
            const url = URL.createObjectURL(coverAsset.blob);
            document.getElementById('metaCoverPreview').src = url;
        }
        
        modal.classList.remove('hidden');
        
        // Store current track for saving
        modal.dataset.trackId = track.id;
    }

    async saveMetadata() {
        const modal = document.getElementById('metadataModal');
        const trackId = modal.dataset.trackId;
        const track = this.library.get(trackId);
        
        if (!track) return;

        // Update track data
        track.title = document.getElementById('metaTitle').value;
        track.artist = document.getElementById('metaArtist').value;
        track.album = document.getElementById('metaAlbum').value;
        track.trackNumber = parseInt(document.getElementById('metaTrackNumber').value) || 1;

        // Save to database
        await this.saveToStore('tracks', track);
        
        // Update displays
        await this.updateLibraryDisplay();
        if (this.currentTrack && this.currentTrack.id === trackId) {
            this.updatePlayerDisplay();
        }

        modal.classList.add('hidden');
        this.showToast('Metadatos actualizados exitosamente', 'success');
    }

    // =====================
    // Settings & Persistence
    // =====================
    
    async loadSettings() {
        const savedSettings = await this.getFromStore('settings', 'userSettings');
        if (savedSettings) {
            this.settings = { ...this.settings, ...savedSettings.data };
        }
    }

    async saveSettings() {
        await this.saveToStore('settings', {
            key: 'userSettings',
            data: this.settings
        });
    }

    async loadLibrary() {
        try {
            // Load tracks
            const tracks = await this.getAllFromStore('tracks');
            tracks.forEach(track => {
                this.library.set(track.id, track);
            });

            // Load assets
            const assets = await this.getAllFromStore('assets');
            assets.forEach(asset => {
                this.assets.set(asset.id, asset);
            });

            // Load playlists
            const playlists = await this.getAllFromStore('playlists');
            playlists.forEach(playlist => {
                this.playlists.set(playlist.id, playlist);
            });

            // Load albums
            const albums = await this.getAllFromStore('albums');
            albums.forEach(album => {
                this.albums.set(album.id, album);
            });

        } catch (error) {
            console.error('Error loading library:', error);
        }
    }

    async deleteTrack(trackId) {
        const track = this.library.get(trackId);
        if (!track) return;

        // Remove from database
        const transaction = this.db.transaction(['tracks', 'assets'], 'readwrite');
        
        transaction.objectStore('tracks').delete(trackId);
        if (track.fileBlobId) {
            transaction.objectStore('assets').delete(track.fileBlobId);
        }
        if (track.coverAssetId) {
            transaction.objectStore('assets').delete(track.coverAssetId);
        }

        // Remove from memory
        this.library.delete(trackId);
        if (track.fileBlobId) this.assets.delete(track.fileBlobId);
        if (track.coverAssetId) this.assets.delete(track.coverAssetId);

        // Update queue if necessary
        const queueIndex = this.queue.indexOf(trackId);
        if (queueIndex > -1) {
            this.queue.splice(queueIndex, 1);
            if (this.currentIndex >= queueIndex && this.currentIndex > 0) {
                this.currentIndex--;
            }
        }

        // Update displays
        await this.updateLibraryDisplay();
        this.showToast('Canción eliminada', 'success');
    }

    // =====================
    // Media Session API
    // =====================
    
    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrevious());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
        }
    }

    updateMediaSession() {
        if ('mediaSession' in navigator && this.currentTrack) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.currentTrack.title,
                artist: this.currentTrack.artist,
                album: this.currentTrack.album
            });
        }
    }

    // =====================
    // Utility Functions
    // =====================
    
    generateId() {
        return 'id_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 3000);
    }

    // =====================
    // Export/Import
    // =====================
    
    async exportLibrary() {
        const data = {
            tracks: Array.from(this.library.values()),
            playlists: Array.from(this.playlists.values()),
            albums: Array.from(this.albums.values()),
            settings: this.settings,
            version: '1.0',
            exportDate: Date.now()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'finalplayer_library.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        this.showToast('Biblioteca exportada exitosamente', 'success');
    }

    async importLibrary(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            // Validate data structure
            if (!data.tracks || !Array.isArray(data.tracks)) {
                throw new Error('Formato de archivo inválido');
            }

            // Import tracks
            for (const track of data.tracks) {
                this.library.set(track.id, track);
                await this.saveToStore('tracks', track);
            }

            // Import playlists
            if (data.playlists) {
                for (const playlist of data.playlists) {
                    this.playlists.set(playlist.id, playlist);
                    await this.saveToStore('playlists', playlist);
                }
            }

            // Import albums
            if (data.albums) {
                for (const album of data.albums) {
                    this.albums.set(album.id, album);
                    await this.saveToStore('albums', album);
                }
            }

            // Import settings
            if (data.settings) {
                this.settings = { ...this.settings, ...data.settings };
                await this.saveSettings();
            }

            await this.updateLibraryDisplay();
            this.showToast('Biblioteca importada exitosamente', 'success');

        } catch (error) {
            console.error('Import error:', error);
            this.showToast('Error al importar la biblioteca', 'error');
        }
    }
}

// =====================
// Initialize App
// =====================

document.addEventListener('DOMContentLoaded', () => {
    window.finalPlayer = new FinalPlayer();
    
    // Additional event listeners for modal interactions
    document.getElementById('closeMetadataBtn').addEventListener('click', () => {
        document.getElementById('metadataModal').classList.add('hidden');
    });
    
    document.getElementById('cancelMetadataBtn').addEventListener('click', () => {
        document.getElementById('metadataModal').classList.add('hidden');
    });
    
    document.getElementById('saveMetadataBtn').addEventListener('click', () => {
        window.finalPlayer.saveMetadata();
    });
    
    document.getElementById('queueBtn').addEventListener('click', () => {
        window.finalPlayer.toggleQueue();
    });
    
    document.getElementById('closeQueueBtn').addEventListener('click', () => {
        document.getElementById('queuePanel').classList.add('hidden');
    });
    
    // Cover upload functionality
    document.getElementById('uploadCoverBtn').addEventListener('click', () => {
        document.getElementById('coverFileInput').click();
    });
    
    document.getElementById('coverFileInput').addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const modal = document.getElementById('metadataModal');
            const trackId = modal.dataset.trackId;
            const track = window.finalPlayer.library.get(trackId);
            
            if (track) {
                // Create new asset for cover
                const coverAssetId = window.finalPlayer.generateId();
                const coverAsset = {
                    id: coverAssetId,
                    type: file.type.startsWith('video/') ? 'video' : 'image',
                    blob: file,
                    filename: file.name,
                    size: file.size
                };
                
                // Save asset
                await window.finalPlayer.saveToStore('assets', coverAsset);
                window.finalPlayer.assets.set(coverAssetId, coverAsset);
                
                // Update track
                track.coverAssetId = coverAssetId;
                
                // Update preview
                const url = URL.createObjectURL(file);
                document.getElementById('metaCoverPreview').src = url;
            }
        }
    });
});