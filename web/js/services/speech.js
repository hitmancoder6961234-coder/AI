// Darkness AI Speech & Text Reader Service
// Provides native SpeechSynthesis with keepalive, language detection, natural voice management, playback controls, and event dispatching.

(function () {
  window.Darkness = window.Darkness || {};

  class LanguageDetector {
    /**
     * Determines language of a text block (Hindi, Marathi, Hinglish, English)
     * @param {string} text 
     * @returns {{lang: string, tag: string, name: string, isHinglish?: boolean}}
     */
    static detect(text) {
      if (!text || typeof text !== "string") {
        return { lang: "en", tag: "en-US", name: "English" };
      }
      const str = text.trim();
      if (!str) return { lang: "en", tag: "en-US", name: "English" };

      // Count Devanagari script characters: \u0900 to \u097F
      const devanagariMatches = str.match(/[\u0900-\u097F]/g) || [];
      const latinMatches = str.match(/[a-zA-Z]/g) || [];
      const devCount = devanagariMatches.length;
      const latinCount = latinMatches.length;

      // If Devanagari characters are present significantly
      if (devCount >= 3 || (devCount > 0 && devCount / (latinCount + devCount) > 0.12)) {
        // Distinguish Marathi vs Hindi:
        // 1. Marathi unique character: ळ (\u0933)
        const hasMarathiChar = /[\u0933]/.test(str);
        // 2. High-confidence Marathi grammatical keywords (matched with Unicode boundary, not ASCII \b)
        const marathiKeywords = /(?:^|[^\u0900-\u097F])(आहे|नाही|करा|बघा|पाहिजे|म्हणून|होय|काय|कसे|झाले|करणार|वाचून|माहिती|प्रकल्प|आणि|याच्या|त्याच्या|सुद्धा|केले|होते|आहोत|येथे|सर्व|फार|छान|मित्रांनो|वापरा|सांगा|करतो|दाखवतो|चालतो|वाचताना|बघू|नक्की|तयार)(?:$|[^\u0900-\u097F])/;
        if (hasMarathiChar || marathiKeywords.test(str)) {
          return { lang: "mr", tag: "mr-IN", name: "Marathi" };
        }
        return { lang: "hi", tag: "hi-IN", name: "Hindi" };
      }

      // Check for Hinglish (Hindi / Indic words written in Roman / Latin script)
      const hinglishWordsRegex = /\b(hai|hain|karna|karke|kare|karo|nahi|nhi|yeh|woh|kya|kyun|kaise|isme|usme|kardo|taki|apni|apna|mera|meri|mujhe|tum|aap|samajh|dekho|accha|theek|batao|samjhao|shuru|khatam|wala|wali|wale|aur|lekin|magar|sabse|pehle|baad|hoga|hogi|honge|sakte|sakta|sakti|bhai|yaar|dost|madad|chahiye|chalega|bana|liya|dikhaye)\b/gi;
      const hinglishMatches = str.match(hinglishWordsRegex) || [];
      const words = str.match(/\b[a-zA-Z]+\b/g) || [];
      const totalWords = words.length;

      if (hinglishMatches.length >= 2 && totalWords > 0 && (hinglishMatches.length / totalWords >= 0.03 || hinglishMatches.length >= 4)) {
        return { lang: "hinglish", tag: "en-IN", name: "Hinglish", isHinglish: true };
      }

      return { lang: "en", tag: "en-US", name: "English" };
    }
  }

  class SpeechController {
    constructor() {
      this.supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      this.synth = this.supported ? window.speechSynthesis : null;
      this.voices = [];
      this.selectedVoiceUri = localStorage.getItem("darkness_reader_voice") || "";
      this.rate = parseFloat(localStorage.getItem("darkness_reader_speed") || "1.0");
      this.pitch = 1.0;
      this.state = "idle"; // "idle" | "ready" | "playing" | "paused" | "stopped"
      this.activeMessageId = null;
      this.activeVoiceUri = null;
      this.detectedLanguage = { lang: "en", tag: "en-US", name: "English" };
      this.segments = [];
      this.currentSegmentIndex = 0;
      this.currentUtterance = null;
      this.listeners = new Map();
      this.keepAliveTimer = null;
      this.resumeRetryTimer = null;

      if (this.supported) {
        this.initVoices();
      }
    }

    isSupported() {
      return this.supported;
    }

    initVoices() {
      if (!this.supported) return;
      const populate = () => {
        try {
          this.voices = this.synth.getVoices() || [];
          this.emit("voices-changed", this.voices);
        } catch (e) {
          console.warn("[Darkness Speech] Failed to retrieve system voices:", e);
        }
      };

      populate();
      if (typeof this.synth.onvoiceschanged !== "undefined") {
        this.synth.onvoiceschanged = populate;
      }
    }

    getVoices() {
      if (!this.supported) return [];
      if (!this.voices || this.voices.length === 0) {
        this.voices = this.synth.getVoices() || [];
      }
      return this.voices;
    }

    detectLanguage(text) {
      return LanguageDetector.detect(text);
    }

    /**
     * Retrieve matching voices for a given language code
     * @param {string} langCode - 'hi', 'mr', 'hinglish', 'en', or BCP-47 tag
     * @returns {SpeechSynthesisVoice[]}
     */
    getVoicesForLanguage(langCode) {
      const allVoices = this.getVoices();
      if (!allVoices.length) return [];
      const code = (langCode || "en").toLowerCase();

      // 1. Hindi
      if (code.startsWith("hi")) {
        const hiVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("hi"));
        if (hiVoices.length > 0) return hiVoices;
        // Fallback: Indian English voices (often support Indic phonetics)
        const inVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en-in") || /india|heera|neerja|prabhat/i.test(v.name));
        return inVoices.length > 0 ? inVoices : allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
      }

      // 2. Marathi
      if (code.startsWith("mr")) {
        const mrVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("mr"));
        if (mrVoices.length > 0) return mrVoices;
        // Fallback: Hindi voices (Devanagari script phonetics shared)
        const hiVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("hi"));
        if (hiVoices.length > 0) return hiVoices;
        const inVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en-in") || /india/i.test(v.name));
        return inVoices.length > 0 ? inVoices : allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
      }

      // 3. Hinglish (Latin script Hindi/English mix)
      if (code === "hinglish" || code.startsWith("en-in")) {
        const inVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en-in") || /india|heera|neerja|prabhat|ravi|kavya/i.test(v.name));
        const hiVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("hi"));
        const combined = [...inVoices, ...hiVoices];
        if (combined.length > 0) return combined;
        return allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
      }

      // 4. English (rank natural / neural voices higher)
      const enVoices = allVoices.filter((v) => (v.lang || "").toLowerCase().startsWith("en"));
      if (enVoices.length > 0) {
        return enVoices.slice().sort((a, b) => {
          const score = (v) => (/natural|neural|google|premium|samantha|jenny|guy|aria/i.test(v.name) ? 2 : 1);
          return score(b) - score(a);
        });
      }

      return allVoices;
    }

    /**
     * Finds best matching voice for a specific language or text block
     * @param {string} text 
     * @param {string|null} preferredUri 
     * @returns {SpeechSynthesisVoice|null}
     */
    getBestVoiceForText(text, preferredUri = null) {
      const voices = this.getVoices();
      if (!voices.length) return null;

      if (preferredUri) {
        const found = voices.find((v) => v.voiceURI === preferredUri || v.name === preferredUri);
        if (found) return found;
      }

      const detected = LanguageDetector.detect(text);
      const candidates = this.getVoicesForLanguage(detected.lang);
      if (candidates.length > 0) return candidates[0];

      return voices.find((v) => v.lang.startsWith("en")) || voices[0];
    }

    /**
     * Preview a voice with a natural 2-second audio sample
     * @param {string} voiceUri 
     * @param {string|null} sampleText 
     */
    previewVoice(voiceUri, sampleText = null) {
      if (!this.supported) return;
      const voices = this.getVoices();
      const voice = voices.find((v) => v.voiceURI === voiceUri || v.name === voiceUri);
      if (!voice) return;

      this._stopRaw();

      let text = sampleText;
      if (!text) {
        const lang = (voice.lang || "").toLowerCase();
        if (lang.startsWith("hi")) {
          text = "नमस्ते, यह मेरी प्राकृतिक आवाज़ है।";
        } else if (lang.startsWith("mr")) {
          text = "नमस्कार, हा माझा आवाज आहे.";
        } else if (lang.startsWith("en-in") || /india/i.test(voice.name)) {
          text = "Hello! I am your AI Professor. I will explain your code clearly.";
        } else {
          text = "Hello! I am your AI Professor. I will guide you through this explanation.";
        }
      }

      const utt = new SpeechSynthesisUtterance(text);
      utt.voice = voice;
      utt.lang = voice.lang || "en-US";
      utt.rate = this.rate;
      utt.pitch = this.pitch;
      this.synth.speak(utt);
    }

    setVoice(voiceUri) {
      this.selectedVoiceUri = voiceUri;
      this.activeVoiceUri = voiceUri;
      try {
        localStorage.setItem("darkness_reader_voice", voiceUri);
      } catch (e) {}
      this.emit("voice-change", voiceUri);

      // If currently playing, restart current segment with new voice
      if (this.state === "playing" && this.currentUtterance) {
        const currentIdx = this.currentSegmentIndex;
        this._stopRaw();
        this._playSegment(currentIdx);
      }
    }

    getVoice() {
      const voices = this.getVoices();
      if (!voices.length) return null;
      if (this.activeVoiceUri) {
        const found = voices.find((v) => v.voiceURI === this.activeVoiceUri || v.name === this.activeVoiceUri);
        if (found) return found;
      }
      if (this.selectedVoiceUri) {
        const found = voices.find((v) => v.voiceURI === this.selectedVoiceUri || v.name === this.selectedVoiceUri);
        if (found) return found;
      }
      return this.getBestVoiceForText("", null);
    }

    setSpeed(newRate) {
      const rateNum = Math.max(0.5, Math.min(2.5, parseFloat(newRate) || 1.0));
      this.rate = rateNum;
      try {
        localStorage.setItem("darkness_reader_speed", String(rateNum));
      } catch (e) {}
      this.emit("speed-change", rateNum);

      if (this.state === "playing" && this.currentUtterance) {
        const currentIdx = this.currentSegmentIndex;
        this._stopRaw();
        this._playSegment(currentIdx);
      }
    }

    getSpeed() {
      return this.rate;
    }

    getState() {
      return this.state;
    }

    getActiveMessageId() {
      return this.activeMessageId;
    }

    getCurrentSegmentIndex() {
      return this.currentSegmentIndex;
    }

    getTotalSegments() {
      return this.segments ? this.segments.length : 0;
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(callback);
      }
    }

    emit(event, ...args) {
      if (this.listeners.has(event)) {
        for (const cb of this.listeners.get(event)) {
          try {
            cb(...args);
          } catch (e) {
            console.error(`[Darkness Speech] Listener error for ${event}:`, e);
          }
        }
      }
    }

    _setState(newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit("state-change", newState, oldState, this.activeMessageId);
    }

    _startKeepAlive() {
      this._stopKeepAlive();
      // Chrome audio synthesis pauses silently around 15 seconds. Keepalive keeps it active.
      this.keepAliveTimer = setInterval(() => {
        if (this.state === "playing" && this.synth && this.synth.speaking && !this.synth.paused) {
          try {
            this.synth.pause();
            this.synth.resume();
          } catch (e) {}
        }
      }, 10000);
    }

    _stopKeepAlive() {
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      if (this.resumeRetryTimer) {
        clearTimeout(this.resumeRetryTimer);
        this.resumeRetryTimer = null;
      }
    }

    _stopRaw() {
      this._stopKeepAlive();
      if (this.supported && this.synth) {
        try {
          this.synth.cancel();
        } catch (e) {}
      }
      this.currentUtterance = null;
    }

    /**
     * Start playing segments for a given message
     * @param {string} messageId 
     * @param {Array<{text: string, element?: HTMLElement, type?: string, lang?: string, tag?: string}>} segments 
     * @param {number} startSegmentIndex 
     * @param {string|null} preferredVoiceUri 
     */
    play(messageId, segments, startSegmentIndex = 0, preferredVoiceUri = null) {
      if (!this.supported) {
        console.warn("[Darkness Speech] Text-to-speech is not supported in this browser.");
        this.emit("unsupported");
        return false;
      }

      if (!segments || !segments.length) {
        console.warn("[Darkness Speech] No readable text segments provided.");
        return false;
      }

      // Stop previous speech cleanly across any message
      this._stopRaw();

      this.activeMessageId = messageId;
      this.segments = segments;
      this.currentSegmentIndex = Math.max(0, Math.min(startSegmentIndex, segments.length - 1));
      if (preferredVoiceUri) {
        this.activeVoiceUri = preferredVoiceUri;
      }

      // Determine overall language of the explanation
      const fullTextSample = segments.map((s) => s.text || "").join(" ").slice(0, 500);
      this.detectedLanguage = LanguageDetector.detect(fullTextSample);

      this._setState("playing");
      this._startKeepAlive();
      this._playSegment(this.currentSegmentIndex);
      return true;
    }

    _playSegment(index) {
      if (!this.supported || this.state !== "playing") return;
      if (index >= this.segments.length) {
        this.stop(false);
        this.emit("complete", this.activeMessageId);
        return;
      }

      this.currentSegmentIndex = index;
      const seg = this.segments[index];
      const textToSpeak = (seg && seg.text) ? seg.text.trim() : "";

      if (!textToSpeak) {
        this._playSegment(index + 1);
        return;
      }

      // Language detection for this specific segment (multilingual code-switching support)
      const segLang = seg.lang ? { lang: seg.lang, tag: seg.tag || "en-US" } : LanguageDetector.detect(textToSpeak);

      this.emit("segment-start", index, seg, this.activeMessageId, segLang);

      try {
        const utterance = new SpeechSynthesisUtterance(textToSpeak);

        // Voice selection: Match segment language
        let matchedVoice = null;
        if (this.activeVoiceUri) {
          const v = this.voices.find((voc) => voc.voiceURI === this.activeVoiceUri || voc.name === this.activeVoiceUri);
          if (v) {
            // Check if activeVoice is compatible with Devanagari when segment is Devanagari
            const isDevanagari = /[\u0900-\u097F]/.test(textToSpeak);
            const voiceLang = (v.lang || "").toLowerCase();
            if (isDevanagari && !voiceLang.startsWith("hi") && !voiceLang.startsWith("mr")) {
              // English voice cannot pronounce Devanagari; pick Hindi/Marathi voice
              matchedVoice = this.getBestVoiceForText(textToSpeak, null);
            } else {
              matchedVoice = v;
            }
          }
        }

        if (!matchedVoice) {
          matchedVoice = this.getBestVoiceForText(textToSpeak, null);
        }

        if (matchedVoice) {
          utterance.voice = matchedVoice;
          utterance.lang = matchedVoice.lang || segLang.tag || "en-US";
        } else {
          utterance.lang = segLang.tag || "en-US";
        }

        utterance.rate = this.rate;
        utterance.pitch = this.pitch;

        utterance.onstart = () => {
          if (this.state !== "playing") return;
          this.emit("utterance-start", index, seg, matchedVoice);
        };

        utterance.onboundary = (e) => {
          if (this.state === "playing") {
            this.emit("boundary", e.charIndex, e.name, index, seg);
          }
        };

        utterance.onpause = () => {
          if (this.state === "playing") {
            this._setState("paused");
          }
        };

        utterance.onresume = () => {
          if (this.state === "paused") {
            this._setState("playing");
          }
        };

        utterance.onend = () => {
          this.emit("segment-end", index, seg);
          if (this.state === "playing") {
            // Natural pause between educational segments
            setTimeout(() => {
              if (this.state === "playing") {
                this._playSegment(index + 1);
              }
            }, 100);
          }
        };

        utterance.onerror = (e) => {
          if (e.error === "canceled" || e.error === "interrupted") {
            return;
          }
          console.warn("[Darkness Speech] Speech utterance warning:", e);
          this.emit("segment-error", e, index);
          if (this.state === "playing") {
            this._playSegment(index + 1);
          }
        };

        this.currentUtterance = utterance;
        this.synth.speak(utterance);
      } catch (err) {
        console.error("[Darkness Speech] Failed to speak segment:", err);
        this.emit("error", err);
        this.stop();
      }
    }

    pause() {
      if (!this.supported || this.state !== "playing") return;
      this._stopKeepAlive();
      try {
        if (this.synth.speaking) {
          this.synth.pause();
        }
      } catch (e) {}
      this._setState("paused");
      this.emit("pause", this.activeMessageId, this.currentSegmentIndex);
    }

    resume() {
      if (!this.supported || this.state !== "paused") return;
      this._setState("playing");
      this._startKeepAlive();
      try {
        if (this.synth.paused) {
          this.synth.resume();
        } else {
          this._playSegment(this.currentSegmentIndex);
        }
      } catch (e) {
        this._playSegment(this.currentSegmentIndex);
      }
      this.emit("resume", this.activeMessageId, this.currentSegmentIndex);
    }

    stop(emitEvent = true) {
      this._stopRaw();
      const prevMessageId = this.activeMessageId;
      this.activeMessageId = null;
      this.activeVoiceUri = null;
      this.currentSegmentIndex = 0;
      this.segments = [];
      this._setState("stopped");
      if (emitEvent) {
        this.emit("stop", prevMessageId);
      }
    }

    replay() {
      if (this.activeMessageId && this.segments.length > 0) {
        this.play(this.activeMessageId, this.segments, 0, this.activeVoiceUri);
      }
    }

    skipToSegment(index) {
      if (this.segments && index >= 0 && index < this.segments.length) {
        this._stopRaw();
        this._setState("playing");
        this._startKeepAlive();
        this._playSegment(index);
      }
    }
  }

  window.Darkness.LanguageDetector = LanguageDetector;
  window.Darkness.speechController = new SpeechController();
})();
