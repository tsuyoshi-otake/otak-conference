import type { LiveServerMessage } from '@google/genai';
import { debugLog, debugWarn, infoLog } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import { processCompleteAudioTurn } from './audioTurn';
import { updateTokenUsage } from './tokenUsage';

export const handleServerMessage = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  startAudioCollectionIfNeeded(state, message);
  collectAudioChunks(state, message);
  finalizeTurnIfComplete(state, message);
  handleInterruption(state, message);
  handleInputTranscription(state, message);
  bufferOutputTranscription(state, message);

  // Handle text response parts
  handleTextResponse(state, message);
};

export const flushTextBuffer = (state: GeminiLiveAudioState): void => {
  if (state.textBuffer.length === 0) return;

  // Combine all buffered text chunks
  const combinedText = state.textBuffer.join(' ').trim();

  if (combinedText) {
    // Commented out verbose text buffer flushing logs
    // console.log('[Text Buffer] FLUSHING BUFFERED TEXT:', combinedText);
    // console.log(`[Text Buffer] Combined ${state.textBuffer.length} chunks into single message`);

    // Track output token usage for received text
    updateTokenUsage(state, 0, 0, combinedText);

    // console.log('[Callback] Calling onTextReceived with buffered text...');
    state.config.onTextReceived?.(combinedText);
    // console.log('[Callback] onTextReceived completed for buffered text');
  }

  // Clear buffer and timeout
  state.textBuffer = [];
  if (state.textBufferTimeout) {
    clearTimeout(state.textBufferTimeout);
    state.textBufferTimeout = null;
  }
};

const handleTextResponse = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  const isSystemAssistantMode = state.config.targetLanguage === 'System Assistant';

  // Handle text response
  // Commented out verbose text analysis logging
  // console.log('[Text Analysis] Analyzing message for text content:', {
  //   hasServerContent: !!message.serverContent,
  //   hasModelTurn: !!message.serverContent?.modelTurn,
  //   hasParts: !!message.serverContent?.modelTurn?.parts,
  //   partsLength: message.serverContent?.modelTurn?.parts?.length || 0,
  //   hasOutputTranscription: !!message.serverContent?.outputTranscription
  // });

  const transcriptionText = message.serverContent?.outputTranscription?.text;
  if (transcriptionText && transcriptionText.trim().length > 0) {
    return;
  }

  if (message.serverContent?.modelTurn?.parts) {
    // Commented out verbose text parts logging
    // console.log(`[Text Analysis] Processing ${message.serverContent.modelTurn.parts.length} parts`);

    for (let i = 0; i < message.serverContent.modelTurn.parts.length; i++) {
      const part = message.serverContent.modelTurn.parts[i];
      // console.log(`[Text Analysis] Part ${i + 1}:`, {
      //   hasText: !!part.text,
      //   hasInlineData: !!part.inlineData,
      //   textContent: part.text ? `"${part.text.substring(0, 100)}${part.text.length > 100 ? '...' : ''}"` : 'No text',
      //   textLength: part.text?.length || 0
      // });

      if (part.text) {
        // Keep minimal text response logging
        debugLog('[Gemini Live Audio] Received translated text:', part.text);

        // Track output token usage for received text
        state.receivedTextChunks += 1;
        state.lastOutputTextTime = Date.now();
        updateTokenUsage(state, 0, 0, part.text);

        if (isSystemAssistantMode || part.text.trim().length > 0) {
          state.config.onTextReceived?.(part.text);
        }
      }
    }
  } else {
    // Commented out verbose no text parts logging
    // console.log('[Text Analysis] No text parts found in message - no text response from Gemini');
  }
};

const startAudioCollectionIfNeeded = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  if (message.serverContent?.modelTurn && !state.isCollectingAudio) {
    state.isCollectingAudio = true;
    state.audioChunks = [];
    debugLog('[Gemini Live Audio] Starting audio collection for new turn');
  }
};

const collectAudioChunks = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  const parts = message.serverContent?.modelTurn?.parts;
  if (!parts) {
    return;
  }

  for (const part of parts) {
    if (!part.inlineData?.data || !part.inlineData.mimeType?.includes('audio')) {
      continue;
    }

    // Commented out verbose audio chunk logging
    // console.log('[Audio Output] AUDIO CHUNK RECEIVED from Gemini');
    // console.log(`[Audio Output] Chunk size: ${part.inlineData.data.length} characters (base64)`);
    state.audioChunks.push(part.inlineData.data);
    state.receivedAudioChunks += 1;
    state.lastOutputAudioTime = Date.now();
    if (state.lastOutputAudioTime - state.lastInfoAudioChunkTime >= state.infoLogIntervalMs) {
      infoLog(`[Gemini Live Audio] Received audio chunk: ${part.inlineData.data.length} chars`);
      state.lastInfoAudioChunkTime = state.lastOutputAudioTime;
    }
    // Store MIME type from first chunk
    if (!state.audioMimeType && part.inlineData.mimeType) {
      state.audioMimeType = part.inlineData.mimeType;
      debugLog(`[Gemini Live Audio] Audio MIME type: ${state.audioMimeType}`);
    }
    debugLog(`[Gemini Live Audio] Collected audio chunk: ${part.inlineData.data.length} chars`);
  }
};

const finalizeTurnIfComplete = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  if (!message.serverContent?.turnComplete || !state.isCollectingAudio) {
    return;
  }

  debugLog(`[Gemini Live Audio] Turn complete, processing ${state.audioChunks.length} audio chunks`);
  state.isCollectingAudio = false;

  // Flush text buffer when turn completes
  flushTextBuffer(state);

  if (state.audioChunks.length > 0) {
    processCompleteAudioTurn(state, state.audioChunks, state.audioMimeType);
    state.audioChunks = [];
    state.audioMimeType = undefined;
  } else {
    debugWarn('[Gemini Live Audio] Turn complete but no audio chunks received');
  }
};

const handleInterruption = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  const interrupted = message.serverContent?.interrupted;
  if (!interrupted) {
    return;
  }

  debugLog('[Gemini Live Audio] Received interruption signal');
  state.isCollectingAudio = false;
  state.audioChunks = [];

  // Clear text buffer on interruption
  state.textBuffer = [];
  if (state.textBufferTimeout) {
    clearTimeout(state.textBufferTimeout);
    state.textBufferTimeout = null;
  }

  for (const source of state.sources.values()) {
    source.stop();
    state.sources.delete(source);
  }
  state.nextStartTime = 0;
};

const handleInputTranscription = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  const transcript = message.serverContent?.inputTranscription?.text;
  if (transcript) {
    state.config.onInputTranscription?.(transcript);
  }
};

const bufferOutputTranscription = (state: GeminiLiveAudioState, message: LiveServerMessage): void => {
  const transcriptText = message.serverContent?.outputTranscription?.text;
  if (!transcriptText) {
    return;
  }

  state.receivedTextChunks += 1;
  state.lastOutputTextTime = Date.now();
  // Commented out verbose text buffer logging
  // console.log('[Text Buffer] TRANSCRIPT CHUNK RECEIVED:', transcriptText);

  // Add to text buffer
  state.textBuffer.push(transcriptText);
  state.lastTextTime = Date.now();

  // Clear existing timeout
  if (state.textBufferTimeout) {
    clearTimeout(state.textBufferTimeout);
  }

  // Set timeout to send buffered text if no more text comes
  state.textBufferTimeout = setTimeout(() => {
    flushTextBuffer(state);
  }, state.textBufferDelay);

  // console.log(`[Text Buffer] Buffered ${state.textBuffer.length} text chunks`);
};
