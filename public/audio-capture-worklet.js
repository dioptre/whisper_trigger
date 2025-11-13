/**
 * AudioWorkletProcessor for capturing raw audio data
 * Replaces deprecated ScriptProcessorNode
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
  }

  process(inputs, outputs, parameters) {
    if (!inputs || !inputs[0] || !inputs[0][0]) {
      return true;
    }

    const inputChannel = inputs[0][0];

    // Send audio data to main thread
    this.port.postMessage({
      type: 'audiodata',
      data: inputChannel
    });

    // Pass through audio
    if (outputs && outputs[0] && outputs[0][0]) {
      outputs[0][0].set(inputChannel);
    }

    return true;
  }
}

registerProcessor("audio-capture", AudioCaptureProcessor);
