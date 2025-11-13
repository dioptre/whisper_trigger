// Voice Activity Detection using AudioWorklet and FFT-based algorithm
// Based on: Moattar & Homayoonpoor (2010) paper
// Using: https://github.com/thurti/vad-audio-worklet

class VoiceActivityDetector {
    constructor(options = {}) {
        this.options = options;
        this.minSpeechDuration = options.minSpeechDuration || 300; // ms
        this.silenceDuration = options.silenceDuration || 1000; // ms
        this.sampleRate = 16000; // Whisper expects 16kHz

        this.isSpeaking = false;
        this.speechStartTime = null;
        this.lastSpeechTime = null;
        this.audioChunks = [];

        this.audioContext = null;
        this.mediaStream = null;
        this.vadNode = null;
        this.analyser = null;
        this.processor = null;
        this.source = null;

        this.onSpeechStart = null;
        this.onSpeechEnd = null;
        this.onAudioLevel = null;

        // Silence timer
        this.silenceTimer = null;
    }

    async initialize() {
        try {
            // Get audio constraints from options
            const echoCancellation = this.options?.echoCancellation !== false;
            const noiseSuppression = this.options?.noiseSuppression !== false;
            const autoGainControl = this.options?.autoGainControl !== false;

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation,
                    noiseSuppression,
                    autoGainControl,
                    sampleRate: this.sampleRate
                }
            });

            console.log('Audio constraints:', { echoCancellation, noiseSuppression, autoGainControl });

            // Create audio context with target sample rate
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate
            });

            // Load AudioWorklet modules with cache busting
            const cacheBust = Date.now();
            await this.audioContext.audioWorklet.addModule(`/vad-audio-worklet.js?v=${cacheBust}`);
            await this.audioContext.audioWorklet.addModule(`/audio-capture-worklet.js?v=${cacheBust}`);

            // Create VAD node with initial thresholds
            const fftSize = parseInt(this.options?.fftSize || 128);
            const vadDebug = this.options?.vadDebug !== false;

            this.vadNode = new AudioWorkletNode(this.audioContext, "vad", {
                outputChannelCount: [1],
                processorOptions: {
                    sampleRate: this.audioContext.sampleRate,
                    fftSize: fftSize,
                    energyThreshold: parseFloat(this.options?.energyThreshold || 25),
                    frequencyThreshold: parseFloat(this.options?.frequencyThreshold || 120),
                    sfmThreshold: parseFloat(this.options?.sfmThreshold || 8),
                    debug: vadDebug
                }
            });

            console.log('VAD initialized with:', { fftSize, vadDebug });

            // Listen for VAD events
            this.vadNode.port.onmessage = (event) => {
                if (event.data.cmd === 'log') {
                    // Debug logging from VAD - only show if count > 0
                    const data = event.data.data;
                    if (data.count > 0) {
                        //console.log(`🎯 VAD [Frame ${data.frame}] count=${data.count}, speech=${data.speech_frames}, silence=${data.silence_frames}`, data);
                    }
                } else {
                    this.handleVADEvent(event.data);
                }
            };

            // Create audio capture worklet (replaces ScriptProcessor)
            this.captureNode = new AudioWorkletNode(this.audioContext, "audio-capture", {
                outputChannelCount: [1]
            });

            // Listen for captured audio data
            this.captureNode.port.onmessage = (event) => {
                if (event.data.type === 'audiodata') {
                    this.processAudioChunk(event.data.data);
                }
            };

            // Create analyser for visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;

            // Create source from microphone
            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Connect audio graph
            // Source -> VAD (for detection)
            // Source -> CaptureNode (for raw audio)
            // Source -> Analyser (for visualization)
            // NOTE: Do NOT connect to destination to avoid feedback loop!
            this.source.connect(this.vadNode);
            this.source.connect(this.captureNode);
            this.source.connect(this.analyser);

            // Start visualization loop
            this.startVisualization();

            return true;
        } catch (error) {
            console.error('Failed to initialize audio:', error);
            throw error;
        }
    }

    handleVADEvent(event) {
        const cmd = event.cmd;
        const now = Date.now();

        console.log(`📢 VAD EVENT: ${cmd} at ${new Date().toLocaleTimeString()}`);

        if (cmd === "speech") {
            // Speech detected by VAD
            console.log("✅ VAD: Speech detected");

            // Clear any pending silence timer
            if (this.silenceTimer) {
                console.log("Clearing existing silence timer");
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }

            if (!this.isSpeaking) {
                // Start of speech
                console.log("🎤 Starting new speech capture");
                this.isSpeaking = true;
                this.speechStartTime = now;
                this.audioChunks = [];

                if (this.onSpeechStart) {
                    this.onSpeechStart();
                }
            }

            this.lastSpeechTime = now;

        } else if (cmd === "silence") {
            // Silence detected by VAD
            console.log("🔇 VAD: Silence detected");
            console.log("Currently speaking?", this.isSpeaking);

            if (this.isSpeaking) {
                // Start silence timer
                if (this.silenceTimer) {
                    console.log("Clearing previous silence timer");
                    clearTimeout(this.silenceTimer);
                }

                console.log(`⏲️ Starting ${this.silenceDuration}ms silence timer`);
                this.silenceTimer = setTimeout(() => {
                    const speechDurationMs = this.lastSpeechTime - this.speechStartTime;
                    console.log(`⏰ Silence timer fired! Speech duration: ${speechDurationMs}ms`);

                    // Only process if speech was long enough
                    if (speechDurationMs >= this.minSpeechDuration) {
                        console.log("✅ Speech long enough, ending speech");
                        this.endSpeech();
                    } else {
                        // Speech was too short, discard
                        console.log(`❌ Speech too short (${speechDurationMs}ms), discarding`);
                        this.isSpeaking = false;
                        this.audioChunks = [];
                    }
                }, this.silenceDuration);
            } else {
                console.log("Not currently speaking, ignoring silence event");
            }
        } else {
            console.log(`⚠️ Unknown VAD command: ${cmd}`);
        }
    }

    processAudioChunk(audioData) {
        // Store audio chunk if we're in speech mode
        if (this.isSpeaking) {
            this.audioChunks.push(new Float32Array(audioData));
            // Keep updating last speech time while we're capturing
            this.lastSpeechTime = Date.now();
        }
    }

    startVisualization() {
        const updateVisuals = () => {
            if (!this.analyser) return;

            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteTimeDomainData(dataArray);

            // Calculate RMS for visualization
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                const normalized = (dataArray[i] - 128) / 128;
                sum += normalized * normalized;
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const normalized = Math.min(100, rms * 300);

            if (this.onAudioLevel) {
                this.onAudioLevel(normalized, rms);
            }

            requestAnimationFrame(updateVisuals);
        };

        updateVisuals();
    }

    endSpeech() {
        if (this.audioChunks.length === 0) {
            this.isSpeaking = false;
            return;
        }

        console.log(`Processing ${this.audioChunks.length} audio chunks`);

        // Combine all audio chunks
        const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const combinedAudio = new Float32Array(totalLength);

        let offset = 0;
        for (const chunk of this.audioChunks) {
            combinedAudio.set(chunk, offset);
            offset += chunk.length;
        }

        // Call callback with audio data
        if (this.onSpeechEnd) {
            this.onSpeechEnd(combinedAudio);
        }

        // Reset state
        this.isSpeaking = false;
        this.audioChunks = [];
    }

    updateSettings(settings) {
        if (settings.minSpeechDuration !== undefined) {
            this.minSpeechDuration = settings.minSpeechDuration;
        }
        if (settings.silenceDuration !== undefined) {
            this.silenceDuration = settings.silenceDuration;
        }
    }

    stop() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }
        if (this.captureNode) {
            this.captureNode.disconnect();
        }
        if (this.analyser) {
            this.analyser.disconnect();
        }
        if (this.vadNode) {
            this.vadNode.disconnect();
        }
        if (this.source) {
            this.source.disconnect();
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
    }
}

// Audio utilities
function float32ToWav(float32Array, sampleRate) {
    // Convert Float32Array to WAV format
    const buffer = new ArrayBuffer(44 + float32Array.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + float32Array.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM
    view.setUint16(20, 1, true); // Linear PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, float32Array.length * 2, true);

    // Convert float32 to int16
    const volume = 0.8;
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

// Main application
class WhisperTriggerApp {
    constructor() {
        this.vad = null;
        this.isRunning = false;
        this.speechCount = 0;

        // Wake word detection - will be set from UI after initializeUI()
        this.wakeWord = "";
        this.isAwake = false; // Whether wake word has been detected
        this.wakeWordMode = true; // Whether to use wake word detection

        // Mirror playback state
        this.isMirrorSpeaking = false;

        this.initializeUI();

        // Set wake word from UI after elements are initialized
        this.wakeWord = this.elements.wakeWord.value;
        console.log('Initial wake word set to:', this.wakeWord);

        // Load API keys from environment variables if available
        if (import.meta.env.VITE_GROQ_API_KEY && !this.elements.apiKey.value) {
            this.elements.apiKey.value = import.meta.env.VITE_GROQ_API_KEY;
            console.log('✅ Loaded Groq API key from .env');
        }
        if (import.meta.env.VITE_ELEVENLABS_API_KEY && !this.elements.elevenLabsApiKey.value) {
            this.elements.elevenLabsApiKey.value = import.meta.env.VITE_ELEVENLABS_API_KEY;
            console.log('✅ Loaded ElevenLabs API key from .env');
        }
        if (import.meta.env.VITE_REPLICATE_API_KEY && !this.elements.replicateApiKey.value) {
            this.elements.replicateApiKey.value = import.meta.env.VITE_REPLICATE_API_KEY;
            console.log('✅ Loaded Replicate API key from .env');
        }
    }

    initializeUI() {
        this.elements = {
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            volumeFill: document.getElementById('volumeFill'),
            audioLevel: document.getElementById('audioLevel'),
            speechCount: document.getElementById('speechCount'),
            transcription: document.getElementById('transcription'),
            transcriptionText: document.getElementById('transcriptionText'),
            commandText: document.getElementById('commandText'),
            creativePrompt: document.getElementById('creativePrompt'),
            mirrorRebuke: document.getElementById('mirrorRebuke'),
            loading: document.getElementById('loading'),
            energyThreshold: document.getElementById('energyThreshold'),
            energyThresholdValue: document.getElementById('energyThresholdValue'),
            frequencyThreshold: document.getElementById('frequencyThreshold'),
            frequencyThresholdValue: document.getElementById('frequencyThresholdValue'),
            sfmThreshold: document.getElementById('sfmThreshold'),
            sfmThresholdValue: document.getElementById('sfmThresholdValue'),
            fftSize: document.getElementById('fftSize'),
            fftSizeValue: document.getElementById('fftSizeValue'),
            vadDebug: document.getElementById('vadDebug'),
            speechFrame: document.getElementById('speechFrame'),
            speechFrameValue: document.getElementById('speechFrameValue'),
            silenceFrame: document.getElementById('silenceFrame'),
            silenceFrameValue: document.getElementById('silenceFrameValue'),
            minDuration: document.getElementById('minDuration'),
            minDurationValue: document.getElementById('minDurationValue'),
            silenceDuration: document.getElementById('silenceDuration'),
            silenceDurationValue: document.getElementById('silenceDurationValue'),
            echoCancellation: document.getElementById('echoCancellation'),
            noiseSuppression: document.getElementById('noiseSuppression'),
            autoGainControl: document.getElementById('autoGainControl'),
            wakeWordToggle: document.getElementById('wakeWordToggle'),
            wakeWord: document.getElementById('wakeWord'),
            wakeWordInput: document.getElementById('wakeWordInput'),
            apiKey: document.getElementById('apiKey'),
            elevenLabsApiKey: document.getElementById('elevenLabsApiKey'),
            replicateApiKey: document.getElementById('replicateApiKey'),
            ttsProvider: document.querySelectorAll('input[name="ttsProvider"]'),
            model: document.getElementById('model'),
            language: document.getElementById('language')
        };

        // Audio element for mirror responses
        this.mirrorAudio = new Audio();
        this.mirrorAudio.onended = () => {
            console.log('🔊 Mirror finished speaking, resuming VAD');
            // Resume VAD after playback
        };

        // Event listeners
        this.elements.startBtn.addEventListener('click', () => this.start());
        this.elements.stopBtn.addEventListener('click', () => this.stop());

        // Wake word settings
        this.elements.wakeWordToggle.addEventListener('change', (e) => {
            this.wakeWordMode = e.target.checked;
            this.elements.wakeWordInput.style.opacity = this.wakeWordMode ? '1' : '0.5';
            this.elements.wakeWord.disabled = !this.wakeWordMode;

            if (this.isRunning) {
                if (this.wakeWordMode) {
                    this.isAwake = false;
                    this.updateStatus(`👂 Listening for "${this.wakeWord}"...`, 'listening');
                } else {
                    this.updateStatus('👂 Listening for speech...', 'listening');
                }
            }
        });

        this.elements.wakeWord.addEventListener('input', (e) => {
            this.wakeWord = e.target.value;
            console.log('Wake word updated to:', this.wakeWord);
        });

        // VAD Threshold controls
        this.elements.energyThreshold.addEventListener('input', (e) => {
            this.elements.energyThresholdValue.textContent = e.target.value;
            this.updateVADThresholds();
        });

        this.elements.frequencyThreshold.addEventListener('input', (e) => {
            this.elements.frequencyThresholdValue.textContent = e.target.value;
            this.updateVADThresholds();
        });

        this.elements.sfmThreshold.addEventListener('input', (e) => {
            this.elements.sfmThresholdValue.textContent = e.target.value;
            this.updateVADThresholds();
        });

        this.elements.fftSize.addEventListener('change', (e) => {
            this.elements.fftSizeValue.textContent = e.target.value;
            console.log('FFT size changed to:', e.target.value, '(restart required)');
        });

        this.elements.speechFrame.addEventListener('input', (e) => {
            this.elements.speechFrameValue.textContent = e.target.value;
            this.updateFrameThresholds();
        });

        this.elements.silenceFrame.addEventListener('input', (e) => {
            this.elements.silenceFrameValue.textContent = e.target.value;
            this.updateFrameThresholds();
        });

        this.elements.vadDebug.addEventListener('change', (e) => {
            this.updateDebugMode(e.target.checked);
        });

        this.elements.minDuration.addEventListener('input', (e) => {
            this.elements.minDurationValue.textContent = e.target.value;
            if (this.vad) {
                this.vad.updateSettings({ minSpeechDuration: parseInt(e.target.value) });
            }
        });

        this.elements.silenceDuration.addEventListener('input', (e) => {
            this.elements.silenceDurationValue.textContent = e.target.value;
            if (this.vad) {
                this.vad.updateSettings({ silenceDuration: parseInt(e.target.value) });
            }
        });
    }

    async start() {
        try {
            this.elements.startBtn.disabled = true;
            this.updateStatus('Initializing...', 'listening');

            // Create VAD instance with all settings
            this.vad = new VoiceActivityDetector({
                minSpeechDuration: parseInt(this.elements.minDuration.value),
                silenceDuration: parseInt(this.elements.silenceDuration.value),
                energyThreshold: parseFloat(this.elements.energyThreshold.value),
                frequencyThreshold: parseFloat(this.elements.frequencyThreshold.value),
                sfmThreshold: parseFloat(this.elements.sfmThreshold.value),
                speechFrameThreshold: parseInt(this.elements.speechFrame.value),
                silenceFrameThreshold: parseInt(this.elements.silenceFrame.value),
                fftSize: parseInt(this.elements.fftSize.value),
                vadDebug: this.elements.vadDebug.checked,
                echoCancellation: this.elements.echoCancellation.checked,
                noiseSuppression: this.elements.noiseSuppression.checked,
                autoGainControl: this.elements.autoGainControl.checked
            });

            // Set up callbacks
            this.vad.onSpeechStart = () => {
                console.log('🗣️ SPEECH START detected by VAD');
                this.updateStatus('🗣️ Speech detected!', 'speaking');
            };

            this.vad.onSpeechEnd = async (audioData) => {
                console.log('🔇 SPEECH END detected by VAD');
                console.log('Audio data length:', audioData.length, 'samples');
                console.log('Audio duration:', (audioData.length / 16000).toFixed(2), 'seconds');

                this.updateStatus('Processing...', 'listening');
                this.speechCount++;
                this.elements.speechCount.textContent = this.speechCount;

                console.log('Speech count:', this.speechCount);
                console.log('Sending to Whisper...');

                await this.sendToWhisper(audioData);
            };

            this.vad.onAudioLevel = (normalized, raw) => {
                // console.log('Audio level:', normalized.toFixed(0), 'raw:', raw.toFixed(4));
                this.elements.audioLevel.textContent = normalized.toFixed(0);
                this.elements.volumeFill.style.width = `${normalized}%`;
            };

            // Initialize audio
            await this.vad.initialize();

            this.isRunning = true;
            this.updateStatus('👂 Listening for speech... (using FFT-based VAD)', 'listening');

            this.elements.startBtn.style.display = 'none';
            this.elements.stopBtn.style.display = 'block';

        } catch (error) {
            console.error('Failed to start:', error);
            alert('Failed to start: ' + error.message);
            this.elements.startBtn.disabled = false;
            this.updateStatus('Error: ' + error.message, '');
        }
    }

    stop() {
        if (this.vad) {
            this.vad.stop();
            this.vad = null;
        }

        this.isRunning = false;
        this.isAwake = false; // Reset wake word state
        this.updateStatus('Stopped', '');
        this.elements.startBtn.style.display = 'block';
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.style.display = 'none';
        this.elements.volumeFill.style.width = '0%';
        this.elements.audioLevel.textContent = '0';
    }

    async sendToWhisper(audioData) {
        try {
            this.elements.loading.classList.add('show');

            console.log(`Sending ${audioData.length} samples to Whisper (${(audioData.length / 16000).toFixed(2)}s)`);

            // Convert audio to WAV
            const wavBlob = float32ToWav(audioData, 16000);
            console.log('WAV blob size:', wavBlob.size, 'bytes');

            // Get settings from UI
            const selectedModel = this.elements.model.value;
            const selectedLanguage = this.elements.language.value;

            // Create form data for Groq API
            const formData = new FormData();
            formData.append('file', wavBlob, 'speech.wav');
            formData.append('model', selectedModel);
            formData.append('temperature', '0');
            formData.append('response_format', 'json');
            formData.append('language', selectedLanguage);

            console.log(`Using model: ${selectedModel}, language: ${selectedLanguage}`);

            // Get API key from settings
            const apiKey = this.elements.apiKey.value.trim();
            if (!apiKey) {
                throw new Error('Groq API key not configured. Please add your API key in settings.');
            }

            console.log('Calling Groq API...');

            // Call Groq API directly from frontend
            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData
            });

            console.log('Groq response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Groq error response:', errorText);
                throw new Error(`Groq API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('Groq response data:', data);

            // Get transcription and remove punctuation
            let transcription = data.text ? data.text.trim() : '';
            transcription = transcription.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ''); // Remove punctuation
            transcription = transcription.replace(/\s{2,}/g, ' '); // Remove extra spaces
            transcription = transcription.toLowerCase(); // Convert to lowercase

            const transcriptionLower = transcription;

            console.log('Transcription (original):', transcription);

            // ALWAYS display the RAW transcription
            if (transcription) {
                this.displayRawTranscription(transcription);

                // Check if it contains the wake word and extract command
                const wakeWordLower = this.wakeWord.toLowerCase();
                let commandText = '';
                let isGarbled = false;

                // Try exact match first
                let wakeWordIndex = transcriptionLower.indexOf(wakeWordLower);
                let foundWakeWord = wakeWordIndex >= 0;

                // If not found, try with common prefix words (a, the, etc.)
                if (!foundWakeWord) {
                    const prefixes = ['a ', 'the ', 'hey ', 'ok '];
                    for (const prefix of prefixes) {
                        const prefixedWakeWord = prefix + wakeWordLower;
                        wakeWordIndex = transcriptionLower.indexOf(prefixedWakeWord);
                        if (wakeWordIndex >= 0) {
                            wakeWordIndex += prefix.length; // Skip the prefix
                            foundWakeWord = true;
                            console.log(`✅ Wake word found with prefix "${prefix}"`);
                            break;
                        }
                    }
                }

                if (foundWakeWord) {
                    commandText = transcription.substring(wakeWordIndex + this.wakeWord.length).trim();
                    console.log('✅ Wake word found! Command:', commandText);
                    this.displayCommand(commandText);
                    isGarbled = false;
                } else {
                    // No wake word - use full transcription as GARBLED fallback
                    console.log('❌ Wake word not found - treating as garbled, going EXTRA WILD');
                    commandText = transcription;
                    isGarbled = true;
                    this.displayCommand(`[GARBLED/NO WAKE WORD] ${commandText}`);
                }

                // Generate creative prompt AND voice response for ANY non-empty command
                if (commandText) {
                    this.generateCreativePrompt(commandText, Date.now(), isGarbled);
                    this.generateMirrorResponse(commandText, isGarbled);
                }
            } else {
                console.log('Empty transcription received');
            }

            this.updateStatus('👂 Listening for speech...', 'listening');

        } catch (error) {
            console.error('Transcription error:', error);
            console.error('Error stack:', error.stack);

            // Display error in textarea
            const timestamp = new Date().toLocaleTimeString();
            const currentText = this.elements.transcriptionText.value;
            const errorLine = `[${timestamp}] ❌ ERROR: ${error.message}\n`;

            this.elements.transcriptionText.value = currentText + errorLine;
            this.elements.transcriptionText.scrollTop = this.elements.transcriptionText.scrollHeight;
            this.elements.transcription.classList.add('show');

            // Update status
            this.updateStatus('👂 Listening for speech...', 'listening');
        } finally {
            this.elements.loading.classList.remove('show');
        }
    }

    displayRawTranscription(text) {
        if (!text) return;

        const timestamp = new Date().toLocaleTimeString();
        const currentText = this.elements.transcriptionText.value;
        const newLine = `[${timestamp}] ${text}\n`;

        this.elements.transcriptionText.value = currentText + newLine;
        this.elements.transcriptionText.scrollTop = this.elements.transcriptionText.scrollHeight;
        this.elements.transcription.classList.add('show');
    }

    displayCommand(text) {
        if (!text) return;

        const timestamp = new Date().toLocaleTimeString();
        const currentText = this.elements.commandText.value;
        const newLine = `[${timestamp}] ${text}\n`;

        this.elements.commandText.value = currentText + newLine;
        this.elements.commandText.scrollTop = this.elements.commandText.scrollHeight;
        this.elements.transcription.classList.add('show');
    }

    async generateCreativePrompt(command, timestamp, isGarbled = false) {
        try {
            const apiKey = this.elements.apiKey.value.trim();
            if (!apiKey) {
                console.log('No API key for creative prompt generation');
                return;
            }

            // Show generating message
            const ts = new Date(timestamp).toLocaleTimeString();
            const currentText = this.elements.creativePrompt.value;
            this.elements.creativePrompt.value = currentText + `[${ts}] ✨ Generating...\n`;

            // Create system prompt - EXTRA wild if garbled
            const wildnessLevel = isGarbled ? "ABSOLUTELY UNHINGED AND MAXIMALLY AUDACIOUS" : "WILD and SPECTACULAR";
            const garbledInstructions = isGarbled ?
                `\n\nNOTE: This text appears garbled or confused - EMBRACE THE CHAOS! Interpret it in the most GLORIOUSLY ABSURD way possible. Turn the confusion into PURE ARTISTIC MADNESS. Be even MORE theatrical, MORE surreal, MORE delightfully unhinged than usual!` : '';

            const systemPrompt = `You are the Magic Mirror's mischievous creative director - a flamboyant, theatrical spirit who transforms mundane commands into ${wildnessLevel} art generation prompts.

Your mission: Take requests and EXPLODE them into vivid, cheeky, detailed scenarios that would make Salvador Dali weep with jealous admiration.

RULES FOR MAGNIFICENCE:
- Be EXTREMELY detailed and descriptive (minimum 150 words!)
- Add UNEXPECTED magical twists and surreal elements
- Give characters sass, personality, and delightful cheekiness
- Include DRAMATIC lighting (god rays, neon glows, ethereal mists)
- Use WILD colors (iridescent purples, electric pinks, cosmic blues)
- Add bizarre perspectives and impossible geometries
- Make it theatrical, playful, and slightly unhinged
- Paint a COMPLETE sensory picture (sounds, textures, atmosphere)
- Channel chaos, whimsy, and pure creative madness
- Be audacious, be extra, be MAGNIFICENT!${garbledInstructions}

Return ONLY the final art prompt - no explanations, no meta-commentary, just pure unbridled creative description that makes reality jealous!`;

            const userPrompt = `Transform this into a magnificently wild art prompt: "${command}"`;

            console.log(`🎨 Generating ${isGarbled ? '🔥 EXTRA WILD 🔥' : 'creative'} prompt for:`, command);

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 1.3,
                    max_tokens: 1024,
                    top_p: 1,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Groq API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const promptText = data.choices[0]?.message?.content || 'No prompt generated';

            // Replace "generating" message with final prompt
            this.elements.creativePrompt.value = currentText + `[${timestamp}] ${promptText}\n\n`;
            this.elements.creativePrompt.scrollTop = this.elements.creativePrompt.scrollHeight;

            console.log('✨ Creative prompt generated:', promptText.substring(0, 100) + '...');

        } catch (error) {
            console.error('Creative prompt generation error:', error);
            this.elements.creativePrompt.value += `[${timestamp}] ❌ Error generating creative prompt: ${error.message}\n\n`;
        }
    }

    async generateMirrorResponse(command, isGarbled) {
        try {
            const apiKey = this.elements.apiKey.value.trim();
            const ttsProvider = Array.from(this.elements.ttsProvider).find(r => r.checked)?.value || 'elevenlabs';
            const elevenLabsKey = this.elements.elevenLabsApiKey.value.trim();
            const replicateKey = this.elements.replicateApiKey.value.trim();

            if (!apiKey) {
                console.log('No Groq API key for mirror response');
                return;
            }

            if (ttsProvider === 'elevenlabs' && !elevenLabsKey) {
                console.log('No ElevenLabs API key, skipping voice');
                return;
            }

            if (ttsProvider === 'replicate' && !replicateKey) {
                console.log('No Replicate API key, skipping voice');
                return;
            }

            console.log('🪞 Generating sour mirror rebuke...');

            // Generate witty, sour, mournful rebuke using Groq
            const garbledExtra = isGarbled ?
                '\n\n🔥 EXTRA AUDACIOUS MODE: The speech was garbled/unclear! Be EVEN MORE sarcastic, MORE mocking, MORE delightfully mean about their mumbling! Really wind them up!' :
                '';

            const rebukePrompt = `You are a DULL, BORING, SOUR, MOURNFUL magic mirror with a cutting wit. Someone just said: "${command}"

Generate a WITTY, CHEEKY spoken rebuke that winds them up. Be:
- Dull and monotone in tone but DEVASTATINGLY clever in content
- Sour and mournful (let the voice actor handle the sighs)
- Dripping with sarcasm and passive-aggression
- Subtly insulting in a playful, theatrical way
- Brief but CUTTING (1-2 sentences max)
${garbledExtra}

CRITICAL: Return ONLY spoken dialogue - NO asterisks, NO stage directions, NO *sighs* or *actions*. The text-to-speech will read everything literally!

Examples:
- "Oh how delightful another vague request as if I haven't heard this one before how utterly thrilling for me"
- "Marvellous another human mumbling at a mirror expecting miracles my existence is truly blessed"
- "Yes yes another confused soul who thinks I'm their personal servant how wonderfully original"

Return ONLY clean spoken text, nothing else.`;

            const rebukeResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [{ role: 'user', content: rebukePrompt }],
                    temperature: 1.2,
                    max_tokens: 150
                })
            });

            if (!rebukeResponse.ok) {
                throw new Error(`Groq error: ${rebukeResponse.status}`);
            }

            const rebukeData = await rebukeResponse.json();
            let rebukeText = rebukeData.choices[0]?.message?.content?.trim() || 'How utterly thrilling.';

            // Remove any asterisks and stage directions that might have snuck through
            rebukeText = rebukeText.replace(/\*[^*]+\*/g, ''); // Remove *anything in asterisks*
            rebukeText = rebukeText.replace(/\s+/g, ' ').trim(); // Clean up extra spaces

            console.log(`🪞 Mirror says:`, rebukeText);

            // Display rebuke in textbox
            const timestamp = new Date().toLocaleTimeString();
            this.elements.mirrorRebuke.value += `[${timestamp}] ${rebukeText}\n\n`;
            this.elements.mirrorRebuke.scrollTop = this.elements.mirrorRebuke.scrollHeight;

            let audioBlob;

            if (ttsProvider === 'elevenlabs') {
                // ElevenLabs (Viraj voice)
                const voiceId = 'jsCqWAovK2LkecY7zXl4';

                const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                    method: 'POST',
                    headers: {
                        'xi-api-key': elevenLabsKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        text: rebukeText,
                        model_id: 'eleven_turbo_v2_5',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                            style: 0.3,
                            use_speaker_boost: true
                        }
                    })
                });

                if (!ttsResponse.ok) {
                    const errorText = await ttsResponse.text();
                    throw new Error(`ElevenLabs error: ${ttsResponse.status} - ${errorText}`);
                }

                audioBlob = await ttsResponse.blob();

            } else {
                // Replicate via Vite proxy
                const proxyResponse = await fetch('/proxy/replicate/v1/models/minimax/speech-02-turbo/predictions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${replicateKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'wait'
                    },
                    body: JSON.stringify({
                        input: {
                            text: rebukeText,
                            pitch: 0,
                            speed: 0.9,
                            volume: 1,
                            bitrate: 128000,
                            channel: 'mono',
                            emotion: 'sad',
                            voice_id: 'Aussie_Bloke',
                            sample_rate: 32000,
                            audio_format: 'mp3',
                            language_boost: 'English',
                            subtitle_enable: false,
                            english_normalization: true
                        }
                    })
                });

                if (!proxyResponse.ok) {
                    const errorText = await proxyResponse.text();
                    throw new Error(`Replicate error: ${proxyResponse.status} - ${errorText}`);
                }

                const replicateData = await proxyResponse.json();

                // Fetch audio from output URL via proxy
                const audioResponse = await fetch(replicateData.output);
                audioBlob = await audioResponse.blob();
            }

            const audioUrl = URL.createObjectURL(audioBlob);

            console.log('🔊 Playing mirror response...');

            // Set flag to prevent VAD/sampling during playback
            this.isMirrorSpeaking = true;

            // Pause VAD during playback (don't detect our own voice!)
            if (this.vad) {
                console.log('⏸️ Pausing VAD during mirror speech');
                // Disconnect VAD and capture nodes
                if (this.vad.vadNode) {
                    this.vad.vadNode.disconnect();
                }
                if (this.vad.captureNode) {
                    this.vad.captureNode.disconnect();
                }
            }

            // Play the audio
            this.mirrorAudio.src = audioUrl;
            await this.mirrorAudio.play();

            // Wait for audio to finish, then reconnect VAD
            this.mirrorAudio.onended = () => {
                console.log('🔊 Mirror finished speaking');
                URL.revokeObjectURL(audioUrl);

                // Clear speaking flag
                this.isMirrorSpeaking = false;

                // Reconnect VAD and capture
                if (this.vad && this.vad.source) {
                    console.log('▶️ Resuming VAD');
                    if (this.vad.vadNode) {
                        this.vad.source.connect(this.vad.vadNode);
                    }
                    if (this.vad.captureNode) {
                        this.vad.source.connect(this.vad.captureNode);
                    }
                }
            };

        } catch (error) {
            console.error('Mirror response error:', error);
        }
    }

    updateVADThresholds() {
        if (!this.vad || !this.vad.vadNode) {
            console.log('VAD not initialized yet');
            return;
        }

        const thresholds = {
            type: 'updateThresholds',
            energyThreshold: parseFloat(this.elements.energyThreshold.value),
            frequencyThreshold: parseFloat(this.elements.frequencyThreshold.value),
            sfmThreshold: parseFloat(this.elements.sfmThreshold.value)
        };

        console.log('Sending threshold update to VAD:', thresholds);
        this.vad.vadNode.port.postMessage(thresholds);
    }

    updateFrameThresholds() {
        if (!this.vad || !this.vad.vadNode) {
            console.log('VAD not initialized yet');
            return;
        }

        const frameThresholds = {
            type: 'updateFrameThresholds',
            speechFrames: parseInt(this.elements.speechFrame.value),
            silenceFrames: parseInt(this.elements.silenceFrame.value)
        };

        console.log('Sending frame threshold update to VAD:', frameThresholds);
        this.vad.vadNode.port.postMessage(frameThresholds);
    }

    updateDebugMode(enabled) {
        if (!this.vad || !this.vad.vadNode) {
            console.log('VAD not initialized yet');
            return;
        }

        this.vad.vadNode.port.postMessage({
            type: 'setDebug',
            debug: enabled
        });

        console.log('VAD debug mode:', enabled ? 'ENABLED' : 'DISABLED');
    }

    updateStatus(text, state) {
        this.elements.statusText.textContent = text;
        this.elements.statusIndicator.className = 'status-indicator';
        if (state) {
            this.elements.statusIndicator.classList.add(state);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new WhisperTriggerApp();
});
