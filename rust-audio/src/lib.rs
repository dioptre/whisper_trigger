use wasm_bindgen::prelude::*;
use std::f32::consts::PI;

#[wasm_bindgen]
pub struct SpectralSubtraction {
    fft_size: usize,
    noise_estimate: Vec<f32>,
    noise_frames_collected: usize,
    noise_profile_ready: bool,
    alpha: f32, // Over-subtraction factor
}

#[wasm_bindgen]
impl SpectralSubtraction {
    #[wasm_bindgen(constructor)]
    pub fn new(fft_size: usize) -> SpectralSubtraction {
        SpectralSubtraction {
            fft_size,
            noise_estimate: vec![0.0; fft_size / 2],
            noise_frames_collected: 0,
            noise_profile_ready: false,
            alpha: 2.0, // Over-subtraction factor (higher = more aggressive)
        }
    }

    /// Update noise profile during silence periods
    #[wasm_bindgen]
    pub fn update_noise_profile(&mut self, spectrum: &[f32]) {
        if spectrum.len() != self.fft_size / 2 {
            return;
        }

        if self.noise_frames_collected < 30 {
            // Collect first 30 frames for noise estimation
            for i in 0..spectrum.len() {
                self.noise_estimate[i] += spectrum[i];
            }
            self.noise_frames_collected += 1;

            if self.noise_frames_collected == 30 {
                // Average the collected frames
                for i in 0..self.noise_estimate.len() {
                    self.noise_estimate[i] /= 30.0;
                }
                self.noise_profile_ready = true;
            }
        } else {
            // Update noise estimate with exponential smoothing
            let beta = 0.98; // Smoothing factor
            for i in 0..spectrum.len() {
                self.noise_estimate[i] = beta * self.noise_estimate[i] + (1.0 - beta) * spectrum[i];
            }
        }
    }

    /// Apply spectral subtraction to reduce noise
    #[wasm_bindgen]
    pub fn process(&self, spectrum: &mut [f32]) {
        if !self.noise_profile_ready || spectrum.len() != self.fft_size / 2 {
            return;
        }

        for i in 0..spectrum.len() {
            // Subtract noise estimate with over-subtraction factor
            let subtracted = spectrum[i] - self.alpha * self.noise_estimate[i];

            // Spectral floor (prevents negative values)
            let floor = 0.1 * spectrum[i];
            spectrum[i] = subtracted.max(floor);
        }
    }

    /// Reset noise profile
    #[wasm_bindgen]
    pub fn reset_noise_profile(&mut self) {
        self.noise_estimate = vec![0.0; self.fft_size / 2];
        self.noise_frames_collected = 0;
        self.noise_profile_ready = false;
    }

    /// Set over-subtraction factor (1.0-3.0, default: 2.0)
    #[wasm_bindgen]
    pub fn set_alpha(&mut self, alpha: f32) {
        self.alpha = alpha.max(1.0).min(3.0);
    }

    #[wasm_bindgen]
    pub fn is_ready(&self) -> bool {
        self.noise_profile_ready
    }
}

/// Simple magnitude spectrum calculation
#[wasm_bindgen]
pub fn simple_magnitude_spectrum(samples: &[f32]) -> Vec<f32> {
    let n = samples.len();
    let mut spectrum = Vec::with_capacity(n / 2);

    for k in 0..n/2 {
        let mut real_sum = 0.0;
        let mut imag_sum = 0.0;

        for i in 0..n {
            let angle = -2.0 * PI * (k as f32) * (i as f32) / (n as f32);
            real_sum += samples[i] * angle.cos();
            imag_sum += samples[i] * angle.sin();
        }

        let magnitude = (real_sum * real_sum + imag_sum * imag_sum).sqrt();
        spectrum.push(magnitude);
    }

    spectrum
}

#[wasm_bindgen]
pub fn greet() -> String {
    "Rust audio processing initialized!".to_string()
}
