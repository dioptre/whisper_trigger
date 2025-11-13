import FFT from "./fft.js";

/**
 * AudioWorkletProcessor for Voice Activity Detection (VAD).
 *
 * From: Moattar, Mohammad & Homayoonpoor, Mahdi. (2010). A simple but efficient real-time voice activity detection algorithm. European Signal Processing Conference.
 * @see https://www.researchgate.net/publication/255667085_A_simple_but_efficient_real-time_voice_activity_detection_algorithm
 */
class AudioVADProcessor extends AudioWorkletProcessor {
  primThresh_e = 40;
  primThresh_f_hz = 185;
  primThresh_sfm = 5;
  frame_size_ms = 10;

  is_speech_frame_counter = 0;
  is_silent_frame_counter = 0;

  e_min = null;
  f_min = null;
  sfm_min = null;

  // Adaptive baseline sampling
  baseline_samples = [];
  max_baseline_samples = 50; // Keep last 50 samples
  sample_counter = 0;
  next_sample_frame = 5; // Start sampling after a few frames
  continuous_speech_frames = 0;

  baselines_ready = false;

  sample_rate;
  fft_size = 128;
  fft; // FFT.js instance

  buffer = [];
  frame_size;
  frame_counter = 0;

  last_command_was_speech = false; // FIXED: Start with false so first speech event can fire!

  debug = false;

  constructor(options) {
    super(options);

    this.debug = options.processorOptions.debug ?? this.debug;

    this.last_command_was_speech =
      options.processorOptions.lastCommandWasSpeech ??
      this.last_command_was_speech;
    this.sample_rate = options.processorOptions.sampleRate;
    this.fft_size = options.processorOptions.fftSize ?? this.fft_size;

    // Allow tunable thresholds
    this.primThresh_e = options.processorOptions.energyThreshold ?? this.primThresh_e;
    this.primThresh_f_hz = options.processorOptions.frequencyThreshold ?? this.primThresh_f_hz;
    this.primThresh_sfm = options.processorOptions.sfmThreshold ?? this.primThresh_sfm;

    this.fft = new FFT(this.fft_size);
    this.frame_size = (this.sample_rate * this.frame_size_ms) / 1000;

    // Store frame thresholds
    this.speechFrameThreshold = 4;
    this.silenceFrameThreshold = 10;

    // Listen for parameter updates from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'updateThresholds') {
        this.primThresh_e = event.data.energyThreshold ?? this.primThresh_e;
        this.primThresh_f_hz = event.data.frequencyThreshold ?? this.primThresh_f_hz;
        this.primThresh_sfm = event.data.sfmThreshold ?? this.primThresh_sfm;
        console.log('VAD thresholds updated:', {
          energy: this.primThresh_e,
          frequency: this.primThresh_f_hz,
          sfm: this.primThresh_sfm
        });
      } else if (event.data.type === 'updateFrameThresholds') {
        this.speechFrameThreshold = event.data.speechFrames ?? this.speechFrameThreshold;
        this.silenceFrameThreshold = event.data.silenceFrames ?? this.silenceFrameThreshold;
        console.log('Frame thresholds updated:', {
          speech: this.speechFrameThreshold,
          silence: this.silenceFrameThreshold
        });
      } else if (event.data.type === 'setDebug') {
        this.debug = event.data.debug ?? this.debug;
        console.log('Debug mode:', this.debug ? 'ENABLED' : 'DISABLED');
      } else if (event.data.type === 'reset') {
        // Reset all counters
        this.is_speech_frame_counter = 0;
        this.is_silent_frame_counter = 0;
        this.last_command_was_speech = false;
        this.continuous_speech_frames = 0;
        console.log('VAD state reset');
      }
    };
  }

  post(cmd, data) {
    this.port.postMessage({
      cmd,
      data,
    });
  }

  getSpectrum(data) {
    // zero pad data
    while (data.length < this.fft_size) {
      data.push(0);
    }

    // calculate fft
    const input = this.fft.toComplexArray(data);
    const out = this.fft.createComplexArray();

    this.fft.realTransform(out, input);

    // get amplitude array
    var res = new Array(out.length >>> 1);
    for (var i = 0; i < out.length; i += 2) {
      let real = out[i];
      let imag = out[i + 1];
      res[i >>> 1] = Math.sqrt(real * real + imag * imag);
    }

    return res.slice(0, res.length / 2 - 1);
  }

  calculateZeroCrossingRate(data) {
    // Count zero crossings (sign changes)
    let crossings = 0;
    for (let i = 1; i < data.length; i++) {
      if ((data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0)) {
        crossings++;
      }
    }
    // Normalize by frame length
    return crossings / data.length;
  }

  process(inputs, outputs, parameters) {
    // Log first few calls
    if (this.frame_counter <= 2) {
      console.log(`VAD process() frame ${this.frame_counter}, has input:`, !!inputs?.[0]?.[0]);
    }

    if (!inputs || !inputs[0] || !inputs[0][0]) {
      console.error('❌ VAD: No input data!');
      return true;
    }

    // buffer input data
    if (this.buffer.length < this.frame_size) {
      this.buffer.push(...inputs[0][0]);
      return true;
    }

    // get time and frequency data
    const timeData = new Float32Array(this.buffer);
    const frequencyData = this.getSpectrum(this.buffer);

    // set dc offset to 0
    frequencyData[0] = 0;

    // reset buffer
    this.buffer = [];

    // increment frame counter
    this.frame_counter++;

    // calculate energy of the frame
    let energy = 0;

    for (let i = 0; i < timeData.length; i++) {
      energy += timeData[i] * timeData[i];
    }

    // calculate zero-crossing rate
    const zcr = this.calculateZeroCrossingRate(timeData);

    // get frequency with highest amplitude...
    let f_max = 0;
    let f_max_index = 0;

    // ...and spectral flatness
    let sfm = 0;
    let sfm_sum_geo = 0;
    let sfm_sum_ari = 0;

    // calc both in one loop
    for (let i = 0; i < frequencyData.length; i++) {
      // find frequency with highest amplitude
      if (frequencyData[i] > f_max) {
        f_max = frequencyData[i];
        f_max_index = i;
      }

      // spectral flatness (geometric mean, arithmetic mean)
      const f_geo = frequencyData[i] > 0 ? frequencyData[i] : 1;
      sfm_sum_geo += Math.log(f_geo);
      sfm_sum_ari += f_geo;
    }

    // get frequency in Hz for highest amplitude
    const f_max_hz = (f_max_index * this.sample_rate) / this.fft_size;

    // calculate spectral flatness
    sfm =
      -10 *
      Math.log10(
        Math.exp(sfm_sum_geo / frequencyData.length) /
          (sfm_sum_ari / frequencyData.length)
      );

    // just safety check
    sfm = isFinite(sfm) ? sfm : 0;

    // frame vad counter - MUST BE CALCULATED FIRST!
    let count = 0;

    // check energy threshold (skip if baseline is 0)
    // Use ratio instead of log (simpler and more reliable)
    if (this.e_min > 0 && energy > 0) {
      const energyRatio = energy / this.e_min;
      // Speech is typically 10-100x louder than ambient noise
      if (energyRatio > 10.0) { // Require 10x increase above baseline
        count++;
      }
    }

    // check frequency threshold (skip if baseline is 0)
    if (this.f_min > 0 && f_max > 1 && f_max_hz - this.f_min >= this.primThresh_f_hz) {
      count++;
    }

    // check spectral flatness threshold (skip if baseline is 0)
    if (this.sfm_min > 0 && sfm > 0 && sfm - this.sfm_min <= this.primThresh_sfm) {
      count++;
    }

    // check zero-crossing rate
    if (zcr > 0.05 && zcr < 0.5) {
      count++;
    }

    // Track continuous speech duration FIRST
    if (count > 1) {
      this.continuous_speech_frames++;
    } else {
      this.continuous_speech_frames = 0;
    }

    // Adaptive baseline sampling - DISABLED during mirror playback
    const isConfirmedSilence = this.is_silent_frame_counter > 5; // At least 5 frames of silence
    const isLongSpeech = this.continuous_speech_frames > 3000; // >30 seconds of speech
    const isBootstrapping = this.baseline_samples.length < 5; // Still collecting initial samples

    const shouldSample = (
      // During bootstrapping, sample when count is low (count <= 1, more lenient)
      (isBootstrapping && count <= 1 && this.frame_counter >= this.next_sample_frame) ||
      // After bootstrapping, only sample during confirmed silence
      (!isBootstrapping && isConfirmedSilence && this.frame_counter >= this.next_sample_frame) ||
      // Or during long speech (background takeover)
      isLongSpeech
    );

    // Note: When mirror is speaking, the worklet is disconnected so this won't run anyway

    // Log first few frames to debug
    if (this.frame_counter <= 5) {
      console.log(`Frame ${this.frame_counter}: count=${count}, shouldSample=${shouldSample}, next_sample=${this.next_sample_frame}, bootstrapping=${isBootstrapping}`);
    }

    if (shouldSample) {
      this.baseline_samples.push({ e: energy, f: f_max_hz, sfm: sfm });

      if (this.baseline_samples.length > this.max_baseline_samples) {
        this.baseline_samples.shift();
      }

      // First 5 samples: Rapid succession (every 10-20 frames = 100-200ms)
      if (this.baseline_samples.length < 5) {
        this.next_sample_frame = this.frame_counter + 10 + Math.floor(Math.random() * 10);
      } else {
        // After 5 samples: Random intervals with exponential falloff
        const base_interval = 100 + Math.random() * 400;
        const falloff = Math.exp(-this.sample_counter / 100);
        this.next_sample_frame = this.frame_counter + Math.floor(base_interval * (0.5 + falloff * 0.5));
      }
      this.sample_counter++;

      console.log(`📊 Sample #${this.baseline_samples.length}, next in ${this.next_sample_frame - this.frame_counter}f`);

      if (this.baseline_samples.length >= 5) {
        let e_sum = 0, f_sum = 0, sfm_sum = 0;
        for (let i = 0; i < this.baseline_samples.length; i++) {
          const weight = (i + 1) / this.baseline_samples.length;
          e_sum += this.baseline_samples[i].e * weight;
          f_sum += this.baseline_samples[i].f * weight;
          sfm_sum += this.baseline_samples[i].sfm * weight;
        }
        const total_weight = this.baseline_samples.length * (this.baseline_samples.length + 1) / 2;
        this.e_min = e_sum / total_weight;
        this.f_min = f_sum / total_weight;
        this.sfm_min = sfm_sum / total_weight;

        if (!this.baselines_ready) {
          this.baselines_ready = true;
          console.log('✅ Baselines:', { e_min: this.e_min, f_min: this.f_min, sfm_min: this.sfm_min, samples: this.baseline_samples.length });
        }
      }

      // If long speech triggered sampling, reset the counter
      if (isLongSpeech) {
        console.log('⚠️ Long speech detected (>30s), resampling baseline');
        this.continuous_speech_frames = 0;
      }
    }

    if (!this.baselines_ready) {
      return true;
    }

    // Speech/silence detection
    if (count > 1) {
      this.is_speech_frame_counter++;
      this.is_silent_frame_counter = 0;
    } else {
      this.is_silent_frame_counter++;
      this.is_speech_frame_counter = 0;
    }

    // Only log when count changes or every 50 frames
    if (this.debug && (count > 0 || this.frame_counter % 50 === 0)) {
      this.post("log", {
        frame: this.frame_counter,
        e: energy,
        e_min: this.e_min,
        f: f_max_hz,
        f_min: this.f_min,
        sfm: sfm,
        sfm_min: this.sfm_min,
        zcr: zcr,
        count: count,
        speech_frames: this.is_speech_frame_counter,
        silence_frames: this.is_silent_frame_counter
      });
    }

    // ignore silence if less than threshold
    if (this.is_silent_frame_counter > this.silenceFrameThreshold && this.last_command_was_speech) {
      console.log(`🔇 SILENCE EVENT! (${this.is_silent_frame_counter} frames)`);
      if (this.debug) {
        this.post("silence", { signal: sfm_sum_ari / frequencyData.length });
      } else {
        this.post("silence");
      }

      this.last_command_was_speech = false;
    }

    // ignore speech if less than threshold
    if (this.is_speech_frame_counter > this.speechFrameThreshold && !this.last_command_was_speech) {
      console.log(`🎤 SPEECH EVENT! (${this.is_speech_frame_counter} frames)`);
      if (this.debug) {
        this.post("speech", { signal: sfm_sum_ari / frequencyData.length });
      } else {
        this.post("speech");
      }

      this.last_command_was_speech = true;
    }

    // return true to keep processor alive
    return true;
  }
}

registerProcessor("vad", AudioVADProcessor);
