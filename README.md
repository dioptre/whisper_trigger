# 🪞 Mirror Mirror - Wake Word Detection + Real-time Transcription

A real-time voice activity detection (VAD) system with wake word support that captures speech and transcribes it using Groq's Whisper API. Say "mirror mirror on the wall" followed by your command!

## Features

- **🎯 Wake Word Detection**: Say "mirror mirror on the wall" to activate (customizable)
- **🎤 Real-time Voice Activity Detection**: Uses FFT-based VAD algorithm with AudioWorklet (Moattar & Homayoonpoor, 2010)
- **🧠 Advanced Speech Detection**: Multi-criteria analysis (energy, frequency, spectral flatness)
- **🔇 Built-in Noise Suppression**: Browser-native echo cancellation and noise reduction
- **✂️ Automatic Speech Segmentation**: Detects speech start/end automatically
- **⚡ Groq Whisper Integration**: Fast and accurate transcription with Whisper-large-v3-turbo
- **⚙️ Adjustable Settings**: Fine-tune wake word, speech duration, and silence detection
- **📊 Live Audio Visualization**: Real-time audio level monitoring
- **🚀 High Performance**: AudioWorklet runs on separate thread for better performance
- **🎨 Clean UI**: Modern, responsive interface with transcription history

## How It Works

1. **Audio Capture**: Captures audio from your microphone using Web Audio API with built-in noise suppression
2. **Voice Activity Detection** (AudioWorklet):
   - Performs FFT (Fast Fourier Transform) analysis in separate thread
   - Evaluates three criteria simultaneously:
     - **Energy threshold**: 40 dB (detects sound intensity)
     - **Frequency threshold**: 185 Hz minimum (typical human speech range)
     - **Spectral flatness**: 5 dB (distinguishes speech from noise)
   - Sends "speech" and "silence" events to main thread
3. **Audio Buffering**:
   - Captures raw audio in parallel with VAD analysis
   - Buffers audio chunks during speech events
   - Discards audio during silence
4. **Speech Segmentation**:
   - Starts buffering when VAD detects speech
   - Continues buffering while speech is detected
   - Ends recording after specified silence duration (default: 1 second)
   - Filters out short noises (minimum duration: 300ms)
5. **Transcription**: Sends accumulated audio to Groq Whisper API
6. **Display**: Shows transcription results in real-time

## Setup

### Prerequisites

- A Groq API key (get one at https://console.groq.com/)
- Modern browser with Web Audio API support

### Installation

**Option 1: With Vite dev server (recommended for development)**

1. Install dependencies:
```bash
npm install
```

2. Start dev server:
```bash
npm run dev
```

3. Open your browser to http://localhost:5173
4. Paste your Groq API key in the settings
5. Click "Start Listening"!

**Option 2: No build tools (just open the file)**

1. Open `index.html` directly in your browser
2. Paste your Groq API key in the settings
3. Click "Start Listening"!

That's it! **No backend server required** - everything runs in your browser.

## Usage

### Wake Word Mode (Default)

1. Click "Start Listening" to begin
2. Say: **"Mirror mirror on the wall"** (the wake word)
3. System responds: ✨ Wake word detected!
4. Say your command: **"What's the weather today?"**
5. View the transcription: "what's the weather today?"

**Or say it all at once:**
> "Mirror mirror on the wall, tell me a joke"

**Result:** Only "tell me a joke" is transcribed

### Without Wake Word

1. Uncheck "Enable Wake Word Mode"
2. Click "Start Listening"
3. Say anything - all speech will be transcribed
4. No wake word required

See [WAKE_WORD_GUIDE.md](./WAKE_WORD_GUIDE.md) for detailed usage instructions.

### Adjusting Settings

- **VAD Threshold**: Automatically configured (40dB energy, 185Hz frequency, 5dB spectral flatness)
- **Min Speech Duration**: Minimum duration to consider valid speech (filters out short noises like coughs)
- **Silence Duration**: How long to wait after speech ends before processing (prevents cutting off sentences)

### Background Noise Reduction

The system uses multiple layers of noise filtering:

1. **Browser-Native Processing** (main.js:34-40):
   - Echo cancellation
   - Noise suppression (removes keyboard clicks, fans, etc.)
   - Auto gain control (normalizes volume)

2. **FFT-Based Speech Detection**:
   - Analyzes frequency spectrum to distinguish speech from noise
   - Rejects sounds outside typical speech frequencies
   - Measures spectral flatness to filter white noise

3. **Minimum Duration Filter**:
   - Rejects audio segments shorter than 300ms (configurable)
   - Prevents false positives from brief noises

## Voice Activity Detection Algorithm

The VAD implementation uses an FFT-based approach running in an AudioWorklet:

### Algorithm (from vad-audio-worklet)

1. **FFT Analysis**: Computes frequency spectrum of 10ms audio frames
2. **Multi-Criteria Detection**:
   - **Energy (E)**: Measures signal power in dB
   - **Dominant Frequency (F)**: Identifies primary frequency component
   - **Spectral Flatness (SFM)**: Measures how "noise-like" the signal is
3. **Adaptive Thresholds**:
   - Maintains minimum values for each metric during silence
   - Compares current values against these baselines
4. **State Machine**:
   - Requires 4+ consecutive "speech" frames to trigger speech event
   - Requires 10+ consecutive "silence" frames to trigger silence event
   - Prevents rapid flickering between states

### Why FFT-based?

Unlike simple energy-based detection, FFT analysis provides:
- **Frequency awareness**: Rejects non-speech sounds
- **Noise robustness**: Distinguishes speech from background noise
- **Better accuracy**: Multi-dimensional analysis vs single threshold

This implementation is based on:
> Moattar, M. H., & Homayoonpoor, M. M. (2010). A simple but efficient real-time voice activity detection algorithm.

And uses the AudioWorklet implementation from:
> https://github.com/thurti/vad-audio-worklet

## API Endpoints

### POST /transcribe
Transcribes a single audio file.

**Request:**
- `audio`: WAV file (multipart/form-data)

**Response:**
```json
{
  "text": "transcribed text",
  "duration": 2.5,
  "language": "en"
}
```

### POST /transcribe-batch
Transcribes multiple audio files.

**Request:**
- `audio`: Array of WAV files (multipart/form-data, max 10 files)

**Response:**
```json
{
  "transcriptions": [
    {
      "text": "transcribed text",
      "filename": "audio-123.wav"
    }
  ],
  "count": 1
}
```

### GET /health
Health check endpoint.

## Architecture

```
                    ┌─────────────────┐
                    │   Microphone    │
                    │ (w/ noise suppr)│
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              v                             v
    ┌─────────────────┐         ┌─────────────────┐
    │  AudioWorklet   │         │ ScriptProcessor │
    │  (VAD - FFT)    │         │ (Audio Capture) │
    │ [Separate Thread]│         └────────┬────────┘
    └────────┬────────┘                   │
             │                             │
             │ "speech"/"silence"          │ Float32Array
             │  events                     │
             v                             v
    ┌─────────────────────────────────────────┐
    │         Main Thread Controller          │
    │  - Manages speech/silence state         │
    │  - Buffers audio during speech          │
    │  - Applies duration filters             │
    └────────┬────────────────────────────────┘
             │
             v
    ┌─────────────────┐
    │  Convert to WAV │
    │  (Float32→PCM)  │
    └────────┬────────┘
             │
             v
    ┌─────────────────┐
    │  Express Server │
    │  (File Upload)  │
    └────────┬────────┘
             │
             v
    ┌─────────────────┐
    │   Groq Whisper  │
    │ (whisper-large- │
    │  v3-turbo)      │
    └────────┬────────┘
             │
             v
    ┌─────────────────┐
    │  Transcription  │
    │   (JSON)        │
    └─────────────────┘
```

## Technical Details

### Audio Processing

- **Sample Rate**: 16kHz (optimal for Whisper)
- **Buffer Size**: 4096 samples (ScriptProcessorNode for capture)
- **Format**: 32-bit Float → 16-bit PCM WAV
- **Channels**: Mono
- **Noise Reduction**: Browser-native (echo cancellation, noise suppression, AGC)

### VAD Parameters (AudioWorklet)

- **FFT Size**: 128 samples (configurable)
- **Frame Size**: 10ms windows
- **Energy Threshold**: 40 dB
- **Frequency Threshold**: 185 Hz
- **Spectral Flatness Threshold**: 5 dB
- **Speech Trigger**: 4+ consecutive speech frames
- **Silence Trigger**: 10+ consecutive silence frames

### Application-Level Filters

- **Min Speech Duration**: 300ms (configurable)
- **Silence Duration**: 1000ms (configurable)
- **Visualization FFT**: 2048 (for spectrum analyzer)

## Troubleshooting

### Microphone Access Denied
- Check browser permissions
- Ensure you're using HTTPS or localhost
- Try a different browser

### No Speech Detected
- Adjust VAD threshold (lower = more sensitive)
- Check microphone input level
- Speak closer to microphone

### Transcription Errors
- Verify Groq API key is set correctly
- Check network connection
- Ensure backend server is running

### Audio Quality Issues
- Reduce background noise
- Use a better microphone
- Enable noise suppression in browser settings

## Performance Considerations

- **VAD runs on separate thread** via AudioWorklet (better performance)
- Audio capture still uses ScriptProcessorNode (for raw audio access)
- FFT analysis is computationally efficient (128-sample window)
- Large audio files may take longer to transcribe
- Network latency affects transcription speed
- Browser-native noise suppression is hardware-accelerated

## Future Improvements

- [x] FFT-based frequency analysis (implemented via AudioWorklet)
- [x] Browser-native noise reduction (implemented)
- [ ] Migrate audio capture to AudioWorklet (currently uses ScriptProcessor)
- [ ] Implement zero-crossing rate detection
- [ ] Add support for multiple languages
- [ ] Real-time streaming transcription
- [ ] Advanced noise reduction (spectral subtraction)
- [ ] Speaker diarization
- [ ] Export transcriptions
- [ ] Tunable VAD thresholds (currently hardcoded in worklet)
- [ ] WebRTC VAD as alternative/comparison

## References

- [Moattar & Homayoonpoor VAD Paper](https://www.researchgate.net/publication/255667085_A_simple_but_efficient_real-time_voice_activity_detection_algorithm)
- [VAD AudioWorklet Implementation](https://github.com/thurti/vad-audio-worklet) - MIT License
- [FFT.js](https://github.com/indutny/fft.js/) - Fast Fourier Transform library
- [Web Audio API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [Groq Whisper API](https://console.groq.com/docs/speech-text)
- [Processing Web Audio with Rust and WASM](https://whoisryosuke.com/blog/2023/processing-web-audio-with-rust-and-wasm/)

## License

MIT

## Security Notice

**⚠️ IMPORTANT**: The API key in your `.env` file was shared publicly in your message. Please:
1. Go to https://console.groq.com/
2. Regenerate your API key immediately
3. Update the `.env` file with the new key
4. Never commit `.env` files to version control
