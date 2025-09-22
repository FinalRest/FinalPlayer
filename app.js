// FinalPlayer - Complete JavaScript Implementation
// Version 2.7 - Layout centering, EQ value feedback, and visualizer fix

class FinalPlayer {
    constructor() {
        // Audio & State
        this.audioContext = null;
        this.mediaElementSource = null;
        this.analyser = null;
        this.gainNode = null;
        this.eqNodes = [];
        this.visualizerAnimationId = null;
        this.eqVisualizerAnimationId = null;
        this.currentTrackId = null;
        this.queue = [];
        this.shuffledQueue = [];
        this.currentIndex = -1;
        this.isPlaying = false;
        this.shuffle = false;
        this.repeat = 'none'; // 'none', 'one', 'all'
        
        // Data Collections
        this.library = new Map();
        this.playlists = new Map();
        this.albums = new Map();
        this.assets = new Map();
        
        // Database
        this.db = null;
        
        // Settings
        this.settings = {
            volume: 0.7,
            isMuted: false,
            lastVolume: 0.7,
            theme: {
                preset: 'dark',
                accentColor: '#6366f1',
                bgColor: '#0f172a',
                textColor: '#ffffff',
                glassOpacity: 20,
                blurAmount: 10,
                backgroundType: 'gradient',
                backgroundAssetId: null,
            },
            eqPreset: 'flat',
            customEq: new Array(10).fill(0),
            lastTrackId: null,
        };
        
        this.init();
    }

    async init() {
        try {
            await this.initDB();
            await this.loadDataFromDB();
            this.setupUI();
            this.setupAudioContext();
            this.setupAllEventListeners();
            this.setupMediaSession();
            await this.applyTheme();
            await this.restorePlaybackState();
            this.showToast('FinalPlayer listo', 'success');
        } catch (error) {
            console.error("Error fatal durante la inicialización:", error);
            this.showToast('Error al iniciar la aplicación', 'error');
        }
    }

    // ===================================
    // DATABASE & DATA MANAGEMENT
    // ===================================
    
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('FinalPlayerDB_v2', 2);
            
            request.onerror = (e) => reject(`Error de IndexedDB: ${e.target.error}`);
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = ['tracks', 'assets', 'playlists', 'albums', 'settings'];
                stores.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, { keyPath: 'id' });
                        if (storeName === 'tracks') {
                            store.createIndex('artist', 'artist');
                            store.createIndex('album', 'album');
                        }
                    }
                });
            };
        });
    }

    async saveToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("La base de datos no está inicializada.");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getFromStore(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("La base de datos no está inicializada.");
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    async deleteFromStore(storeName, key) {
         return new Promise((resolve, reject) => {
            if (!this.db) return reject("La base de datos no está inicializada.");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getAllFromStore(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("La base de datos no está inicializada.");
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async loadDataFromDB() {
        const [tracks, assets, playlists, albums, settings] = await Promise.all([
            this.getAllFromStore('tracks'),
            this.getAllFromStore('assets'),
            this.getAllFromStore('playlists'),
            this.getAllFromStore('albums'),
            this.getFromStore('settings', 'userSettings')
        ]);

        tracks.forEach(t => this.library.set(t.id, t));
        assets.forEach(a => this.assets.set(a.id, a));
        playlists.forEach(p => this.playlists.set(p.id, p));
        albums.forEach(a => this.albums.set(a.id, a));

        if (settings && settings.data) {
            this.settings = { 
                ...this.settings, 
                ...settings.data,
                theme: { ...this.settings.theme, ...(settings.data.theme || {}) }
            };
        }
        
        await this.updateLibraryDisplay();
    }

    async saveSettings() {
        await this.saveToStore('settings', { id: 'userSettings', data: this.settings });
    }

    async restorePlaybackState() {
        if (this.settings.lastTrackId && this.library.has(this.settings.lastTrackId)) {
            const lastTrack = this.library.get(this.settings.lastTrackId);
            this.currentTrackId = lastTrack.id;
            await this.loadTrack(lastTrack, false);
            this.updatePlayerDisplay(lastTrack);
        }
    }

    // ===================================
    // AUDIO CONTEXT
    // ===================================
    
    setupAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioElement = document.getElementById('audioElement');
            this.mediaElementSource = this.audioContext.createMediaElementSource(audioElement);
            this.gainNode = this.audioContext.createGain();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.8;
            
            this.createEQNodes();
            this.connectAudioGraph();
            this.setVolume(this.settings.volume);
            this.applyEQPreset(this.settings.eqPreset, false);
            
        } catch (error) {
            console.error('Error al configurar AudioContext:', error);
            this.showToast('El contexto de audio no pudo ser iniciado', 'error');
        }
    }

    createEQNodes() {
        const frequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        this.eqNodes = frequencies.map((freq) => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.41;
            filter.gain.value = 0;
            return filter;
        });
    }

    connectAudioGraph() {
        let currentNode = this.mediaElementSource;
        currentNode.connect(this.gainNode);
        currentNode = this.gainNode;
        this.eqNodes.forEach(eqNode => {
            currentNode.connect(eqNode);
            currentNode = eqNode;
        });
        currentNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
    }
    
    // ===================================
    // MEDIA IMPORT & PROCESSING
    // ===================================

    async importFiles(files) {
        const validFiles = Array.from(files).filter(file => file.type.startsWith('audio/') || file.type.startsWith('video/'));
        if (validFiles.length === 0) {
            this.showToast('No se encontraron archivos de audio/video válidos', 'warning');
            return;
        }

        this.showToast(`Importando ${validFiles.length} archivos...`, 'info');
        let successCount = 0;
        for (const file of validFiles) {
            const success = await this.processFile(file);
            if (success) successCount++;
        }

        await this.updateLibraryDisplay();
        this.showToast(`${successCount} de ${validFiles.length} archivos importados`, 'success');
    }

    async processFile(file) {
        try {
            const metadata = await window.mmb.parseBlob(file);
            const common = metadata.common;
            const format = metadata.format;
            const trackId = this.generateId();
            const assetId = `asset_${trackId}`;
            
            let coverAssetId = null;
            if (common.picture && common.picture.length > 0) {
                const picture = common.picture[0];
                const coverBlob = new Blob([picture.data], { type: picture.format });
                coverAssetId = `cover_${trackId}`;
                const coverAsset = { id: coverAssetId, type: 'image', blob: coverBlob, filename: 'cover.jpg' };
                await this.saveToStore('assets', coverAsset);
                this.assets.set(coverAssetId, coverAsset);
            }

            const track = {
                id: trackId,
                title: common.title || file.name.replace(/\.[^/.]+$/, ""),
                artist: common.artist || 'Artista Desconocido',
                album: common.album || 'Álbum Desconocido',
                trackNumber: common.track.no || 1,
                duration: format.duration || 0,
                fileAssetId: assetId,
                coverAssetId: coverAssetId,
                addedAt: Date.now()
            };

            const fileAsset = { id: assetId, type: file.type.startsWith('audio/') ? 'audio' : 'video', blob: file, filename: file.name };

            await this.saveToStore('tracks', track);
            await this.saveToStore('assets', fileAsset);
            this.library.set(trackId, track);
            this.assets.set(assetId, fileAsset);
            await this.updateAlbumAndArtist(track);
            return true;

        } catch (error) {
            console.warn(`Fallo en el análisis de metadatos para ${file.name}, usando fallback.`, error);
            try {
                const duration = await this.getMediaDuration(file);
                const trackId = this.generateId();
                const assetId = `asset_${trackId}`;

                const track = {
                    id: trackId,
                    title: file.name.replace(/\.[^/.]+$/, ""),
                    artist: 'Artista Desconocido',
                    album: 'Álbum Desconocido',
                    trackNumber: 1,
                    duration: duration,
                    fileAssetId: assetId,
                    coverAssetId: null,
                    addedAt: Date.now()
                };

                const fileAsset = { id: assetId, type: file.type.startsWith('audio/') ? 'audio' : 'video', blob: file, filename: file.name };
                
                await this.saveToStore('tracks', track);
                await this.saveToStore('assets', fileAsset);
                this.library.set(trackId, track);
                this.assets.set(assetId, fileAsset);
                await this.updateAlbumAndArtist(track);
                return true;
            } catch (fallbackError) {
                console.error(`Fallo del fallback de importación para ${file.name}:`, fallbackError);
                this.showToast(`Error irrecuperable con ${file.name}`, 'error');
                return false;
            }
        }
    }

    getMediaDuration(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const mediaElement = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
            mediaElement.addEventListener('loadedmetadata', () => {
                URL.revokeObjectURL(url);
                resolve(mediaElement.duration);
            });
            mediaElement.addEventListener('error', (e) => {
                URL.revokeObjectURL(url);
                reject(`Error al cargar media para obtener duración: ${e.message}`);
            });
            mediaElement.src = url;
        });
    }
    
    async updateAlbumAndArtist(track) {
        const albumKey = `${track.album}|${track.artist}`.toLowerCase();
        let album = [...this.albums.values()].find(a => `${a.name}|${a.artist}`.toLowerCase() === albumKey);

        if (!album) {
            album = {
                id: this.generateId(),
                name: track.album,
                artist: track.artist,
                trackIds: [],
                coverAssetId: track.coverAssetId
            };
        }
        
        if (!album.trackIds.includes(track.id)) {
            album.trackIds.push(track.id);
            if (!album.coverAssetId && track.coverAssetId) {
                album.coverAssetId = track.coverAssetId;
            }
        }
        
        this.albums.set(album.id, album);
        await this.saveToStore('albums', album);
    }
    
    // ===================================
    // PLAYBACK CONTROLS
    // ===================================

    async play(trackId = null) {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        if (trackId) {
            const track = this.library.get(trackId);
            if (!track) return;
            this.currentTrackId = trackId;
            await this.loadTrack(track, true);
        } else if (this.currentTrackId) {
            const audioElement = document.getElementById('audioElement');
            try {
                await audioElement.play();
                this.isPlaying = true;
                this.updatePlayButton();
                this.startVisualizer();
                this.updateMediaSessionState('playing');
            } catch (err) {
                console.error("Play error:", err);
                this.showToast("Error al reproducir", "error");
                this.isPlaying = false;
                this.updatePlayButton();
            }
        }
    }

    pause() {
        const audioElement = document.getElementById('audioElement');
        audioElement.pause();
        this.isPlaying = false;
        this.updatePlayButton();
        this.stopVisualizer();
        this.updateMediaSessionState('paused');
    }

    async loadTrack(track, shouldPlay = true) {
        this.currentTrackId = track.id;
        const asset = this.assets.get(track.fileAssetId);
        if (!asset) {
            this.showToast('Archivo de audio no encontrado', 'error');
            return;
        }

        const url = URL.createObjectURL(asset.blob);
        const audioElement = document.getElementById('audioElement');
        if (audioElement.src) {
            URL.revokeObjectURL(audioElement.src);
        }
        audioElement.src = url;
        
        audioElement.onloadedmetadata = async () => {
             this.updatePlayerDisplay(track);
             this.updateMediaSessionMetadata(track);
             if (shouldPlay) {
                await this.play();
             }
        };
        
        this.settings.lastTrackId = track.id;
        await this.saveSettings();
    }
    
    async playNext() {
        if (this.queue.length === 0) return;
        
        this.currentIndex = (this.currentIndex + 1) % this.queue.length;
        const queueToUse = this.shuffle ? this.shuffledQueue : this.queue;
        const nextTrackId = queueToUse[this.currentIndex];
        
        await this.play(nextTrackId);
    }

    async playPrevious() {
        if (this.queue.length === 0) return;
        
        this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
        const queueToUse = this.shuffle ? this.shuffledQueue : this.queue;
        const prevTrackId = queueToUse[this.currentIndex];

        await this.play(prevTrackId);
    }
    
    setQueueAndPlay(trackIds, startingTrackId) {
        this.queue = [...trackIds];
        this.generateShuffledQueue();
        
        const queueToSearch = this.shuffle ? this.shuffledQueue : this.queue;
        const startIndex = queueToSearch.indexOf(startingTrackId);
        this.currentIndex = (startIndex !== -1) ? startIndex : 0;
        
        const trackToPlayId = queueToSearch[this.currentIndex];
        
        this.play(trackToPlayId);
        this.updateQueueDisplay();
    }
    
    generateShuffledQueue() {
        this.shuffledQueue = [...this.queue]
            .map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);
    }

    setVolume(volume, isMuteToggle = false) {
        if(this.gainNode) {
            this.gainNode.gain.value = volume;
            this.settings.volume = volume;
            document.getElementById('volumeSlider').value = volume * 100;

            if(!isMuteToggle) {
                this.settings.isMuted = volume === 0;
                if(volume > 0) this.settings.lastVolume = volume;
            }
        }
    }

    toggleMute() {
        this.settings.isMuted = !this.settings.isMuted;
        if(this.settings.isMuted) {
            this.setVolume(0, true);
        } else {
            this.setVolume(this.settings.lastVolume > 0 ? this.settings.lastVolume : 0.7, true);
        }
        this.saveSettings();
    }

    seek(percentage) {
        const audioElement = document.getElementById('audioElement');
        if (audioElement && !isNaN(audioElement.duration)) {
            audioElement.currentTime = (percentage / 100) * audioElement.duration;
        }
    }
    
    // ===================================
    // UI MANAGEMENT
    // ===================================
    
    setupUI() {
        this.resizeCanvases();
        window.addEventListener('resize', () => this.resizeCanvases());
    }
    
    resizeCanvases() {
        document.querySelectorAll('canvas').forEach(canvas => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
        });
    }
    
    async updatePlayerDisplay(track) {
        if (!track) {
            document.getElementById('trackTitle').textContent = 'Sin reproducción';
            document.getElementById('trackArtist').textContent = '-';
            document.getElementById('playerCover').src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
            document.getElementById('timeTotal').textContent = '0:00';
            return;
        }

        document.getElementById('trackTitle').textContent = track.title;
        document.getElementById('trackArtist').textContent = track.artist;
        document.getElementById('timeTotal').textContent = this.formatTime(track.duration);
        
        const coverImg = document.getElementById('playerCover');
        if (track.coverAssetId && this.assets.has(track.coverAssetId)) {
            const coverAsset = this.assets.get(track.coverAssetId);
            coverImg.src = URL.createObjectURL(coverAsset.blob);
        } else {
            coverImg.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        }
    }
    
    updatePlayButton() {
        const playIcon = document.querySelector('.play-icon');
        const pauseIcon = document.querySelector('.pause-icon');
        playIcon.classList.toggle('hidden', this.isPlaying);
        pauseIcon.classList.toggle('hidden', !this.isPlaying);
    }

    updateProgressBar() {
        const audioElement = document.getElementById('audioElement');
        const progress = (audioElement.currentTime / audioElement.duration) * 100 || 0;
        
        document.getElementById('progressFill').style.width = `${progress}%`;
        document.getElementById('progressSlider').value = progress;
        document.getElementById('timeCurrent').textContent = this.formatTime(audioElement.currentTime);
    }
    
    async updateLibraryDisplay(filter = '') {
        const tracksGrid = document.getElementById('tracksGrid');
        tracksGrid.innerHTML = '';
        const lowerCaseFilter = filter.toLowerCase();

        const trackIds = Array.from(this.library.keys());
        
        for (const trackId of trackIds) {
            const track = this.library.get(trackId);
            if(track.title.toLowerCase().includes(lowerCaseFilter) || 
               track.artist.toLowerCase().includes(lowerCaseFilter) ||
               track.album.toLowerCase().includes(lowerCaseFilter)) {
                const trackElement = await this.createTrackElement(track);
                tracksGrid.appendChild(trackElement);
            }
        }
    }

    async createTrackElement(track) {
        const div = document.createElement('div');
        div.className = 'track-item';
        div.dataset.trackId = track.id;
        
        const coverUrl = track.coverAssetId && this.assets.has(track.coverAssetId) 
            ? URL.createObjectURL(this.assets.get(track.coverAssetId).blob) 
            : '';

        div.innerHTML = `
            <div class="track-cover" style="background-image: url('${coverUrl}')"></div>
            <div class="track-info">
                <div class="track-name">${track.title}</div>
                <div class="track-artist">${track.artist}</div>
            </div>
        `;

        div.addEventListener('click', () => {
             this.setQueueAndPlay(Array.from(this.library.keys()), track.id);
        });

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTrackContextMenu(e, track);
        });

        return div;
    }
    
    switchView(viewName, data = null) {
        document.querySelectorAll('.view-container').forEach(v => v.classList.add('hidden'));
        
        const targetView = document.getElementById(`${viewName}View`);
        if(targetView) {
            targetView.classList.remove('hidden');
        }

        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.toggle('active', n.dataset.view === viewName);
        });

        this.loadViewData(viewName, data);
    }

    async loadViewData(viewName, data) {
        switch (viewName) {
            case 'library': await this.updateLibraryDisplay(); break;
            case 'playlists': await this.updatePlaylistsDisplay(); break;
            case 'playlistDetail': await this.updatePlaylistDetailView(data.playlistId); break;
            case 'albums': await this.updateAlbumsDisplay(); break;
            case 'artists': await this.updateArtistsDisplay(); break;
        }
    }
    
    // ===================================
    // EVENT LISTENERS
    // ===================================
    
    setupAllEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            item.addEventListener('click', () => this.switchView(item.dataset.view));
        });

        // Player Controls
        document.getElementById('playPauseBtn').addEventListener('click', () => this.isPlaying ? this.pause() : this.play());
        document.getElementById('nextBtn').addEventListener('click', () => this.playNext());
        document.getElementById('prevBtn').addEventListener('click', () => this.playPrevious());
        document.getElementById('shuffleBtn').addEventListener('click', (e) => this.toggleShuffle(e.currentTarget));
        document.getElementById('repeatBtn').addEventListener('click', (e) => this.toggleRepeat(e.currentTarget));
        document.getElementById('volumeBtn').addEventListener('click', () => this.toggleMute());


        // Progress & Volume
        const progressSlider = document.getElementById('progressSlider');
        progressSlider.addEventListener('input', (e) => this.seek(e.target.value));
        document.getElementById('volumeSlider').addEventListener('input', (e) => this.setVolume(e.target.value / 100));

        // Media Element Events
        const audioElement = document.getElementById('audioElement');
        audioElement.addEventListener('timeupdate', () => this.updateProgressBar());
        audioElement.addEventListener('ended', this.handleTrackEnd.bind(this));

        // File Import
        document.getElementById('importBtn').addEventListener('click', () => document.getElementById('fileInput').click());
        document.getElementById('fileInput').addEventListener('change', (e) => this.importFiles(e.target.files));
        this.setupDragAndDrop();

        // Search
        document.querySelector('.search-input').addEventListener('input', (e) => this.updateLibraryDisplay(e.target.value));

        // Panels & Modals
        this.setupPanelToggle('equalizerBtn', 'equalizerPanel', this.startEQVisualizer.bind(this), this.stopEQVisualizer.bind(this));
        this.setupPanelToggle('settingsBtn', 'themeEditor');
        this.setupPanelToggle('queueBtn', 'queuePanel', this.updateQueueDisplay.bind(this));
        
        document.getElementById('closeEqBtn').addEventListener('click', () => this.hidePanel('equalizerPanel', this.stopEQVisualizer.bind(this)));
        document.getElementById('closeThemeBtn').addEventListener('click', () => this.hidePanel('themeEditor'));
        document.getElementById('closeQueueBtn').addEventListener('click', () => this.hidePanel('queuePanel'));
        
        // Equalizer
        this.setupEQKnobs();
        document.getElementById('eqPresetSelect').addEventListener('change', (e) => this.applyEQPreset(e.target.value));
        
        // Theme Editor
        this.setupThemeEditorEvents();
        
        // Modals
        this.setupMetadataModalEvents();
        this.setupPlaylistEditModalEvents();
        this.setupAlbumEditModalEvents();
        this.setupArtistEditModalEvents();
        
        // Playlist button
        document.getElementById('newPlaylistBtn').addEventListener('click', () => this.createPlaylist());
    }
    
    setupDragAndDrop() {
        const dropZone = document.getElementById('dropZone');
        const mainContent = document.querySelector('.main-content');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            mainContent.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        mainContent.addEventListener('dragenter', () => dropZone.classList.add('active'));

        const onDragLeave = (e) => {
            if (!mainContent.contains(e.relatedTarget)) {
                dropZone.classList.remove('active');
            }
        };
        mainContent.addEventListener('dragleave', onDragLeave);

        mainContent.addEventListener('drop', e => {
            dropZone.classList.remove('active');
            this.importFiles(e.dataTransfer.files);
        });
    }
    
    setupPanelToggle(buttonId, panelId, onShow, onHide) {
        document.getElementById(buttonId).addEventListener('click', () => {
            const panel = document.getElementById(panelId);
            const isHidden = panel.classList.contains('hidden');
            
            ['equalizerPanel', 'themeEditor', 'queuePanel'].forEach(pId => {
                if (pId !== panelId) this.hidePanel(pId, pId === 'equalizerPanel' ? this.stopEQVisualizer.bind(this) : null);
            });
            
            panel.classList.toggle('hidden');
            if (isHidden && onShow) onShow();
            else if (!isHidden && onHide) onHide();
        });
    }

    hidePanel(panelId, onHide) {
        document.getElementById(panelId).classList.add('hidden');
        if (onHide) onHide();
    }
    
    setupThemeEditorEvents() {
        const controls = document.querySelector('.theme-controls');
        controls.addEventListener('input', e => {
            const { id, value } = e.target;
            switch(id) {
                case 'accentColor': this.settings.theme.accentColor = value; break;
                case 'bgColor': this.settings.theme.bgColor = value; break;
                case 'textColor': this.settings.theme.textColor = value; break;
                case 'glassOpacity': 
                    this.settings.theme.glassOpacity = value;
                    e.target.nextElementSibling.textContent = `${value}%`;
                    break;
                case 'blurAmount': 
                    this.settings.theme.blurAmount = value;
                    e.target.nextElementSibling.textContent = `${value}px`;
                    break;
            }
            this.applyTheme(false);
        });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                this.applyThemePreset(e.target.dataset.preset);
            });
        });
        
        document.querySelectorAll('.bg-option').forEach(btn => {
            btn.addEventListener('click', e => {
                document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const bgType = e.target.dataset.bg;
                this.settings.theme.backgroundType = bgType;
                if(bgType === 'gradient') {
                    this.settings.theme.backgroundAssetId = null;
                    this.applyTheme();
                    this.saveSettings();
                } else {
                    document.getElementById('bgFileInput').click();
                }
            })
        });

        document.getElementById('bgFileInput').addEventListener('change', async e => {
            const file = e.target.files[0];
            if(!file) return;

            const assetId = this.generateId();
            const asset = { id: assetId, blob: file, type: file.type };
            await this.saveToStore('assets', asset);
            this.assets.set(assetId, asset);

            this.settings.theme.backgroundAssetId = assetId;
            this.applyTheme();
            this.saveSettings();
        });

        document.getElementById('closeThemeBtn').addEventListener('click', () => this.saveSettings());
    }
    
    setupMetadataModalEvents() {
        const modal = document.getElementById('metadataModal');
        document.getElementById('closeMetadataBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancelMetadataBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('saveMetadataBtn').addEventListener('click', () => this.saveMetadata());
        document.getElementById('uploadCoverBtn').addEventListener('click', () => document.getElementById('coverFileInput').click());
        document.getElementById('coverFileInput').addEventListener('change', (e) => this.handleCoverFileSelect(e));
    }

    setupPlaylistEditModalEvents() {
        const modal = document.getElementById('playlistEditModal');
        document.getElementById('closePlaylistEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancelPlaylistEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('savePlaylistEditBtn').addEventListener('click', () => this.savePlaylistDetails());
        document.getElementById('uploadPlaylistCoverBtn').addEventListener('click', () => document.getElementById('playlistCoverFileInput').click());
        document.getElementById('playlistCoverFileInput').addEventListener('change', e => {
            const file = e.target.files[0];
            if(file) {
                document.getElementById('playlistEditCoverPreview').src = URL.createObjectURL(file);
            }
        });
    }

    setupAlbumEditModalEvents() {
        const modal = document.getElementById('albumEditModal');
        document.getElementById('closeAlbumEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancelAlbumEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('saveAlbumEditBtn').addEventListener('click', () => this.saveAlbumDetails());
        document.getElementById('uploadAlbumCoverBtn').addEventListener('click', () => document.getElementById('albumCoverFileInput').click());
        document.getElementById('albumCoverFileInput').addEventListener('change', e => {
            if (e.target.files[0]) {
                document.getElementById('albumEditCoverPreview').src = URL.createObjectURL(e.target.files[0]);
            }
        });
    }

    setupArtistEditModalEvents() {
        const modal = document.getElementById('artistEditModal');
        document.getElementById('closeArtistEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancelArtistEditBtn').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('saveArtistEditBtn').addEventListener('click', () => this.saveArtistDetails());
    }
    
    toggleShuffle(button) {
        this.shuffle = !this.shuffle;
        button.classList.toggle('active', this.shuffle);
        this.showToast(`Shuffle ${this.shuffle ? 'activado' : 'desactivado'}`, 'info');
        this.generateShuffledQueue();
    }

    toggleRepeat(button) {
        const states = ['none', 'all', 'one'];
        const current = states.indexOf(this.repeat);
        this.repeat = states[(current + 1) % states.length];
        button.classList.toggle('active', this.repeat !== 'none');
        this.showToast(`Repetir: ${this.repeat}`, 'info');
    }
    
    handleTrackEnd() {
        if (this.repeat === 'one') {
            this.seek(0);
            this.play();
        } else if (this.currentIndex === this.queue.length - 1 && this.repeat !== 'all') {
            this.pause();
        } else {
            this.playNext();
        }
    }
    
    // ===================================
    // THEME MANAGEMENT
    // ===================================
    
    async applyTheme(fromSettings = true) {
        if (fromSettings) {
            document.getElementById('accentColor').value = this.settings.theme.accentColor;
            document.getElementById('bgColor').value = this.settings.theme.bgColor;
            document.getElementById('textColor').value = this.settings.theme.textColor;
            document.getElementById('glassOpacity').value = this.settings.theme.glassOpacity;
            document.getElementById('blurAmount').value = this.settings.theme.blurAmount;
        }

        const root = document.documentElement;
        root.style.setProperty('--accent', this.settings.theme.accentColor);
        root.style.setProperty('--bg-primary', this.settings.theme.bgColor);
        root.style.setProperty('--text-primary', this.settings.theme.textColor);
        root.style.setProperty('--glass-opacity', this.settings.theme.glassOpacity / 100);
        root.style.setProperty('--blur-amount', `${this.settings.theme.blurAmount}px`);
        
        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
        };
        const rgb = hexToRgb(this.settings.theme.accentColor);
        if(rgb) root.style.setProperty('--accent-rgb', rgb);

        const bgImageEl = document.querySelector('.background-image');
        const bgVideoEl = document.getElementById('bgVideo');
        bgImageEl.style.display = 'none';
        bgVideoEl.style.display = 'none';

        if (this.settings.theme.backgroundType !== 'gradient' && this.settings.theme.backgroundAssetId) {
            const asset = this.assets.get(this.settings.theme.backgroundAssetId);
            if (asset) {
                const url = URL.createObjectURL(asset.blob);
                if(asset.type.startsWith('image')) {
                    bgImageEl.style.backgroundImage = `url(${url})`;
                    bgImageEl.style.display = 'block';
                } else if(asset.type.startsWith('video')) {
                    bgVideoEl.src = url;
                    bgVideoEl.style.display = 'block';
                    bgVideoEl.play();
                }
            }
        }
    }

    applyThemePreset(presetName) {
        const presets = {
            dark: { accentColor: '#6366f1', bgColor: '#0f172a', textColor: '#ffffff' },
            neon: { accentColor: '#34d399', bgColor: '#111827', textColor: '#f9fafb' },
            pastel: { accentColor: '#f472b6', bgColor: '#fff1f2', textColor: '#831843' },
            minimal: { accentColor: '#1f2937', bgColor: '#f9fafb', textColor: '#1f2937' },
        };
        const preset = presets[presetName];
        if (preset) {
            this.settings.theme = { ...this.settings.theme, ...preset };
            this.applyTheme();
            this.saveSettings();
        }
    }

    // ===================================
    // EQUALIZER
    // ===================================

    setupEQKnobs() {
        const knobs = document.querySelectorAll('.eq-knob');
        knobs.forEach((knob, index) => {
            let isDragging = false;
            let startAngle = 0;
            let currentAngle = 0;
            const valueDisplay = knob.parentElement.querySelector('.eq-value');

            const gainToAngle = (gain) => (gain + 12) / 24 * 270 - 135;
            const angleToGain = (angle) => ((angle + 135) / 270) * 24 - 12;
            
            const initialGain = this.settings.customEq[index] || 0;
            currentAngle = gainToAngle(initialGain);
            knob.style.transform = `rotate(${currentAngle}deg)`;
            if (valueDisplay) valueDisplay.textContent = `${initialGain.toFixed(1)}dB`;


            const startDrag = (e) => {
                isDragging = true;
                const rect = knob.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const clientX = e.clientX || e.touches[0].clientX;
                const clientY = e.clientY || e.touches[0].clientY;
                const startX = clientX - centerX;
                const startY = clientY - centerY;
                startAngle = Math.atan2(startY, startX) * (180 / Math.PI) - currentAngle;
                document.body.style.cursor = 'grabbing';
            };

            const drag = (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const rect = knob.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                const clientX = e.clientX || e.touches[0].clientX;
                const clientY = e.clientY || e.touches[0].clientY;
                const moveX = clientX - centerX;
                const moveY = clientY - centerY;
                
                let angle = Math.atan2(moveY, moveX) * (180 / Math.PI) - startAngle;
                angle = Math.max(-135, Math.min(135, angle));
                
                currentAngle = angle;
                knob.style.transform = `rotate(${currentAngle}deg)`;

                const gain = angleToGain(angle);
                this.setEQGain(index, gain);
                if (valueDisplay) valueDisplay.textContent = `${gain.toFixed(1)}dB`;
                
                document.getElementById('eqPresetSelect').value = 'custom';
                this.settings.eqPreset = 'custom';
            };

            const stopDrag = () => {
                if (!isDragging) return;
                isDragging = false;
                document.body.style.cursor = 'default';
                this.saveSettings();
            };

            knob.addEventListener('mousedown', startDrag);
            knob.addEventListener('touchstart', startDrag);

            document.addEventListener('mousemove', drag);
            document.addEventListener('touchmove', drag, { passive: false });

            document.addEventListener('mouseup', stopDrag);
            document.addEventListener('touchend', stopDrag);
        });
    }

    setEQGain(bandIndex, gain) {
        if (this.eqNodes[bandIndex]) {
            this.eqNodes[bandIndex].gain.value = gain;
            this.settings.customEq[bandIndex] = gain;
        }
    }

    applyEQPreset(presetName, save = true) {
        const presets = {
            flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            rock: [5, 3, 1, -2, -1, 1, 3, 4, 5, 5],
            pop: [-1, 1, 3, 4, 3, 1, -1, -1, 0, 0],
            jazz: [4, 2, 1, 2, -1, -1, 0, 1, 3, 4],
            classical: [-1, 0, 0, 0, 0, 0, 0, 2, 3, 4],
            bass: [6, 5, 4, 2, 0, -1, -2, -2, -3, -3],
            custom: this.settings.customEq,
        };
        const preset = presets[presetName] || presets.flat;
        preset.forEach((gain, index) => this.setEQGain(index, gain));
        this.settings.eqPreset = presetName;
        document.getElementById('eqPresetSelect').value = presetName;
        this.updateEQDisplay();
        if(save) this.saveSettings();
    }

    updateEQDisplay() {
        const bands = document.querySelectorAll('.eq-band');
        const gainToAngle = (gain) => (gain + 12) / 24 * 270 - 135;
        this.eqNodes.forEach((node, index) => {
            if (bands[index]) {
                const knob = bands[index].querySelector('.eq-knob');
                const valueDisplay = bands[index].querySelector('.eq-value');
                const angle = gainToAngle(node.gain.value);
                knob.style.transform = `rotate(${angle}deg)`;
                if (valueDisplay) valueDisplay.textContent = `${node.gain.value.toFixed(1)}dB`;
            }
        });
    }

    // ===================================
    // VISUALIZERS
    // ===================================

    startVisualizer() {
        this.stopVisualizer();
        const canvas = document.getElementById('visualizerCanvas');
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.visualizerAnimationId = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength) * 1.5;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i] / 2.5;
                ctx.fillStyle = `rgba(${getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')}, 0.7)`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 2;
            }
        };
        draw();
    }
    stopVisualizer() { cancelAnimationFrame(this.visualizerAnimationId); }
    
    startEQVisualizer() {
        this.stopEQVisualizer();
        const canvas = document.getElementById('eqVisualizerCanvas');
        if (!canvas || !this.analyser) return;

        // CAMBIO: Se redimensiona el canvas justo antes de empezar a dibujar
        this.resizeCanvases();

        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const width = canvas.width;
        const height = canvas.height;

        const draw = () => {
            if (!this.eqVisualizerAnimationId) return;
            this.eqVisualizerAnimationId = requestAnimationFrame(draw);
            
            this.analyser.getByteFrequencyData(dataArray);
            
            ctx.clearRect(0, 0, width, height);
            
            const accentRGB = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb');
            
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, `rgba(${accentRGB}, 0.5)`);
            gradient.addColorStop(1, `rgba(${accentRGB}, 0)`);
            ctx.fillStyle = gradient;
            
            ctx.beginPath();
            ctx.moveTo(0, height);
            
            const sliceWidth = width * 1.0 / bufferLength;
            let x = 0;

            for(let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 255.0;
                const y = height - (v * height);
                ctx.lineTo(x, y);
                x += sliceWidth;
            }

            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fill();

            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(${accentRGB}, 0.8)`;
            ctx.beginPath();
            x = 0; // Reiniciar x para la línea
            for(let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 255.0;
                const y = height - (v * height);
                 if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            // CAMBIO: Se asegura que la línea llegue hasta el final del canvas
            ctx.lineTo(width, height - (dataArray[bufferLength-1] / 255.0 * height));
            ctx.stroke();
        };

        this.eqVisualizerAnimationId = requestAnimationFrame(draw);
    }

    stopEQVisualizer() { 
        if (this.eqVisualizerAnimationId) {
            cancelAnimationFrame(this.eqVisualizerAnimationId);
            this.eqVisualizerAnimationId = null;
        }
    }

    // ===================================
    // PLAYLISTS, ALBUMS, ARTISTS
    // ===================================
    
    async createPlaylist() {
        const name = prompt("Nombre de la nueva playlist:");
        if (!name || name.trim() === '') return;

        const playlist = {
            id: this.generateId(),
            name,
            trackIds: [],
            coverAssetId: null,
            createdAt: Date.now()
        };
        
        await this.saveToStore('playlists', playlist);
        this.playlists.set(playlist.id, playlist);
        await this.updatePlaylistsDisplay();
        this.showToast(`Playlist "${name}" creada`, 'success');
    }

    async updatePlaylistsDisplay() {
        const grid = document.getElementById('playlistsGrid');
        grid.innerHTML = '';

        const sortedPlaylists = Array.from(this.playlists.values())
            .sort((a, b) => b.createdAt - a.createdAt);

        for (const playlist of sortedPlaylists) {
            const element = await this.createPlaylistElement(playlist);
            grid.appendChild(element);
        }
    }

    async createPlaylistElement(playlist) {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.dataset.playlistId = playlist.id;

        let coverUrl = '';
        if (playlist.coverAssetId && this.assets.has(playlist.coverAssetId)) {
             coverUrl = URL.createObjectURL(this.assets.get(playlist.coverAssetId).blob);
        } else if (playlist.trackIds.length > 0) {
            const firstTrack = this.library.get(playlist.trackIds[0]);
            if (firstTrack && firstTrack.coverAssetId && this.assets.has(firstTrack.coverAssetId)) {
                coverUrl = URL.createObjectURL(this.assets.get(firstTrack.coverAssetId).blob);
            }
        }

        div.innerHTML = `
            <button class="edit-btn" aria-label="Editar playlist">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <div class="playlist-cover" style="background-image: url('${coverUrl}')"></div>
            <div class="playlist-info">
                <div class="playlist-name">${playlist.name}</div>
                <div class="playlist-track-count">${playlist.trackIds.length} canciones</div>
            </div>
        `;
        
        div.addEventListener('click', () => {
            this.switchView('playlistDetail', { playlistId: playlist.id });
        });
        
        div.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showPlaylistEditor(playlist);
        });

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showPlaylistContextMenu(e, playlist);
        });

        return div;
    }

    async updatePlaylistDetailView(playlistId) {
        const playlist = this.playlists.get(playlistId);
        if(!playlist) return;

        document.getElementById('playlistDetailName').textContent = playlist.name;
        
        let totalDuration = 0;
        playlist.trackIds.forEach(tid => {
            const track = this.library.get(tid);
            if(track) totalDuration += track.duration;
        });

        document.getElementById('playlistDetailStats').textContent = 
            `${playlist.trackIds.length} canciones, ${this.formatTime(totalDuration)}`;

        let coverUrl = '';
         if (playlist.coverAssetId && this.assets.has(playlist.coverAssetId)) {
             coverUrl = URL.createObjectURL(this.assets.get(playlist.coverAssetId).blob);
        } else if (playlist.trackIds.length > 0) {
            const firstTrack = this.library.get(playlist.trackIds[0]);
            if (firstTrack && firstTrack.coverAssetId && this.assets.has(firstTrack.coverAssetId)) {
                coverUrl = URL.createObjectURL(this.assets.get(firstTrack.coverAssetId).blob);
            }
        }
        document.getElementById('playlistDetailCover').src = coverUrl;
        
        document.getElementById('playPlaylistBtn').onclick = () => {
            if (playlist.trackIds.length > 0) {
                this.setQueueAndPlay(playlist.trackIds, playlist.trackIds[0]);
            }
        };

        const grid = document.getElementById('playlistTracksGrid');
        grid.innerHTML = '';
        for(const trackId of playlist.trackIds) {
            const track = this.library.get(trackId);
            if(track) {
                const trackElement = await this.createTrackElement(track);
                trackElement.onclick = () => this.setQueueAndPlay(playlist.trackIds, trackId);
                grid.appendChild(trackElement);
            }
        }
    }

    async updateAlbumsDisplay() {
        const grid = document.getElementById('albumsGrid');
        grid.innerHTML = '';
        for (const album of this.albums.values()) {
            const element = await this.createAlbumElement(album);
            grid.appendChild(element);
        }
    }

    async createAlbumElement(album) {
        const div = document.createElement('div');
        div.className = 'album-item';
        div.dataset.albumId = album.id;
        
        const coverUrl = album.coverAssetId && this.assets.has(album.coverAssetId)
            ? URL.createObjectURL(this.assets.get(album.coverAssetId).blob)
            : '';

        div.innerHTML = `
            <button class="edit-btn" aria-label="Editar álbum">
                 <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <div class="album-cover" style="background-image: url('${coverUrl}')"></div>
            <div class="album-info">
                <div class="album-name">${album.name}</div>
                <div class="album-artist">${album.artist}</div>
            </div>
        `;
        
        div.addEventListener('click', () => {
            if(album.trackIds.length > 0) {
                const sortedTracks = album.trackIds
                    .map(id => this.library.get(id))
                    .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0))
                    .map(t => t.id);
                this.setQueueAndPlay(sortedTracks, sortedTracks[0]);
            }
        });
        
        div.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showAlbumEditor(album);
        });

        return div;
    }

    async updateArtistsDisplay() {
        const artistsData = new Map();
        for (const track of this.library.values()) {
            if (!artistsData.has(track.artist)) {
                artistsData.set(track.artist, { name: track.artist, trackIds: [] });
            }
            artistsData.get(track.artist).trackIds.push(track.id);
        }
        
        const grid = document.getElementById('artistsGrid');
        grid.innerHTML = '';
        for (const artist of artistsData.values()) {
            const element = await this.createArtistElement(artist);
            grid.appendChild(element);
        }
    }

    async createArtistElement(artist) {
        const div = document.createElement('div');
        div.className = 'artist-item';

        const firstTrackWithCover = artist.trackIds.map(id => this.library.get(id)).find(t => t.coverAssetId);
        const coverUrl = firstTrackWithCover && this.assets.has(firstTrackWithCover.coverAssetId)
            ? URL.createObjectURL(this.assets.get(firstTrackWithCover.coverAssetId).blob)
            : '';

        div.innerHTML = `
             <button class="edit-btn" aria-label="Editar artista">
                 <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
             <div class="artist-cover" style="background-image: url('${coverUrl}')"></div>
             <div class="artist-info">
                <div class="artist-name">${artist.name}</div>
                <div class="artist-track-count">${artist.trackIds.length} canciones</div>
             </div>
        `;
        
        div.addEventListener('click', () => {
            if (artist.trackIds.length > 0) {
                this.setQueueAndPlay(artist.trackIds, artist.trackIds[0]);
            }
        });

        div.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showArtistEditor(artist.name);
        });

        return div;
    }

    // ===================================
    // CONTEXT MENUS & MODALS
    // ===================================
    
    showTrackContextMenu(event, track) {
        document.querySelector('.context-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'context-menu glass-panel';
        menu.style.cssText = `left: ${event.clientX}px; top: ${event.clientY}px;`;
        
        let playlistItems = '';
        if(this.playlists.size > 0){
             playlistItems += `<div class="context-divider"></div>`;
             for(const playlist of this.playlists.values()){
                 playlistItems += `<button class="glass-btn" data-action="addToSpecificPlaylist" data-playlist-id="${playlist.id}">Añadir a ${playlist.name}</button>`;
             }
        }
        menu.innerHTML = `
            <button class="glass-btn" data-action="addToQueue">Agregar a Cola</button>
            <button class="glass-btn" data-action="editMetadata">Editar</button>
            <button class="glass-btn" data-action="delete">Eliminar</button>
            ${playlistItems}
        `;
        document.body.appendChild(menu);
        this.addContextMenuListeners(menu, (action, button) => {
            this.handleContextAction(action, {track}, button.dataset.playlistId);
        });
    }
    
    showPlaylistContextMenu(event, playlist) {
        document.querySelector('.context-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'context-menu glass-panel';
        menu.style.cssText = `left: ${event.clientX}px; top: ${event.clientY}px;`;
        menu.innerHTML = `
            <button class="glass-btn" data-action="editPlaylist">Editar</button>
            <button class="glass-btn" data-action="deletePlaylist">Eliminar</button>
        `;
        document.body.appendChild(menu);
        this.addContextMenuListeners(menu, (action) => this.handleContextAction(action, {playlist}));
    }

    addContextMenuListeners(menu, callback) {
        menu.addEventListener('click', e => {
            const button = e.target.closest('button');
            if (button && button.dataset.action) {
                callback(button.dataset.action, button);
                menu.remove();
            }
        });
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu, { once: true, capture: true }), 0);
    }


    async handleContextAction(action, data, playlistId) {
        const { track, playlist, album, artist } = data;
        switch (action) {
            case 'addToQueue':
                if(!this.queue.includes(track.id)) {
                    this.queue.push(track.id);
                    this.generateShuffledQueue();
                    this.updateQueueDisplay();
                    this.showToast('Agregado a la cola', 'success');
                }
                break;
            case 'editMetadata': this.showMetadataEditor(track); break;
            case 'delete':
                if (confirm(`¿Seguro que quieres eliminar "${track.title}"?`)) {
                    await this.deleteTrack(track.id);
                }
                break;
            case 'addToSpecificPlaylist': await this.addTrackToPlaylist(playlistId, track.id); break;
            case 'editPlaylist': this.showPlaylistEditor(playlist); break;
            case 'deletePlaylist':
                 if (confirm(`¿Seguro que quieres eliminar la playlist "${playlist.name}"?`)) {
                    await this.deletePlaylist(playlist.id);
                }
                break;
        }
    }

    async addTrackToPlaylist(playlistId, trackId) {
        const playlist = this.playlists.get(playlistId);
        if (playlist && !playlist.trackIds.includes(trackId)) {
            playlist.trackIds.push(trackId);
            await this.saveToStore('playlists', playlist);
            this.showToast(`Añadido a ${playlist.name}`, 'success');
            if(!document.getElementById('playlistsView').classList.contains('hidden')) {
                await this.updatePlaylistsDisplay();
            }
        } else {
             this.showToast(`La canción ya está en ${playlist.name}`, 'info');
        }
    }
    
    showMetadataEditor(track) {
        const modal = document.getElementById('metadataModal');
        modal.dataset.trackId = track.id;
        document.getElementById('metaTitle').value = track.title;
        document.getElementById('metaArtist').value = track.artist;
        document.getElementById('metaAlbum').value = track.album;
        document.getElementById('metaTrackNumber').value = track.trackNumber || '';
        const preview = document.getElementById('metaCoverPreview');
        preview.src = (track.coverAssetId && this.assets.has(track.coverAssetId)) 
            ? URL.createObjectURL(this.assets.get(track.coverAssetId).blob) : '';
        modal.classList.remove('hidden');
    }
    
    showPlaylistEditor(playlist) {
        const modal = document.getElementById('playlistEditModal');
        modal.dataset.playlistId = playlist.id;
        document.getElementById('playlistEditName').value = playlist.name;
        const preview = document.getElementById('playlistEditCoverPreview');
        preview.src = (playlist.coverAssetId && this.assets.has(playlist.coverAssetId))
            ? URL.createObjectURL(this.assets.get(playlist.coverAssetId).blob) : '';
        modal.classList.remove('hidden');
    }

    showAlbumEditor(album) {
        const modal = document.getElementById('albumEditModal');
        modal.dataset.albumId = album.id;
        document.getElementById('albumEditName').value = album.name;
        document.getElementById('albumEditArtist').value = album.artist;
        const preview = document.getElementById('albumEditCoverPreview');
        preview.src = (album.coverAssetId && this.assets.has(album.coverAssetId))
            ? URL.createObjectURL(this.assets.get(album.coverAssetId).blob) : '';
        modal.classList.remove('hidden');
    }
    
    showArtistEditor(artistName) {
        const modal = document.getElementById('artistEditModal');
        modal.dataset.originalArtistName = artistName;
        document.getElementById('artistEditName').value = artistName;
        modal.classList.remove('hidden');
    }

    async savePlaylistDetails() {
        const modal = document.getElementById('playlistEditModal');
        const playlistId = modal.dataset.playlistId;
        const playlist = this.playlists.get(playlistId);
        if (!playlist) return;

        playlist.name = document.getElementById('playlistEditName').value;
        
        const coverInput = document.getElementById('playlistCoverFileInput');
        if (coverInput.files && coverInput.files[0]) {
            const file = coverInput.files[0];
            const coverAssetId = playlist.coverAssetId || `cover_${playlist.id}`;
            const asset = { id: coverAssetId, blob: file, type: file.type };
            await this.saveToStore('assets', asset);
            this.assets.set(coverAssetId, asset);
            playlist.coverAssetId = coverAssetId;
        }

        await this.saveToStore('playlists', playlist);
        await this.updatePlaylistsDisplay();
        
        coverInput.value = '';
        modal.classList.add('hidden');
        this.showToast('Playlist guardada', 'success');
    }

    async saveAlbumDetails() {
        const modal = document.getElementById('albumEditModal');
        const albumId = modal.dataset.albumId;
        const album = this.albums.get(albumId);
        if (!album) return;

        const oldArtist = album.artist;
        const oldAlbumName = album.name;
        
        album.name = document.getElementById('albumEditName').value;
        album.artist = document.getElementById('albumEditArtist').value;

        const coverInput = document.getElementById('albumCoverFileInput');
        if (coverInput.files && coverInput.files[0]) {
            const file = coverInput.files[0];
            const coverAssetId = album.coverAssetId || `cover_${album.id}`;
            const asset = { id: coverAssetId, blob: file, type: file.type };
            await this.saveToStore('assets', asset);
            this.assets.set(coverAssetId, asset);
            album.coverAssetId = coverAssetId;
        }

        await this.saveToStore('albums', album);
        
        for (const trackId of album.trackIds) {
            const track = this.library.get(trackId);
            if (track && track.album === oldAlbumName && track.artist === oldArtist) {
                track.album = album.name;
                track.artist = album.artist;
                await this.saveToStore('tracks', track);
            }
        }
        
        await this.updateAlbumsDisplay();
        await this.updateArtistsDisplay();
        coverInput.value = '';
        modal.classList.add('hidden');
        this.showToast('Álbum guardado', 'success');
    }

    async saveArtistDetails() {
        const modal = document.getElementById('artistEditModal');
        const originalName = modal.dataset.originalArtistName;
        const newName = document.getElementById('artistEditName').value;

        if (!newName || newName === originalName) {
            modal.classList.add('hidden');
            return;
        }

        if(!confirm(`Esto cambiará el nombre de "${originalName}" a "${newName}" en todas las canciones y álbumes. ¿Continuar?`)) {
            return;
        }

        for (const track of this.library.values()) {
            if (track.artist === originalName) {
                track.artist = newName;
                await this.saveToStore('tracks', track);
            }
        }
        
        for (const album of this.albums.values()) {
            if (album.artist === originalName) {
                album.artist = newName;
                await this.saveToStore('albums', album);
            }
        }

        await this.updateArtistsDisplay();
        await this.updateAlbumsDisplay();
        modal.classList.add('hidden');
        this.showToast('Artista actualizado', 'success');
    }


    async deletePlaylist(playlistId) {
        const playlist = this.playlists.get(playlistId);
        if (!playlist) return;
        
        await this.deleteFromStore('playlists', playlistId);
        this.playlists.delete(playlistId);

        await this.updatePlaylistsDisplay();
        this.showToast(`Playlist "${playlist.name}" eliminada`, 'success');
    }

    async handleCoverFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const preview = document.getElementById('metaCoverPreview');
        preview.src = URL.createObjectURL(file);
    }
    
    async saveMetadata() {
        const modal = document.getElementById('metadataModal');
        const trackId = modal.dataset.trackId;
        const track = this.library.get(trackId);
        if (!track) return;

        track.title = document.getElementById('metaTitle').value;
        track.artist = document.getElementById('metaArtist').value;
        track.album = document.getElementById('metaAlbum').value;
        track.trackNumber = parseInt(document.getElementById('metaTrackNumber').value, 10) || 1;

        const coverInput = document.getElementById('coverFileInput');
        if (coverInput.files && coverInput.files[0]) {
            const file = coverInput.files[0];
            const coverAssetId = track.coverAssetId || `cover_${track.id}`;
            const coverAsset = { id: coverAssetId, type: 'image', blob: file };
            await this.saveToStore('assets', coverAsset);
            this.assets.set(coverAssetId, coverAsset);
            track.coverAssetId = coverAssetId;
        }

        await this.saveToStore('tracks', track);
        this.library.set(trackId, track);

        await this.updateLibraryDisplay();
        if (this.currentTrackId === trackId) {
            this.updatePlayerDisplay(track);
        }
        
        coverInput.value = '';
        modal.classList.add('hidden');
        this.showToast('Metadatos guardados', 'success');
    }

    async deleteTrack(trackId) {
        const track = this.library.get(trackId);
        if (!track) return;

        await this.deleteFromStore('tracks', trackId);
        if (track.fileAssetId) await this.deleteFromStore('assets', track.fileAssetId);
        if (track.coverAssetId) await this.deleteFromStore('assets', track.coverAssetId);

        this.library.delete(trackId);
        if (track.fileAssetId) this.assets.delete(track.fileAssetId);
        if (track.coverAssetId) this.assets.delete(track.coverAssetId);

        this.queue = this.queue.filter(id => id !== trackId);
        this.generateShuffledQueue();

        await this.updateLibraryDisplay();
        this.updateQueueDisplay();
        this.showToast('Canción eliminada', 'success');
    }
    
    // ===================================
    // QUEUE MANAGEMENT
    // ===================================
    
    updateQueueDisplay() {
        const listEl = document.getElementById('queueList');
        listEl.innerHTML = '';
        const currentQueue = this.shuffle ? this.shuffledQueue : this.queue;
        
        currentQueue.forEach((trackId, index) => {
            const track = this.library.get(trackId);
            if (track) {
                const item = document.createElement('div');
                item.className = 'queue-item';
                item.classList.toggle('playing', this.currentTrackId === trackId);
                item.dataset.trackId = trackId;
                
                const coverUrl = track.coverAssetId && this.assets.has(track.coverAssetId)
                    ? URL.createObjectURL(this.assets.get(track.coverAssetId).blob)
                    : '';
                
                item.innerHTML = `
                    <img class="queue-item-cover" src="${coverUrl}" alt="Cover">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${track.title}</div>
                        <div class="queue-item-artist">${track.artist}</div>
                    </div>
                `;
                item.addEventListener('click', () => {
                    this.currentIndex = index;
                    this.play(trackId);
                });
                listEl.appendChild(item);
            }
        });
    }

    // ===================================
    // MEDIA SESSION API
    // ===================================

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrevious());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
        }
    }

    updateMediaSessionMetadata(track) {
        if ('mediaSession' in navigator) {
            const artwork = [];
            if (track.coverAssetId && this.assets.has(track.coverAssetId)) {
                const asset = this.assets.get(track.coverAssetId);
                artwork.push({ src: URL.createObjectURL(asset.blob), type: asset.blob.type });
            }
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title,
                artist: track.artist,
                album: track.album,
                artwork: artwork
            });
        }
    }
    
    updateMediaSessionState(state) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = state;
        }
    }

    // ===================================
    // UTILITIES
    // ===================================
    
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${min}:${sec}`;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}


// ===================================
// INITIALIZE APP
// ===================================
document.addEventListener('DOMContentLoaded', () => {
    window.finalPlayer = new FinalPlayer();
});

